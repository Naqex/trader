export function installChunkRecovery(build, target = window) {
  const key = `wm-chunk-recovery:${build}`
  const recover = event => {
    if (target.navigator.onLine === false) return
    try {
      if (target.sessionStorage.getItem(key)) return
      target.sessionStorage.setItem(key, '1')
    } catch { return }
    // React.lazy caches a rejected import. Reload once to read the current index;
    // a persistent failure remains visible instead of causing a reload loop.
    event.preventDefault()
    target.location.reload()
  }
  target.addEventListener('vite:preloadError', recover)
  return () => target.removeEventListener('vite:preloadError', recover)
}
