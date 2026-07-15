import { describe, it, expect } from 'vitest'
import { buildBlocks, blocksToMarkdown } from './layout'
import { cleanPdfMarkdown } from './clean'
import { markdownToSegments } from '../feishu/docx'
import type { TextLine } from './types'

/** 构造一个有 X 间距的 TextLine（模拟 PDF 表格行）。 */
function line(text: string, y: number, segments: { text: string; x: number; width: number }[], fontSize = 10): TextLine {
  return { text, y, x: segments[0]?.x ?? 0, fontSize, page: 1, segments }
}

describe('buildBlocks — table detection via X coordinate gaps', () => {
  it('detects a table when columns have large X gaps but text has no 2+ spaces', () => {
    // 模拟 PDF 表格：3 列，列间距 100pt（远大于字号 10pt * 1.5 = 15pt）
    // text 字段没有 2+ 空格（"姓名年龄城市"），但 segments 有明显的 X 间距
    const lines: TextLine[] = [
      line('姓名年龄城市', 100, [
        { text: '姓名', x: 50, width: 20 },
        { text: '年龄', x: 150, width: 20 },
        { text: '城市', x: 250, width: 20 },
      ]),
      line('张三25上海', 90, [
        { text: '张三', x: 50, width: 20 },
        { text: '25', x: 150, width: 20 },
        { text: '上海', x: 250, width: 20 },
      ]),
      line('李四30北京', 80, [
        { text: '李四', x: 50, width: 20 },
        { text: '30', x: 150, width: 20 },
        { text: '北京', x: 250, width: 20 },
      ]),
    ]
    const blocks = buildBlocks(lines, [])
    expect(blocks.filter((b) => b.kind === 'table')).toHaveLength(1)
    const md = blocksToMarkdown(blocks, false)
    expect(md).toContain('| 姓名 | 年龄 | 城市 |')
    expect(md).toContain('| --- | --- | --- |')
    expect(md).toContain('| 张三 | 25 | 上海 |')
    expect(md).toContain('| 李四 | 30 | 北京 |')
  })

  it('does not split columns when X gaps are small (normal text)', () => {
    // 模拟普通文本：字间距小（5pt < 字号 10pt * 1.5 = 15pt），不应被检测为表格
    const lines: TextLine[] = [
      line('这是一段普通文本', 100, [
        { text: '这', x: 50, width: 10 },
        { text: '是', x: 60, width: 10 },
        { text: '一', x: 70, width: 10 },
        { text: '段', x: 80, width: 10 },
        { text: '普', x: 90, width: 10 },
        { text: '通', x: 100, width: 10 },
        { text: '文', x: 110, width: 10 },
        { text: '本', x: 120, width: 10 },
      ]),
      line('第二行普通文本', 90, [
        { text: '第', x: 50, width: 10 },
        { text: '二', x: 60, width: 10 },
        { text: '行', x: 70, width: 10 },
        { text: '普', x: 80, width: 10 },
        { text: '通', x: 90, width: 10 },
        { text: '文', x: 100, width: 10 },
        { text: '本', x: 110, width: 10 },
      ]),
    ]
    const blocks = buildBlocks(lines, [])
    expect(blocks.filter((b) => b.kind === 'table')).toHaveLength(0)
    expect(blocks.every((b) => b.kind === 'paragraph')).toBe(true)
  })

  it('falls back to 2+ space splitting when segments are absent', () => {
    // 无 segments 时，回退到 2+ 空格检测（兼容旧数据）
    const lines: TextLine[] = [
      { text: '姓名  年龄  城市', y: 100, x: 50, fontSize: 10, page: 1 },
      { text: '张三  25  上海', y: 90, x: 50, fontSize: 10, page: 1 },
    ]
    const blocks = buildBlocks(lines, [])
    expect(blocks.filter((b) => b.kind === 'table')).toHaveLength(1)
    const md = blocksToMarkdown(blocks, false)
    expect(md).toContain('| 姓名 | 年龄 | 城市 |')
    expect(md).toContain('| --- | --- | --- |')
  })

  it('aligns rows with different column counts (fills empty cells)', () => {
    // 某行少一列时，用空字符串填充
    const lines: TextLine[] = [
      line('姓名年龄城市', 100, [
        { text: '姓名', x: 50, width: 20 },
        { text: '年龄', x: 150, width: 20 },
        { text: '城市', x: 250, width: 20 },
      ]),
      line('张三上海', 90, [
        { text: '张三', x: 50, width: 20 },
        { text: '上海', x: 250, width: 20 },
      ]),
    ]
    const blocks = buildBlocks(lines, [])
    expect(blocks.filter((b) => b.kind === 'table')).toHaveLength(1)
    const md = blocksToMarkdown(blocks, false)
    // 第二行只有 2 列，对齐到 3 列，中间补空
    expect(md).toContain('| 张三 |  | 上海 |')
  })
})

describe('end-to-end: PDF extract → clean → markdownToSegments', () => {
  it('table survives cleanPdfMarkdown and is recognized by markdownToSegments', () => {
    // 模拟 PDF 提取：表格前后有段落
    const lines: TextLine[] = [
      line('这是一段引言文字', 120, [{ text: '这是一段引言文字', x: 50, width: 100 }]),
      line('姓名年龄城市', 100, [
        { text: '姓名', x: 50, width: 20 },
        { text: '年龄', x: 150, width: 20 },
        { text: '城市', x: 250, width: 20 },
      ]),
      line('张三25上海', 90, [
        { text: '张三', x: 50, width: 20 },
        { text: '25', x: 150, width: 20 },
        { text: '上海', x: 250, width: 20 },
      ]),
      line('李四30北京', 80, [
        { text: '李四', x: 50, width: 20 },
        { text: '30', x: 150, width: 20 },
        { text: '北京', x: 250, width: 20 },
      ]),
      line('结论文字', 60, [{ text: '结论文字', x: 50, width: 80 }]),
    ]
    const blocks = buildBlocks(lines, [])
    const md = blocksToMarkdown(blocks, true)
    // 清洗后仍应包含 pipe 表格
    const cleaned = cleanPdfMarkdown(md)
    expect(cleaned).toContain('| 姓名 | 年龄 | 城市 |')
    expect(cleaned).toContain('| --- | --- | --- |')
    expect(cleaned).toContain('| 张三 | 25 | 上海 |')
    // markdownToSegments 应识别为 table 段
    const segs = markdownToSegments(cleaned)
    const tableSegs = segs.filter((s) => s.kind === 'table')
    expect(tableSegs).toHaveLength(1)
    const table = tableSegs[0] as { kind: 'table'; rows: string[][] }
    expect(table.rows).toEqual([
      ['姓名', '年龄', '城市'],
      ['张三', '25', '上海'],
      ['李四', '30', '北京'],
    ])
  })
})
