import AppIcon from './AppIcon.jsx'

export default function TestingIcon({ kind = 'info', size = 18 }) {
  return <AppIcon name={kind === 'check' ? 'success' : kind === 'zoom-area' ? 'fit' : kind} size={size} />
}
