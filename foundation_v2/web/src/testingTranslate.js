import copy from './testing-copy.json' with { type: 'json' }

export const missingTestingCopy = new Set()
const reverseCopy = Object.fromEntries(
  Object.values(copy).flatMap(entry => [[entry.vi, entry], [entry.en, entry]]),
)

export function translateTesting(text, language = 'vi', values = {}) {
  if (typeof text !== 'string') return text
  const trimmed = text.trim()
  const entry = copy[text] || copy[trimmed] || reverseCopy[trimmed]
  if (!entry && /[A-Za-zÀ-ỹ]/u.test(text) && !reverseCopy[text]) missingTestingCopy.add(text)
  const localized = entry ? `${text.match(/^\s*/)[0]}${entry[language].trim()}${text.match(/\s*$/)[0]}` : text
  let result = localized.replace(/\{(\w+)\}/g, (match, key) => (values[key] === undefined ? match : String(values[key])))
  if (language === 'en' && Number(values.count) === 1) {
    result = result.replace(/\b(days|trades|sessions|minutes|candles)\b/g, word => word.slice(0, -1))
  }
  return result
}
