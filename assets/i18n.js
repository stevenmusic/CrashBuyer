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
    'panel.chartSuffix': ' · Historical Price',
    'app.brand': 'Crash Buying Simulator',
    'btn.reset': 'Reset',
    'lang.label': 'Language',

    'session.pre': ' · pre-market',
    'session.open': ' · market open',
    'session.post': ' · after hours',
    'session.closed': '',
    'status.loading': 'loading data…',
    'status.fetching': 'fetching history…',
    'status.noData': 'no data',
    'status.live': (source, date) => `live · ${source} · ${date}`,
    'status.direct': (date) => `direct fetch · ${date}`,
    'status.daily': (date) => `daily snapshot · ${date}`,
    // The title attribute below is inert on iOS Safari — no hover, no
    // long-press reveal — so a phone needs the reason visible in the pill
    // itself, not just in a tooltip only a mouse can open.
    'status.dailyReason': (date, reason) => `daily snapshot · ${date} · ${reason}`,
    'status.liveTitle': (source) => `Topped up in-browser from ${source}.`,
    'status.offlineTitle':
      'Live top-up unavailable (usually a CORS block); showing the daily committed snapshot.',
    'status.offlineReason': (reason) =>
      `Live top-up unavailable — ${reason}; showing the daily committed snapshot.`,
    'status.reason.unreachable': 'every live source failed or timed out',
    'status.reason.scale-mismatch': 'the quote was wildly off the committed close, so it was rejected',
    'status.reason.stale': 'the quote was older than the committed close',
    'status.reasonShort.unreachable': 'unreachable',
    'status.reasonShort.scale-mismatch': 'bad quote',
    'status.reasonShort.stale': 'stale quote',
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
    'panel.tradeInput': 'Trade Input',
    'panel.log': 'Transaction Log',

    'mkt.instrument': 'Instrument',
    'mkt.dayPointer': 'Day Pointer',
    'mkt.currentDate': 'Current Date',
    'mkt.currentPrice': 'Current Price',
    'mkt.currentDrawdown': 'Current Drawdown',
    'mkt.peakToDate': 'Peak To Date',
    'mkt.todayRange': (lo, hi) => `Today's range: ${lo} – ${hi}`,
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
    'chart.hint': 'Tap or slide to move the Day Pointer through the days · pinch or scroll to zoom · two fingers, or shift-drag, to pan · double-click to reset.',
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
    'footer.feed': 'Drawdown alerts feed',
    'footer.subscribe': 'Email me the drawdown alerts',
    'footer.subscribePlaceholder': 'you@example.com',
    'footer.subscribeButton': 'Subscribe',
    'proxy.note': (symbol) =>
      `Prices are ${symbol}, an ETF tracking the index — roughly a tenth of the index level. ` +
      'Drawdowns, the allocation ladder and returns are unaffected. Pick S&P 500 above for index levels.',
    'accumulating.note': (symbol) =>
      `${symbol} accumulates: its dividends are reinvested inside the fund, so its price already ` +
      'contains them, while SPY, VOO and IVV quote price alone. Drawdowns and the ladder read the ' +
      'same, but its returns run about 1.5%/yr above theirs on dividends rather than performance — ' +
      'compare it against itself, not against them.',

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
    'alerts.blocked': 'Browser notifications are blocked; alerts will still appear on the page.',
    'alerts.enabled': (step) => `Alerts on. Crossing −${step}%, −${step * 2}%, −${step * 3}%… will notify you.`,
    'alerts.before': 'Alert every',
    'alerts.after': 'below',
    'alerts.stepLabel': 'Drawdown step between alerts',
    'alerts.basisLabel': 'What the drawdown is measured from',
    'alerts.basisPeak': 'the peak',
    'alerts.basisTrade': 'my first trade',
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
    'panel.chartSuffix': ' · 歷史走勢',
    'app.brand': '崩盤抄底模擬器',
    'btn.reset': '重設',
    'lang.label': '語言',

    'session.pre': ' · 盤前',
    'session.open': ' · 盤中',
    'session.post': ' · 盤後',
    'session.closed': '',
    'status.loading': '載入資料中…',
    'status.fetching': '抓取歷史資料中…',
    'status.noData': '無資料',
    'status.live': (source, date) => `即時 · ${source} · ${date}`,
    'status.direct': (date) => `即時抓取 · ${date}`,
    'status.daily': (date) => `每日快照 · ${date}`,
    'status.dailyReason': (date, reason) => `每日快照 · ${date} · ${reason}`,
    'status.liveTitle': (source) => `已於瀏覽器端從 ${source} 補上最新報價。`,
    'status.offlineTitle': '即時補檔失敗（通常是 CORS 阻擋），改用每日更新的快照。',
    'status.offlineReason': (reason) => `即時補檔失敗 — ${reason}；改用每日更新的快照。`,
    'status.reason.unreachable': '所有即時來源都失敗或逾時',
    'status.reason.scale-mismatch': '報價與已存收盤價差距過大，已拒絕採用',
    'status.reasonShort.unreachable': '無法連線',
    'status.reasonShort.scale-mismatch': '報價異常',
    'status.reasonShort.stale': '報價過舊',
    'status.reason.stale': '報價比已存的收盤價還舊',
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
    'panel.tradeInput': '交易輸入',
    'panel.log': '交易紀錄',

    'mkt.instrument': '標的',
    'mkt.dayPointer': '日期指標',
    'mkt.currentDate': '當前日期',
    'mkt.currentPrice': '當前價格',
    'mkt.currentDrawdown': '當前跌幅',
    'mkt.peakToDate': '歷史高點',
    'mkt.todayRange': (lo, hi) => `今日區間：${lo} – ${hi}`,
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
    'chart.hint': '點一下或左右滑動移動日期指標、逐日查看 · 雙指縮放或滾輪放大 · 雙指平移或 Shift 拖曳 · 雙擊還原。',
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
    'footer.feed': '跌幅警報訂閱源',
    'footer.subscribe': '用 Email 接收跌幅警報',
    'footer.subscribePlaceholder': 'you@example.com',
    'footer.subscribeButton': '訂閱',
    'proxy.note': (symbol) =>
      `價格為 ${symbol}，追蹤該指數的 ETF——大約是指數點位的十分之一。` +
      '跌幅、配置階梯與報酬率都不受影響。想看指數點位，在上方切換成 S&P 500 即可。',
    'accumulating.note': (symbol) =>
      `${symbol} 是累積型：股息在基金內部再投入，價格本身已含息，而 SPY、VOO、IVV 只報純價格。` +
      '跌幅與配置階梯的讀法相同，但它的報酬率會比那幾檔每年高約 1.5%——那是股息，不是績效。' +
      '請拿它跟自己比，不要跟那幾檔並列比較。',

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
    'alerts.blocked': '瀏覽器通知被封鎖，提醒仍會顯示在頁面上。',
    'alerts.enabled': (step) => `提醒已開啟。跌破 −${step}%、−${step * 2}%、−${step * 3}%… 時會通知你。`,
    'alerts.before': '每再跌',
    'alerts.after': '就通知，基準為',
    'alerts.stepLabel': '通知的跌幅間距',
    'alerts.basisLabel': '跌幅的計算基準',
    'alerts.basisPeak': '波段高點',
    'alerts.basisTrade': '我的第一筆交易',
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
