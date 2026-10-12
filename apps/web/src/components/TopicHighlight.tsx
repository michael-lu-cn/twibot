/** 搜索命中高亮：按 fuzzyMatch 返回的归一化区间切分文本，命中段落包 <mark>。 */
export function TopicHighlight({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  if (!ranges || ranges.length === 0) return <>{text}</>
  const parts: React.ReactNode[] = []
  let cursor = 0
  ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(
      <mark key={i} className="rounded-[2px] bg-sky-500/25 text-inherit">
        {text.slice(start, end)}
      </mark>,
    )
    cursor = end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}
