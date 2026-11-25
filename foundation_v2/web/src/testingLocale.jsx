import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import { formatAmount } from './moneyFormat.js'
import { getTimezone, subscribeTimezone } from './timezone.js'
import enums from './testing-enums.json'
import { translateWithDictionary } from './testingCopySplit.js'

const LocaleContext = createContext('vi')
export const missingTestingCopy = new Set()

const localeDictionaries = { vi: null, en: null }
const localePromises = { vi: null, en: null }
let localeRevision = 0
const localeListeners = new Set()

function notifyLocaleLoaded() {
  localeRevision += 1
  for (const listener of localeListeners) listener()
}

function subscribeLocaleRevision(listener) {
  localeListeners.add(listener)
  return () => localeListeners.delete(listener)
}

function getLocaleRevision() {
  return localeRevision
}

export function preloadTestingLocale(language = 'vi') {
  const lang = language === 'en' ? 'en' : 'vi'
  if (localeDictionaries[lang]) return Promise.resolve(localeDictionaries[lang])
  if (!localePromises[lang]) {
    const load = lang === 'en'
      ? () => import('virtual:testing-copy-en')
      : () => import('virtual:testing-copy-vi')
    localePromises[lang] = load()
      .then(mod => {
        localeDictionaries[lang] = mod.default || mod
        notifyLocaleLoaded()
        return localeDictionaries[lang]
      })
      .catch(error => {
        localePromises[lang] = null
        throw error
      })
  }
  return localePromises[lang]
}

export function TestingLocaleProvider({ language, children }) {
  const normalized = language === 'en' ? 'en' : 'vi'
  useEffect(() => {
    void preloadTestingLocale(normalized).catch(() => {})
  }, [normalized])
  return <LocaleContext.Provider value={normalized}>{children}</LocaleContext.Provider>
}

export function translateTesting(text, language = 'vi', values = {}) {
  const lang = language === 'en' ? 'en' : 'vi'
  const dictionary = localeDictionaries[lang]
  if (typeof text === 'string' && dictionary && !(text in dictionary) && !(text.trim() in dictionary) && /[A-Za-zÀ-ỹ]/u.test(text)) {
    missingTestingCopy.add(text)
  }
  return translateWithDictionary(dictionary, text, lang, values)
}
export function useTestingLocale() {
  const timezone = useSyncExternalStore(subscribeTimezone, getTimezone)
  const revision = useSyncExternalStore(subscribeLocaleRevision, getLocaleRevision)
  const language = useContext(LocaleContext), locale = language === 'en' ? 'en-US' : 'vi-VN'
  const t = useCallback((text, values) => translateTesting(text, language, values), [language, revision])
  const fmt = useCallback((value, suffix = '', digits = 2) => formatAmount(value, suffix, digits, locale), [locale])
  const statusLabel = useCallback((family, value) => enums[family]?.[value]?.[language] || value || '-', [language])
  return useMemo(() => ({ language, locale, t, fmt, statusLabel, timezone }), [language, locale, t, fmt, statusLabel, timezone])
}
