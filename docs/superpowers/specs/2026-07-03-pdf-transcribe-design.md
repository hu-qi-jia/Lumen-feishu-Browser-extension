# PDF 转写 — 设计文档

- **日期**：2026-07-03
- **状态**：已确认，实现中（见计划 `docs/superpowers/plans/2026-07-03-pdf-transcribe.md`）
- **形态**：App Hub 新增「PDF 转写」面板
- **一句话**：用 `pdf2md` 在本地把 PDF 抽成 Markdown，再用 AI 做文本润色，最后由用户选择复制 / 导出 / 写入指定文档。

---

## 1. 概述

在 App Hub 中新增「PDF 转写」面板。用户上传 PDF 后：

1. **JS 抽取（pdf2md）**：基于 pdf.js 在浏览器本地把 PDF 文本层抽成 Markdown。免费、即时、**完全不出站**。
2. **AI 润色**：把抽取结果交给用户已配置的 LLM 做"查漏补缺 / 语义通顺 / 修复破损表格与排版"的**纯文本清理**。单次或分块调用，**只走文本、不需要视觉模型**，成本低。
3. **输出**：可编辑预览 → 复制 / 导出 `.md` / 添加到指定飞书文档。

### 1.1 与项目约束对齐

- 纯前端、无后端、无付费服务、无 Python —— 全程在扩展内完成。
- 抽取在本地、不出站；AI 润色只走现有 LLM 出站（`assertSafeBaseUrl` + `resolveLlmConfig`），不新增出站。
- 写入文档复用现有 feishu API（`feishuReq` / `feishuFetch`），不新增出站。
- UI 遵循项目既定风格：无 emoji、内联 SVG 图标（`icons.tsx`）、shadcn/M3 基建。

---

## 2. 管线

### 2.1 抽取（pdf2md，本地）

- **输入**：PDF 的 `ArrayBuffer`（来自 `FileReader` / 拖拽 `DataTransfer`）。
- **调用**：`pdf2md(uint8Array) → Promise<string>`（`@opendocsg/pdf2md`，MIT）。v1 在**主线程**运行（见 §9 DEV-v1-1；Worker 延后 Phase 2）。
- **输出**：`rawMd`（基线 Markdown 字符串）。
- **扫描件探测**：若 `rawMd` 去除空白后**总字符数**过低（默认阈值 30，留实现时校准；扫描件近乎 0 字、真实文档大量字符），判定为无文本层（扫描件/纯图），提示"未检测到文本层（可能是扫描件），pdf2md 无法提取"。v1 仅提示并中止；AI 视觉兜底列入 Phase 2。

### 2.2 AI 润色（文本 LLM）

- **输入**：`rawMd`。
- **调用**：复用现有文本 LLM 调用模式（`resolveLlmConfig` + `assertSafeBaseUrl` + OpenAI client，参照 `vision.ts` / `text.ts` 的写法）。**纯文本进、纯文本出**，用户现有的任意文本 LLM 即可，不强制视觉模型。
- **Prompt 约束**（关键）：
  - 修复抽取造成的断句、错位、乱码、破损的表格 / 列表 / 标题层级。
  - 保证语义通顺，**不改变原意**。
  - **只清理、不补造**：不得添加原文没有的内容、不得臆测或编造数据。
  - 直接输出清理后的 Markdown，不加解释、前言或代码围栏。
- **长文档**：若 `rawMd` 超过模型上下文一半，按章节（`## ` / `---` 分页符）切分、逐块润色后按序拼接；每块带上下文衔接提示。
- **失败降级**：LLM 调用失败 / 超时 / 限流 → 显示 `rawMd` 并标注"AI 润色失败，已显示原始抽取结果"，不阻断复制 / 导出 / 写入。
- **开关**：面板提供「启用 AI 润色」开关（默认开）。用户可关闭以省 token、直接拿原始抽取结果。

### 2.3 输出

- **可编辑预览**：Markdown 文本框（可编辑，用户能在写入前手动修正）。左侧 pdf.js 页缩略图对照：**v1 不做**，列入 Phase 2。
- **三个动作**：
  - **复制**：`navigator.clipboard.writeText(md)`。
  - **导出**：构造 `new Blob([md], { type: 'text/markdown' })`，触发下载 `<原文件名>.md`。
  - **添加到指定文档**：**默认目标 = 当前打开的文档**（`context.feishu.appToken`），提供「换一个」入口（粘贴飞书文档链接/token，`parseDocTokenFromUrl` 解析）→ 复用现有文档写入能力（`markdownToBlocks` + `insertContentBlocks`，追加到文档末尾）。v1 不接 `DocSelector`（见 §9 DEV-v1-2）。

---

## 3. 组件与职责

| 组件 | 位置 | 职责 |
|---|---|---|
| `PdfTranscribePanel.tsx` | `src/sidepanel/components/` | 面板 UI：上传区 → 进度 → 可编辑预览 → 输出动作；注册到 App Hub |
| `pdfExtract.ts` | `src/shared/` | `extractMarkdown(buffer): Promise<string>` + `detectScan(rawMd)`，封装 pdf2md（v1 主线程） |
| `mdPolish.ts` | `src/shared/ai/` | `polishMarkdown(settings, rawMd): Promise<string>`，复用现有 LLM 调用模式 + 润色 prompt |
| `parseDocRef.ts` | `src/shared/feishu/` | `parseDocTokenFromUrl(input)`，从链接/token 解析文档 token（「换一个」用） |
| ~~`mdToDocBlocks.ts`~~ | — | **不新建**：复用 `docx.ts` 的 `markdownToBlocks` + `insertContentBlocks` + `listBlocks` |

