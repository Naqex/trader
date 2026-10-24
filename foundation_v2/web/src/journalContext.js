export function readJournalContext(payload, workspace, session) {
  if (payload?.schema_version !== 'replay-journal-context-v1' || payload.workspace_id !== workspace || payload.session_id !== session
    || !Number.isSafeInteger(payload.record_count) || payload.record_count < 0 || !Array.isArray(payload.trades)) throw new Error('journal_context_invalid')
  const byTrade = new Map()
  for (const item of payload.trades) {
    if (!item || typeof item.trade_id !== 'string' || byTrade.has(item.trade_id) || !Number.isSafeInteger(item.record_count)
      || item.record_count < 0 || !Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== 'string')) throw new Error('journal_context_invalid')
    if (item.has_notes !== undefined && typeof item.has_notes !== 'boolean') throw new Error('journal_context_invalid')
    byTrade.set(item.trade_id, { tags: [...new Set(item.tags)], count: item.record_count, labelRevision: item.label_revision ?? 0, authoritative: item.labels_authoritative === true, hasNotes: item.has_notes })
  }
  return { workspace, session, count: payload.record_count, byTrade, definitions: payload.label_definitions || [] }
}

function normalizeTags(tags, definitions) {
  return [...new Set(tags.flatMap(tag => {
    const key = tag.toLocaleLowerCase()
    const definition = definitions.find(item => [item.name, ...(item.aliases || [])].some(name => name.toLocaleLowerCase() === key))
    return definition?.active === false ? [] : [definition?.name || tag]
  }))]
}

export function enrichJournalTags(ledger, context) {
  return ledger.map(trade => {
    const tags = context?.byTrade.get(trade.tradeId)?.tags || []
    const annotation = context?.byTrade.get(trade.tradeId)
    const hasNotes = Boolean(trade.note?.trim?.() || trade.notes?.trim?.()) ? true : annotation ? annotation.hasNotes ?? null : false
    const canonical = normalizeTags(annotation?.authoritative ? tags : [...(Array.isArray(trade.tags) ? trade.tags : []), ...tags], context?.definitions || [])
    const aliases = (context?.definitions || []).filter(item => item.active !== false && canonical.includes(item.name)).flatMap(item => item.aliases || [])
    return { ...trade, ...(context ? { has_notes: hasNotes } : {}), label_revision: annotation?.labelRevision ?? 0, tags: canonical, label_aliases: aliases, tag_source: tags.length ? 'journal_annotation' : 'ledger' }
  })
}
