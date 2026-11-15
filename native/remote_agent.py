#!/usr/bin/env python3
import argparse
import hashlib
import json
import mimetypes
import os
import re
import shutil
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

try:
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = None
except ImportError:
    Image = None
    ImageOps = None


IMAGE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff",
    ".gif", ".bmp", ".avif", ".heic", ".heif", ".svg",
}
CACHE_DIR = Path.home() / ".cache" / "multifunction-file-browser" / "images"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
RESIZE_LOCK = threading.Lock()


def expand_path(value):
    return os.path.abspath(os.path.expanduser(value))


def image_type(file_path):
    return "image" if Path(file_path).suffix.lower() in IMAGE_EXTENSIONS else "file"


def entry(file_path, root):
    stat = os.stat(file_path)
    is_directory = os.path.isdir(file_path)
    return {
        "type": "directory" if is_directory else image_type(file_path),
        "name": os.path.basename(file_path),
        "path": file_path,
        "relativePath": os.path.relpath(file_path, root) if file_path != root else os.path.basename(file_path),
        "size": None if is_directory else stat.st_size,
        "modified": stat.st_mtime * 1000,
    }


def stat_path(file_path):
    file_path = expand_path(file_path)
    stat = os.stat(file_path)
    return {
        "path": file_path,
        "size": stat.st_size,
        "modified": stat.st_mtime * 1000,
        "directory": os.path.isdir(file_path),
        "writable": os.access(file_path, os.W_OK),
    }


def list_path(target, recursive):
    target = expand_path(target)
    if not os.path.exists(target):
        raise FileNotFoundError(target)
    if os.path.isfile(target):
        return {"targetType": "file", "path": target, "entries": [entry(target, target)]}

    result = []
    if recursive:
        for root, directories, files in os.walk(target):
            directories.sort()
            files.sort()
            for name in files:
                result.append(entry(os.path.join(root, name), target))
                if len(result) >= 100000:
                    return {"targetType": "directory", "path": target, "entries": result}
    else:
        with os.scandir(target) as scan:
            for item in scan:
                try:
                    result.append(entry(item.path, target))
                except (FileNotFoundError, PermissionError):
                    continue
        result.sort(key=lambda item: (item["type"] != "directory", item["relativePath"].lower()))
    return {"targetType": "directory", "path": target, "entries": result}


def image_metadata(file_path):
    if Image is None:
        raise RuntimeError("Pillow is not installed on the remote host")
    with Image.open(file_path) as image:
        width, height = image.size
        orientation = image.getexif().get(274)
        if orientation in (5, 6, 7, 8):
            width, height = height, width
        return width, height, "A" in image.getbands()


