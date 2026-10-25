import { useEffect, useMemo, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import { chartTimezones, setTimezone, subscribeTimezone, timezoneLabel, timezoneOptionsAt } from './timezone.js'
import { useTestingLocale } from './testingLocale.jsx'
import './shell-clock.css'

export default function ShellClock() {
  const { t, locale, timezone } = useTestingLocale()
  const [now, setNow] = useState(() => new Date()), [volatile, setVolatile] = useState(false)
  useEffect(() => subscribeTimezone(() => setVolatile(false)), [])
  useEffect(() => {
    let timer
    const tick = () => {
      setNow(new Date())
      timer = setTimeout(tick, 60000 - Date.now() % 60000)
    }
    const resume = () => { if (!document.hidden) { clearTimeout(timer); tick() } }
    timer = setTimeout(tick, 60000 - Date.now() % 60000)
    document.addEventListener('visibilitychange', resume)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', resume) }
  }, [])
  const date = new Intl.DateTimeFormat(locale, { timeZone: timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(now)
  const time = new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  const offset = timezoneLabel(timezone, now)
  const options = useMemo(() => timezoneOptionsAt(now, [...new Set([...chartTimezones, timezone])]), [now, timezone])
  const notice = t('Đã áp dụng trong phiên này. Trình duyệt đang chặn lưu tùy chọn; bạn có thể thử lưu lại.')
  return <div className="wm-shell-clock" data-testid="shell-clock">
    <FxSelect label="Ngày giờ và múi giờ" menuTitle="Múi giờ hiển thị" value={timezone} options={options}
      localizeOptions={false} searchable onChange={value => setVolatile(!setTimezone(value))}
      aria-description={`${t('Giờ hiện tại')}: ${date} ${time}, (${offset}) ${timezone.replaceAll('_', ' ')}`}
      triggerContent={<span className="wm-shell-clock-content">
        <time dateTime={now.toISOString()}>{date} <span aria-hidden="true">·</span> <strong>{time}</strong></time>
        <span className="wm-shell-clock-zone">({offset}) <span className="wm-shell-clock-zone-name">{timezone.replaceAll('_', ' ')}</span>{volatile && <span title={notice} aria-hidden="true"> !</span>}</span>
      </span>} />
    {volatile && <span className="sr-only" role="status">{notice}</span>}
  </div>
}
