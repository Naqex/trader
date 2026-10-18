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
    positive: theme === 'light' ? '#087F6A' : '#089981',
    negative: theme === 'light' ? '#C52F45' : '#F23645',
    // Candles need a higher-saturation pair than UI status colors so thin
    // bodies and wicks remain crisp against the chart canvas.
    candlePositive: theme === 'light' ? '#087F6A' : '#089981',
    candleNegative: theme === 'light' ? '#C52F45' : '#F23645',
    primary: theme === 'light' ? '#2466AC' : '#70B5FF',
    highlight: theme === 'light' ? '#A44715' : '#FFAD7C',
    // Protection lines follow FXReplay's orange SL / green TP convention;
    // keep this chart-only token distinct from the muted app warning copy.
    warning: theme === 'light' ? '#B56800' : '#F59E0B',
    orderSell: theme === 'light' ? '#B54718' : '#FF603B',
    orderSellBorder: theme === 'light' ? '#B35A0A' : '#D87813',
    orderBuyText: theme === 'light' ? '#B54718' : '#FF603B',
    orderSellText: theme === 'light' ? '#087F6A' : '#00B26F',
    orderCloseBackground: '#F5F8FF',
    orderCloseIcon: '#398EF0',
    orderCloseBorder: '#70B5FF',
  }
}
