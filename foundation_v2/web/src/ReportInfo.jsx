import TestingIcon from './TestingIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import './report-info.css'

export default function ReportInfo({ title, text }) {
  const { t } = useTestingLocale()
  return <button type="button" className="wm-report-info" aria-label={t('Thông tin về {title}', { title: t(title) })} data-tooltip={text.split(/\n{2,}/).map(paragraph => t(paragraph)).join('\n\n')} data-tooltip-touch=""><TestingIcon kind="info" size={14} /></button>
}
