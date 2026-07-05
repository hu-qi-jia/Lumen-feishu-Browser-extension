# 文档图片能力：插入 / 迁移 / 替换 / 导出

- 日期：2026-07-05
- 状态：设计待评审
- 分支：`feishu-ok`
- 关联：`2026-07-02-slides-templates-images-design.md`（已落地图片**读取/下载**侧，本设计补**上传/写入**侧）

## 1. 目标

补齐 chat 对"文档中图片"的弱能力。落地四个场景（飞书开放 API 均支持）：

1. **插入图片到指定位置** —— 把对话框里上传的图片，按自然语言锚点插入到当前文档（某标题后 / 某句话后 / 节末 / 文档末尾）。
2. **迁移文档时带上图片** —— 分两条路径：① **保真克隆**（`copy_document`，服务端 drive copy 一次调用，图片/表格/内嵌表格完整保留）；② **转换式迁移**（`clone_doc_with_images`，块级重建，适用总结/抽取/合并场景，图片下载原图再传无画质损失）。
3. **替换文档里的已有图片** —— 按"第 N 张"或"某标题下那张"定位，换成新图，原位保留。
4. **导出/提取文档全部图片** —— 把一篇文档里的所有图片批量下载，在对话里出缩略图画廊 + "下载全部 ZIP"。

## 2. 非目标

- **不做"当前光标位置"插入** —— 飞书编辑器是 canvas/ProseMirror，从 content script 稳定读光标块 id 不可靠；统一走**锚点定位**（标题/文本/节末/文档末，或"我选中的那段后面"经文本匹配回溯到块）。
- **不做 Base 附件字段（type 17）写图** —— 本设计只覆盖**文档（docx）图片块**。Base Attachment 字段是另一套上传链路，留作后续。
- **不做 AI 生图 / 云图床 / 网图 URL 抓取** —— 运行时图片只来自对话框附件或源文档。遵守"最省成本：不付费、不引入 SaaS"。
- **不做嵌入式电子表格块（type 30）的克隆** —— 它是独立的实时表格，无"复制嵌入块"API；迁移时插文字占位。
- **不改变现有对话/附件/vision 链路** —— 见 §7 回归保护。

## 3. 现状（改动基线）

调研结论（已确认）：

- **读侧已有**：`listBlocks`（`docx.ts:138`）返回**全部块的扁平列表**（含任意嵌套深度，带 `parent_id`+`children`，一次分页调用即可拿到整棵树）——可直接扫描 `block_type:27` 找图片块，**无需逐块递归**。`serializeDocBlocks`（`slidesImages.ts:41`）已经这样在用（幻灯片抽图）。
- **下载已有**：`downloadMedia(fileToken, userToken)`（`media.ts:5`）→ `GET /drive/v1/medias/{token}/download` → Blob（仅幻灯片用）。
- **对话框附件**：`Attachment { id, type:'image'|'file', name, mimeType, size, dataUrl?, content? }`（`types.ts:9`）。`InputBar` 接受 `image/*` + `.csv/.tsv/.txt`，picker + 拖拽，**无粘贴**，上限 4 张，压缩到 ≤1280px/≤1MB。图片作为 `image_url` vision 部分发给 LLM；**从不上传到飞书**。
- **写侧缺口**：
  - **无上传能力** —— 全仓无 `drive/v1/medias/upload_all` 封装；`feishuFetch`（`http.ts:37`）只发 JSON、不支持 multipart。
  - **不能写图片块** —— `buildBlock`（`docx.ts:49`）支持 text/h1…/table(31)/sheet(30)，**无 image(27) 分支**；`BlockStyle`（`docx.ts:14`）无 image；`add_document_content` 工具 schema 不允许 image。
- **鉴权**：user_access_token（OAuth，`auth.ts:120`）。已声明 scope：`bitable:app / docx:document / sheets:spreadsheet / drive:drive / wiki:wiki / contact:user.base:readonly / offline_access`。`drive:drive` 大概率覆盖 `upload_all`（待实测，见 §8）。
- **存储/CSP**：`manifest.json` 已有 `unlimitedStorage`；CSP `img-src 'self' data: https:`。
- **现有"迁移"类能力**：无。最接近的 PDF→doc、base→doc 报告、table→sheet 全部丢图。

## 4. 架构（方案 A：专用工具 + 共享地基）

