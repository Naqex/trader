import test from 'node:test'
import assert from 'node:assert/strict'
import { chartDomain, reportCurvePath } from '../src/reportChartModel.js'
import { groupPerformanceMonths } from '../src/sessionPerformanceModel.js'

test('signed performance centers zero with equal nice steps, even with one-sided data', () => {
  for (const values of [[-295, 865], [720], [-310], [0], [-6, 14], [180000]]) {
    const domain = chartDomain(values, { symmetric: true })
    assert.equal(domain.low, -domain.high)
    assert.equal(domain.ticks[2], 0)
    assert.ok(values.every(value => value >= domain.low && value <= domain.high))
    const step = domain.ticks[1] - domain.ticks[0]
    assert.ok(domain.ticks.slice(1).every((value, index) => value - domain.ticks[index] === step))
  }
  assert.deepEqual(chartDomain([-295, 865], { symmetric: true }).ticks, [-1000, -500, 0, 500, 1000])
  assert.equal(chartDomain([NaN], { symmetric: true }), null)
  assert.equal(chartDomain([]), null)
  assert.equal(chartDomain([40, 60], { maximum: 100 }).low, 0)
})

test('calendar month grouping sums both sides over years and keeps missing months absent', () => {
  const rows = [{ label: '2021-01', value: 10, profit: 30, loss: -20, count: 2 }, { label: '2025-01', value: -10, profit: 5, loss: -15, count: 3 }, { label: '2023-03', value: 0, profit: 0, loss: 0, count: 1 }]
  const original = structuredClone(rows)
  assert.deepEqual(groupPerformanceMonths(rows), [{ label: '01', value: 0, profit: 35, loss: -35, count: 5 }, { label: '03', value: 0, profit: 0, loss: 0, count: 1 }])
  assert.deepEqual(rows, original)
  assert.equal(groupPerformanceMonths([{ label: '2021-01', value: 10 }])[0].profit, null)
})

test('curve passes each observation and its control points cannot overshoot a local range', () => {
  const points = [[0, 100], [2, 40], [100, 90], [100, 30], [140, 30]]
  const commands = reportCurvePath(points).split(' C')
  assert.equal(commands[0], 'M0,100')
  commands.slice(1).forEach((command, index) => {
    const [cx1, cy1, cx2, cy2, x, y] = command.split(/[ ,]/).map(Number)
    const [x0, y0] = points[index], [x1, y1] = points[index + 1]
    assert.deepEqual([x, y], [x1, y1])
    for (let step = 0; step <= 20; step++) {
      const t = step / 20, u = 1 - t
      const px = u ** 3 * x0 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t ** 3 * x1
      const py = u ** 3 * y0 + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t ** 3 * y1
      assert.ok(px >= x0 - 1e-9 && px <= x1 + 1e-9)
      assert.ok(py >= Math.min(y0, y1) - 1e-9 && py <= Math.max(y0, y1) + 1e-9)
    }
  })
})
