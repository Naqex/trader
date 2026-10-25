import { displayTimeframe } from './dataDisplay.js'
import { matchesSearch } from './searchText.js'
import { compareTableValues } from './tableModel.js'
import { datasetRange } from './researchDataApi.js'

export const CATEGORIES = [
  ['stock', 'Cổ phiếu'], ['futures', 'Hợp đồng tương lai'], ['fx', 'Forex'],
  ['crypto', 'Crypto'], ['index', 'Chỉ số'], ['metal', 'Kim loại'],
  ['energy', 'Năng lượng'], ['agriculture', 'Nông sản'], ['etf', 'ETF'], ['bond', 'Trái phiếu'],
]

const aliases = { stocks:'stock', equities:'stock', forex:'fx', indices:'index', metals:'metal', energies:'energy', etfs:'etf', bonds:'bond' }
export function categoryOf(item) {
  const value = item.asset_class || item.instrument_spec?.asset_class || ''
  return aliases[value] || value
}
export const categoryLabel = value => CATEGORIES.find(([key]) => key === value)?.[1] || 'Chưa phân loại'
function exportSettingsOf(item) {
  try { return JSON.parse(item?.source?.export_settings || '{}') || {} }
  catch { return {} }
}
// Keep transport identity for job/update matching, including immutable older QDM imports.
export const downloadEngineOf = item => item?.download_engine || exportSettingsOf(item).download_engine || item?.source?.provider || item?.provider || item?.provider_id || '-'
export const sourceOf = item => item?.data_source || exportSettingsOf(item).upstream_provider
  || (downloadEngineOf(item) === 'QuantDataManager' ? 'Dukascopy' : item?.source?.provider || item?.provider || item?.provider_id || '-')

export function libraryDataType(item, availableStart) {
  if (!item.downloaded) return availableStart ? { timeframe: 'M1', ...(downloadEngineOf(item) === 'QuantDataManager' ? {} : { price: 'Bid' }) } : { timeframe: '-' }
  const settings = exportSettingsOf(item)
  const price = { bid: 'Bid', ask: 'Ask', mid: 'Mid' }[settings?.price]
  return { timeframe: displayTimeframe(item), price }
}

export function canDownloadAsset(asset, download, preview = false) {
  return !preview && Boolean(download?.available) && Array.isArray(download.supported_instruments)
    && download.supported_instruments.includes(asset.instrument_id)
    && downloadEngineOf(asset).toLowerCase() === (download.download_engine || download.provider || 'Dukascopy').toLowerCase()
}

export function defaultDownloadDates(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86400000)
  return { to_date:end.toISOString().slice(0,10), from_date:new Date(end.getTime() - 29 * 86400000).toISOString().slice(0,10) }
}

export function downloadRangeError(from, to, now = new Date()) {
  const date = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
    const parsed = new Date(`${value}T00:00:00Z`)
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value ? parsed.getTime() : NaN
  }
  const start = date(from), end = date(to)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return 'Chọn khoảng ngày hợp lệ.'
  if (to > defaultDownloadDates(now).to_date) return 'Chỉ tải ngày đã kết thúc theo UTC.'
  if ((end - start) / 86400000 + 1 > 366) return 'Mỗi lần tải tối đa 366 ngày.'
  return ''
}

export function libraryRows(datasets, instruments = [], jobs = []) {
  const rows = currentDatasetVersions(datasets).map(item => ({ ...item, key:item.dataset_id, downloaded:true }))
  for (const item of instruments) {
    if (!datasets.some(dataset => dataset.instrument_id === item.instrument_id && downloadEngineOf(dataset) === downloadEngineOf(item))) {
      rows.push({ ...item, key:`${item.provider_id}:${item.instrument_id}`, downloaded:false })
    }
  }
  return rows.map(item => ({ ...item, downloadJob: jobs.find(job => (job.download_engine || job.provider || 'Dukascopy') === downloadEngineOf(item)
    && job.instrument_id === item.instrument_id && ['queued','running','pausing','paused','failed'].includes(job.status)) }))
}

