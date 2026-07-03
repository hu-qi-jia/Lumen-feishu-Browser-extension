/** 从粘贴的飞书文档链接或裸 token 解析出文档 token。
 *  支持 `https://*.feishu.cn/(docx|docs|wiki)/TOKEN[?...]` 与裸 token（无 `/` `?`）。
 *  v1 仅处理文档；wiki 节点 token 需额外解析（Phase 2）。 */
export function parseDocTokenFromUrl(input: string): { token: string } | null {
  const s = (input ?? '').trim()
  if (!s) return null
  // 裸 token：无分隔符、足够长、字母数字/-_。
  if (!/[/?#]/.test(s) && /^[\w-]{10,}$/.test(s)) return { token: s }
  const m = s.match(/\/(?:docx|docs|wiki)\/([A-Za-z0-9]+)/)
  return m ? { token: m[1] } : null
}
