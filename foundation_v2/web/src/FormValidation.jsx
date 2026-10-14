import { useTestingLocale } from './testingLocale.jsx'
import './form-validation.css'

export function fieldValidationProps(error, id) {
  return { 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? id : undefined }
}

export function focusFirstInvalid(form) {
  // Wait for React to attach the validation state after the submit attempt.
  requestAnimationFrame(() => form?.querySelector('[aria-invalid="true"]:not(:disabled)')?.focus())
}

export function FieldError({ id, error }) {
  const { t } = useTestingLocale()
  return error ? <small id={id} className="wm-field-error">{t(error)}</small> : null
}

export function ValidationSummary({ errors, title = 'Kiểm tra lại thông tin phiên' }) {
  const { t } = useTestingLocale()
  const messages = [...new Set(Object.values(errors).filter(Boolean))]
  return messages.length ? <div role="alert" className="wm-validation-summary"><strong>{t(title)}</strong><ul>{messages.map(message => <li key={message}>{t(message)}</li>)}</ul></div> : null
}
