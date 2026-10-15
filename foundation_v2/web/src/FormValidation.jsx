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

export function FormFeedback({ errors }) {
  const { t } = useTestingLocale()
  return <p role="alert" className="wm-form-feedback">{Object.values(errors).some(Boolean) ? t('Vui lòng kiểm tra các trường được đánh dấu.') : ''}</p>
}
