const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const REMOTE_DIRECTORY = "$HOME/.cache/multifunction-file-browser";

function sshOptions(source) {
  const args = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=12",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=2",
    "-o", "TCPKeepAlive=yes",
    "-o", "ClearAllForwardings=yes",
    "-o", "LogLevel=ERROR",
  ];
  if (source.port) args.push("-p", String(source.port));
  return args;
}

function runSsh(source, command, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [...sshOptions(source), source.target, command], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `ssh exited ${code}`));
    });
    child.stdin.end(input);
  });
}

async function resolvedTunnelOptions(source) {
  const output = await new Promise((resolve, reject) => {
    const child = spawn("ssh", ["-G", source.target], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || "ssh -G failed"));
    });
  });
  const config = new Map();
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf(" ");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!config.has(key)) config.set(key, []);
    config.get(key).push(value);
  }
  const first = (name, fallback) => config.get(name)?.[0] || fallback;
  const args = [
    "-F", "/dev/null",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=12",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=2",
    "-o", "TCPKeepAlive=yes",
    "-o", "LogLevel=ERROR",
    "-p", String(source.port || first("port", "22")),
    "-l", first("user", process.env.USER),
  ];
  for (const identity of config.get("identityfile") || []) {
    args.push("-i", identity.replace(/^~/, process.env.HOME));
  }
  const copyOption = (name, optionName = name) => {
    const value = first(name);
    if (value && value !== "none") args.push("-o", `${optionName}=${value}`);
  };
  copyOption("proxyjump", "ProxyJump");
  copyOption("proxycommand", "ProxyCommand");
  copyOption("stricthostkeychecking", "StrictHostKeyChecking");
  copyOption("userknownhostsfile", "UserKnownHostsFile");
  copyOption("hostkeyalias", "HostKeyAlias");
  if (first("identitiesonly") === "yes") args.push("-o", "IdentitiesOnly=yes");
  return { args, hostname: first("hostname", source.target) };
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    let errors = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("远端助手启动超时"));
    }, 15000);
    child.stderr.on("data", (chunk) => {
      errors += chunk.toString("utf8");
    });
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      const match = output.match(/(?:^|\n)READY (\d+)(?:\n|$)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(Number(match[1]));
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      reject(new Error(errors.trim() || `远端助手退出 (${code})`));
    });
  });
}

class RemoteAgentManager {
  constructor(scriptPath = path.join(__dirname, "remote_agent.py")) {
    this.script = fs.readFileSync(scriptPath);
    this.agents = new Map();
    this.reconnectTimers = new Map();
    this.closing = false;
  }

  key(source) {
    return `${source.target}:${source.port || 22}`;
  }

  async connect(source) {
    this.closing = false;
    const key = this.key(source);
    const existing = this.agents.get(key);
    if (existing) return existing;

    const promise = this.start(source, key).catch((error) => {
      this.agents.delete(key);
      throw error;
    });
    this.agents.set(key, promise);
    return promise;
  }

