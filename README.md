<div align="center">

# Lumen — 飞书文档 agent

**Chrome 侧边栏 AI agent，用一句话操作飞书文档 / 多维表格 / 电子表格。**

[![License: Elastic License 2.0](https://img.shields.io/badge/License-Elastic%202.0-005571.svg)](LICENSE)
![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-build-646CFF?logo=vite&logoColor=white)

</div>

Lumen 是一个**非官方**的 Chrome MV3 侧边栏扩展，通过自然语言让 AI 直接操作你的飞书
**多维表格（Base）/ 电子表格（Sheet）/ 文档（Docs）/ 白板（Board）**——建表、填数、写公式、
生成文档、按评论改稿、跨表查找、去重、审计，一句话搞定。

- **AI**：OpenAI 兼容接口，默认中国大模型（DeepSeek）；模型 / Key / Base URL 运行时可配。
- **形态**：侧边栏 + 注入飞书页的内容脚本 + 后台 Service Worker；运行时依赖仅 React + openai SDK，**无后端**。
- **安全**：助手始终以**用户本人身份**操作、绝不越权；权限边界**硬编码在代码里**。
- **本地优先**：PDF 解析、CSV 导入、Obsidian 知识库、经验记忆全部在本地；出站仅飞书、LLM、Obsidian REST API 三个方向。

> 本工具与飞书 / Lark 官方无任何 affiliation 关系。"飞书"是北京飞书科技有限公司的商标。

---

## 功能

侧边栏 4 个主标签：**对话 / 应用 / 资讯 / 设置**。

**对话** — Agentic 循环 + 68 个工具（启用知识库 +3 = 71），覆盖飞书全产品：

| 域 | 工具数 | 能力 |
|---|---|---|
| 多维表格 | 22 | 表 / 字段 / 视图 / 记录增改删 / 结构化搜索 / 仪表盘复制 |
| 电子表格 | 14 | 读写区间 / 追加行 / 填充列 / 查找替换 / 行列增删 |
| 文档 | 16 | Markdown 转文档 / 插入各类内容块 / 删除 / 复制 / 图片导出 |
| 白板 | 2 | 创建 / 查询白板 |
| 复合算子 | 12 | 去重 / 跨表查找 / 条件批改 / 表→表汇总 / 审计 / 数据报告 / 文档总结 / **智能填充预览+写回** |
| 通用 API | 1 | `feishu_api_call`——按官方文档自造请求，默认拒绝白名单 |
| 知识库（条件） | 3 | 只读检索 Obsidian 笔记 |

- **越用越聪明**：成功任务提炼经验存本机（最多 300 条），下次相似任务自动参考。
- **Auto 模式**：自动确认内容级删除；**文件级删除始终硬拦**。
- **用户技能**：常用 prompt 写成带 frontmatter 的 markdown，自动注册为 `skill__<slug>` 工具。

**应用** — 高级能力卡片：

- **AI 看板**：把表格数据做成 ECharts 看板，渲染成飞书页面内可拖拽悬浮窗。声明式 VizSpec（非 LLM 代码），保存后用最新数据零 LLM 重开。
- **AI 演示文稿**：多文档 / 表格链接聚合成 deck，12 种 layout，可导出 HTML 或 PPTX。
- **PDF / 文件转写**：pdfjs-dist 本地解析 PDF（不上传服务器）→ Markdown + AI 润色；支持拖拽 CSV/TSV/TXT。
- **技能库**：管理用户技能。
- **Obsidian 知识库**：连接 Local REST API（loopback only），浏览 / 搜索 / 读笔记。

**资讯** — 聚合 GitHub Trending 与微博热搜，后台定时抓取，GitHub 标题可自动翻译。

**网页剪藏** — 在任意网页右键 / Alt+Shift+C，把选中内容或整页经 AI 整理写入飞书。手势触发 + activeTab，不新增出站端点。

---

## 下载到本地

```bash
git clone https://github.com/scott987-cmd/feishu-doc-ai-assistant.git
cd feishu-doc-ai-assistant
npm install
```

依赖：Node.js 18+，npm。后续开发与构建命令见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。

---

## 文档导航

| 文档 | 内容 |
|---|---|
| [QUICKSTART.md](docs/QUICKSTART.md) | 个人快速部署：配飞书应用 → 填配置 → 打包 → 加载 |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发手册：环境 / 命令 / 仓库地图 / 硬约束 |
| [USER_GUIDE.md](docs/USER_GUIDE.md) | 使用手册：全功能图文说明 |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 模块结构、工具清单、字段类型、API 实测坑 |
| [SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) | 安全设计逐条审计 + 攻击场景 + 修复 |
| [FAQ.md](docs/FAQ.md) | 常见问题排错 |
| [PRIVACY.md](PRIVACY.md) | 隐私政策 |
| [.env.example](.env.example) | 全部构建时配置项 |

---

## 免责声明

本工具通过大模型对飞书数据执行真实操作（建表、写入、删除内容等）。虽内置多重护栏，
**仍建议在重要数据上谨慎使用、必要时先备份**。开启 Auto 模式会跳过内容删除的逐次确认。
作者不对因使用本工具造成的数据损失负责（详见 [`LICENSE`](LICENSE)）。

## 许可证

[Elastic License 2.0](LICENSE) © 2026 [scott987-cmd](https://github.com/scott987-cmd)

个人 / 企业均可免费使用、修改、分发、自行部署（含公司内部商用）；唯独禁止「作为托管 / SaaS
服务提供给第三方」，且不得绕过授权功能、不得去除版权标识。需要商业授权请在 GitHub Issues
开 `commercial` 标签的 issue 联系作者。
