import test from 'node:test'
import assert from 'node:assert/strict'
import { virtualTableSegments } from '../src/virtualTableModel.js'

const config = { count:10000, rowHeight:60, offset:0, height:300, overscan:6 }
const indexes = segments => segments.filter(s => !s.spacer).flatMap(s => Array.from({ length:s.end - s.start }, (_, i) => s.start + i))

test('first viewport renders visible rows and overscan, not the full data set', () => {
  const segments = virtualTableSegments(config)
  assert.deepEqual(indexes(segments), Array.from({ length:11 }, (_, i) => i))
  assert.equal(segments.at(-1).height, 9989 * 60)
})

test('fractional row scrolling includes the partially visible bottom row', () => {
  assert.deepEqual(indexes(virtualTableSegments({ ...config, offset:30, overscan:0 })), [0,1,2,3,4,5])
})

test('focus far from viewport adds only one mounted row and preserves total height', () => {
  const segments = virtualTableSegments({ ...config, offset:300000, focusedIndex:2 })
  const mounted = indexes(segments)
  assert.equal(mounted.length,18)
  assert.equal(mounted[0],2)
  assert.ok(mounted.includes(5000))
  assert.equal(segments.reduce((sum, s) => sum + (s.end - s.start) * 60, 0),600000)
})

test('clamps after data shrink, end jumps and negative scroll bounce', () => {
  assert.deepEqual(indexes(virtualTableSegments({ ...config, count:3, offset:900000 })), [0,1,2])
  assert.deepEqual(virtualTableSegments({ ...config, offset:-200 }), virtualTableSegments(config))
  assert.equal(indexes(virtualTableSegments({ ...config, offset:600000 })).at(-1),9999)
  assert.deepEqual(virtualTableSegments({ ...config, count:0 }), [])
})

test('window and spacers cover the collection without overlap across boundaries', () => {
  for (const offset of [0,1,59,60,61,299999,599700,600000]) {
    for (const focusedIndex of [-1,0,4000,9999,10000]) {
      const segments = virtualTableSegments({ ...config, offset, focusedIndex })
      assert.equal(segments[0].start,0)
      for (let i = 1; i < segments.length; i++) assert.equal(segments[i].start,segments[i - 1].end)
      assert.equal(segments.at(-1).end,10000)
      assert.ok(indexes(segments).length <= 19)
    }
  }
})

test('rejects unsupported geometry instead of fabricating a scroll range', () => {
  for (const override of [{ count:-1 },{ rowHeight:0 },{ rowHeight:47 },{ height:NaN },{ offset:Infinity },{ overscan:-1 }]) assert.throws(() => virtualTableSegments({ ...config, ...override }), RangeError)
})
