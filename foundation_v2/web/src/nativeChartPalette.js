// Keep the native iframe on the same semantic palette as the app-owned chart
// chrome. The library runs in a separate document, so it cannot resolve the
// parent document's --project-* variables at runtime.
export function nativeChartPalette(theme) {
  return {
    canvas: theme === 'light' ? '#FFFFFF' : '#0C0E12',
    surface: theme === 'light' ? '#FFFFFF' : '#14171C',
    grid: theme === 'light' ? '#DCE3ED' : '#2A3340',
    border: theme === 'light' ? '#BCC6D3' : '#424E5E',
    text: theme === 'light' ? '#17202C' : '#EDF1F7',
    positive: theme === 'light' ? '#06734F' : '#22C78A',
    negative: theme === 'light' ? '#BE2438' : '#FF5364',
    // Candles need a higher-saturation pair than UI status colors so thin
    // bodies and wicks remain crisp against the chart canvas.
    candlePositive: theme === 'light' ? '#087F6A' : '#089981',
    candleNegative: theme === 'light' ? '#C52F45' : '#F23645',
    primary: theme === 'light' ? '#1766C1' : '#4CA6FF',
    highlight: theme === 'light' ? '#B84D0E' : '#FF963F',
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
