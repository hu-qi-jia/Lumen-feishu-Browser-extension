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
