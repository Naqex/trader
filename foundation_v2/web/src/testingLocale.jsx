import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react'
import { formatAmount } from './moneyFormat.js'
import { getTimezone, subscribeTimezone } from './timezone.js'
import enums from './testing-enums.json'
import { missingTestingCopy, translateTesting } from './testingTranslate.js'

const LocaleContext = createContext('vi')
export { missingTestingCopy, translateTesting }

export function TestingLocaleProvider({ language, children }) {
  return <LocaleContext.Provider value={language === 'en' ? 'en' : 'vi'}>{children}</LocaleContext.Provider>
}

export function useTestingLocale() {
  const timezone = useSyncExternalStore(subscribeTimezone, getTimezone)
  const language = useContext(LocaleContext), locale = language === 'en' ? 'en-US' : 'vi-VN'
  const t = useCallback((text, values) => translateTesting(text, language, values), [language])
  const fmt = useCallback((value, suffix = '', digits = 2) => formatAmount(value, suffix, digits, locale), [locale])
  const statusLabel = useCallback((family, value) => enums[family]?.[value]?.[language] || value || '-', [language])
  return useMemo(() => ({ language, locale, t, fmt, statusLabel, timezone }), [language, locale, t, fmt, statusLabel, timezone])
}