每个场景做成**一个专用 agent 工具**，内部跑完整确定性流程；LLM 只负责选工具 + 填参数。理由：迁移是"读→下载→上传→插入"循环 N 次，让 LLM 编排既费 token 又易断；专用工具可单测、行为确定、提示词简单。

### 4.1 地基（scenarios 1/2/3 共享，必须先做）

**新增 `src/shared/feishu/upload.ts`**：

```ts
// 上传图片二进制到指定云文档，返回 file_token（仅在该文档内可见）
export async function uploadMedia(opts: {
  blob: Blob
  fileName: string
  mimeType: string
  parentNode: string      // 文档 obj_token（wiki 文档需先解析）
  parentType: 'docx_image'
  token: string           // user_access_token
}): Promise<string>       // file_token
```

- 调 `POST /drive/v1/medias/upload_all`，multipart/form-data。表单字段：`file_name` / `parent_type=docx_image` / `parent_node=<docToken>` / `size=<字节数>` / 二进制 `file`。返回 `data.file_token`。
- 上限 20MB；超出抛错（调用方决定跳过/提示）。
- **`http.ts` 加 multipart 兄弟方法** `feishuUpload(path, formData, token): Promise<Response>` —— 不设 `Content-Type`（让浏览器加 boundary）、不 `JSON.stringify`、仍走出站守卫 `isFeishuOutboundAllowed`。`feishuFetch`/`feishuReq` 原样不动。

**`docx.ts` 的 `buildBlock` 加 image 分支**：

```ts
type BlockStyle = ... | 'image'
interface BlockSpec { style: BlockStyle; text?: string; imageToken?: string; ... }
// buildBlock 内：
case 'image': return { block_type: 27, image: { token: spec.imageToken } }
```

`insertBlocks` 现有分块（每 50）+ POST children 逻辑不动，图片块自然透传。

**wiki 解析**：调用方在 upload 前用已有 `getWikiNodeToken`（`api.ts:288`）把 wiki token 解析成真实 obj_token，作 `parentNode`。

### 4.2 数据流总览

```
对话框附件(dataUrl) ─┐
                     ├─► uploadMedia ──► file_token ──► buildBlock(image) ──► insertBlocks
源文档 image.token ─► downloadMedia ─┘                       ▲
                                                            │
clone_doc_with_images: listBlocks → 逐块走上面这条链重建
```

## 5. 详细设计

### 5.1 Scenario 1 —— `insert_image`（doc 上下文）

**工具签名**（加进 `FEISHU_TOOLS`，仅 `doc`/wiki→doc 暴露）：

```ts
insert_image({
  attachment_id: string,                       // 当前轮用户消息里的某张图片附件
  anchor: {
    type: 'heading' | 'text' | 'section_end' | 'end',
    value?: string                             // heading/text 时必填
  }
})
```

**流程**（`agent.ts executeDocTool` 新分支）：

1. **附件透传（plumbing 改动，见 §7）**：dispatcher 从当前轮最近一条 user message 的 `attachments` 里按 `attachment_id` 取出，校验 `type==='image'` 且有 `dataUrl`；`dataUrl` → Blob（`fetch(dataUrl).then(r=>r.blob())` 或 atob 解码）。注：对话框附件已被压缩（≤1280px/≤1MB），故**插入的是压缩后的图**（区别于 §5.2 迁移走原图无损）。
2. **锚点定位**：`listBlocks(当前文档)` → 取根级子块（`parent_id === docId`，按 `index` 排序）。飞书 docx 顶层块是扁平的（标题不是容器），故图片一律作**文档根的子块**插入：
   - `end` → parent=`docId`，index 省略（追加）。
   - `heading` → 找文本匹配 `value` 的标题块，index = 该块 index + 1。
   - `text` → 找文本含 `value` 的块，index = 该块 index + 1。
   - `section_end` → 找标题块 → 找其后第一个同级或更高级标题 → index = 那个标题的 index；无则追加。
   - "我选中的那段后面" → 用 `context.selectedText` 走 `text` 匹配（已有 `PageContext.selectedText`）。
3. `uploadMedia(blob, name, mime, parentNode=docToken, 'docx_image', token)` → `file_token`。
4. `insertBlocks(docToken, [{ style:'image', imageToken: file_token }], index)`。
5. 返回确认 + 触发 `reloadActiveTab()`（复用现有刷新）。

**对话框增强**：`InputBar.tsx` 加 `onPaste` —— 剪贴板有图片文件时走 `fileToAttachment`（复用现有压缩/校验）。**不影响**现有 picker/拖拽/文本输入。