  async start(source, key) {
    await runSsh(
      source,
      `mkdir -p "${REMOTE_DIRECTORY}" && cat > "${REMOTE_DIRECTORY}/remote_agent.py" && chmod 700 "${REMOTE_DIRECTORY}/remote_agent.py"`,
      this.script,
    );

    const token = crypto.randomBytes(24).toString("base64url");
    const remote = spawn(
      "ssh",
      [
        ...sshOptions(source),
        source.target,
        `exec python3 "${REMOTE_DIRECTORY}/remote_agent.py" --token='${token}'`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const remotePort = await waitForReady(remote);
    const localPort = await availablePort();
    const tunnelConnection = await resolvedTunnelOptions(source);
    const tunnel = spawn(
      "ssh",
      [
        ...tunnelConnection.args,
        "-o", "ExitOnForwardFailure=yes",
        "-N",
        "-L", `${localPort}:127.0.0.1:${remotePort}`,
        tunnelConnection.hostname,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let tunnelError = "";
    tunnel.stderr.on("data", (chunk) => {
      tunnelError += chunk.toString("utf8");
    });

    const agent = {
      key,
      source,
      token,
      localPort,
      remotePort,
      remote,
      tunnel,
      heartbeat: null,
      checkingHealth: false,
      established: false,
    };
    const cleanup = () => {
      const current = this.agents.get(key);
      if (current === agent || current instanceof Promise) this.agents.delete(key);
      clearInterval(agent.heartbeat);
      remote.kill();
      tunnel.kill();
      if (agent.established && !this.closing) {
        this.scheduleReconnect(source, key);
      }
    };
    remote.once("close", cleanup);
    tunnel.once("close", cleanup);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await this.fetch(agent, "/health", {}, {}, false);
        if (response.ok) {
          this.agents.set(key, agent);
          agent.established = true;
          agent.heartbeat = setInterval(async () => {
            if (agent.checkingHealth || this.agents.get(key) !== agent) return;
            agent.checkingHealth = true;
            try {
              const health = await this.fetch(agent, "/health", {}, {}, false);
              if (!health.ok) throw new Error(`health status ${health.status}`);
              await health.body?.cancel().catch(() => {});
            } catch {
              this.discard(agent);
              this.connect(source).catch(() => {});
            } finally {
              agent.checkingHealth = false;
            }
          }, 20000);
          agent.heartbeat.unref();
          return agent;
        }
      } catch {
        // Tunnel startup is asynchronous.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    cleanup();
    throw new Error(tunnelError.trim() || "SSH 文件通道启动失败");
  }

  scheduleReconnect(source, key, attempt = 0) {
    if (this.closing || this.agents.has(key) || this.reconnectTimers.has(key)) return;
    const delay = Math.min(30000, 500 * (2 ** attempt));
    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(key);
      if (this.closing || this.agents.has(key)) return;
      try {
        await this.connect(source);
      } catch {
        this.scheduleReconnect(source, key, attempt + 1);
      }
    }, delay);
    timer.unref();
    this.reconnectTimers.set(key, timer);
  }

  discard(agent) {
    if (!agent) return;
    if (this.agents.get(agent.key) === agent) this.agents.delete(agent.key);
    clearInterval(agent.heartbeat);
    agent.remote?.kill();
    agent.tunnel?.kill();
  }

  async fetch(agentOrSource, pathname, params = {}, options = {}, retry = true) {
    const source = agentOrSource.localPort
      ? agentOrSource.source
      : agentOrSource;
    const agent = agentOrSource.localPort
      ? agentOrSource
      : await this.connect(agentOrSource);
    const url = new URL(pathname, `http://127.0.0.1:${agent.localPort}`);
    url.searchParams.set("token", agent.token);
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
    }
    try {
      const response = await fetch(url, options);
      if (retry && response.status === 401) {
        await response.body?.cancel().catch(() => {});
        this.discard(agent);
        return this.fetch(source, pathname, params, options, false);
      }
      return response;
    } catch (error) {
      if (!retry) throw error;
      this.discard(agent);
      return this.fetch(source, pathname, params, options, false);
    }
  }

  async json(source, pathname, params = {}) {
    const response = await this.fetch(source, pathname, params);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `远端助手请求失败 (${response.status})`);
    return body;
  }

  async close() {
    this.closing = true;
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    const values = [...this.agents.values()];
    this.agents.clear();
    await Promise.all(values.map(async (value) => {
      try {
        const agent = await Promise.resolve(value);
        await this.fetch(agent, "/shutdown", {}, {
          signal: AbortSignal.timeout(1500),
        }, false).catch(() => {});
        agent.remote.kill();
        agent.tunnel.kill();
      } catch {
        // Agent startup may already have failed.
      }
    }));
  }
}

module.exports = { RemoteAgentManager };
