import test from 'node:test'
import assert from 'node:assert/strict'
import { chatHistory, finishReply, prependHistory } from '../src/aiTranscript.js'

test('stopped text and its question remain context for a new prompt', () => {
  const messages = [{ role: 'user', id: 'a', content: 'Explain', status: 'running' }]
  const stopped = finishReply(messages, { id: 'a', text: 'First part', status: 'cancelled' })
  assert.equal(stopped[0].status, 'cancelled')
  assert.deepEqual(chatHistory(stopped), [{ role: 'user', content: 'Explain' }, { role: 'assistant', content: 'First part' }])
  assert.equal(stopped[1].status, 'cancelled')
})

test('continuations join the same response and duplicate terminal events do not repeat text', () => {
  const stopped = [{ role: 'user', content: 'Explain', status: 'cancelled' }, { role: 'assistant', id: 'a', content: 'First', status: 'cancelled' }]
  const run = { id: 'b', continuation_of: 'a', text: ' second', status: 'completed' }
  const complete = finishReply(stopped, run)
  assert.equal(complete.length, 2)
  assert.equal(complete[1].content, 'First second')
  assert.deepEqual(finishReply(complete, run), complete)
  assert.equal(stopped[1].content, 'First')
})

test('stopping before any output retains the question without invalid adjacent user roles', () => {
  const stopped = finishReply([{ role: 'user', id: 'a', content: 'Explain', status: 'running' }], { id: 'a', status: 'cancelled', phase: 'thinking' })
  assert.equal(stopped[1].phase, 'thinking')
  assert.deepEqual(chatHistory([...stopped, { role: 'user', content: 'Continue' }]), [{ role: 'user', content: 'Explain\n\nContinue' }])
})

test('pagination joins a continuation chain across multiple history pages', () => {
  const oldest = [{ role: 'user', content: 'Question' }, { role: 'assistant', id: 'a', content: 'First ', continuation_of: null }]
  const middle = [{ role: 'assistant', id: 'b', content: 'second ', continuation_of: 'a' }]
  const newest = [{ role: 'assistant', id: 'c', content: 'third', continuation_of: 'b' }]
  const joined = prependHistory(oldest, prependHistory(middle, newest))
  assert.equal(joined.length, 2)
  assert.equal(joined[1].content, 'First second third')
  assert.equal(joined[1].id, 'c')
  assert.equal(joined[1].continuation_of, null)
  assert.deepEqual(chatHistory(joined), [{ role: 'user', content: 'Question' }, { role: 'assistant', content: 'First second third' }])
  assert.deepEqual(prependHistory(oldest, [{ role: 'assistant', id: 'z', content: 'Other' }]), [...oldest, { role: 'assistant', id: 'z', content: 'Other' }])
})
