import { useEffect, useState } from 'react'

const eventName = 'tw:trade-label-order'
export function orderedLabels(items, ids) {
  const byId = new Map(items.map(item => [item.id,item]))
  const preferred = [...new Set(ids)].filter(id => byId.has(id))
  return [...preferred.map(id => byId.get(id)),...items.filter(item => !preferred.includes(item.id))]
}
export function moveLabelIds(items, id, target, before) {
  const ids = items.map(item => item.id)
  if (id === target || !ids.includes(id) || !ids.includes(target)) return ids
  const next = ids.filter(value => value !== id)
  next.splice(next.indexOf(target) + (before ? 0 : 1),0,id)
  return next
}

// Display preference only; label definitions/assignments remain API-owned.
export default function useTradeLabelOrder(workspace, items, kind='trade-labels') {
  const key = `tw:${kind}:${encodeURIComponent(workspace || 'default')}:order:v1`
  const read = () => {
    try { const ids = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [] } catch { return [] }
  }
  const [state,setState] = useState(() => ({key,ids:read(),error:false}))
  useEffect(() => {
    setState({key,ids:read(),error:false})
    const receive = event => {
      if (event.type === 'storage' && (event.key === key || event.key === null)) setState({key,ids:read(),error:false})
      if (event.type === eventName && event.detail.key === key) setState(event.detail)
    }
    window.addEventListener('storage',receive); window.addEventListener(eventName,receive)
    return () => {window.removeEventListener('storage',receive);window.removeEventListener(eventName,receive)}
  },[key])
  const current = state.key === key ? state : {key,ids:read(),error:false}
  const ordered = orderedLabels(items,current.ids)
  const move = (id,target,before) => {
    const ids = moveLabelIds(ordered,id,target,before)
    if (ids.every((value,index) => value === ordered[index].id)) return
    let error = false
    try { localStorage.setItem(key,JSON.stringify(ids)) } catch { error = true }
    const next = {key,ids,error}
    setState(next); window.dispatchEvent(new CustomEvent(eventName,{detail:next}))
  }
  return {items:ordered,move,orderError:current.error}
}
