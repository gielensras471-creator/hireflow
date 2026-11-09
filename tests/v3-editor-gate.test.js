import assert from 'node:assert/strict'
import test from 'node:test'
import { createEditorGate } from '../src/utils/v3-editor-gate.ts'

test('editors acquire exclusivity synchronously before awaiting their reads', () => {
  const gate = createEditorGate()
  const profile = gate.acquire()
  assert.ok(profile)
  assert.equal(gate.acquire(), null)
  gate.release(profile)
  const interview = gate.acquire()
  assert.ok(interview)
  assert.equal(gate.acquire(), null)
})
test('a delayed release cannot unlock a different active editor', () => {
  const gate = createEditorGate()
  const old = gate.acquire()
  gate.release(old)
  const current = gate.acquire()
  gate.release(old)
  assert.equal(gate.owns(current), true)
  assert.equal(gate.acquire(), null)
  gate.release(current)
  assert.equal(gate.current.value, null)
})
