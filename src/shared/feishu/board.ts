import { feishuReq } from './http'
import { createDocument } from './docx'

/**
 * Create a new whiteboard (画板). Feishu's Board API has NO standalone create endpoint
 * (POST /board/v1/whiteboards returns 404), but a Board block (block_type 43) CAN be
 * created inside a document — and doing so auto-provisions a fresh whiteboard whose
 * token IS the whiteboard_id.
 *
 * Behavior:
 * - If `documentId` is provided → insert the Board block directly into THAT document
 *   (no new host document is created).
 * - If `documentId` is undefined → create a new host document first, then insert the
 *   Board block into it (standalone whiteboard use case).
 *
 * Returns { whiteboard_id, title, document_id, block_id }.
 */
export async function createWhiteboard(
  token: string,
  title: string,
  folderToken?: string,
  documentId?: string,
  index = 0,
) {
  const safeTitle = title || '未命名画板'

  // Resolve the target document: use the provided one, or create a new host doc.
  let docId = documentId
  let createdHost = false
  if (!docId) {
    const doc = (await createDocument(token, safeTitle, folderToken)) as {
      document?: { document_id?: string }
    }
    docId = doc.document?.document_id
    if (!docId) throw new Error('创建画板失败：无法创建宿主文档。')
    createdHost = true
  }

  // Insert a Board block (block_type 43) — auto-provisions a fresh whiteboard.
  const created = (await feishuReq(
    'POST',
    `/docx/v1/documents/${docId}/blocks/${docId}/children`,
    token,
    { index, children: [{ block_type: 43, board: {} }] },
  )) as { children?: Array<{ block_id?: string; board?: { token?: string } }> }

  const block = created.children?.[0]
  const whiteboardId = block?.board?.token
  if (!whiteboardId) throw new Error('创建画板失败：未返回画板 token。')

  return {
    whiteboard: {
      whiteboard_id: whiteboardId,
      title: safeTitle,
    },
    document_id: docId,
    block_id: block?.block_id ?? null,
    inserted_into_existing_doc: !createdHost,
  }
}

/**
 * Get whiteboard info. Feishu's Board API has no board-level GET endpoint
 * (GET /board/v1/whiteboards/:id returns 404). The closest available API is the
 * node-list endpoint, which at least confirms the whiteboard exists and is accessible.
 */
export async function getWhiteboard(token: string, whiteboardId: string) {
  // GET /board/v1/whiteboards/:id/nodes is the only board-level read endpoint that exists.
  const data = (await feishuReq(
    'GET',
    `/board/v1/whiteboards/${whiteboardId}/nodes`,
    token,
  )) as { nodes?: unknown[] }
  return {
    whiteboard: {
      whiteboard_id: whiteboardId,
      accessible: true,
    },
    node_count: Array.isArray(data.nodes) ? data.nodes.length : 0,
  }
}

// ─── Node-level operations ──────────────────────────────────────────────────

export interface BoardNode {
  id?: string
  type: string
  parent_id?: string
  children?: string[]
  x?: number
  y?: number
  z_index?: number
  width?: number
  height?: number
  angle?: number
  text?: {
    text?: string
    font_weight?: string
    font_size?: number
    horizontal_align?: string
    vertical_align?: string
    text_color?: string
    text_background_color?: string
    line_through?: boolean
    underline?: boolean
    italic?: boolean
    bold?: boolean
  }
  // composite_shape sub-type (rect / diamond / ellipse / cylinder / ...).
  shape?: string
  fill_color?: string
  border_color?: string
  border_style?: number
  border_width?: number
  // connector-specific
  start_id?: string
  end_id?: string
  start_point?: { x: number; y: number }
  end_point?: { x: number; y: number }
  // image-specific
  file_token?: string
  // section / group / table are containers — no extra required fields
  [k: string]: unknown
}

/** List all nodes of a whiteboard (the full canvas tree). */
export async function listNodes(token: string, whiteboardId: string) {
  return feishuReq<{ nodes?: BoardNode[] }>(
    'GET',
    `/board/v1/whiteboards/${whiteboardId}/nodes`,
    token,
  )
}

/** Create one or more nodes on a whiteboard (batch). Returns the created node IDs.
 *  NOTE: Feishu has REMOVED the doc page for this endpoint. Empirically, text_shape and
 *  sticky_note create reliably; composite_shape and connector often fail with field
 *  validation errors (the exact field schema is undocumented). Prefer createDiagram
 *  (PlantUML/Mermaid) for structured graphics — it has full doc support. */
export async function createNodes(
  token: string,
  whiteboardId: string,
  nodes: BoardNode[],
) {
  try {
    return await feishuReq<{ ids?: string[]; client_token?: string }>(
      'POST',
      `/board/v1/whiteboards/${whiteboardId}/nodes`,
      token,
      { nodes },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const types = nodes.map((n) => n.type).join(',')
    throw new Error(
      `createNodes 失败（whiteboard_id=${whiteboardId}, 节点类型=[${types}], 数量=${nodes.length}）：${msg}`,
    )
  }
}

/**
 * Parse PlantUML/Mermaid syntax into board nodes. Great for flowcharts, mind maps,
 * sequence diagrams, class diagrams, ER diagrams — the agent just writes the syntax
 * and Feishu lays it out automatically.
 *
 * Key API constraints (learned the hard way — 2890002 invalid arg):
 * - style_type=2 (classic/single-image) is PlantUML-ONLY. Mermaid MUST use style_type=1.
 * - diagram_type should ALWAYS be 0 (auto-detect). Passing a mismatched type (e.g. 1=mindmap
 *   for a flowchart @startuml) causes 2890002. The agent has no reason to override auto-detect.
 */
export async function createDiagram(
  token: string,
  whiteboardId: string,
  code: string,
  opts?: {
    /** 1=PlantUML (default), 2=Mermaid */
    syntax_type?: 1 | 2
    /** 1=画板样式(多节点可编辑, 默认), 2=经典样式(单图, PlantUML only) */
    style_type?: 1 | 2
  },
) {
  const syntaxType = opts?.syntax_type ?? 1
  // style_type=1 = artboard style (parsed into editable board nodes, visible on canvas)
  // style_type=2 = classic style (single image, PlantUML-only) — renders as ONE flat image
  //   that's easy to miss on a large canvas. Default to 1 so the diagram shows up as real nodes.
  //   Mermaid MUST use 1 (2 is PlantUML-only → 2890002).
  const styleType = opts?.style_type ?? 1
  try {
    return await feishuReq<{ node_id?: string }>(
      'POST',
      `/board/v1/whiteboards/${whiteboardId}/nodes/plantuml`,
      token,
      {
        plant_uml_code: code,
        syntax_type: syntaxType,
        style_type: styleType,
        diagram_type: 0, // always auto-detect — non-zero causes 2890002 when it mismatches the syntax
      },
    )
  } catch (e) {
    // 2890002 is ambiguous — could be bad whiteboard_id OR bad params. Augment with the actual
    // request payload + id so the agent/user can see exactly what was sent and diagnose.
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `createDiagram 失败（whiteboard_id=${whiteboardId}, syntax_type=${syntaxType}, style_type=${styleType}, code 长度=${code.length}）：${msg}`,
    )
  }
}

/** Delete nodes by ID (recursive — descendants are removed too). */
export async function deleteNodes(
  token: string,
  whiteboardId: string,
  nodeIds: string[],
) {
  return feishuReq<{ client_token?: string }>(
    'DELETE',
    `/board/v1/whiteboards/${whiteboardId}/nodes/batch_delete`,
    token,
    { ids: nodeIds },
  )
}
