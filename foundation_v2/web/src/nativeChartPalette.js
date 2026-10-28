// Keep the native iframe on the same semantic palette as the app-owned chart
// chrome. The library runs in a separate document, so it cannot resolve the
// parent document's --project-* variables at runtime.
export function nativeChartPalette(theme) {
  return {
    canvas: theme === 'light' ? '#FFFFFF' : '#080808',
    surface: theme === 'light' ? '#FFFFFF' : '#121212',
    grid: theme === 'light' ? '#DEDEDE' : '#2B2B2B',
    border: theme === 'light' ? '#BDBDBD' : '#424242',
    text: theme === 'light' ? '#171717' : '#F1F1F1',
    positive: theme === 'light' ? '#087D50' : '#20D493',
    negative: theme === 'light' ? '#C62F43' : '#FF5C6C',
    // Candles need a higher-saturation pair than UI status colors so thin
    // bodies and wicks remain crisp against the chart canvas.
    candlePositive: theme === 'light' ? '#087F6A' : '#089981',
    candleNegative: theme === 'light' ? '#C52F45' : '#F23645',
    primary: theme === 'light' ? '#1768C4' : '#5AAEFF',
    highlight: theme === 'light' ? '#9C4400' : '#FF9A1F',
    // Protection lines follow FXReplay's orange SL / green TP convention;
    // keep this chart-only token distinct from the muted app warning copy.
    warning: theme === 'light' ? '#B56800' : '#F59E0B',
    orderSell: theme === 'light' ? '#B54718' : '#FF603B',
    orderSellBorder: theme === 'light' ? '#B35A0A' : '#D87813',
    orderBuyText: theme === 'light' ? '#B54718' : '#FF603B',
    orderSellText: theme === 'light' ? '#B54718' : '#FF603B',
    orderCloseBackground: '#F5F8FF',
    orderCloseIcon: '#1766C1',
    orderCloseBorder: '#4CA6FF',
    orderEntryPrice: theme === 'light' ? '#E8EBEF' : '#F5F8FF',
    orderProtectionPrice: theme === 'light' ? '#159989' : '#46C7B7',
    orderSelectedPrice: '#FFBF00',
  }
}
