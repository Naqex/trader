import React from 'react'
import AppIcon from './AppIcon.jsx'

// Drawing tools retain their recognizable trading geometry.
const paths = {
  indicators: 'M4 18 9 6l6 12M6 14h7M17 6h5M17 12h4M17 18h5',
  level: 'M3 12h18M5 9v6M19 9v6',
  trendline: 'M4 20 20 4M3 17v4h4M17 3h4v4',
  zone: 'M4 6h16v12H4zM4 12h16',
  goto: 'M5 6h10a5 5 0 0 1 0 10H7M12 2l4 4-4 4M7 12l-4 4 4 4',
  fib: 'M4 5h16M4 10h16M4 14h16M4 19h16M7 3v18',
  long: 'M5 3h14v7H5zM5 10h14v11H5zM12 17V6M9 9l3-3 3 3',
  short: 'M5 3h14v11H5zM5 14h14v7H5zM12 7v11M9 15l3 3 3-3',
}
const aliases = { objects:'list', compare:'chart', news:'calendar', 'single-pane':'stop' }

export default function ChartIcon({ name, ...props }) {
  return paths[name] ? <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="wm-icon" data-icon={name} {...props}><path d={paths[name]} /></svg> : <AppIcon name={aliases[name] || name} {...props} />
}
