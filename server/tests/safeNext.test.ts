import test from 'node:test'
import assert from 'node:assert/strict'
import { safeNext } from '../../src/lib/safeNext.ts'

test('safeNext keeps same-origin paths with query and hash', () => {
  assert.equal(safeNext('/'), '/')
  assert.equal(safeNext('/settings'), '/settings')
  assert.equal(safeNext('/settings?tab=account#security'), '/settings?tab=account#security')
  assert.equal(safeNext('/login?next=%2Fsettings'), '/login?next=%2Fsettings')
  assert.equal(safeNext(null), '/')
  assert.equal(safeNext(null, '/chat'), '/chat')
})

test('safeNext rejects external and protocol-relative URLs', () => {
  assert.equal(safeNext('https://evil.example'), '/')
  assert.equal(safeNext('http://evil.example/login'), '/')
  assert.equal(safeNext('//evil.example'), '/')
  assert.equal(safeNext('javascript:alert(1)'), '/')
  assert.equal(safeNext('data:text/html,hi'), '/')
})

test('safeNext rejects backslashes and normalized network paths', () => {
  assert.equal(safeNext('/\\evil.example'), '/')
  assert.equal(safeNext('/%5Cevil.example'), '/%5Cevil.example')
  assert.equal(safeNext('/..//evil.example'), '/')
  assert.equal(safeNext('/%2e%2e//evil.example'), '/')
  assert.equal(safeNext('/a/../../evil.example'), '/evil.example')
})
