export interface ParsedQuestion {
  question_number: string
  question_key: string
  parent_key: string
  question_text: string
  options: string[]
  marks: string | null
  page_number: number | null
  section: string | null
  order_index: number
  metadata: Record<string, unknown>
}

export interface QuestionPage {
  pageNumber: number | null
  text: string
}

const QUESTION_START =
  /^\s*(?:(?:Q(?:uestion)?|प्रश्न)\s*[.:-]?\s*)?(\d{1,3})\s*(?:\(([a-zA-Z])\))?\s*[.):-]\s*(.*)$/u
const ROMAN_QUESTION_START =
  /^\s*(?:(?:Q(?:uestion)?|प्रश्न)\s*[.:-]?\s*)?([IVXLC]{1,6})\s*[.):-]\s+(.*)$/u
const OPTION_START = /^\s*(?:\(([a-hA-H])\)|([a-hA-H])[.)])\s+(.+)$/u
const SECTION_START = /^\s*(?:section|part|भाग)\s+([A-Z0-9IVXLC]+)\b.*$/iu
const MARKS_PATTERN =
  /(?:\[|\()?\s*(\d{1,3})\s*(?:marks?|mark|अंक)\s*(?:\]|\))?/iu
const INSTRUCTION_PATTERN =
  /^(?:answer|attempt|note|instructions?|time\s+allowed|maximum\s+marks|total\s+marks|all\s+questions|general\s+instructions)/iu

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeKey(number: string, subpart?: string): string {
  const base = number.toLowerCase().replace(/[^0-9a-z]/g, '')
  return subpart ? `${base}${subpart.toLowerCase()}` : base
}

const INLINE_OPTION_SPLIT = /\s+(?=(?:\([a-hA-H]\)|[a-hA-H][.)])\s+)/u

function splitInlineOptions(text: string): { text: string; options: string[] } {
  const parts = text.split(INLINE_OPTION_SPLIT)
  if (parts.length < 3) return { text, options: [] }
  const stem = parts.shift() ?? ''
  const options = parts
    .map((part) => normalizeWhitespace(part.replace(/^(?:\([a-hA-H]\)|[a-hA-H][.)])\s+/u, '')))
    .filter((option) => option.length > 0)
  if (options.length < 2) return { text, options: [] }
  return { text: stem.trim(), options }
}

function isLikelyQuestion(text: string, hasOptions: boolean): boolean {
  const trimmed = normalizeWhitespace(text)
  if (trimmed.length < 8) return false
  if (hasOptions) return true
  if (trimmed.length >= 22) return true
  return /\?|:\s*$|explain|describe|define|state|write|calculate|find|prove|derive|discuss|compare|list|name|what|why|how|which|who|where|when/iu.test(
    trimmed,
  )
}

function preprocessText(text: string): string[] {
  const cleaned = text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')

  const lines = cleaned.split('\n').map((line) => line.trim())
  const dense = lines.filter((line) => line.length > 0)

  if (dense.length <= 3) {
    return cleaned
      .replace(/(?=(?:^|\s)(?:Q(?:uestion)?\s*[.:-]?\s*)?\d{1,3}\s*[.)]\s)/g, '\n')
      .split('\n')
      .map((line) => line.trim())
  }

  return lines
}

function extractMarks(text: string): string | null {
  const match = MARKS_PATTERN.exec(text)
  return match?.[1] ?? null
}