### 5.2a Scenario 2a —— `copy_document`（保真克隆，首选）

**用飞书 `drive/v1/files/{token}/copy`** —— 服务端深拷贝一篇文档到用户云空间，**一次调用**获得完美副本：

- 全部内容（文本/表格/图片/内嵌电子表格）完整保留。
- 图片 token 由服务端重新绑定，不生歧义（零挖矿、零逐图上传）。
- 格式 100% 保真，block 重建做不到的事（如内嵌表格）这里天然保留。

**工具签名**（加进 `FEISHU_TOOLS`，仅 `doc`/wiki→doc 暴露）：

```ts
copy_document({
  source_doc_token?: string,    // 默认当前文档
  new_title?: string            // 默认 "<源标题> 副本"
})
```

**流程**（`agent.ts executeDocTool` 新分支）：

1. 解析源（wiki→obj_token）；`getDocumentMeta` 取源标题。
2. `feishuReq('POST', '/drive/v1/files/{sourceToken}/copy', token, { name: newTitle, type: 'docx' })` → 返回新 `file_token`（即新 doc id）。接口标注"异步"但对 docx 大概率同步返回；若需轮询，实现时处理。
3. 返回：新文档 URL + 标题。触发 `reloadActiveTab()` 让对方能看到。

**适用场景**：整篇备份、复制、原样克隆。**LLM 应在用户要求"克隆"/"复制"/"帮我另存一份"时优先选此工具。**

### 5.2b Scenario 2b —— `clone_doc_with_images`（转换式迁移，块级重建）

**新增 `src/shared/feishu/cloneDoc.ts`** —— 仅在内容被**总结/抽取/合并/改写**（不是纯克隆）时使用。内部循环跑在 JS 里，**agent 只调 1 次**，不会反复调工具。

**工具签名**：

```ts
clone_doc_with_images({
  source_doc_token?: string,    // 默认当前文档
  new_doc_title?: string        // 默认 "<源标题> 副本"
})
```

**流程**（内部循环，不让 LLM 逐步编排）：

1. 解析源（wiki→obj_token）；`getDocumentMeta` 取源标题。
2. `createDocument(new_doc_title)` → 目标 docToken。
3. `listBlocks(源)` → **全块树的扁平列表**（一次分页调用，包含所有嵌套块，带 `parent_id` + `children` + `index`）。**无需逐块递归 getBlock**，直接扫描全表找 `block_type===27`。
4. 按 `parent_id` 分组重建树，递归走根级子块（按 `index` 排序）。对于每个块：
   - 文本族（2/3/4/5/12/13/14/15/17/22）→ `buildBlock` 重建，攒进待插入缓冲。
   - 表格（31）→ 先 flush 文本缓冲；`insertTable` 重建（其文本单元格走 `buildTableDescendants`，仅一层）。
   - **图片（27）→ 先 flush 文本缓冲；`downloadMedia(token)` 取原图 → `uploadMedia(blob, …, parentNode=目标docToken, 'docx_image')` → 新 token → `insertBlocks([image block])`。** 图片在表格单元格里也能搬到对应 cell 下（递归按 parent_id 定位）。原图 >20MB 或下载/上传失败 → 计入 `skippedImages` 继续。
   - 内嵌表格（30）→ flush；插文本占位块"〔原嵌入式表格，未迁移〕"。
   - Quote 容器 / Callout 等 → 作为容器块创建，其子块递归重建。
   - 其他未知类型 → 计入 `skippedBlocks` 跳过。
   - 文本缓冲每满 50 或遇到非文本块时 flush（复用 `insertBlocks` 分块）。
5. 多图下载/上传：并发上限 4（沿用 `harvestDocImages` 的并发模式），逐块顺序仍保持（结果按原 index 顺序插入）。
6. 返回：目标文档 URL + 汇总 `{ migratedImages, skippedImages, skippedBlocks, totalBlocks }`。

**进度上报**：图多时通过 `onToolMessage` 推一条"已迁移 X/Y 张…"（可选增强）。

**已知限制**（写进工具描述给 LLM 看）：内嵌电子表格不可重建（走占位文本）；>20MB 源图跳过；表格仅重建一层文本单元格；极深嵌套层级的容器可能被展开（飞书 docx 不会出现太深嵌套）。

### 5.3 Scenario 3 —— `replace_image`

