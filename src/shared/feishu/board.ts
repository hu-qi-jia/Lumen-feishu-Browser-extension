import { feishuReq } from './http'

/** Create a new whiteboard (画板). Returns whiteboard_id + title. */
export function createWhiteboard(token: string, title: string, folderToken?: string) {
  return feishuReq('POST', '/board/v1/whiteboards', token, {
    title,
    ...(folderToken ? { folder_token: folderToken } : {}),
  })
}

/** Get whiteboard info by ID. */
export function getWhiteboard(token: string, whiteboardId: string) {
  return feishuReq('GET', `/board/v1/whiteboards/${whiteboardId}`, token)
}
