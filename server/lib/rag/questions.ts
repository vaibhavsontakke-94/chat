import type { getUserSupabase } from '../supabase/user.ts'
import {
  isAnswerAllQuestions,
  questionLookupKeys,
  type ParsedQuestion,
} from '../ingest/questions.ts'

type DbClient = ReturnType<typeof getUserSupabase>

export interface DocumentQuestion {
  id: string
  document_id: string
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

export interface QuestionSelection {
  intent: 'all' | 'one'
  questions: DocumentQuestion[]
  requestedKeys: string[]
}

function mapRow(row: Record<string, unknown>): DocumentQuestion {
  const metadata =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : {}
  const options = Array.isArray(row.options)
    ? row.options.filter((option): option is string => typeof option === 'string')
    : []

  return {
    id: String(row.id),
    document_id: String(row.document_id),
    question_number: String(row.question_number ?? ''),
    question_key: String(row.question_key ?? ''),
    parent_key:
      typeof metadata.parent_key === 'string'
        ? metadata.parent_key
        : String(row.question_key ?? '').replace(/[a-z]$/i, ''),
    question_text: String(row.question_text ?? ''),
    options,
    marks: typeof row.marks === 'string' ? row.marks : null,
    page_number: typeof row.page_number === 'number' ? row.page_number : null,
    section: typeof row.section === 'string' ? row.section : null,
    order_index: typeof row.order_index === 'number' ? row.order_index : 0,
    metadata,
  }
}

export async function loadDocumentQuestions(
  supabase: DbClient,
  documentIds: string[],
): Promise<DocumentQuestion[]> {
  if (documentIds.length === 0) return []
  const { data, error } = await supabase
    .from('document_questions')
    .select(
      'id, document_id, question_number, question_key, question_text, options, marks, page_number, section, order_index, metadata',
    )
    .in('document_id', documentIds)
    .order('document_id', { ascending: true })
    .order('order_index', { ascending: true })
    .limit(500)

  if (error) {
    if (error.code === 'PGRST205' || /could not find the table/i.test(error.message ?? '')) {
      return []
    }
    throw error
  }

  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>))
}

export function selectQuestions(
  questions: DocumentQuestion[],
  query: string,
  maxQuestions: number,
): QuestionSelection | null {
  if (questions.length === 0) return null
  const requestedKeys = questionLookupKeys(query)

  if (isAnswerAllQuestions(query)) {
    return {
      intent: 'all',
      questions: questions.slice(0, Math.max(1, maxQuestions)),
      requestedKeys: [],
    }
  }

  if (requestedKeys.length === 0) return null

  const ordered = [...questions].sort((a, b) => a.order_index - b.order_index)
  const wanted = new Set(requestedKeys.map((key) => key.toLowerCase()))
  const matches: DocumentQuestion[] = []
  const seen = new Set<string>()

  for (const key of wanted) {
    const exact = ordered.filter((question) => question.question_key.toLowerCase() === key)
    const byParent = ordered.filter((question) => question.parent_key.toLowerCase() === key)
    const selected = byParent.length > 0 ? byParent : exact
    for (const question of selected) {
      if (seen.has(question.id)) continue
      seen.add(question.id)
      matches.push(question)
    }
  }

  if (matches.length === 0) {
    const numbered = ordered.find((question) => question.question_number === requestedKeys[0])
    if (numbered) matches.push(numbered)
  }

  if (matches.length === 0) return null
  return {
    intent: 'one',
    questions: matches.slice(0, Math.max(1, maxQuestions)),
    requestedKeys,
  }
}

export function batchQuestions(
  questions: DocumentQuestion[],
  batchSize: number,
): DocumentQuestion[][] {
  const size = Math.max(1, batchSize)
  const batches: DocumentQuestion[][] = []
  for (let start = 0; start < questions.length; start += size) {
    batches.push(questions.slice(start, start + size))
  }
  return batches
}

export function questionSearchText(question: DocumentQuestion): string {
  const options = question.options.length > 0 ? ` Options: ${question.options.join(' | ')}` : ''
  return `${question.question_text}${options}`.trim()
}

export function parsedQuestionMetadata(question: ParsedQuestion): Record<string, unknown> {
  return {
    ...question.metadata,
    parent_key: question.parent_key,
  }
}