**工具签名**：

```ts
replace_image({
  which: { by: 'index' | 'heading', value: number | string },  // "第3张" / "产品架构标题下那张"
  source: { type: 'attachment', attachment_id: string }
})
```

**流程**：

1. `listBlocks` → 收集全部 image 块（文档顺序）。定位目标：
   - `index` → 第 N 个 image 块。
   - `heading` → 其最近前驱标题匹配 `value` 的那张 image 块。
2. 记下目标 image 块的 `parent_id` 与 `index`。
3. 取新图附件（同 §5.1 的附件透传 + 解码）→ `uploadMedia(parentNode=目标docToken)` → 新 token。
4. **删旧 + 原位插新**：`deleteBlocks([旧image块id])`；`insertBlocks(parent_id, [{style:'image', imageToken:新token}], index=旧index)`。（飞书 docx 不保证 image token 可原地 PATCH，删+插最稳。）
5. 返回确认 + 刷新。

### 5.4 Scenario 4 —— `export_doc_images`

**工具签名**：

```ts
export_doc_images({ doc_token?: string })  // 默认当前文档
```

**流程**：

1. `listBlocks` → 收集全部 image token（文档顺序，附 `context` = 最近前驱标题）。
2. 并行 `downloadMedia`（并发 4）→ 每张 `{ name, context, blob/dataUrl }`。
3. 返回结构化结果，带 marker `__image_export`（仿 `render_data_app` 的 `__dataviz` 模式）。

**UI**：ChatPanel 在 `onToolMessage` 里识别 `__image_export` marker → 渲染新组件 **`ImageExportCard`**（`src/sidepanel/components/ImageExportCard.tsx`）：

- 缩略图画廊（`<img src=dataUrl>`，已有 CSP 支持）+ 每张的 context 标签。
- "下载全部 (ZIP)" 按钮：用 **JSZip** 打包 → `Blob` → 触发下载。单张也可点开大图。
- 零图片时显示"该文档没有图片"。

## 6. 横切事项

### 6.1 工具注册与提示词

- 5 个工具加进 `FEISHU_TOOLS`（`tools.ts`）。`toolsForContext`（`agent.ts:250`）只在 `kind==='doc'`（及 wiki 解析为 doc）时暴露这 5 个；其他上下文行为不变。
- 系统提示词（`agent.ts` doc 段）补几行：何时用 `insert_image` / `copy_document` / `clone_doc_with_images` / `replace_image` / `export_doc_images`；以及"图片位置只走锚点定位，无法读光标"与"保真克隆优先用 `copy_document`"。

### 6.2 附件透传 plumbing

现有：`runAgent(history, …)` 的 history 里 user message 带 `attachments`，但 `executeDocTool` 拿不到。

改动：把"当前轮最近一条 user message 的 attachments"透传进工具执行上下文（例如 `executeDocTool(args, ctx)` 的 `ctx` 增 `attachments`）。**只读不改**：`insert_image`/`replace_image` 读这份附件；现有 `buildApiHistory` 把附件发 vision 的链路完全不动（见 §7）。

### 6.3 错误处理

- 上传失败（体积/scope/网络）→ 工具返回中文错误串，由 agent 转述给用户。
- clone/export 里单图失败 → 跳过 + 计入汇总，不中断整体。
- scope 不足（`upload_all` 返回权限错）→ 返回明确提示"当前授权可能缺少上传权限，请在设置里重新授权"，不静默失败。

### 6.4 测试计划（vitest，沿用 `slidesImages.test.ts` fixture 风格）

- `upload.test.ts`：multipart 表单字段构造（mock `feishuUpload`）、20MB 边界、返回 token 解析。
- `docx.test.ts` 增量：`buildBlock` image 分支输出正确的 `block_type:27`。
- `cloneDoc.test.ts`：mock listBlocks/downloadMedia/uploadMedia/insertBlocks，断言文本/图片/表格/占位/skip 的重建顺序与计数。
- `replace` / `export` 工具路径：定位 + 删插 / 下载打包。
- `InputBar` 粘贴：剪贴板图片 → 附件（无图片时不影响文本粘贴）。

## 7. 回归保护（"不影响原来的对话功能"）

