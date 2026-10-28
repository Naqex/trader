import { known, number } from './tradingAnalyticsModel.js'

export function monteCarloDefaults(rows, balance) {
  const moments = simulationMoments(rows)
  const rounded = value => Number(value.toFixed(2))
  return { method:'normal', simulations:100, trades:100, capital:number(balance) > 0 ? rounded(Number(balance)) || .01 : 10000,
    averageWin:moments?.averageWin == null ? 100 : rounded(moments.averageWin),
    averageLoss:moments?.averageLoss == null ? 100 : rounded(moments.averageLoss),
    winRate:moments?.winRate == null ? 50 : rounded(moments.winRate),
    winStd:moments?.winStd ?? 0, lossStd:moments?.lossStd ?? 0, seed:42 }
}

export function monteCarloInputErrors(config) {
  const errors = {}
  for (const key of ['simulations','trades','capital','averageWin','averageLoss','winRate']) {
    const value = number(config[key])
    if (value === null) errors[key] = 'Nhập một số hợp lệ.'
    else if (['simulations','trades'].includes(key) && (!Number.isInteger(value) || value < 1 || value > 1000)) errors[key] = 'Nhập số nguyên từ 1 đến 1.000.'
    else if (key === 'capital' && value <= 0) errors[key] = 'Vốn bắt đầu phải lớn hơn 0.'
    else if (key === 'winRate' && (value < 0 || value > 100)) errors[key] = 'Nhập tỷ lệ từ 0 đến 100%.'
    else if (['averageWin','averageLoss'].includes(key) && value < 0) errors[key] = 'Nhập giá trị từ 0 trở lên.'
  }
  if (!errors.simulations && !errors.trades && Number(config.simulations) * Number(config.trades) > 250000) errors.trades = 'Giảm số lệnh hoặc số lượt để tổng không quá 250.000 bước.'
  return errors
}

export function monteCarlo(config, ledger = []) {
  const simulations = number(config.simulations), trades = number(config.trades), capital = number(config.capital), seed = number(config.seed)
  if (!Number.isInteger(simulations) || simulations < 1 || simulations > 1000 || !Number.isInteger(trades) || trades < 1 || trades > 1000 || simulations * trades > 250000 || !known(capital) || capital <= 0 || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Giới hạn: 1–1.000 lượt, 1–1.000 lệnh, tối đa 250.000 bước; vốn > 0 và seed 0–4.294.967.295.')
  const samples = ledger.map(row => number(row.net_pnl))
  const bootstrap = config.method === 'ledger'
  if (!['ledger', 'configured', 'normal'].includes(config.method)) throw new Error('Phương pháp mô phỏng không hợp lệ.')
  if (bootstrap && (!samples.length || samples.some(value => value === null))) throw new Error('Ledger phải có Net PnL đầy đủ để lấy mẫu.')
  const win = number(config.averageWin), loss = number(config.averageLoss), rate = number(config.winRate)
  if (!bootstrap && (![win, loss, rate].every(Number.isFinite) || win < 0 || loss < 0 || rate < 0 || rate > 100)) throw new Error('Lãi/lỗ trung bình phải ≥ 0; win rate từ 0 đến 100%.')
  const normal = config.method === 'normal', winStd = number(config.winStd), lossStd = number(config.lossStd)
  if (normal && (![winStd, lossStd].every(Number.isFinite) || winStd < 0 || lossStd < 0)) throw new Error('Độ lệch chuẩn phải là số ≥ 0.')
  const random = seededRandom(seed), paths = [], endings = [], drawdowns = []
  let ruined = 0, totalWins = 0, totalLosses = 0, maxWinStreak = 0, maxLossStreak = 0
  const factors = []
  const amount = (mean, std) => normal ? Math.max(0, mean + std * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())) : mean
  for (let run = 0; run < simulations; run++) {
    let balance = capital, peak = capital, maxDD = 0
    let grossWin = 0, grossLoss = 0, wins = 0, losses = 0
    const path = [balance]
    for (let index = 0; index < trades; index++) {
      const pnl = balance <= 0 ? null : bootstrap ? samples[Math.floor(random() * samples.length)] : random() < rate / 100 ? amount(win, winStd) : -amount(loss, lossStd)
      if (pnl !== null) {
        if (!Number.isFinite(pnl) || !Number.isFinite(balance + pnl)) throw new Error('Giá trị mô phỏng vượt giới hạn số; hãy giảm vốn hoặc lãi/lỗ mỗi lệnh.')
        const before = balance
        balance = Math.max(0, balance + pnl)
        const realized = balance - before
        if (realized > 0) { grossWin += realized; totalWins++; wins++; losses = 0; maxWinStreak = Math.max(maxWinStreak, wins) }
        else if (realized < 0) { grossLoss -= realized; totalLosses++; losses++; wins = 0; maxLossStreak = Math.max(maxLossStreak, losses) }
        else { wins = 0; losses = 0 }
      }
      if (!Number.isFinite(balance)) throw new Error('Giá trị mô phỏng vượt giới hạn số; hãy giảm vốn hoặc lãi/lỗ mỗi lệnh.')
      balance = Math.max(0, balance); peak = Math.max(peak, balance); maxDD = Math.max(maxDD, peak - balance)
      path.push(balance)
    }
    if (balance === 0) ruined++
    endings.push(balance); drawdowns.push(maxDD)
    factors.push(grossLoss ? grossWin / grossLoss : grossWin ? Infinity : null)
    if (run < 30) paths.push(path)
  }
  const sorted = [...endings].sort((a, b) => a - b)
  const percentile = p => { const at = (sorted.length - 1) * p; return sorted[Math.floor(at)] + (sorted[Math.ceil(at)] - sorted[Math.floor(at)]) * (at % 1) }
  return { paths, average: endings.reduce((mean, value, index) => mean + (value - mean) / (index + 1), 0), p05: percentile(.05), median: percentile(.5), p95: percentile(.95), min: sorted[0], max: sorted.at(-1), maxDD: Math.max(...drawdowns), ruinRate: ruined / simulations * 100, probabilityProfit: endings.filter(value => value > capital).length / simulations * 100, averageProfitFactor: factors.every(Number.isFinite) ? factors.reduce((mean, value, index) => mean + (value - mean) / (index + 1), 0) : factors.every(value => value === Infinity) ? Infinity : null, totalWins, totalLosses, maxWinStreak, maxLossStreak, config: { ...config }, sampleCount: samples.length }
}

export function simulationMoments(rows) {
  if (!rows.length || rows.some(row => !known(row.net_pnl))) return null
  const values = rows.map(row => Number(row.net_pnl)), wins = values.filter(value => value > 0), losses = values.filter(value => value < 0).map(Math.abs)
  const mean = group => group.length ? group.reduce((average, value, index) => average + (value - average) / (index + 1), 0) : null
  const deviation = group => { const average = mean(group), value = group.length ? Math.sqrt(group.reduce((sum, value) => sum + (value - average) ** 2 / group.length, 0)) : null; return Number.isFinite(value) ? value : null }
  return { averageWin: mean(wins), averageLoss: mean(losses), winStd: deviation(wins), lossStd: deviation(losses), winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) * 100 : null }
}

function seededRandom(seed) {
  let value = Number(seed) >>> 0
  return () => { value += 0x6D2B79F5; let n = value; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296 }
}
