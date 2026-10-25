export function formatAmount(value, suffix = '', digits = 2, locale = 'vi-VN') {
  if (value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value))) return '-'
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(Number(value))
  return suffix.trim() === 'USD' ? `$${number}` : `${number}${suffix}`
}

export const currencyLabel = currency => currency === 'USD' ? '$' : currency
