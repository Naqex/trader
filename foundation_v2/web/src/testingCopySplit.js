/**
 * Build a compact single-language dictionary from the canonical bilingual
 * testing-copy.json catalog. Only mappings where input !== output are stored,
 * preserving exact lookup and reverse EN/VI lookup semantics without shipping
 * both directions of the inactive locale in the startup entry bundle.
 */
export function buildLocaleDictionary(copy, language = 'vi') {
  const lang = language === 'en' ? 'en' : 'vi'
  const dictionary = Object.create(null)
  for (const [key, entry] of Object.entries(copy)) {
    const target = entry[lang].trim()
    for (const source of [key, key.trim(), entry.vi.trim(), entry.en.trim()]) {
      if (source && source !== target && !(source in dictionary)) {
        dictionary[source] = target
      }
    }
  }
  return dictionary
}

export function translateWithDictionary(dictionary, text, language = 'vi', values = {}) {
  if (typeof text !== 'string') return text
  const trimmed = text.trim()
  const mapped = dictionary ? (dictionary[text] ?? dictionary[trimmed]) : undefined
  const localized = mapped === undefined
    ? text
    : `${text.match(/^\s*/)[0]}${mapped}${text.match(/\s*$/)[0]}`
  let result = localized.replace(/\{(\w+)\}/g, (match, key) => (values[key] === undefined ? match : String(values[key])))
  if (language === 'en' && Number(values.count) === 1) {
    result = result.replace(/\b(days|trades|sessions|minutes|candles)\b/g, word => word.slice(0, -1))
  }
  return result
}
