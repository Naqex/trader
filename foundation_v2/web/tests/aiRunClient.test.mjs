import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readRunEvents, runPending } from '../src/aiRunClient.js'

test('run events survive byte-split Vietnamese and CRLF and stop at the terminal event', async () => {
  const bytes = new TextEncoder().encode('event: run\r\nid: 1\r\ndata: {"status":"running","text":"đúng rồi"}\r\n\r\nevent: run\r\ndata: {"status":"completed","text":"xong"}\r\n\r\n')
  let offset = 0, cancelled = false
  const response = new Response(new ReadableStream({ pull(controller) { if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset)); else controller.close() }, cancel() { cancelled = true } }))
  const values = []
  await readRunEvents(response, value => { values.push(value); return runPending(value) })
  assert.deepEqual(values.map(v => v.text), ['đúng rồi', 'xong'])
  assert.equal(cancelled, true)
})
test('unbounded frames and resync fail so the caller can reconnect without inference', async () => {
  await assert.rejects(readRunEvents(new Response('data: ' + 'x'.repeat(600001)), () => {}), /ai_stream_too_large/)
  await assert.rejects(readRunEvents(new Response('event: resync\ndata: {}\n\n'), () => {}), /ai_stream_unavailable/)
  assert.equal(runPending({ status: 'cancelling' }), true)
  assert.equal(runPending({ status: 'interrupted' }), false)
})
