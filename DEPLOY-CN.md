# `playforfun.life` 部署手册

## 当前已落地结构

- 前台站点：`https://score.playforfun.life`
- AI 后台：`https://score.playforfun.life/admin`
- 一人公司后台：`https://score.playforfun.life/admin-opc`
- API 服务：`https://api.playforfun.life`

当前已确认可用：

- 前台首页可打开
- AI 评分卡可提交、查询、修改、删除
- 一人公司评分卡可提交、查询、修改、删除
- 手机端可访问前台填写页
- 数据写入 GitHub issue，后台按场次 `?session=xxx` 查询

这套结构已经写进当前仓库：

- 前端默认 API：`api-config.js`
- Worker 自定义域：`wrangler.toml`
- 静态站点构建：`npm run build:pages`

当前代码基线：

- GitHub 仓库：`waterhuangfu-art/ai-score-card`
- 域名：`playforfun.life`
- 前端：Cloudflare Pages
- 后端：Cloudflare Worker
- 默认 API：`https://api.playforfun.life`

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

## 当前产品规则

- 首页 `https://score.playforfun.life` 只给填写人使用
- 填写人不看别人数据
- 后台用单独链接访问，不从首页暴露记录列表
- 后台支持修改和删除
- 现场使用统一通过 `?session=场次名` 区分不同活动

## 后续新增题卡的固定做法

以后再增加新的测试题、自评卡，按下面的结构扩：

- 首页增加一个新入口卡片
- 新增一个前台填写页
- 新增一个独立后台页
- Worker 新增一组接口：
  - `/api/submit-xxx`
  - `/api/results-xxx`
  - `/api/manage-xxx`
- 数据继续落 GitHub issue

这样做的好处是：

- 入口统一，不会散
- 手机端和现场填写体验可复用
- 后台能力可复用
- 后续只换题目和评分逻辑，不必重做整套系统

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

- `https://score.playforfun.life/admin`
- `https://score.playforfun.life/admin-opc`

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
  - 已经补齐提交、读取、修改、删除所需接口
- `scripts/build-pages.mjs`
  - 会把静态文件整理到 `dist/`
- `package.json`
  - 已加 `build:pages`

## 最后提醒

这条方案的核心前提是：

- `playforfun.life` 在 Cloudflare 账号里
- 你愿意用 Cloudflare Pages + Worker

如果这两个前提成立，这就是目前最稳、最适合中国用户的 Git 发布方式。

## 备注

最近一次已确认可用的代码提交：

- `95b0ad9` `Harden Cloudflare worker GitHub reads`

这个提交之后，读取 GitHub issue 的容错更稳，适合继续在这套基础上扩新的题卡。
