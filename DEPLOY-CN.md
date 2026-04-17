# `playforfun.life` 部署手册

## 目标结构

- 前台站点：`https://score.playforfun.life`
- 后台入口：`https://score.playforfun.life/admin.html`
- API 服务：`https://api.playforfun.life`

这套结构已经写进当前仓库：

- 前端默认 API：`api-config.js`
- Worker 自定义域：`wrangler.toml`
- 静态站点构建：`npm run build:pages`

## 推荐架构

### 静态页

用 **Cloudflare Pages 连接 GitHub 仓库** 发版。

原因：

- 代码仍然在 Git 里
- 国内访问比直接走 `github.io` 更稳
- 自定义域名和 DNS 都在 Cloudflare 里，配置最顺

### 动态接口

用 **Cloudflare Worker** 承接：

- `/api/submit-ai`
- `/api/submit-opc`
- `/api/manage-ai`
- `/api/manage-opc`
- `/api/results-ai`
- `/api/results-opc`

数据仍然写回 GitHub issue。

## 你要做的事情

### 1. 把 `playforfun.life` 接入 Cloudflare

如果还没接入：

- 在 Cloudflare 后台添加站点 `playforfun.life`
- 按 Cloudflare 提示，把域名注册商的 NS 改到 Cloudflare

这一步做完后，Cloudflare 才能给你配：

- `score.playforfun.life`
- `api.playforfun.life`

### 2. 创建 Cloudflare Pages 项目

在 Cloudflare Pages 里：

- 选择连接 GitHub
- 选仓库：`waterhuangfu-art/ai-score-card`
- Production branch：`main`
- Framework preset：`None`
- Build command：`npm run build:pages`
- Build output directory：`dist`

### 3. 给 Pages 绑定前台域名

在刚创建好的 Pages 项目里添加 Custom domain：

- `score.playforfun.life`

### 4. 部署 Worker API

在当前项目目录执行：

```bash
cd "/Users/huangfu/Library/Mobile Documents/com~apple~CloudDocs/AI007/05-项目开发/ai-score-card"
wrangler secret put GITHUB_TOKEN
wrangler deploy
```

`GITHUB_TOKEN` 建议用一个对仓库 `waterhuangfu-art/ai-score-card` 有 issue 读写权限的 token。

当前仓库已经把 Worker 自定义域写成：

- `api.playforfun.life`

也就是说，只要 `playforfun.life` 已经在你的 Cloudflare 账号里，这一步会把 Worker 绑定到 `api.playforfun.life`。

### 5. 验证

先看前台：

- `https://score.playforfun.life`

再看后台：

- `https://score.playforfun.life/admin.html`

再直接测 API：

```bash
curl -sS https://api.playforfun.life/api/results-opc
```

如果返回 JSON，就说明 API 域名已经通了。

## 仓库里我已经改好的

- `api-config.js`
  - 默认 API 已经是 `https://api.playforfun.life`
- `wrangler.toml`
  - 已经写了 `api.playforfun.life` 的 custom domain route
- `cloudflare-worker.mjs`
  - 已经补齐后台需要的 `results-ai/results-opc`
- `scripts/build-pages.mjs`
  - 会把静态文件整理到 `dist/`
- `package.json`
  - 已加 `build:pages`

## 最后提醒

这条方案的核心前提是：

- `playforfun.life` 在 Cloudflare 账号里
- 你愿意用 Cloudflare Pages + Worker

如果这两个前提成立，这就是目前最稳、最适合中国用户的 Git 发布方式。