export function parseQuestionsFromPages(pages: QuestionPage[]): ParsedQuestion[] {
  const questions: ParsedQuestion[] = []
  let section: string | null = null
  let current: ParsedQuestion | null = null
  let order = 0

  const pushCurrent = () => {
    if (!current) return
    current.question_text = normalizeWhitespace(current.question_text)
    if (current.question_text.length > 0) {
      current.marks = current.marks ?? extractMarks(current.question_text)
      questions.push(current)
      order += 1
    }
    current = null
  }

  for (const page of pages) {
    for (const rawLine of preprocessText(page.text)) {
      const line = rawLine.trim()
      if (!line) continue

      const sectionMatch = SECTION_START.exec(line)
      if (sectionMatch && line.length < 90 && !QUESTION_START.test(line)) {
        section = `Section ${sectionMatch[1]?.toUpperCase()}`
        continue
      }

      if (INSTRUCTION_PATTERN.test(line) && !QUESTION_START.test(line)) {
        continue
      }

      const optionMatch = OPTION_START.exec(line)
      if (optionMatch && current && line.length < 240) {
        const optionText = normalizeWhitespace(optionMatch[3] ?? '')
        if (optionText.length > 0) {
          current.options.push(optionText)
          if (!current.marks) current.marks = extractMarks(optionText)
        }
        continue
      }

      const numeric = QUESTION_START.exec(line)
      const roman = numeric ? null : ROMAN_QUESTION_START.exec(line)

      if (numeric || roman) {
        const number = numeric?.[1] ?? roman?.[1] ?? ''
        const subpart = numeric?.[2]
        const inlineText = normalizeWhitespace(numeric?.[3] ?? roman?.[2] ?? '')
        const hasOptions = /\b(?:[a-hA-H])[.)]\s/.test(inlineText)
        const looksLikeYear = /^(?:19|20)\d{2}$/.test(number)

        if (looksLikeYear) {
          if (current) current.question_text += ` ${line}`
          continue
        }

        pushCurrent()

        const inline = splitInlineOptions(inlineText)

        if (!isLikelyQuestion(inline.text, hasOptions) && current === null) {
          current = {
            question_number: number,
            question_key: normalizeKey(number, subpart),
            parent_key: normalizeKey(number),
            question_text: inline.text,
            options: inline.options,
            marks: extractMarks(inlineText),
            page_number: page.pageNumber,
            section,
            order_index: 0,
            metadata: { parser: 'pattern' },
          }
          continue
        }

        current = {
          question_number: subpart ? `${number}(${subpart})` : number,
          question_key: normalizeKey(number, subpart),
          parent_key: normalizeKey(number),
          question_text: inline.text,
          options: inline.options,
          marks: extractMarks(inlineText),
          page_number: page.pageNumber,
          section,
          order_index: 0,
          metadata: { parser: 'pattern' },
        }
        continue
      }

      if (current) {
        const continuation = normalizeWhitespace(line)
        if (continuation.length > 0) {
          current.question_text = `${current.question_text} ${continuation}`.trim()
          if (!current.marks) current.marks = extractMarks(continuation)
        }
      }
    }
  }

  pushCurrent()

  const filtered = questions
    .filter((question) => question.question_text.length >= 8)
    .slice(0, 300)

  filtered.forEach((question, index) => {
    question.order_index = index
  })

  return filtered
}

export function looksLikeQuestionPaper(
  pages: QuestionPage[],
  extracted: ParsedQuestion[] = parseQuestionsFromPages(pages),
): boolean {
  if (extracted.length < 3) return false
  const withMarks = extracted.filter((question) => question.marks).length
  const withOptions = extracted.filter((question) => question.options.length > 0).length
  const questionMarks = extracted.filter((question) => question.question_text.includes('?')).length
  return withMarks >= 2 || withOptions >= 2 || questionMarks >= 2 || extracted.length >= 5
}

export function questionLookupKeys(query: string): string[] {
  const keys = new Set<string>()
  const numberMatches = query.match(/\b(?:q(?:uestion)?\s*)?(\d{1,3})(?:\s*\(([a-zA-Z])\))?/giu)
  if (numberMatches) {
    for (const match of numberMatches) {
      const parsed = /(\d{1,3})(?:\s*\(([a-zA-Z])\))?/u.exec(match)
      if (!parsed?.[1]) continue
      keys.add(parsed[1])
      if (parsed[2]) keys.add(`${parsed[1]}${parsed[2].toLowerCase()}`)
    }
  }
  for (const roman of query.match(/\b(?:q(?:uestion)?\s*)?([IVXLC]{1,6})\b/giu) ?? []) {
    const parsed = /([IVXLC]{1,6})/iu.exec(roman)
    if (parsed?.[1]) keys.add(parsed[1].toLowerCase())
  }
  return Array.from(keys)
}

export function isAnswerAllQuestions(query: string): boolean {
  return /\b(?:answer|solve|do|attempt)\s+(?:all|every|each)\s+(?:of\s+)?(?:the\s+)?questions?\b/iu.test(
    query,
  )
}

export function isAnswerQuestionIntent(query: string): boolean {
  return (
    isAnswerAllQuestions(query) ||
    /\b(?:answer|solve|do)\s+(?:the\s+)?(?:q(?:uestion)?\s*(?:no\.?|number)?\s*)?\d{1,3}\b/iu.test(
      query,
    ) ||
    /\b(?:question|q)\s*(?:no\.?|number)?\s*\d{1,3}\b/iu.test(query)
  )
}
