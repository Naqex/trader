import { useEffect, useState } from 'react'
import { tableColumnsPreference } from './tableModel.js'

export default function useTableColumns(workspace, table, available) {
  const key = `tw:grid:${encodeURIComponent(workspace || 'default')}:${table}:columns:v1`
  const read = () => {
    try { return tableColumnsPreference(localStorage.getItem(key), available) } catch { return available }
  }
  const [state, setState] = useState(() => ({ key, columns: read(), error: false }))
  const columns = state.key === key ? state.columns : read()
  useEffect(() => { setState({ key, columns: read(), error: false }) }, [key])
  const change = values => {
    const columns = tableColumnsPreference(JSON.stringify(values), available)
    let error = false
    try { localStorage.setItem(key, JSON.stringify(columns)) } catch { error = true }
    setState({ key, columns, error })
  }
  return [columns, change, state.key === key && state.error]
}