export function currentDatasetVersions(datasets) {
  const byId = new Map(datasets.map(item => [item.dataset_id, item]))
  const superseded = new Set()
  for (const item of datasets) {
    let child = item
    const visited = new Set([child.dataset_id])
    const ancestors = []
    while (child) {
      const parent = byId.get(exportSettingsOf(child).parent_dataset_id)
      if (parent && visited.has(parent.dataset_id)) { ancestors.length = 0; break }
      if (!parent || parent.instrument_id !== child.instrument_id
        || downloadEngineOf(parent) !== downloadEngineOf(child) || sourceOf(parent) !== sourceOf(child)
        || parent.timeframe_seconds !== child.timeframe_seconds
        || exportSettingsOf(parent).price !== exportSettingsOf(child).price
        || !(child.first_timestamp <= parent.first_timestamp && child.last_timestamp >= parent.last_timestamp)) break
      visited.add(parent.dataset_id)
      ancestors.push(parent.dataset_id)
      child = parent
    }
    for (const id of ancestors) superseded.add(id)
  }
  // Only explicit, compatible update ancestry is collapsed; unrelated CSV imports remain distinct.
  return datasets.filter(item => !superseded.has(item.dataset_id))
}

export const LIBRARY_SORT_COLUMNS = [['asset','Sản phẩm'],['category','Danh mục'],['source','Nguồn'],['data','Dữ liệu'],['from','Từ ngày'],['to','Đến ngày'],['count','Số nến'],['size','Dung lượng']]

export function libraryDisplayRange(item, download, now = new Date()) {
  const availableStart = downloadEngineOf(item) === (download?.download_engine || download?.provider || 'Dukascopy') ? download?.earliest_dates?.[item.instrument_id] : null
  const range = item.downloaded ? datasetRange(item) : { start:availableStart, end:availableStart ? defaultDownloadDates(now).to_date : null }
  return { ...range, availableStart }
}

export function filterLibrary(rows, { category = 'all', provider = 'all', downloadStatus = 'all', search = '', sort = 'asset-asc', download, now } = {}) {
  const filtered = rows.filter(item => (category === 'all' || categoryOf(item) === category)
    && (provider === 'all' || sourceOf(item) === provider)
    && (downloadStatus === 'all'
      || (downloadStatus === 'downloading' && Boolean(item.downloadJob))
      || (downloadStatus === 'downloaded' && item.downloaded)
      || (downloadStatus === 'not-downloaded' && !item.downloaded && !item.downloadJob))
    && matchesSearch(`${item.instrument_id} ${item.name || ''} ${item.timeframe || ''} ${sourceOf(item)} ${categoryLabel(categoryOf(item))}`, search))
  const assetCompare = (a, b) => `${a.instrument_id || ''} ${a.timeframe || ''}`.localeCompare(`${b.instrument_id || ''} ${b.timeframe || ''}`, 'en', { numeric:true }) || a.key.localeCompare(b.key)
  const [key, direction = 'asc'] = sort === 'newest' ? ['updated','desc'] : sort.split('-')
  const value = item => {
    if (key === 'asset') return `${item.instrument_id || ''} ${item.timeframe || ''}`
    if (key === 'category') return categoryLabel(categoryOf(item))
    if (key === 'source') return sourceOf(item)
    if (key === 'data') { const type = libraryDataType(item, libraryDisplayRange(item,download,now).availableStart); return type.timeframe === '-' ? null : `${type.timeframe} ${type.price || ''}` }
    if (key === 'downloaded' || key === 'not') return item.downloaded ? 1 : 0
    if (key === 'updated') return Date.parse(item.created_at_utc)
    if (['from','to'].includes(key)) { const range = libraryDisplayRange(item,download,now); const stamp = key === 'from' ? range.start : range.end; return stamp == null ? null : typeof stamp === 'number' ? Math.abs(stamp) < 1e11 ? stamp * 1000 : stamp : Date.parse(stamp) }
    if (key === 'count') return item.downloaded ? item.row_count : null
    if (key === 'size') return item.downloaded ? item.size_bytes : null
    return null
  }
  return filtered.sort((a,b) => compareTableValues(value(a), value(b), sort === 'downloaded' ? 'desc' : sort === 'not-downloaded' ? 'asc' : direction) || assetCompare(a,b))
}
