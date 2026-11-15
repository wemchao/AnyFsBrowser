# AnyFs Browser

Chrome/Edge 多来源文件浏览插件。支持本地目录、SSH 主机和 S3/MinIO；超大图片超过浏览器上限时会按比例缩放并明确提示。

## 功能

- 主页统一收藏本地、SSH、S3/MinIO 目录
- VS Code 风格双栏浏览：左侧目录树，右侧文件缩略图
- 左侧目录树展开后同时显示子目录和文件，可直接点击预览
- 左侧文件和目录支持一键复制完整路径
- 左侧文件树接管右键菜单，可打开、下载、复制路径；SSH 文件和目录还可就地重命名
- SSH 文件与目录复制时只复制远端路径，不包含 `user@host:` 前缀
- SSH 目录支持从右侧文件区或左侧指定目录拖拽上传，也可从顶部选择多个文件或整个目录
- SSH 文件区支持粘贴剪贴板图片，自动转换并命名为 `paste_YYYYMMDD_HHMMSS.jpg`
- SSH 上传保留目录层级且不会覆盖同名文件
- 所有来源的文件都可直接下载，目录可实时打包为 ZIP 下载
- ZIP、TAR、TAR.GZ、TGZ、TAR.BZ2 和 TAR.XZ 可像目录一样展开浏览
- 归档内部的图片、文档、代码、HTML 和视频可直接预览或单独下载
- 目录树与文件区之间可拖动调整宽度，并自动记住设置
- 顶部路径栏支持直接输入本地、SSH、S3 路径；文件路径会定位到父目录并自动打开
- 网页中的 `s3://`、`oss://` 链接和纯文本地址可点击后在新标签页中打开
- S3 文件搜索框可输入完整的 `s3://` 或 `oss://` 地址并按回车跳转
- 刷新按钮和刷新页面都会保留最初打开的左侧根目录，不会把当前子目录提升为根目录
- 直接打开文件后刷新仍会恢复文件；文件在右侧打开并保留父目录列表
- 从目录打开图片或文档时保留左侧目录树；直接打开文件时使用全屏预览
- S3 同样使用双栏布局：每个 Bucket 作为左侧目录节点，右侧显示文件
- 插件设置仅提供 macOS Finder 和 Windows Explorer 两种全局界面风格
- 本地目录输入框默认使用当前系统用户的主目录
- 文件夹导航、文件名搜索
- Markdown Enhanced 风格预览，支持 Mermaid 流程图和 LaTeX 公式
- Markdown 内的相对路径图片会按文档所在目录解析，支持本地、SSH 和 S3
- Markdown 和 JSON 预览铺满右侧内容区
- Markdown 支持宽屏与阅读模式临时切换；设置页可指定默认版式
- 常见代码、TXT、HTML/XML 安全源码预览与语法高亮
- 文本、代码、JSON、Markdown 和 HTML 支持直接编辑；可手动保存，或在停止修改 1 秒后自动保存
- 本地、SSH、S3/OSS 文本均可写回，归档包内文件保持只读
- `.gitignore`、`.env`、Dockerfile、Makefile 和未知后缀的文本文件会像 VS Code 一样直接打开
- 未知二进制文件只显示“不支持预览”提示，不会自动下载；手动下载保留原始文件名
- DOCX 排版、XLSX 工作表、PPTX 幻灯片文字内容预览；PDF 使用浏览器预览
- 视频默认暂停并铺满右侧预览区，按原始宽高比自适应，支持 Range 拖动播放
- 图片缩略图墙，普通文件可直接在浏览器打开
- 文件区提供类似 Windows 文件资源管理器的缩略图大小滑杆，并自动记住尺寸
- 图片先显示已缓存缩略图，再在后台无阻塞切换到清晰浏览图
- SSH/S3 图片会持久缓存拉取到的原始文件字节，重复浏览不再走远程网络
- 图片保留浏览器原生右键菜单，并增加“复制图像（AnyFs Browser）”；大图查看器也提供独立复制按钮
- 文本预览支持“复制全文”，`Cmd/Ctrl+A` 只选择文件正文，不会选中目录树和工具栏
- 图片支持缩放、拖动和导航图；超大图片按浏览器上限等比例缩放
- SSH 使用系统 `ssh`、`~/.ssh/config`、密钥和 ssh-agent
- SSH 首次连接自动部署远端助手，通过复用隧道完成目录、缩略图和 resize
- SSH 助手在插件会话期间保持运行，连接失效时自动重建通道并重试请求
- 后台定时检查本地与 SSH 通道，断线后自动重连，高清图片请求会等待恢复
- 图片查看器支持返回文件列表、返回主页和下载原图（支持 Range）
- S3/MinIO 首页自动列出凭证 Profile，点击后将 Bucket 作为目录载入，无需手输路径
- S3/MinIO 使用 `~/.aws/credentials`，具体浏览路径可收藏，密钥不写进收藏
- Chrome Native Messaging 自动启动本地能力，本机无需 Python，也无需手动启动服务
- 关闭浏览器后原生辅助程序自动退出
- 每次点击插件都会打开新标签页，可同时浏览多个来源

## 安装

要求 Node.js 20+。

