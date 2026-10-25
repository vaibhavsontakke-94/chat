import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isAnswerAllQuestions,
  isAnswerQuestionIntent,
  looksLikeQuestionPaper,
  parseQuestionsFromPages,
  questionLookupKeys,
} from '../lib/ingest/questions.ts'
import { selectQuestions, type DocumentQuestion } from '../lib/rag/questions.ts'
import { buildQuestionPaperPrompt, buildRagPrompt } from '../lib/rag/prompt.ts'
import { filterRetrievedChunks, type RetrievedChunk } from '../lib/rag/retrieve.ts'

function question(overrides: Partial<DocumentQuestion> = {}): DocumentQuestion {
  return {
    id: 'q1',
    document_id: 'doc-1',
    question_number: '1',
    question_key: '1',
    parent_key: '1',
    question_text: 'What is the capital of France?',
    options: [],
    marks: '2',
    page_number: 1,
    section: 'Section A',
    order_index: 0,
    metadata: {},
    ...overrides,
  }
}

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunk_id: 'chunk-1',
    document_id: 'doc-1',
    filename: 'paper.pdf',
    page_number: 1,
    chunk_index: 0,
    content: 'Paris is the capital of France. Photosynthesis converts light into chemical energy.',
    metadata: {},
    similarity: 0.72,
    ...overrides,
  }
}

test('parseQuestionsFromPages extracts numbered questions, options, marks, and sections', () => {
  const questions = parseQuestionsFromPages([
    {
      pageNumber: 1,
      text: `Section A
1. What is the capital of France? (2 marks)
a) Paris
b) London
2. Explain photosynthesis. [5 marks]
3. Calculate 2 + 2. (1 mark)`,
    },
  ])

  assert.equal(questions.length, 3)
  assert.deepEqual(
    questions.map((item) => item.question_number),
    ['1', '2', '3'],
  )
  assert.deepEqual(questions[0]?.options, ['Paris', 'London'])
  assert.equal(questions[0]?.marks, '2')
  assert.equal(questions[0]?.section, 'Section A')
  assert.equal(questions[1]?.marks, '5')
  assert.equal(questions[2]?.marks, '1')
  assert.equal(looksLikeQuestionPaper([{ pageNumber: 1, text: '' }], questions), true)
})

test('parseQuestionsFromPages handles dense single-line question papers', () => {
  const questions = parseQuestionsFromPages([
    {
      pageNumber: 2,
      text: '1. What is velocity? 2. Define acceleration. 3. State Newton first law.',
    },
  ])

  assert.equal(questions.length, 3)
  assert.equal(questions[1]?.question_text, 'Define acceleration.')
})

test('parseQuestionsFromPages splits inline options from extracted PDF text', () => {
  const questions = parseQuestionsFromPages([
    {
      pageNumber: 1,
      text: 'Section A 1. What is the capital of France? (2 marks) a) Paris b) London 2. Explain photosynthesis. (5 marks) 3. What is 2 + 2? (1 mark)',
    },
  ])

  assert.equal(questions.length, 3)
  assert.equal(questions[0]?.question_text, 'What is the capital of France? (2 marks)')
  assert.deepEqual(questions[0]?.options, ['Paris', 'London'])
  assert.equal(questions[1]?.question_text, 'Explain photosynthesis. (5 marks)')
})

test('question intent and lookup keys understand question numbers and answer-all', () => {
  assert.equal(isAnswerAllQuestions('Answer all questions'), true)
  assert.equal(isAnswerAllQuestions('Please solve every question'), true)
  assert.equal(isAnswerAllQuestions('Answer question 3'), false)
  assert.equal(isAnswerQuestionIntent('answer q2'), true)
  assert.equal(isAnswerQuestionIntent('explain the topic'), false)
  assert.deepEqual(questionLookupKeys('answer question 4(b)').sort(), ['4', '4b'])
})

test('selectQuestions matches a numbered question, its subparts, and answer-all', () => {
  const rows = [
    question({ id: 'q1', question_number: '1', question_key: '1', parent_key: '1' }),
    question({
      id: 'q2a',
      question_number: '2(a)',
      question_key: '2a',
      parent_key: '2',
      order_index: 1,
    }),
    question({
      id: 'q2b',
      question_number: '2(b)',
      question_key: '2b',
      parent_key: '2',
      order_index: 2,
    }),
    question({ id: 'q3', question_number: '3', question_key: '3', parent_key: '3', order_index: 3 }),
  ]

  assert.deepEqual(
    selectQuestions(rows, 'answer question 2', 25)?.questions.map((item) => item.id),
    ['q2a', 'q2b'],
  )
  assert.deepEqual(
    selectQuestions(rows, 'solve Q1', 25)?.questions.map((item) => item.id),
    ['q1'],
  )
  assert.equal(selectQuestions(rows, 'Answer all questions', 2)?.questions.length, 2)
  assert.equal(selectQuestions(rows, 'answer question 9', 25), null)
})

test('buildQuestionPaperPrompt answers every question and keeps citations', () => {
  const { prompt, citations } = buildQuestionPaperPrompt(
    [
      {
        question_number: '1',
        question_text: 'What is the capital of France?',
        options: ['Paris', 'London'],
        marks: '2',
        section: 'Section A',
        page_number: 1,
      },
      {
        question_number: '2',
        question_text: 'Explain photosynthesis.',
        options: [],
        marks: '5',
        section: 'Section A',
        page_number: 1,
      },
    ],
    [chunk()],
    'document',
  )

  assert.equal(citations.length, 1)
  assert.match(prompt, /Question 1/)
  assert.match(prompt, /Question 2/)
  assert.match(prompt, /Answer EVERY question/)
  assert.match(prompt, /Paris/)
  assert.match(prompt, /Do not merge questions/)
})

test('filterRetrievedChunks applies a relative similarity floor', () => {
  const chunks = [
    chunk({ chunk_id: 'a', similarity: 0.9 }),
    chunk({ chunk_id: 'b', similarity: 0.7 }),
    chunk({ chunk_id: 'c', similarity: 0.3 }),
  ]

  const result = filterRetrievedChunks(chunks, {
    threshold: 0.2,
    relativeThreshold: 0.55,
    topK: 5,
  })

  assert.deepEqual(
    result.map((item) => item.chunk_id),
    ['a', 'b'],
  )
})

test('document prompt still handles an empty context', () => {
  const prompt = buildRagPrompt('What is the code name?', [], 'document').prompt
  assert.match(prompt, /could not find this information/)
})
