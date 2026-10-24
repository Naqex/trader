import { useTestingLocale } from './testingLocale.jsx'
import './search-input.css'

// Keep the native input/ref contract so existing popup keyboard navigation works.
export default function SearchInput({ onKeyDown, ...props }) {
  const { t } = useTestingLocale()
  return <input {...props} type="search" autoComplete="off" spellCheck={false} className={`wm-search-input ${props.className || ''}`} onKeyDown={event => {
    if (event.key === 'Escape' && event.currentTarget.value && !event.nativeEvent.isComposing) {
      event.preventDefault(); event.stopPropagation()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(event.currentTarget, '')
      event.currentTarget.dispatchEvent(new Event('input', { bubbles: true }))
    } else onKeyDown?.(event)
  }} aria-label={props['aria-label'] || t('Tìm…')} />
}
