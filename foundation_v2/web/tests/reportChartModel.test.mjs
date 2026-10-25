import test from 'node:test'
import assert from 'node:assert/strict'
import { chartDomain, chartTicks, reportCurvePath } from '../src/reportChartModel.js'
import { groupPerformanceMonths } from '../src/sessionPerformanceModel.js'

test('mixed signs center zero with equal nice steps', () => {
  for (const values of [[-295, 865], [-6, 14], [-500, 600], [-90, 0, 0, 310]]) {
    const domain = chartDomain(values, { symmetric: true })
    assert.equal(domain.low, -domain.high)
    assert.equal(domain.ticks[Math.floor(domain.ticks.length / 2)], 0)
    assert.ok(values.every(value => value >= domain.low && value <= domain.high))
    const step = domain.ticks[1] - domain.ticks[0]
    assert.ok(domain.ticks.slice(1).every((value, index) => value - domain.ticks[index] === step))
  }
  assert.deepEqual(chartDomain([-295, 865], { symmetric: true }).ticks, [-1000, -500, 0, 500, 1000])
  assert.equal(chartDomain([NaN], { symmetric: true }), null)
  assert.equal(chartDomain([]), null)
  assert.equal(chartDomain([40, 60], { maximum: 100 }).low, 0)
})

test('one-sided bars anchor at zero regardless of row count or equal values', () => {
  for (const values of [[310], [90, 310], [310, 310], [0, 310, 20, 100]]) {
    assert.deepEqual(chartDomain(values, { symmetric: true }), { low: 0, high: 400, ticks: [0, 100, 200, 300, 400] })
    assert.deepEqual(chartDomain(values.map(value => -value), { symmetric: true }), { low: -400, high: 0, ticks: [-400, -300, -200, -100, 0] })
  }
  for (const options of [{}, { symmetric: true }, { integer: true }]) assert.deepEqual(chartDomain([0, 0], options), { low: 0, high: 0, ticks: [0] })
  assert.equal(chartDomain([null]), null)
  assert.ok(chartDomain([0], { zero: false }).high > chartDomain([0], { zero: false }).low, 'flat equity retains a drawable scale')
})

test('responsive ticks retain bounds and zero with equal intervals', () => {
  for (const values of [[310], [-310], [-310, 1115], [-295, 865], [0], [0, 1]]) {
    const domain = chartDomain(values, { symmetric: true })
    for (const capacity of [2, 3, 4, 5, 6]) {
      const ticks = chartTicks(domain, capacity)
      assert.equal(ticks[0], domain.low)
      assert.equal(ticks.at(-1), domain.high)
      assert.ok(ticks.includes(0))
      assert.equal(new Set(ticks).size, ticks.length)
      assert.ok(ticks.length <= Math.max(capacity, domain.low < 0 && domain.high > 0 ? 3 : 2))
      if (ticks.length > 1) {
        const step = ticks[1] - ticks[0]
        assert.ok(ticks.slice(1).every((value, index) => Math.abs(value - ticks[index] - step) < 1e-9))
      }
    }
  }
})

test('nice axes cover the data with round steps, integer counts and bounded percentages', () => {
  assert.deepEqual(chartDomain([9867, 12450], { zero: false }), { low: 9500, high: 12500, ticks: [9500, 10000, 10500, 11000, 11500, 12000, 12500] })
  assert.deepEqual(chartDomain([-310, 1115], { symmetric: true }).ticks, [-1500, -1000, -500, 0, 500, 1000, 1500])
  assert.deepEqual(chartDomain([0, 1], { integer: true }).ticks, [0, 1])
  assert.deepEqual(chartDomain([10.25], { zero: false }).ticks, [9, 9.5, 10, 10.5, 11, 11.5])
  assert.deepEqual(chartDomain([.001, .008]).ticks, [0, .002, .004, .006, .008])
  assert.deepEqual(chartDomain([0, 13], { integer: true }).ticks, [0, 3, 6, 9, 12, 15])
  assert.deepEqual(chartDomain([65], { maximum: 100 }).ticks, [0, 20, 40, 60, 80, 100])
  assert.equal(chartDomain([101], { maximum: 100 }), null)
  const tinyFlat = chartDomain([.001], { zero: false })
  assert.ok(tinyFlat.low >= .0008 && tinyFlat.high <= .0012)
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

test('smooth monotone observations share a nonzero tangent instead of staircase plateaus', () => {
  const commands = reportCurvePath([[0, 100], [30, 80], [90, 50], [120, 20]]).split(' C').slice(1).map(command => command.split(/[ ,]/).map(Number))
  assert.ok(commands[0][3] > 80 && commands[1][1] < 80)
  const incoming = (80 - commands[0][3]) / (30 - commands[0][2])
  const outgoing = (commands[1][1] - 80) / (commands[1][0] - 30)
  assert.ok(Math.abs(incoming - outgoing) < 1e-10)
  assert.equal(reportCurvePath([]), '')
  assert.equal(reportCurvePath([[5, 9]]), 'M5,9')
})
