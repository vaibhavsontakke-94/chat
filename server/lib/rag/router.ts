import type { AppConfig } from '../../config.ts'
import { completeChat } from '../groq.ts'
import type { RetrievedChunk } from './retrieve.ts'
import { sanitizeForPrompt } from './prompt.ts'

export type ChatMode = 'document' | 'general' | 'mixed'

const DOCUMENT_REFERENCE_PATTERNS = [
  /\b(document|documents|file|files|pdf|attachment|attachments|upload|uploaded|source|sources)\b/i,
  /\b(according to|based on|in the (text|paper|report|doc|file)|from the (text|paper|report|doc|file))\b/i,
  /\b(this|that|the) (page|section|chapter|table|figure|excerpt)\b/i,
]

export function looksDocumentSpecific(question: string): boolean {
  return DOCUMENT_REFERENCE_PATTERNS.some((pattern) => pattern.test(question))
}

const VAGUE_OVERVIEW_PATTERNS = [
  /^(about|answer|info|information|details?|summary|summarize|overview|explain)[.!?]*$/i,
  /^what(?:'s| is)? (?:this|it)(?: (?:about|do))?[.!?]*$/i,
  /^(tell me|show me) (?:more|about (?:this|it))[.!?]*$/i,
]

/**
 * Short inputs like "about" are common when a user has just attached a file.
 * Expand them into an explicit overview request so retrieval and the answer
 * prompt do not treat them as unanswerable questions.
 */
export function expandVagueDocumentQuestion(question: string): string {
  const trimmed = question.trim()
  if (trimmed.length === 0 || trimmed.length > 40) return trimmed
  if (!VAGUE_OVERVIEW_PATTERNS.some((pattern) => pattern.test(trimmed))) return trimmed
  return `${trimmed} What is this document about? Summarize its main topics and key details from the excerpts.`
}

export function fallbackMode(
  question: string,
  documentCount: number,
  relevantChunks: number,
): ChatMode {
  if (documentCount === 0) return 'general'
  if (relevantChunks > 0) return 'document'
  return looksDocumentSpecific(question) ? 'document' : 'general'
}

function parseMode(value: string): ChatMode | null {
  const normalized = value.toLowerCase()
  if (/\bmixed\b/.test(normalized)) return 'mixed'
  if (/\bdocument\b/.test(normalized)) return 'document'
  if (/\bgeneral\b/.test(normalized)) return 'general'
  return null
}

export async function classifyQuestion(input: {
  config: AppConfig
  question: string
  documentNames: string[]
  chunks: RetrievedChunk[]
  signal: AbortSignal
}): Promise<ChatMode> {
  const attachments = input.documentNames
    .slice(0, 20)
    .map((name) => `- ${sanitizeForPrompt(name).replace(/\s+/g, ' ')}`)
    .join('\n')
  const excerpts = input.chunks
    .slice(0, 5)
    .map(
      (chunk, index) =>
        `[${index + 1}] ${sanitizeForPrompt(chunk.filename)}\n${sanitizeForPrompt(chunk.content).slice(0, 700)}`,
    )
    .join('\n\n')

  const prompt = `You are a routing classifier for a document chat.
Decide how the user's latest question should be answered.

Labels:
- document: the question asks for information that should come from the attached documents.
- general: the question is normal conversation or general knowledge and does not need the documents.
- mixed: the question needs both document facts and general knowledge.

Prioritize the question's intent over keyword overlap. A question may be about a document's topic without naming the file.
Return exactly one lowercase label: document, general, or mixed.

Attached files:
${attachments || '(none)'}

Potentially relevant excerpts:
${excerpts || '(none)'}

Question:
${input.question}`

  const answer = await completeChat(
    input.config,
    {
      model: input.config.groqChatModel,
      messages: [
        {
          role: 'system',
          content: 'Classify the question. Output only one word: document, general, or mixed.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      maxTokens: 8,
    },
    input.signal,
  )

  return parseMode(answer) ?? 'general'
}
