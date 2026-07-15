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

/** Create one or more nodes on a whiteboard (batch). Returns the created node IDs. */
export async function createNodes(
  token: string,
  whiteboardId: string,
  nodes: BoardNode[],
) {
  return feishuReq<{ ids?: string[]; client_token?: string }>(
    'POST',
    `/board/v1/whiteboards/${whiteboardId}/nodes`,
    token,
    { nodes },
  )
}

/**
 * Parse PlantUML/Mermaid syntax into board nodes. Great for flowcharts, mind maps,
 * sequence diagrams, class diagrams, ER diagrams — the agent just writes the syntax
 * and Feishu lays it out automatically.
 */
export async function createDiagram(
  token: string,
  whiteboardId: string,
  code: string,
  opts?: {
    /** 1=PlantUML, 2=Mermaid */
    syntax_type?: 1 | 2
    /** 1=画板样式(多节点可编辑), 2=经典样式(单图可编辑语法). Only PlantUML supports 2. */
    style_type?: 1 | 2
    /** 0=auto-detect, 1=mindmap, 2=sequence, 3=activity, 4=class, ... */
    diagram_type?: number
  },
) {
  return feishuReq<{ node_id?: string }>(
    'POST',
    `/board/v1/whiteboards/${whiteboardId}/nodes/plantuml`,
    token,
    {
      plant_uml_code: code,
      syntax_type: opts?.syntax_type ?? 1,
      style_type: opts?.style_type ?? 2,
      diagram_type: opts?.diagram_type ?? 0,
    },
  )
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
