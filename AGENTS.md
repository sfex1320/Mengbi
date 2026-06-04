# AGENTS.md — 梦笔（mengbi）

> **本仓库的最权威 AI 开发规范是 [`CLAUDE.md`](./CLAUDE.md)，不是本文件。**
> 任何 AI 助手（Codex / Claude / 其它）在本仓库生成代码前，都以 `CLAUDE.md` 为唯一真相来源。
> 本文件曾是一份独立的旧版规范，已于 2026-06-05 退役为薄指针，避免与实现/`CLAUDE.md` 双向漂移。

## 速记（详情一律查 `CLAUDE.md`）

- **项目**：梦笔（mengbi）绘画工具箱 —— Electron 28 + React 18 + TypeScript + Vite 5 + Zustand 4 + better-sqlite3 11 的跨平台桌面 AI 绘画工具箱。
- **Slogan**：梦中之笔，绘未来之画 —— 一个不断进化的 AI 绘画工具箱。（无"带你吃火锅儿"彩蛋。）
- **默认主题**：`atmosphere=deep-quiet × palette=warm-orange`。
- **7 个顶级路由**：生图 `/`、画板 `/canvas`、管家 `/manager`、ComfyUI `/comfyui`、工具箱 `/tools`、实验室 `/lab`、智能画布 `/smart-canvas`（外加设置 `/settings`）。
- **铁律**（完整 15 条见 `CLAUDE.md` §9）：渲染端绝不直连外网；API Key 经 `safeStorage`、永不经 IPC 明文返回；better-sqlite3 同步 API；IPC 返回 `Result<T,AppError>`（不 throw）；流式走 `webContents.send`；软删除 `deleted_at`；无 `any`/未处理 Promise；颜色字面量只在 `theme.css`。
- **IPC 命名**：`api:<domain>:<action>`，注册在 `electron/ipc/`，preload 白名单暴露，前端 `window.electronAPI.<domain>.<action>(...)` 调用。

## 文档地图

`README.md`（门面）· `WHITEPAPER.md`（产品）· `FEATURES.md`（P0/P1/P2）· `ARCHITECTURE.md`（架构）· `DEVELOPMENT.md`（开发节奏）· `ENVIRONMENT.md`（环境）· `THEMING.md`（主题）· **`CLAUDE.md`（最权威）** · `中转站请求体覆盖指南.md`（中转站对账）。
