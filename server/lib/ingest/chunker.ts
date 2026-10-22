export interface Chunk {
  index: number
  pageNumber: number | null
  content: string
}

export interface ChunkOptions {
  chunkSize?: number
  overlap?: number
}

export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const chunkSize = opts.chunkSize ?? 1000
  const overlap = opts.overlap ?? 200
  const cleaned = text.replace(/\r\n/g, '\n')
  if (cleaned.trim().length === 0) return []
  const chunks: Chunk[] = []
  let start = 0
  let index = 0
  while (start < cleaned.length) {
    const end = Math.min(start + chunkSize, cleaned.length)
    const slice = cleaned.slice(start, end)
    // try to break at whitespace
    let cut = slice
    if (end < cleaned.length) {
      const lastSpace = slice.lastIndexOf(' ')
      if (lastSpace > chunkSize * 0.5) {
        cut = slice.slice(0, lastSpace)
      }
    }
    const content = cut.trim()
    if (content.length > 0) {
      chunks.push({ index, pageNumber: null, content })
      index++
    }
    if (end === cleaned.length) break
    start = start + cut.length - overlap
    if (start < 0) start = 0
    // prevent infinite loop
    if (start >= cleaned.length) break
  }
  return chunks
}

export function chunkPages(pages: Array<{ pageNumber: number; text: string }>, opts: ChunkOptions = {}): Chunk[] {
  const chunkSize = opts.chunkSize ?? 1000
  const overlap = opts.overlap ?? 200
  const chunks: Chunk[] = []
  let globalIndex = 0
  for (const page of pages) {
    const cleaned = page.text.replace(/\r\n/g, '\n')
    if (cleaned.trim().length === 0) continue
    let start = 0
    while (start < cleaned.length) {
      const end = Math.min(start + chunkSize, cleaned.length)
      const slice = cleaned.slice(start, end)
      let cut = slice
      if (end < cleaned.length) {
        const lastSpace = slice.lastIndexOf(' ')
        if (lastSpace > chunkSize * 0.5) {
          cut = slice.slice(0, lastSpace)
        }
      }
      const content = cut.trim()
      if (content.length > 0) {
        chunks.push({ index: globalIndex++, pageNumber: page.pageNumber, content })
      }
      if (end === cleaned.length) break
      start = start + cut.length - overlap
      if (start < 0) start = 0
      if (start >= cleaned.length) break
    }
  }
  return chunks
}
