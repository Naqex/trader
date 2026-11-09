export function formatReturnPercent(value, { fmt, locale }) {
  if (Number.isFinite(value) && value !== 0 && Math.abs(value) < .01) return `${new Intl.NumberFormat(locale, { maximumSignificantDigits: 2 }).format(value)}%`
  return fmt(value, '%')
}
