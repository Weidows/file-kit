# 文件工具箱 FileKit (for ZTools)

一个 [ZTools](https://github.com/ZToolsCenter/ZTools) 插件（uTools 的开源实现）：文件操作工具箱。

- **解散文件夹**：把文件夹里的文件提取到上级目录（或指定目录），多选全处理、预览、可撤销
- **图床上传**：把图片上传到 S3 兼容图床（MinIO / RustFS / 阿里云 OSS / AWS S3 等），复制公开链接

## 功能：解散文件夹

**入口**

- 复制文件夹后在 ZTools 粘贴（Ctrl+V），选择「解散文件夹」（支持一次多选）
- 关键字 `解散文件夹` / `提取文件` / `extract`
- 插件页面内：拖拽 / 「选择文件夹」/ 从剪贴板导入（解析复制的文件路径）

**要点**：逐文件夹、逐文件双层容错（一个失败不影响其余）；预览先行；执行后可一键撤销（历史 30 条）；跨盘自动复制回退；文件占用自动重试；Windows 长路径（>260 字符）自动加 `\\?\` 前缀；重名支持 智能重命名 `name (1).ext` / 跳过 / 覆盖。

## 功能：图床上传

**入口**

- 截图后在 ZTools 主输入框直接粘贴（Ctrl+V）→ 选「上传图床」（img 触发）
- 复制图片文件后粘贴 → 选「上传图床」（可多选，按扩展名匹配）
- 关键字 `图床` / `上传图床` / `upload`
- 插件页面内：拖拽图片 / Ctrl+V 粘贴 / 「选择图片」/ 从剪贴板导入

**要点**

- 上传到 **S3 兼容存储**，路径模板默认 `图床/{YYYY}-{MM}/{timestamp}.{ext}`，
  占位符：`{YYYY} {MM} {DD} {date} {timestamp}(毫秒) {name} {ext} {rand}`
- 上传成功显示公开 URL，支持复制链接 / 复制 Markdown / 打开；可设自动复制
- 上传记录保留 100 条，支持从图床删除文件
- 手写 AWS Signature V4，零依赖；设置页可「测试连接」（上传探针并自动清理）
- Provider 已抽象，后续可扩展其他图床类型

## 开发

```bash
node test/extract.test.js   # 解散文件夹核心测试（11 项）
node test/s3.test.js        # S3 签名向量 + 真实上传集成测试（8 项，读 config.local.json）
node scripts/gen-logo.js    # 重新生成 logo.png
```

**本地调试**：ZTools → 设置 → 开发者，添加本地插件项目指向本目录（含 `plugin.json`）。

**打包安装**（插件管理 → 本地安装，选择 zip）：

```bash
npm run pack        # = node scripts/pack.js，输出 ../file-kit-<版本>.zip
```

包由 `scripts/pack.js` 生成（标准 ZIP、`plugin.json` 在根目录、条目名正斜杠，
不含 `config.local.json`）。不要用 `tar -a` 生成 zip——Git Bash 的 GNU tar 会输出 tar 包，
ZTools 会报「缺少 plugin.json」。
安装后的运行目录在 `~/.ztools/plugins/`，S3 密钥配置放在 `~/.file-kit/config.local.json`
即可在安装版中自动生效（与开发目录的配置互为备份，升级插件不丢失）。
**浏览器预览 UI**：直接打开 `index.html` 会进入演示模式（数据为模拟，无真实上传）。

**调试接口**（可选）：ZTools 本地 HTTP 服务开启后，可远程触发插件：

```bash
curl -X POST http://127.0.0.1:36578/api/plugin/launch \
  -H "Authorization: Bearer <你的apiKey>" -H "Content-Type: application/json" \
  -d '{"path":"文件工具箱","type":"plugin","featureCode":"image-host","param":{"type":"text","payload":"","code":"image-host"}}'
```

## S3 配置

三种方式（优先级从低到高）：

1. 插件内「设置 → S3 图床」填写并保存（存入 ZTools 插件存储，仅本机）
2. 开发目录下 `config.local.json`（已加入 `.gitignore`，不会提交）：

```json
{
  "s3": {
    "endpoint": "https://fs.weidows.tech",
    "bucket": "img",
    "region": "us-east-1",
    "accessKey": "...",
    "secretKey": "...",
    "publicBase": "https://fs.weidows.tech/img",
    "pathTemplate": "图床/{YYYY}-{MM}/{timestamp}.{ext}"
  }
}
```

> 密钥只保存在本机。如果图床不是公开读，上传后仍可用，但公开 URL 需自行配 CDN/鉴权；
> `core/s3.js` 也提供 `presignedUrl` 可生成带签名的临时链接。

## 如何新增一个功能（扩展位）

1. **核心逻辑**：`core/` 下新建纯 Node 模块（不依赖宿主，便于测试），`test/` 加测试
2. **桥接层**：`preload.js` 挂到 `window.FK.<feature>`
3. **视图 + 触发**：`assets/js/views/<feature>.js` 调用 `FK_UI.registerView({...})`；
   `plugin.json` 的 `features` 添加关键字或 `img`/`files` 触发；`preload.js` 末尾把新 `code` 路由到视图

## 目录结构

```
file-kit/
├── plugin.json          # ZTools 插件清单（features: extract-folder / image-host, tools: upload_image）
├── preload.js           # ZTools 桥接层（window.FK.* + MCP 工具注册）
├── index.html           # 入口页面
├── core/
│   ├── extract.js       # 解散文件夹：扫描/计划/执行/撤销（纯 Node）
│   ├── s3.js            # S3 客户端：SigV4 签名/上传/删除/预签名（零依赖）
│   └── imagehost.js     # 图床编排：路径模板/URL 生成/Provider 抽象
├── assets/
│   ├── css/app.css      # 全部样式（暗色/浅色主题）
│   └── js/              # icons / util / app(壳) / mock(演示模式) / views/*
├── test/                # extract / s3 测试
├── config.local.json    # 本地密钥配置（gitignore，不提交）
└── scripts/gen-logo.js  # logo 生成脚本
```

## MCP 工具

插件通过 `ztools.registerTool` 向 ZTools 的 MCP 服务注册了 `upload_image` 工具
（参数：`path` 或 `dataUrl`），ZTools 内的 AI 助手可直接调用它上传图片并拿到 URL。
