// Telegram message text (HTML parse mode).
const { esc } = require('./telegram.js');
const { timeOf, hhmm } = require('./time.js');

const DISCLAIMER = '<i>Educational alert from technical indicators. Not investment advice.</i>';
const px = (x) => (x == null || Number.isNaN(x) ? '—' : x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const partArrow = (d) => (d === 'UP' ? '▲' : d === 'DOWN' ? '▼' : '–');
const arrow = (trend) => (trend === 'BULL' ? '▲' : trend === 'BEAR' ? '▼' : 'mixed');

function setupBlock(row) {
  const r = row.result;
  const s = r.signal;
  const buy = s.side === 'BUY';
  const head = r.verdict === 'WATCH'
    ? `🟡 <b>WATCH ${s.side} · ${esc(row.symbol)}</b> (${esc(row.tier)}) · 2 of 3`
    : `${buy ? '🟢' : '🔴'} <b>CONFIRMED ${s.side} · ${esc(row.symbol)}</b> (${esc(row.tier)})`;
  const lines = [
    head,
    `${r.c1 ? '✅' : '❌'} ST Momentum ${s.side} at ${timeOf(s.t)} · entry ${px(s.entry)}`,
    r.bounce ? `✅ Bounced off PI ${r.bounce.zone} (${px(r.bounce.lo)}–${px(r.bounce.hi)}) at ${timeOf(r.bounce.t)}` : '❌ No PI zone bounce before the signal',
    `${r.c3 ? '✅' : '❌'} Trend: Supertrend ${arrow(r.stTrend)} · Dual MACD ${arrow(r.macdTrend)}${r.macdParts ? ` (fast ${partArrow(r.macdParts.fast)} slow ${partArrow(r.macdParts.slow)} EMA ${partArrow(r.macdParts.ema)})` : ''}`,
    `Targets 1:1 ${px(s.t1)} · 1:1.5 ${px(s.t2)} · 1:2 ${px(s.t3)} · SL: candle close through Supertrend`,
  ];
  if (r.trade && r.trade !== 'Open') lines.push(`Trade so far: ${esc(r.trade)}`);
  return lines.join('\n');
}

function alertMessage(rows, cp) {
  return [`<b>Intraday Top 27 · ${hhmm(cp)} IST scan</b>`, ...rows.map(setupBlock), DISCLAIMER].join('\n\n');
}

function summaryMessage(rows, dateStr, alerted = {}) {
  const pick = (v) => rows.filter((r) => r.result && r.result.verdict === v);
  const line = (r) => {
    const x = r.result;
    return `• <b>${esc(r.symbol)}</b> ${timeOf(x.signal.t)} · entry ${px(x.signal.entry)}${x.bounce ? ' · ' + x.bounce.zone + ' bounce' : ''}${x.trade && x.trade !== 'Open' ? ' · ' + esc(x.trade) : ''}`;
  };
  const buys = pick('BUY'), sells = pick('SELL'), watch = pick('WATCH');
  const failed = rows.filter((r) => r.error);
  const parts = [`<b>Intraday Top 27 · scan closed ${esc(dateStr)} 11:45 IST</b>`];
  const sent = Object.entries(alerted).filter(([k]) => !k.startsWith('WATCH|'));
  if (sent.length) {
    parts.push(`📨 <b>Alerts sent today (${sent.length})</b>\n` + sent.map(([k, at]) => {
      const [side, sym, t] = k.split('|');
      const row = rows.find((r) => r.symbol === sym);
      const same = row && row.result && row.result.signal && String(row.result.signal.t) === t;
      const now = same ? (row.result.trade || 'Open') : row && row.result && row.result.signal ? `replaced by ${row.result.signal.side} at ${timeOf(row.result.signal.t)}` : 'no longer active';
      return `• <b>${esc(sym)}</b> ${side} ${timeOf(Number(t))} (alerted ${esc(at)}) · now: ${esc(now)}`;
    }).join('\n'));
  }
  parts.push('<b>Status at 11:45</b>');
  parts.push(`🟢 <b>Confirmed buy (${buys.length})</b>\n${buys.length ? buys.map(line).join('\n') : 'None'}`);
  parts.push(`🔴 <b>Confirmed sell (${sells.length})</b>\n${sells.length ? sells.map(line).join('\n') : 'None'}`);
  if (watch.length) parts.push(`🟡 <b>Watch, 2 of 3 (${watch.length})</b>\n${watch.map((r) => `• ${esc(r.symbol)} ${r.result.signal.side} ${timeOf(r.result.signal.t)}`).join('\n')}`);
  if (failed.length) parts.push(`⚠️ Not scanned: ${failed.map((r) => esc(r.symbol)).join(', ')}`);
  parts.push('No more scans today. Next scan 09:45 IST on the next trading day.');
  parts.push(DISCLAIMER);
  return parts.join('\n\n');
}

module.exports = { alertMessage, summaryMessage, setupBlock, DISCLAIMER };