**复用的现有件**：`vision.ts`/`text.ts`/`llm.ts` 的调用模式、`docx.ts` 的 markdown→blocks/写入、`icons.tsx`、`Button`/`TopBar` 等 UI 基件。~~`DocSelector`~~ —— 经核实为受控组件、需 App 级状态，v1 改用轻量选择器（§9 DEV-v1-2）。

---

## 4. 数据流

```
拖入 / 选择 PDF
 → ArrayBuffer
 → pdf2md（主线程）→ rawMd
 → 扫描件探测（rawMd 过短 → 提示并中止）
 → [AI 润色开关=开] LLM 文本清理 → polishedMd
                          （失败 → 回退 rawMd + 标注）
 → 可编辑预览（polishedMd / rawMd）
 → 用户动作：复制 / 导出 .md / 写入指定文档（默认当前文档 +「换一个」）
```

---

## 5. 错误处理

| 场景 | 处理 |
|---|---|
| 加密 / 损坏 PDF | pdf2md 抛错 → "PDF 受密码保护或损坏，无法解析" |
| 扫描件（文本层空） | 提示无法抽取，中止（v1 不做 AI 视觉兜底） |
| AI 润色失败 / 超时 / 限流 | 回退显示 `rawMd` + 标注，不阻断输出动作 |
| 模型不支持 / 未配置 | 复用现有 LLM 报错文案（参照 `isVisionUnsupportedError` 的友好提示风格） |
| 写入文档失败 | 复用现有 feishu API 错误处理 |
| 超长 PDF | 分块润色；若整体过大给出内存 / 成本提示 |

---

## 6. 测试（vitest）

- `pdfExtract.test.ts`：用一个小型 fixture PDF（提交进仓库 `test/fixtures/`），断言输出 Markdown 含预期文本。无网络，确定性。
- `mdPolish.test.ts`：mock OpenAI client（参照 `vision.test.ts`）。断言：prompt 含"只清理、不补造"约束；正常返回清理后文本；LLM 失败时优雅回退（抛出可被上层捕获、上层降级到 rawMd）。
- 输出动作：单测纯函数（Markdown → doc blocks 映射、Blob 文件名构造）。
- `PdfTranscribePanel.test.tsx`：Testing Library 组件测试（上传 → 进度 → 预览 → 三个动作的渲染与交互；润色开关开/关；「换一个」入口）。

---

## 7. 风险与缓解

1. **pdf.js 在 MV3 侧边栏**（pdf2md 内部的 pdf.js worker：CSP / `worker-src` / web-accessible resource）—— 头号技术风险。
   - v1 pdf2md 跑在**主线程**（不引入我们自己的 Worker，见 DEV-v1-1），但 pdf2md 内部仍可能用 pdf.js worker。
   - 行动：真机 spike（计划 Task 5 Step 7）—— 在扩展侧边栏跑通一个真实 PDF；若 pdf.js worker 在 MV3 报错，走 pdf.js `disableWorker`（主线程解析）降级兜底。

2. **抽取质量上限**：启发式对复杂表格 / 公式 / 多栏偏弱；AI 润色能修一部分但非万能。复杂文档建议用户后续走（Phase 2）AI 视觉兜底。

3. **大 PDF 内存**：pdf2md 一次载入整文档；超大文件给提示 / 上限。

> **库维护状态（已核实 2026-07-03）**：`@opendocsg/pdf2md` npm 最新 **0.2.6**（约一个月前发布，共 35 版本），仍在活跃维护——GitHub `opengovsg/pdf2md` 的 Releases 页面停在 v0.1.31（2024-05）只是没同步打 tag，npm 一直在持续发布。MIT、是 pdf.js 的薄封装，必要时可 vendor / fork。~~原先误判的"维护停滞"风险不成立，已撤销。~~

---

## 8. 不在 v1 范围（留后续迭代）

- AI 重构（PDF 表格 → 多维表格字段 / 行）—— Phase 2。
- 批量多 PDF —— v1 单文件；批量是循环扩展。
- 扫描件 AI 视觉兜底 —— Phase 2。
- 多格式（DOCX / PPTX）—— pdf2md 仅 PDF。
- pdf2md 跑进 Web Worker（避免大 PDF 解析冻结 UI）—— v1 主线程（DEV-v1-1），Phase 2 加。
- 完整 `DocSelector` 目标选择器（最近文件 / 跟随 tab / wiki 解析）—— v1 用轻量选择器（DEV-v1-2），Phase 2 接入。

---

## 9. 审阅结论（2026-07-03）

1. **AI 润色对比视图**：不做。面板只显示润色后结果；关掉「启用 AI 润色」开关即可看原始抽取。
2. **添加到指定文档**：默认写入当前打开文档，提供「换一个」入口（粘贴飞书文档链接/token）。
3. **pdf.js 页缩略图对照**：不做（v1）。

### v1 实现决策（plan-writing 阶段落地，用户 2026-07-03 确认）

- **DEV-v1-1（无 Worker）**：pdf2md 在主线程运行；Web Worker 延后 Phase 2。理由：mrmps 纯浏览器 demo 证明主线程可行，Worker 是 §7 头号风险；主线程让 `extractMarkdown` 可在 vitest 用 mock 直接测。
- **DEV-v1-2（轻量目标选择器）**：v1 不接 `DocSelector`（受控组件，需 App 级 `recentFiles`/`setWorkDoc` 状态，`ScenarioPanel` 不持有）。改用「默认当前文档 + 换一个（粘贴链接/token）」。完整 `DocSelector` = Phase 2。

> 实现计划（权威执行文档）：`docs/superpowers/plans/2026-07-03-pdf-transcribe.md`。pdf2md 库维护状态：见 §7 末注（已核实，活跃维护）。
