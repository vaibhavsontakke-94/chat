import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_MESSAGE_CHARS } from '../constants.ts'
import { trimContext, validateChatRequest } from '../lib/validate.ts'

const options = { fallbackModel: 'test-model' }

describe('validateChatRequest', () => {
  it('accepts a well-formed payload', () => {
    const result = validateChatRequest(
      { messages: [{ role: 'user', content: 'Hello there' }] },
      options,
    )

    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.messages.length, 1)
    assert.equal(result.value.messages[0]?.content, 'Hello there')
    assert.equal(result.value.model, 'test-model')
  })

  it('uses an explicit model when one is provided', () => {
    const result = validateChatRequest(
      { messages: [{ role: 'user', content: 'Hello' }], model: 'custom/model' },
      options,
    )

    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.model, 'custom/model')
  })

  it('rejects a non-object body', () => {
    const result = validateChatRequest('nope', options)
    assert.equal(result.ok, false)
  })

  it('rejects an empty message list', () => {
    const result = validateChatRequest({ messages: [] }, options)
    assert.equal(result.ok, false)
  })

  it('rejects an unknown role', () => {
    const result = validateChatRequest(
      { messages: [{ role: 'robot', content: 'beep' }] },
      options,
    )
    assert.equal(result.ok, false)
  })

  it('rejects blank content', () => {
    const result = validateChatRequest({ messages: [{ role: 'user', content: '   ' }] }, options)
    assert.equal(result.ok, false)
  })

  it('rejects a message above the size limit', () => {
    const result = validateChatRequest(
      { messages: [{ role: 'user', content: 'x'.repeat(MAX_MESSAGE_CHARS + 1) }] },
      options,
    )
    assert.equal(result.ok, false)
  })

  it('clamps temperature and max tokens', () => {
    const result = validateChatRequest(
      { messages: [{ role: 'user', content: 'hi' }], temperature: 99, maxTokens: 10 ** 9 },
      options,
    )

    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.temperature, 2)
    assert.ok(result.value.maxTokens <= 4096)
  })

  it('requires the conversation to end with a user or assistant message', () => {
    const result = validateChatRequest(
      { messages: [{ role: 'system', content: 'be brief' }] },
      options,
    )
    assert.equal(result.ok, false)
  })
})

describe('trimContext', () => {
  it('keeps everything when inside the budget', () => {
    const messages = [
      { role: 'user' as const, content: 'one' },
      { role: 'assistant' as const, content: 'two' },
    ]

    assert.deepEqual(trimContext(messages, 100), messages)
  })

  it('drops the oldest messages first', () => {
    const messages = [
      { role: 'user' as const, content: 'oldest' },
      { role: 'assistant' as const, content: 'middle' },
      { role: 'user' as const, content: 'newest' },
    ]

    const trimmed = trimContext(messages, 10)

    assert.equal(trimmed.length, 1)
    assert.equal(trimmed[0]?.content, 'newest')
  })

  it('always keeps system instructions', () => {
    const messages = [
      { role: 'system' as const, content: 'stay helpful' },
      { role: 'user' as const, content: 'oldest' },
      { role: 'user' as const, content: 'newest' },
    ]

    const trimmed = trimContext(messages, 20)

    assert.equal(trimmed[0]?.role, 'system')
    assert.equal(trimmed[0]?.content, 'stay helpful')
  })
})
