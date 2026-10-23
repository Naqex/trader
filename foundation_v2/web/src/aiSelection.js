export function storedSelection(value) {
  if (!value || typeof value.provider !== 'string' || !value.provider || typeof value.model !== 'string' || !value.model) return null
  if (value.effort != null && typeof value.effort !== 'string') return null
  return { provider: value.provider, model: value.model, effort: value.effort ?? null }
}

// An unavailable catalog cannot prove that a saved model or effort was removed.
export function resolveSelection(value, fallback, routes) {
  const selected = storedSelection(value) || storedSelection(fallback)
  if (!routes?.length) return selected
  const route = routes.find(item => item.provider === selected?.provider)
  if (selected && route && !route.ready) return selected
  const target = route?.models.length ? route : routes.find(item => item.ready && item.models.length)
  if (!target) return selected
  const model = target.models.find(item => item.id === selected?.model)
    || (fallback?.provider === target.provider && target.models.find(item => item.id === fallback.model))
    || target.models[0]
  const effort = selected?.provider === target.provider && selected?.model === model.id ? selected.effort
    : fallback?.provider === target.provider && fallback?.model === model.id ? fallback.effort : null
  const efforts = model.efforts || []
  return { provider: target.provider, model: model.id, effort: efforts.includes(effort) ? effort : target.provider === 'local-gateway' ? null : efforts[0] ?? null }
}
