// Evaluates one stock at one checkpoint with the three ported indicators.
// Same rules as the Intraday Top 27 dashboard.
const STMomentum = require('./engine/stMomentum.js');
const DualMACD = require('./engine/dualMacd.js');
const PILevels = require('./engine/piLevels.js');
const { dayOf, utcOf } = require('./time.js');

const slice = (b, n) => ({ t: b.t.slice(0, n), o: b.o.slice(0, n), h: b.h.slice(0, n), l: b.l.slice(0, n), c: b.c.slice(0, n), v: b.v.slice(0, n) });

// PI LVLS input: completed daily candles before the session + today's open taken from the
// session's first 5-minute candle (brokers differ on whether today's daily candle exists mid-session).
function dailyForSession(daily, bars, dayStart, day) {
  const prev = { t: [], o: [], h: [], l: [], c: [] };
  for (let k = 0; k < daily.t.length; k++) {
    if (dayOf(daily.t[k]) >= day) break;
    for (const f of ['t', 'o', 'h', 'l', 'c']) prev[f].push(daily[f][k]);
  }
  prev.t.push(bars.t[dayStart]);
  prev.o.push(bars.o[dayStart]);
  prev.h.push(bars.h[dayStart]);
  prev.l.push(bars.l[dayStart]);
  prev.c.push(bars.c[dayStart]);
  return prev;
}

// bars5 / daily: {t[], o[], h[], l[], c[], v[]}, t = candle open, unix seconds UTC, oldest first.
function evaluate(bars5, daily, session, lookback = 6) {
  const cutoff = utcOf(session.day, session.cp);
  let n = 0;
  while (n < bars5.t.length && bars5.t[n] + 300 <= cutoff) n++;
  const bars = slice(bars5, n);
  const dayStart = bars.t.findIndex((t) => dayOf(t) === session.day);
  if (dayStart < 0) return { error: 'no_session' };
  const i = n - 1;

  const lv = daily ? PILevels.levels(dailyForSession(daily, bars, dayStart, session.day)) : null;
  const st = STMomentum.compute(bars);
  const dm = DualMACD.compute(bars);
  const sigs = st.signals.filter((s) => s.i >= dayStart);
  const sig = sigs.length ? sigs[sigs.length - 1] : null;
  const bounce = sig && lv ? PILevels.bounce(bars, sig.i, sig.side, lv, lookback, dayStart) : null;
  const stTrend = st.st.dir[i] === 1 ? 'BULL' : 'BEAR';
  const macdTrend = dm.trend[i];
  const want = sig ? (sig.side === 'BUY' ? 'BULL' : 'BEAR') : null;
  const c1 = !!sig;
  const c2 = !!bounce;
  const c3 = !!sig && stTrend === want && macdTrend === want;
  const passes = c1 + c2 + c3;
  const verdict = sig && passes === 3 ? sig.side : sig && passes === 2 ? 'WATCH' : 'NONE';

  let trade = null;
  if (sig) {
    const tr = sig.trade;
    trade = tr.exit === 'SL' ? 'Stopped (Supertrend close)' : tr.exit === 'TSL' ? 'Trailed out (EMA 10)' : tr.t3Hit ? 'Exit 3 hit (1:2)' : tr.t2Hit ? 'Exit 2 hit (1:1.5)' : tr.t1Hit ? 'Exit 1 hit (1:1)' : 'Open';
  }
  const zone = bounce && lv.zones.find((z) => z.name === bounce.zone);
  return {
    verdict, c1, c2, c3, stTrend, macdTrend, trade,
    signal: sig && { side: sig.side, t: sig.t, entry: sig.trade.entry, t1: sig.trade.t1, t2: sig.trade.t2, t3: sig.trade.t3 },
    bounce: bounce && { zone: bounce.zone, t: bounce.t, lo: zone.lo, hi: zone.hi },
    levels: lv && { center: lv.center, unit: lv.unit },
    signalsToday: sigs.length,
    lastT: bars.t[i],
    close: bars.c[i],
  };
}

module.exports = { evaluate, dailyForSession };
