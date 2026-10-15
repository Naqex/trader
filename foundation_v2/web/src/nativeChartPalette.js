// Keep the native iframe on the same semantic palette as the app-owned chart
// chrome. The library runs in a separate document, so it cannot resolve the
// parent document's --project-* variables at runtime.
export function nativeChartPalette(theme) {
  return {
    canvas: theme === 'light' ? '#FFFFFF' : '#080808',
    surface: theme === 'light' ? '#FFFFFF' : '#141414',
    grid: theme === 'light' ? '#E8EBEF' : '#22282E',
    border: theme === 'light' ? '#D2D5DA' : '#3D444C',
    text: theme === 'light' ? '#15181C' : '#FFFFFF',
    positive: theme === 'light' ? '#24724B' : '#72CFA1',
    negative: theme === 'light' ? '#B5373C' : '#FF828B',
    primary: theme === 'light' ? '#2466AC' : '#70B5FF',
    highlight: theme === 'light' ? '#A44715' : '#FFAD7C',
    warning: theme === 'light' ? '#80590B' : '#EAC369',
  }
}
