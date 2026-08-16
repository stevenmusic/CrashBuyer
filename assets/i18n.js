// English / 繁體中文 strings.
//
// Values are either a string or a function of the interpolated parts, so a
// translation can reorder them. `t()` falls back to English for any key a
// language has not filled in, which keeps a partial translation usable.

export const LANGS = ['en', 'zh'];
export const DEFAULT_LANG = 'en';

const STRINGS = {
  en: {
    'app.title': (name) => `Crash Buying Simulator · ${name}`,
    'app.brand': 'Crash Buying Simulator',
    'btn.reset': 'Reset',
    'lang.label': 'Language',

    'status.loading': 'loading data…',
    'status.fetching': 'fetching history…',
    'status.noData': 'no data',
    'status.live': (source, date) => `live · ${source} · ${date}`,
    'status.direct': (date) => `direct fetch · ${date}`,
    'status.daily': (date) => `daily snapshot · ${date}`,
    'status.liveTitle': (source) => `Topped up in-browser from ${source}.`,
    'status.offlineTitle':
      'Live top-up unavailable (usually a CORS block); showing the daily committed snapshot.',
    'meta.summary': (count, start, end, symbol, source) =>
      `${count} bars · ${start} → ${end} · ${symbol} via ${source}`,
    'meta.proxy': ' · ETF proxy',

    'err.stale': (days) =>
      `Price data is ${days} days old. The daily refresh workflow may not be running — check the "Update S&P 500 data" GitHub Action.`,
    'err.bootstrap':
      'No committed price snapshot found — this history was fetched directly in your browser and is not cached. Run the "Update S&P 500 data" workflow to commit it.',
    'err.noDataAtAll': (msg) =>
      `${msg} A direct in-browser fetch was also blocked, so there is nothing to display.`,

    'panel.currentMarket': 'Current Market',
    'panel.currentMarketNote': 'auto-updates by Day Pointer',
    'panel.portfolio': 'Portfolio',
    'panel.allocation': 'Allocation Guide',
    'panel.allocationNote': '% of base',
    'panel.chart': (name) => `${name} · Historical Price`,
    'panel.tradeInput': 'Trade Input',
    'panel.log': 'Transaction Log',

    'mkt.dayPointer': 'Day Pointer',
    'mkt.currentDate': 'Current Date',
    'mkt.currentPrice': 'Current Price',
    'mkt.currentDrawdown': 'Current Drawdown',
    'mkt.peakToDate': 'Peak To Date',
    'mkt.prevDay': 'Previous day',
    'mkt.nextDay': 'Next day',

    'pf.startingCash': 'Cash Budget',
    'pf.startingCashHint': 'Sets the allocation ladder amounts and caps how much you can deploy. Returns are measured on Total Invested, not on this.',
    'pf.invested': 'Total Invested',
    'pf.investedHint': 'The sum of every buy up to the day pointer — the basis every return here is measured against.',
    'pf.avgCost': 'Average Cost',
    'alloc.base': 'Ladder base',
    'alloc.baseHint': 'Only scales the amounts suggested below. Nothing in Portfolio or Performance depends on it.',
    'col.investedAfter': 'Invested After',
    'col.valueAfter': 'Value After',
    'pf.withdrawn': 'Total Sold',
    'pf.cashBalance': 'Cash Balance',
    'pf.unitsHeld': 'Units Held',
    'pf.marketValue': 'Market Value',
    'pf.totalEquity': 'Total Equity',
    'pf.pnl': 'P&L',
    'pf.returnPct': 'Return %',
    'pf.returnHint': 'P&L divided by Total Invested — the money actually committed.',
    'pf.pending': (n) =>
      n === 1
        ? '1 logged trade happens after this date and is not counted yet.'
        : `${n} logged trades happen after this date and are not counted yet.`,

    'alloc.drawdown': 'Drawdown',
    'alloc.triggerPrice': 'Trigger Price',
    'alloc.pctInvest': '% Invest',
    'alloc.amount': 'Amount',
    'alloc.use': 'Use',

    'legend.price': 'Price',
    'legend.peak': 'Peak',
    'legend.buy': 'BUY',
    'legend.sell': 'SELL',
    'chart.hint': 'Click or drag to move the Day Pointer · pinch or scroll to zoom · double-click to reset.',
    'legend.resetZoom': 'Reset zoom',
    'chart.tip': (day, date, price, dd) =>
      `<b>Day ${day}</b> · ${date}<br />${price}<br />Drawdown ${dd}`,
    'chart.aria': 'Historical price with drawdown episodes',

    'trade.action': 'Action',
    'trade.buy': 'Buy',
    'trade.sell': 'Sell',
    'trade.amount': 'Amount ($)',
    'trade.units': 'Units (auto)',
    'trade.suggest': 'Suggest',
    'trade.execute': 'Execute Trade',
    'trade.preview': 'Trade Preview',
    'trade.previewNote': 'mirrors one row of the transaction log',
    'trade.previewEmpty': 'Enter an amount to preview the trade.',

    'col.num': '#',
    'col.day': 'Day',
    'col.date': 'Date',
    'col.price': 'Price',
    'col.action': 'Action',
    'col.units': 'Units',
    'col.amount': 'Amount',
    'col.cashAfter': 'Cash After',
    'col.unitsAfter': 'Units After',
    'col.equityAfter': 'Equity After',
    'col.notes': 'Notes',

    'log.count': (n) => `${n} trade${n === 1 ? '' : 's'} logged`,
    'log.empty': 'No trades yet — rewind to a crash and buy the dip.',
    'log.notePlaceholder': 'add note…',
    'log.delete': 'Delete trade',

    'msg.enterAmount': 'Enter an amount greater than zero.',
    'msg.executed': (action, units, price, date) =>
      `${action} ${units} units at ${price} on ${date}.`,
    'msg.noUnits': 'No units held at this date to sell.',
    'msg.suggestSell': (units) => `Suggested: sell the full position (${units} units).`,
    'msg.noRung': (dd) =>
      `No allocation rung is armed at ${dd} — the first rung triggers at −10%.`,
    'msg.noCash': 'No cash left to deploy at this date.',
    'msg.suggestBuy': (dd, pct) => `Suggested: the −${dd}% rung — ${pct}% of the ladder base.`,
    'msg.loadedRung': (dd, amount, date) =>
      `Loaded the −${dd}% rung: ${amount}. Execute to log it at ${date}.`,
    'msg.cashTooLow': (amount, reason) =>
      `A budget of ${amount} cannot fund the logged trades. ${reason}`,
    'msg.overdraw': (day, shortfall) =>
      `Trade on day ${day} would overdraw cash by ${shortfall}.`,
    'msg.oversell': (day) => `Trade on day ${day} would sell more units than are held.`,

    'confirm.reset': 'Clear all trades and restore the default ladder base?',
    'footer.disclaimer':
      'Educational simulation only — not investment advice. Index prices exclude dividends, fees and taxes.',
    'proxy.note': (symbol) =>
      `Prices are ${symbol}, the ETF that tracks the index — roughly a tenth of the index level. ` +
      'Drawdowns, the allocation ladder and returns are unaffected; add a FRED_API_KEY secret to switch to true index levels.',

    'panel.performance': 'Performance',
    'panel.performanceNote': 'on invested capital',
    'perf.empty': 'Log a trade to compare against buy & hold.',
    'perf.strategy': 'Your strategy',
    'perf.lump': 'Lump sum',
    'perf.dca': 'Monthly DCA',
    'perf.excess': 'vs lump sum',
    'perf.cagr': 'CAGR',
    'perf.maxdd': 'Max Drawdown',
    'perf.vol': 'Volatility',
    'perf.sharpe': 'Sharpe',
    'perf.tim': 'Time in Market',
    'perf.span': 'Span',
    'perf.years': (y) => `${y} yr`,
    'perf.foot': 'All three commit the same Total Invested from your first trade date: lump sum buys it all at once, DCA spreads it over 12 monthly instalments. Drawdown and volatility describe the account\u2019s equity path. Sharpe assumes a 0% risk-free rate.',

    'legend.log': 'LOG',
    'alerts.label': 'Alert on every −10% of drawdown',
    'alerts.blocked': 'Browser notifications are blocked; alerts will still appear on the page.',
    'alerts.enabled': 'Alerts on. Crossing −10%, −20%, −30%… will notify you.',
    'alert.title': 'Crash Buyer',
    'alert.body': (level, date, price) =>
      `Drawdown crossed −${level}% on ${date} — now at ${price}.`,
    'alert.recovered': (date) => `Back at a new high on ${date}.`,

    'preset.start': 'START',
    'preset.1929': '1929 Great Crash',
    'preset.1987': '1987 Black Monday',
    'preset.2000': '2000 Dot-com',
    'preset.2008': '2008 Financial Crisis',
    'preset.2018': '2018 Trade War',
    'preset.2020': '2020 Covid',
    'preset.2022': '2022 Inflation',
    'preset.2025': '2025 Liberation Day',
    'preset.latest': 'Latest',
  },

  zh: {
    'app.title': (name) => `崩盤抄底模擬器 · ${name}`,
    'app.brand': '崩盤抄底模擬器',
    'btn.reset': '重設',
    'lang.label': '語言',

    'status.loading': '載入資料中…',
    'status.fetching': '抓取歷史資料中…',
    'status.noData': '無資料',
    'status.live': (source, date) => `即時 · ${source} · ${date}`,
    'status.direct': (date) => `即時抓取 · ${date}`,
    'status.daily': (date) => `每日快照 · ${date}`,
    'status.liveTitle': (source) => `已於瀏覽器端從 ${source} 補上最新報價。`,
    'status.offlineTitle': '即時補檔失敗（通常是 CORS 阻擋），改用每日更新的快照。',
    'meta.summary': (count, start, end, symbol, source) =>
      `${count} 個資料點 · ${start} → ${end} · ${symbol}，來源 ${source}`,
    'meta.proxy': ' · ETF 代理',

    'err.stale': (days) =>
      `價格資料已經 ${days} 天沒更新。每日更新的排程可能沒在跑——請檢查 GitHub Action「Update S&P 500 data」。`,
    'err.bootstrap':
      '找不到已提交的價格快照——這份歷史是直接在你瀏覽器抓的，不會被快取。請執行「Update S&P 500 data」workflow 把它提交進 repo。',
    'err.noDataAtAll': (msg) => `${msg} 瀏覽器直接抓取也被擋掉了，因此沒有資料可以顯示。`,

    'panel.currentMarket': '當前市場',
    'panel.currentMarketNote': '隨日期指標自動更新',
    'panel.portfolio': '投資組合',
    'panel.allocation': '配置指南',
    'panel.allocationNote': '佔基準比例',
    'panel.chart': (name) => `${name} · 歷史走勢`,
    'panel.tradeInput': '交易輸入',
    'panel.log': '交易紀錄',

    'mkt.dayPointer': '日期指標',
    'mkt.currentDate': '當前日期',
    'mkt.currentPrice': '當前價格',
    'mkt.currentDrawdown': '當前跌幅',
    'mkt.peakToDate': '歷史高點',
    'mkt.prevDay': '前一日',
    'mkt.nextDay': '後一日',

    'pf.startingCash': '資金預算',
    'pf.startingCashHint': '決定配置指南的各檔金額，並限制最多能投入多少。報酬率是以「累計投入」為基準，與這個數字無關。',
    'pf.invested': '累計投入',
    'pf.investedHint': '到目前日期為止所有買進的加總——本頁所有報酬率都以它為基準。',
    'pf.avgCost': '平均成本',
    'alloc.base': '階梯基準',
    'alloc.baseHint': '只用來換算下方建議的金額。投資組合與績效的數字都跟它無關。',
    'col.investedAfter': '交易後累計投入',
    'col.valueAfter': '交易後持倉市值',
    'pf.withdrawn': '累計賣出',
    'pf.cashBalance': '現金餘額',
    'pf.unitsHeld': '持有單位',
    'pf.marketValue': '市值',
    'pf.totalEquity': '總資產',
    'pf.pnl': '損益',
    'pf.returnPct': '報酬率',
    'pf.returnHint': '損益 ÷ 累計投入——以實際投入的金額為基準。',
    'pf.pending': (n) => `有 ${n} 筆已紀錄的交易發生在這個日期之後，尚未計入。`,

    'alloc.drawdown': '跌幅',
    'alloc.triggerPrice': '觸發價格',
    'alloc.pctInvest': '投入比例',
    'alloc.amount': '金額',
    'alloc.use': '套用',

    'legend.price': '價格',
    'legend.peak': '高點',
    'legend.buy': '買進',
    'legend.sell': '賣出',
    'chart.hint': '點擊或拖曳可移動日期指標 · 雙指縮放或滾輪可放大 · 雙擊還原。',
    'legend.resetZoom': '還原縮放',
    'chart.tip': (day, date, price, dd) =>
      `<b>第 ${day} 天</b> · ${date}<br />${price}<br />跌幅 ${dd}`,
    'chart.aria': '歷史價格走勢與回檔區間',

    'trade.action': '動作',
    'trade.buy': '買進',
    'trade.sell': '賣出',
    'trade.amount': '金額（$）',
    'trade.units': '單位（自動）',
    'trade.suggest': '建議',
    'trade.execute': '執行交易',
    'trade.preview': '交易預覽',
    'trade.previewNote': '對應交易紀錄中的一列',
    'trade.previewEmpty': '輸入金額即可預覽這筆交易。',

    'col.num': '#',
    'col.day': '天',
    'col.date': '日期',
    'col.price': '價格',
    'col.action': '動作',
    'col.units': '單位',
    'col.amount': '金額',
    'col.cashAfter': '交易後現金',
    'col.unitsAfter': '交易後單位',
    'col.equityAfter': '交易後總資產',
    'col.notes': '備註',

    'log.count': (n) => `已紀錄 ${n} 筆交易`,
    'log.empty': '還沒有交易——把時間倒回某次崩盤，然後抄底。',
    'log.notePlaceholder': '新增備註…',
    'log.delete': '刪除交易',

    'msg.enterAmount': '請輸入大於零的金額。',
    'msg.executed': (action, units, price, date) =>
      `已於 ${date} 以 ${price} ${action} ${units} 單位。`,
    'msg.noUnits': '這個日期沒有持倉可以賣出。',
    'msg.suggestSell': (units) => `建議：賣出全部持倉（${units} 單位）。`,
    'msg.noRung': (dd) => `目前跌幅 ${dd}，尚未觸發任何配置檔位——第一檔在 −10% 觸發。`,
    'msg.noCash': '這個日期已經沒有現金可以投入。',
    'msg.suggestBuy': (dd, pct) => `建議：−${dd}% 檔位——階梯基準的 ${pct}%。`,
    'msg.loadedRung': (dd, amount, date) =>
      `已載入 −${dd}% 檔位：${amount}。按「執行交易」即可記錄在 ${date}。`,
    'msg.cashTooLow': (amount, reason) => `資金預算 ${amount} 不足以支應已紀錄的交易。${reason}`,
    'msg.overdraw': (day, shortfall) => `第 ${day} 天的交易會讓現金透支 ${shortfall}。`,
    'msg.oversell': (day) => `第 ${day} 天的交易會賣出超過持有的單位數。`,

    'confirm.reset': '確定要清除所有交易並還原預設階梯基準嗎？',
    'footer.disclaimer': '僅供教學模擬，非投資建議。指數價格不含股息、手續費與稅負。',
    'proxy.note': (symbol) =>
      `價格為 ${symbol}，即追蹤該指數的 ETF——大約是指數點位的十分之一。` +
      '跌幅、配置階梯與報酬率都不受影響；加上 FRED_API_KEY secret 即可切換成真實指數點位。',

    'panel.performance': '績效',
    'panel.performanceNote': '以累計投入為基準',
    'perf.empty': '記錄一筆交易後，即可與長抱策略比較。',
    'perf.strategy': '你的策略',
    'perf.lump': '一次全買',
    'perf.dca': '每月定額',
    'perf.excess': '對比一次全買',
    'perf.cagr': '年化報酬',
    'perf.maxdd': '最大回撤',
    'perf.vol': '年化波動',
    'perf.sharpe': '夏普值',
    'perf.tim': '在場時間',
    'perf.span': '期間',
    'perf.years': (y) => `${y} 年`,
    'perf.foot': '三者都是從你第一筆交易當天投入同樣的「累計投入」金額：一次全買是一次到位，每月定額則分 12 個月平均投入。最大回撤與波動度描述的是帳戶權益曲線。夏普值假設無風險利率為 0%。',

    'legend.log': '對數',
    'alerts.label': '每下跌 10% 就通知我',
    'alerts.blocked': '瀏覽器通知被封鎖，提醒仍會顯示在頁面上。',
    'alerts.enabled': '提醒已開啟。跌破 −10%、−20%、−30%… 時會通知你。',
    'alert.title': '崩盤抄底',
    'alert.body': (level, date, price) => `${date} 跌幅跌破 −${level}%，目前為 ${price}。`,
    'alert.recovered': (date) => `${date} 創下新高。`,

    'preset.start': '起點',
    'preset.1929': '1929 大崩盤',
    'preset.1987': '1987 黑色星期一',
    'preset.2000': '2000 網路泡沫',
    'preset.2008': '2008 金融海嘯',
    'preset.2018': '2018 貿易戰',
    'preset.2020': '2020 疫情',
    'preset.2022': '2022 通膨',
    'preset.2025': '2025 解放日',
    'preset.latest': '最新',
  },
};

let current = DEFAULT_LANG;

export function getLang() {
  return current;
}

export function setLang(lang) {
  current = LANGS.includes(lang) ? lang : DEFAULT_LANG;
  document.documentElement.lang = current === 'zh' ? 'zh-Hant' : 'en';
}

export function t(key, ...args) {
  const value = STRINGS[current]?.[key] ?? STRINGS[DEFAULT_LANG][key];
  if (value === undefined) return key;
  return typeof value === 'function' ? value(...args) : value;
}

/** Fills every element carrying data-i18n / data-i18n-* from the string table. */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
}
