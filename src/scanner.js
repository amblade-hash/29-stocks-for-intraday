// Evaluates one stock at one checkpoint with the three ported indicators.
// Same rules as the Intraday Top 27 dashboard.
const STMomentum = require('./engine/stMomentum.js');
const DualMACD = require('./engine/dualMacd.js');
const PILevels = require('./engine/piLevels.js');
const { dayOf, utcOf, FIRST } = require('./time.js');

const HOLD_UNTIL = 10 * 60 + 15; // stocks with a signal by 09:45 are held until this scan
const PAUSE_UNTIL = 10 * 60 + 45;      // signal seen at 09:50-10:00: paused until this scan
const PAUSE_EARLY_CUTOFF = 10 * 60;     // ...signals seen after this scan are paused longer:
const PAUSE_LATE_UNTIL = 11 * 60 + 40; // signal seen at 10:05 or later: paused until this scan

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

// Opening rule. A signal that fired by the 09:45 scan (opening candles) is never alerted, and its
// stock is held until the 10:15 scan; after that only a newer signal (after 09:45) can be alerted.
// signalTimes: today's signal candle times, oldest first; the last one is the signal being judged.
function openingHold(verdict, signalTimes, session) {
  const cutoff = utcOf(session.day, FIRST);
  const isOpening = (t) => t + 300 <= cutoff;
  if (!signalTimes.some(isOpening)) return verdict;
  if (session.cp < HOLD_UNTIL) return 'HOLD';
  return isOpening(signalTimes[signalTimes.length - 1]) ? 'OPENING' : verdict;
}

// bars5 / daily: {t[], o[], h[], l[], c[], v[]}, t = candle open, unix seconds UTC, oldest first.
// Pause rules. A signal after 09:45 is checked at the scan that sees it; the stock is then frozen at that
// scan until 10:45 (signal seen by the 10:00 scan) or 11:40 (signal seen after 10:00). Signals during a pause
// are ignored; after a pause ends, the next signal starts a new one. Returns {cp, until} while paused, else null.
function pauseCheckpoint(signalTimes, session) {
  let pause = null;
  for (const t of signalTimes) {
    const seen = Math.round((((t + 300) + 19800) % 86400) / 60); // checkpoint that first sees the signal
    if (seen <= FIRST || seen > session.cp) continue;              // opening signal, or not seen yet
    if (pause && seen < pause.until) continue;                     // fired while paused: ignored
    const until = seen <= PAUSE_EARLY_CUTOFF ? PAUSE_UNTIL : PAUSE_LATE_UNTIL;
    pause = seen < until ? { cp: seen, until } : null;
  }
  return pause && pause.cp < session.cp && session.cp < pause.until ? pause : null;
}

function evaluate(bars5, daily, session, lookback = 6) {
  const res = evaluateAt(bars5, daily, session, lookback);
  if (res.error || !res.signalTimes) return res;
  const pause = pauseCheckpoint(res.signalTimes, session);
  if (!pause) return res;
  return { ...evaluateAt(bars5, daily, { day: session.day, cp: pause.cp }, lookback), paused: true, pausedAt: pause.cp, pausedUntil: pause.until };
}

function evaluateAt(bars5, daily, session, lookback = 6) {
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
  // Check 3 is judged on the signal candle (latest candle when there is no signal).
  const k = sig ? sig.i : i;
  const stTrend = st.st.dir[k] === 1 ? 'BULL' : 'BEAR';
  const macdTrend = dm.trend[k];
  const macdParts = dm.parts[k];
  const want = sig ? (sig.side === 'BUY' ? 'BULL' : 'BEAR') : null;
  const c1 = !!sig;
  const c2 = !!bounce;
  const c3 = !!sig && stTrend === want && macdTrend === want;
  const passes = c1 + c2 + c3;
  let verdict = sig && passes === 3 ? sig.side : sig && passes === 2 ? 'WATCH' : 'NONE';
  // A stock that already had a signal by the 09:45 scan (opening candles) is held until the 10:15 scan.
  verdict = openingHold(verdict, sigs.map((x) => x.t), session);

  let trade = null;
  if (sig) {
    const tr = sig.trade;
    trade = tr.exit === 'SL' ? 'Stopped (Supertrend close)' : tr.exit === 'TSL' ? 'Trailed out (EMA 10)' : tr.t3Hit ? 'Exit 3 hit (1:2)' : tr.t2Hit ? 'Exit 2 hit (1:1.5)' : tr.t1Hit ? 'Exit 1 hit (1:1)' : 'Open';
  }
  const zone = bounce && lv.zones.find((z) => z.name === bounce.zone);
  return {
    verdict, c1, c2, c3, stTrend, macdTrend, macdParts, trade,
    signal: sig && { side: sig.side, t: sig.t, entry: sig.trade.entry, t1: sig.trade.t1, t2: sig.trade.t2, t3: sig.trade.t3 },
    bounce: bounce && { zone: bounce.zone, t: bounce.t, lo: zone.lo, hi: zone.hi },
    levels: lv && { center: lv.center, unit: lv.unit },
    signalsToday: sigs.length,
    signalTimes: sigs.map((x) => x.t),
    lastT: bars.t[i],
    close: bars.c[i],
  };
}

module.exports = { evaluate, dailyForSession, openingHold, pauseCheckpoint, HOLD_UNTIL, PAUSE_UNTIL, PAUSE_LATE_UNTIL };