- **附件→vision 链路不动**：`buildApiHistory`（`agent.ts:634`）把图片附件发 `image_url` 的逻辑零改动；`insert_image`/`replace_image` 是**额外**读附件的新路径，不替换旧路径。
- **`feishuFetch`/`feishuReq` 不动**：multipart 走新兄弟方法 `feishuUpload`，JSON 路径原样。
- **`buildBlock` 只加分支**：现有 text/h1…/table/sheet 分支零改动。
- **`InputBar` 粘贴只加 `onPaste`**：仅在 `e.clipboardData.files` 有图片文件时才介入；纯文本粘贴、拖拽、picker 全部不变。
- **新工具默认不暴露**：`toolsForContext` 对非 doc 上下文返回的工具集与今天完全一致。
- **JSZip 局部引入**：只在 `ImageExportCard` 动态/局部 import，不进主 bundle 路径，不影响其他面板。
- **现有图片读取/下载（幻灯片用）不动**：`downloadMedia`、`serializeDocBlocks` 零改动，新代码复用它们。

## 8. 鉴权与 scope

- 走 user_access_token（`resolveToken`）。`upload_all` 预期被现有 `drive:drive` 覆盖。
- **落地时实测**：先不改 scope；若 `upload_all` 返回权限错误（如需要 `drive:file:upload` 或 image 专用 scope），再在 `config.ts feishuOauthScope` 与文档里补 scope，并提示用户重新授权。
- 不引入 tenant 身份；不破坏"只用用户身份操作"硬约束。

## 9. 风险与未决

- **`upload_all` 表单字段** —— 上面字段名（`file_name`/`parent_type`/`parent_node`/`size`/`file`）按飞书文档，实现时对照官方文档二次确认；`parent_type=docx_image` 同理。
- **图片块创建是否需 width/height** —— FAQ 示例只给 `image.token`；先只传 token，若飞书要求尺寸再补。
- **大图/多图性能** —— block 重建式克隆含数十张图的文档会串/并行多次上传；并发 4 + 进度上限缓解。>20MB 跳过。对保真克隆无影响（drive copy 一次调用）。
- **`drive copy` 行为** —— 接口标注"异步"，但对 docx 大概率同步返回新 `file_token`；实现时实测确认是否需要轮询。复制后图片是否正常渲染需真机验证。
- **`drive copy` scope** —— `drive:drive` 大概率覆盖；若不足，补 scope 提示。
- **JSZip 依赖** —— 已确认接受（~45KB，免费，仅 export card 用）。
- **wiki 文档** —— upload 的 `parentNode` 必须是 obj_token；clone 源/目标都要先解析。已在流程里写明。

## 10. 文件清单

**新增**：
- `src/shared/feishu/upload.ts` —— `uploadMedia` + `feishuUpload` 封装。
- `src/shared/feishu/cloneDoc.ts` —— 整篇克隆管线。
- `src/sidepanel/components/ImageExportCard.tsx` + `.css` —— 导出画廊 + ZIP。
- 测试：`upload.test.ts`、`cloneDoc.test.ts`，及 `docx.test.ts`/`InputBar` 粘贴增量。

**修改**：
- `src/shared/feishu/http.ts` —— 加 `feishuUpload`（multipart 兄弟，不动现有）。
- `src/shared/feishu/docx.ts` —— `BlockStyle` 加 `'image'`、`buildBlock` 加 image 分支、`BlockSpec` 加 `imageToken`。
- `src/shared/ai/tools.ts` —— 5 个新工具 schema（`insert_image`/`copy_document`/`clone_doc_with_images`/`replace_image`/`export_doc_images`）。
- `src/shared/ai/agent.ts` —— `executeDocTool` 5 个新分支 + `copy_document` drive-copy 封装 + 附件透传 + `toolsForContext` 暴露 + `__image_export` marker 识别 + 提示词补充。
- `src/sidepanel/components/InputBar.tsx` —— `onPaste` 剪贴板图片。
- `src/sidepanel/components/ChatPanel.tsx` —— `onToolMessage` 识别 `__image_export` → 渲染 `ImageExportCard`。
- `package.json` —— 加 `jszip` 依赖。

## 11. 验收标准

- 四个场景在真机（飞书文档页）各跑通一次：插入可见、克隆新文档图文齐全、替换原位生效、导出 ZIP 可下载且张数正确。
- `npm run typecheck` 0 错；`npm test` 全绿（含新增测试）；`npm run build` 成功。
- 现有对话/附件/vision/幻灯片图片功能回归无变化。
- 非 doc 上下文（Base/Sheet/普通页）工具集与 UI 无变化。