```bash
cd xxx/code/AnyFsBrowser
bash scripts/install-macos.sh
```

安装 Chrome/Edge 插件：

1. 打开 `chrome://extensions`（Edge 使用 `edge://extensions`）。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择轻量扩展目录 `xxx/code/AnyFsBrowser/extension`。

插件固定 ID 为 `bbdpmlabgaoebjojgmgglldcnlllgjjd`。点击浏览器工具栏中的“AnyFs Browser”即可使用；无需运行 `npm start`。

不要直接加载项目根目录：根目录中的 `node_modules` 仅供本地辅助程序使用，会让浏览器错误地显示两百多 MB 的扩展体积。`extension` 只包含浏览器需要的文件。

## 分发给其他人

不能只发送一个 `.crx`：本插件还依赖 Native Messaging、本地 Node.js、Sharp、系统 SSH 和本机凭证。Chrome Stable 通常也会阻止直接安装非商店来源的 CRX。

当前可将完整项目目录打包给其他 macOS 用户。对方安装 Node.js 20+ 后运行：

```bash
cd xxx/AnyFsBrowser
bash scripts/install-macos.sh
```

然后在 `chrome://extensions` 或 `edge://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，加载项目中的 `extension` 目录。

也可以生成不含开发源码和前端构建依赖的完整轻量发布目录：

```bash
npm run build:lite
```

生成位置为 `xxx/code/AnyFsBrowser-lite`。该目录包含轻量扩展、完整 Native Host 和安装脚本，可以直接整体发送给其他 macOS 用户。

正式对外发布时，推荐：

1. 将扩展发布到 Chrome Web Store / Edge 加载项商店。
2. 另行提供 macOS `.pkg` 安装器，用于安装本地运行时和 Native Host。
3. 用户先安装 `.pkg`，再从浏览器商店安装扩展。

从商店首次安装扩展后，会自动打开本地能力安装引导页。页面会检测 Native Host、展示并复制安装命令；受 Chrome 安全沙箱限制，扩展不能替用户自动执行 Bash 脚本。

公开发布后，用户可在终端运行：

```bash
curl -fsSL https://raw.githubusercontent.com/wemchao/AnyFsBrowser/main/scripts/install-online-macos.sh | bash
```

在线脚本会下载 GitHub Release 中的完整轻量运行包，安装到用户目录并注册 Native Host。

如需企业内部分发，可通过浏览器企业策略安装 CRX，但仍需要单独安装 Native Host。CRX 更新必须始终使用同一私钥签名才能保持插件 ID；私钥 `.pem` 不应分发给用户。

## 来源格式

本地目录：

```text
/Users/me/data
```

SSH：

```text
user@host:~
user@host:/data/images
my-server:~
```

SSH 使用 SCP 风格路径并读取 `~/.ssh/config` 别名。连接是非交互式的；首次连接请先在终端执行一次 `ssh user@host`，接受主机指纹，并确保密钥或 ssh-agent 可直接登录。

AWS S3：

```text
s3://my-bucket/path/to/folder
```

阿里云 OSS 风格地址也可直接使用，插件会按同一对象存储路径处理：

```text
oss://my-bucket/path/to/folder
```

MinIO 或其他 S3 兼容存储：

```text
s3://my-bucket/path
```

默认读取 `~/.aws/credentials` 的 `default` Profile，并支持其中的自定义 `oss-endpoint-url` 字段。主页可切换 Profile，也可通过“配置凭证文件”按钮直接编辑。

插件获得网页访问权限后，会识别 HTTP/HTTPS 页面中的 S3/OSS 链接；普通超链接和纯文本地址都支持点击打开。浏览器内部页面、`file://` 页面不支持内容脚本注入。

如有需要，也可以启用高级模式，为单个收藏单独配置 Endpoint、AK、SK、Region 和 Path Style。

进入 S3 目录后，插件地址的 hash 会显示对应路径，例如：

```text
chrome-extension://bbdpmlabgaoebjojgmgglldcnlllgjjd/app.html#/s3/my-bucket/path/to/folder?connection=...
```

复制该地址或刷新页面会恢复相同目录。

## 开发

```bash
npm install
npm run build:extension
npm start
```

`npm start` 仅用于脱离插件调试网页。正式使用时由 Chrome 自动拉起随机端口的原生辅助程序。缓存位于：

```text
~/Library/Caches/image-browser
```

其中 `remote/` 保存按文件版本区分的 SSH/S3 原始图片缓存；源文件大小、修改时间或 S3 ETag 变化后会使用新的缓存。

可用环境变量 `IMAGE_VIEWER_PORT` 和 `IMAGE_VIEWER_CACHE` 修改。

## 大图实现

插件通过 WebGL 查询浏览器支持的最大纹理尺寸。原图未超过上限时直接浏览；超过上限时，Sharp/libvips 将它按原始长宽比缩到最大可支持边长，并在查看器底部显示原始尺寸与实际浏览尺寸。源文件不会被修改。

实测 `26056×22026`、约 `68 MB` 的 PNG：

- 浏览器上限为 16384 时，等比例缩放为 `16384×13850`
- 首次转换约 6.7 秒
- 后续打开直接复用缓存