def resized_image(file_path, max_dimension, force=False, output_format_override=None):
    file_path = expand_path(file_path)
    stat = os.stat(file_path)
    width, height, has_alpha = image_metadata(file_path)
    scale = min(1.0, max_dimension / width, max_dimension / height)
    resized = scale < 1.0
    output_width = max(1, round(width * scale))
    output_height = max(1, round(height * scale))
    if not resized and not force:
        return {
            "resized": False,
            "originalWidth": width,
            "originalHeight": height,
            "width": width,
            "height": height,
        }

    output_format = output_format_override or ("png" if has_alpha else "jpg")
    cache_key = hashlib.sha256(
        f"{file_path}:{stat.st_size}:{stat.st_mtime_ns}:{max_dimension}:{output_format}".encode()
    ).hexdigest()
    cache_name = f"{cache_key}.{output_format}"
    destination = CACHE_DIR / cache_name
    with RESIZE_LOCK:
        if not destination.exists():
            temporary = CACHE_DIR / f"{cache_name}.{os.getpid()}.tmp"
            with Image.open(file_path) as image:
                image = ImageOps.exif_transpose(image)
                image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
                if output_format == "png":
                    image.save(temporary, format="PNG", compress_level=1)
                else:
                    image.convert("RGB").save(temporary, format="JPEG", quality=88)
            os.replace(temporary, destination)
    return {
        "resized": resized,
        "originalWidth": width,
        "originalHeight": height,
        "width": output_width,
        "height": output_height,
        "cacheName": cache_name,
        "format": output_format,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "MultifunctionFileBrowser/1"

    def log_message(self, *_args):
        pass

    def send_json(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def authorized_query(self):
        query = parse_qs(urlparse(self.path).query)
        if query.get("token", [""])[0] != self.server.token:
            self.send_json(401, {"error": "invalid token"})
            return None
        return query

    def stream_file(self, file_path, download=False):
        file_path = expand_path(file_path)
        stat = os.stat(file_path)
        start, end = 0, stat.st_size - 1
        status = 200
        range_header = self.headers.get("Range")
        if range_header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header)
            if match:
                if not match.group(1) and match.group(2):
                    suffix_length = int(match.group(2))
                    start = max(0, stat.st_size - suffix_length)
                elif match.group(1):
                    start = int(match.group(1))
                if match.group(1) and match.group(2):
                    end = min(end, int(match.group(2)))
                if start > end or start >= stat.st_size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{stat.st_size}")
                    self.end_headers()
                    return
                status = 206
        length = max(0, end - start + 1)
        self.send_response(status)
        self.send_header("Content-Type", mimetypes.guess_type(file_path)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{stat.st_size}")
        if download:
            name = os.path.basename(file_path).replace('"', "")
            fallback = "".join(char if 32 <= ord(char) < 127 else "_" for char in name)
            self.send_header(
                "Content-Disposition",
                f'attachment; filename="{fallback or "download"}"; '
                f"filename*=UTF-8''{quote(name)}",
            )
        self.end_headers()
        with open(file_path, "rb") as source:
            source.seek(start)
            remaining = length
            while remaining:
                chunk = source.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_GET(self):
        parsed = urlparse(self.path)
        query = self.authorized_query()
        if query is None:
            return
        try:
            if parsed.path == "/health":
                self.send_json(200, {"ok": True, "pillow": Image is not None})
            elif parsed.path == "/shutdown":
                self.send_json(200, {"ok": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
            elif parsed.path == "/list":
                self.send_json(200, list_path(
                    query.get("path", ["~"])[0],
                    query.get("recursive", ["0"])[0] == "1",
                ))
            elif parsed.path == "/stat":
                self.send_json(200, stat_path(query["path"][0]))
            elif parsed.path == "/image-info":
                maximum = max(2048, min(16384, int(query.get("maxDimension", ["8192"])[0])))
                self.send_json(200, resized_image(query["path"][0], maximum))
            elif parsed.path == "/thumbnail":
                info = resized_image(
                    query["path"][0],
                    480,
                    force=True,
                    output_format_override="jpg",
                )
                self.stream_file(str(CACHE_DIR / info["cacheName"]))
            elif parsed.path == "/cached":
                name = query.get("name", [""])[0]
                if not re.fullmatch(r"[a-f0-9]{64}\.(jpg|png)", name):
                    raise ValueError("invalid cache name")
                self.stream_file(str(CACHE_DIR / name))
            elif parsed.path == "/file":
                self.stream_file(
                    query["path"][0],
                    query.get("download", ["0"])[0] == "1",
                )
            else:
                self.send_json(404, {"error": "not found"})
        except FileNotFoundError as error:
            self.send_json(404, {"error": f"path not found: {error}"})
        except Exception as error:
            self.send_json(500, {"error": str(error)})

    def do_PUT(self):
        parsed = urlparse(self.path)
        query = self.authorized_query()
        if query is None:
            return
        temporary = None
        try:
            if parsed.path not in {"/upload", "/save"}:
                self.send_json(404, {"error": "not found"})
                return
            overwrite = parsed.path == "/save"
            target = expand_path(query["path"][0])
            parent = os.path.dirname(target)
            if overwrite and not os.path.isfile(target):
                self.send_json(404, {"error": "text file not found"})
                return
            if overwrite and not os.access(target, os.W_OK):
                self.send_json(403, {"error": "text file is read-only"})
                return
            if not overwrite:
                os.makedirs(parent, exist_ok=True)
            if not overwrite and os.path.exists(target):
                self.send_json(409, {"error": f"file already exists: {os.path.basename(target)}"})
                return
            original_mode = os.stat(target).st_mode & 0o777 if overwrite else None
            length = int(self.headers.get("Content-Length", "-1"))
            if length < 0:
                self.send_json(411, {"error": "Content-Length is required"})
                return
            if length > 50 * 1024 * 1024 * 1024:
                self.send_json(413, {"error": "file is larger than 50 GB"})
                return
            temporary = os.path.join(
                parent,
                f".{os.path.basename(target)}.anyfs-{os.getpid()}-{threading.get_ident()}.tmp",
            )
            remaining = length
            with open(temporary, "xb") as destination:
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise IOError("upload ended before Content-Length")
                    destination.write(chunk)
                    remaining -= len(chunk)
                destination.flush()
                os.fsync(destination.fileno())
            if original_mode is not None:
                os.chmod(temporary, original_mode)
            if overwrite:
                os.replace(temporary, target)
            else:
                os.link(temporary, target)
                os.unlink(temporary)
            temporary = None
            result = os.stat(target)
            self.send_json(200 if overwrite else 201, {
                "ok": True,
                "path": target,
                "name": os.path.basename(target),
                "size": result.st_size,
                "modified": result.st_mtime * 1000,
            })
        except FileExistsError:
            self.send_json(409, {"error": "file already exists"})
        except Exception as error:
            self.send_json(500, {"error": str(error)})
        finally:
            if temporary:
                try:
                    os.unlink(temporary)
                except FileNotFoundError:
                    pass

    def do_POST(self):
        parsed = urlparse(self.path)
        query = self.authorized_query()
        if query is None:
            return
        try:
            if parsed.path == "/delete":
                target = expand_path(query["path"][0])
                protected = {
                    os.path.abspath(os.sep),
                    os.path.abspath(os.path.expanduser("~")),
                }
                if os.path.abspath(target) in protected:
                    self.send_json(403, {"error": "refusing to delete a protected directory"})
                    return
                if not os.path.lexists(target):
                    self.send_json(200, {"ok": True, "path": target, "alreadyMissing": True})
                    return
                if os.path.isdir(target) and not os.path.islink(target):
                    if query.get("directory", ["0"])[0] != "1":
                        self.send_json(400, {"error": "directory flag is required"})
                        return
                    shutil.rmtree(target)
                else:
                    os.unlink(target)
                self.send_json(200, {"ok": True, "path": target})
                return
            if parsed.path != "/rename":
                self.send_json(404, {"error": "not found"})
                return
            source = expand_path(query["path"][0])
            new_name = query["name"][0]
            if (
                not new_name
                or new_name in {".", ".."}
                or "/" in new_name
                or "\\" in new_name
                or "\0" in new_name
            ):
                self.send_json(400, {"error": "invalid file name"})
                return
            destination = os.path.join(os.path.dirname(source), new_name)
            if os.path.exists(destination):
                self.send_json(409, {"error": f"file already exists: {new_name}"})
                return
            os.rename(source, destination)
            self.send_json(200, {
                "ok": True,
                "path": destination,
                "name": new_name,
            })
        except FileNotFoundError as error:
            self.send_json(404, {"error": f"path not found: {error}"})
        except Exception as error:
            self.send_json(500, {"error": str(error)})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", required=True)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.token = args.token
    print(f"READY {server.server_port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
