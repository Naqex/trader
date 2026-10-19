import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { mergeReplayHistoryView } from './src/replayHistoryView.js'
const cases = JSON.parse(await readFile(process.argv[2], 'utf8'))
for (const { before, delta, after } of cases) {
  assert.deepEqual(mergeReplayHistoryView(before, delta, { workspace: 'tenant-a', sessionId: before.record_id }), after)
}
console.log(`History server/client differential: ${cases.length} exact matches`)
