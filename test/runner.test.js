const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { totp } = require('../src/data/totp.js');
const { createRunner } = require('../src/runner.js');
const { utcOf, dayOf, CHECKPOINTS } = require('../src/time.js');

test('TOTP matches the RFC 6238 SHA-1 test vector', () => {
  // secret "12345678901234567890", T = 59 s -> 94287082 (8 digits) -> 287082 (6 digits)
  assert.strictEqual(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082');
});

// Real NIFTY candles re-stamped as 5-minute candles ending on "today" (a Friday), 75 per session.
const TODAY = Math.floor(Date.UTC(2026, 9, 30) / 86400000);
function mockProvider({ failDailyFor = null, noToday = false } = {}) {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'nifty15.json'), 'utf8'));
  const n = d.c.length;
  const bars = { t: [], o: [], h: [], l: [], c: [], v: [] };
  for (let k = 0; k < n; k++) {
    const fromEnd = n - 1 - k; // last candle = today 15:25
    const day = TODAY - Math.floor(fromEnd / 75) - (noToday ? 1 : 0);
    const slot = 74 - (fromEnd % 75);
    bars.t.push(utcOf(day, 9 * 60 + 15 + slot * 5));
    bars.o.push(k ? d.c[k - 1] : d.c[0]); bars.h.push(d.h[k]); bars.l.push(d.l[k]); bars.c.push(d.c[k]); bars.v.push(1000);
  }
  const daily = { t: [], o: [], h: [], l: [], c: [], v: [] };
  // 30 older sessions so PI LVLS has its 22-day average, then sessions built from the 5-minute candles.
  for (let j = 30; j > 0; j--) { const day = dayOf(bars.t[0]) - j; daily.t.push(utcOf(day, 0)); daily.o.push(22600); daily.h.push(22800); daily.l.push(22500); daily.c.push(22650); daily.v.push(1); }
  for (let k = 0; k < n;) {
    const day = dayOf(bars.t[k]); let e = k; while (e < n && dayOf(bars.t[e]) === day) e++;
    daily.t.push(utcOf(day, 0)); daily.o.push(bars.o[k]); daily.h.push(Math.max(...bars.h.slice(k, e))); daily.l.push(Math.min(...bars.l.slice(k, e))); daily.c.push(bars.c[e - 1]); daily.v.push(1);
    k = e;
  }
  const calls = { five: 0, daily: 0 };
  return {
    calls,
    name: 'mock',
    prepare: async () => {},
    fiveMinute: async () => { calls.five++; return bars; },
    daily: async (sym) => { calls.daily++; if (sym === failDailyFor) throw new Error('boom'); return daily; },
  };
}
function fakeTelegram({ failFirst = 0 } = {}) {
  const sent = [];
  let fails = failFirst;
  return { sent, send: async (chat, text) => { if (fails-- > 0) throw new Error('Telegram down'); sent.push({ chat, text }); } };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alerts-'));
const watchlist = { tiers: [{ name: 'Tier 1', symbols: ['NIFTYA', 'NIFTYB'] }] };
const at = (min, sec = 25) => (utcOf(TODAY, min) + sec) * 1000;

async function runDay(runner, extraTimes = []) {
  const times = [at(9 * 60 + 30), ...CHECKPOINTS.map((m) => at(m)), at(12 * 60), at(14 * 60), ...extraTimes].sort((a, b) => a - b);
  for (const t of times) await runner.tick(t);
}

test('full session: scans 25 checkpoints, alerts once per setup, posts only confirmed setups, then stops', async () => {
  const provider = mockProvider();
  const tg = fakeTelegram();
  const dir = tmp();
  const runner = createRunner({ provider, telegram: tg, watchlist, chatId: 'chan', stateDir: dir, log: () => {} });
  await runDay(runner, [at(10 * 60, 50), at(10 * 60 + 2)]); // extra ticks between checkpoints must not rescan
  assert.strictEqual(provider.calls.five, 25 * 2, 'one 5-minute fetch per stock per checkpoint');
  assert.strictEqual(provider.calls.daily, 2, 'daily candles fetched once per stock per day');
  assert.ok(tg.sent.every((m) => /CONFIRMED (BUY|SELL)/.test(m.text)), 'every message is a confirmed setup');
  assert.ok(!tg.sent.some((m) => m.text.includes('scan closed')), 'no closing summary');
  const alerts = tg.sent.filter((m) => m.text.includes('IST scan'));
  // Both stocks have identical candles, so every alert names both, and no setup is repeated.
  const keys = alerts.flatMap((m) => [...m.text.matchAll(/CONFIRMED (BUY|SELL) · (\w+)<\/b>[^\n]*\n[^\n]*at (\d\d:\d\d)/g)].map((x) => x.slice(1).join(' ')));
  assert.strictEqual(new Set(keys).size, keys.length, 'no duplicate alerts');
  assert.ok(runner.getState().done);
  console.log(`  ${alerts.length} alert message(s): ${keys.join(', ') || 'none'}`);

  // Restart after the window: nothing is fetched or sent again.
  const again = createRunner({ provider, telegram: tg, watchlist, chatId: 'chan', stateDir: dir, log: () => {} });
  const before = provider.calls.five;
  await again.tick(at(13 * 60));
  assert.strictEqual(provider.calls.five, before);
});

test('restart mid-session does not resend alerts already posted', async () => {
  const dir = tmp();
  const provider = mockProvider();
  const tg = fakeTelegram();
  const r1 = createRunner({ provider, telegram: tg, watchlist, chatId: 'chan', stateDir: dir, log: () => {} });
  for (const m of CHECKPOINTS.filter((m) => m <= 11 * 60)) await r1.tick(at(m));
  const sentBefore = tg.sent.length;
  const r2 = createRunner({ provider, telegram: tg, watchlist, chatId: 'chan', stateDir: dir, log: () => {} });
  await r2.tick(at(11 * 60, 40)); // same checkpoint again after restart
  assert.strictEqual(tg.sent.length, sentBefore);
});

test('a server started after 11:55 does not scan at all', async () => {
  const provider = mockProvider();
  const runner = createRunner({ provider, telegram: fakeTelegram(), watchlist, chatId: 'c', stateDir: tmp(), log: () => {} });
  await runner.tick(at(12 * 60));
  assert.strictEqual(provider.calls.five, 0);
});

test('holiday: no candles today stops scanning after 10:00', async () => {
  const provider = mockProvider({ noToday: true });
  const tg = fakeTelegram();
  const runner = createRunner({ provider, telegram: tg, watchlist, chatId: 'c', stateDir: tmp(), log: () => {} });
  await runDay(runner);
  assert.ok(runner.getState().holiday);
  assert.strictEqual(tg.sent.length, 0);
  assert.ok(provider.calls.five <= 4 * 2, 'stops within a few checkpoints');
});

test('a failed Telegram post is retried and not lost', async () => {
  const provider = mockProvider();
  const tg = fakeTelegram({ failFirst: 1 });
  const ok = fakeTelegram();
  const runner = createRunner({ provider, telegram: ok, watchlist, chatId: 'c', stateDir: tmp(), log: () => {} });
  await runDay(runner);
  const flaky = createRunner({ provider: mockProvider(), telegram: tg, watchlist, chatId: 'c', stateDir: tmp(), log: () => {} });
  // Tick every minute so the one-minute retry back-off can elapse.
  for (let m = 9 * 60 + 40; m <= 12 * 60; m++) await flaky.tick(at(m, 25));
  assert.deepStrictEqual(tg.sent.map((m) => m.text), ok.sent.map((m) => m.text));
});

test('one stock failing does not block the others, and the admin is told once', async () => {
  const provider = mockProvider({ failDailyFor: 'NIFTYA' });
  const tg = fakeTelegram();
  const runner = createRunner({ provider, telegram: tg, watchlist, chatId: 'c', adminChatId: 'admin', stateDir: tmp(), holidays: { 2026: [] }, log: () => {} });
  await runDay(runner);
  const adminMsgs = tg.sent.filter((m) => m.chat === 'admin');
  assert.strictEqual(adminMsgs.length, 1);
  assert.ok(!tg.sent.some((m) => /· NIFTYA</.test(m.text)), 'no alert for the failed stock');
});

test('total outage is retried, never mistaken for a holiday', async () => {
  const provider = mockProvider();
  const real = provider.fiveMinute;
  let down = true;
  provider.fiveMinute = async (s) => { if (down) throw new Error('timeout'); return real(s); };
  const tg = fakeTelegram();
  const runner = createRunner({ provider, telegram: tg, watchlist, chatId: 'c', adminChatId: 'admin', stateDir: tmp(), holidays: { 2026: [] }, log: () => {} });
  for (let m = 9 * 60 + 45; m <= 10 * 60 + 30; m++) await runner.tick(at(m, 25));
  assert.ok(!runner.getState().holiday);
  down = false;
  for (let m = 10 * 60 + 31; m <= 12 * 60; m++) await runner.tick(at(m, 25));
  assert.ok(runner.getState().done, 'recovers and finishes the morning');
  assert.strictEqual(tg.sent.filter((m) => m.chat === 'admin').length, 1, 'admin told once');
});

test('NSE holiday from the calendar: no login, no fetch, no message', async () => {
  const provider = mockProvider();
  const tg = fakeTelegram();
  const runner = createRunner({ provider, telegram: tg, watchlist, chatId: 'c', stateDir: tmp(), holidays: { 2026: ['2026-10-30'] }, log: () => {} });
  await runDay(runner);
  assert.strictEqual(provider.calls.five, 0);
  assert.strictEqual(tg.sent.length, 0);
});

test('weekend: nothing runs', async () => {
  const provider = mockProvider();
  const runner = createRunner({ provider, telegram: fakeTelegram(), watchlist, chatId: 'c', stateDir: tmp(), holidays: { 2026: [] }, log: () => {} });
  const saturday = (utcOf(TODAY + 1, 10 * 60) + 25) * 1000;
  await runner.tick(saturday);
  assert.strictEqual(provider.calls.five, 0);
});

test('a year with no holiday list still scans and tells the admin once', async () => {
  const provider = mockProvider();
  const tg = fakeTelegram();
  const runner = createRunner({ provider, telegram: tg, watchlist, chatId: 'c', adminChatId: 'admin', stateDir: tmp(), holidays: { 2025: [] }, log: () => {} });
  await runDay(runner);
  assert.strictEqual(provider.calls.five, 50);
  assert.strictEqual(tg.sent.filter((m) => m.chat === 'admin' && /holiday list/.test(m.text)).length, 1);
});

test('finishedFor: false before 09:45 on a trading day, true after the 11:45 scan', async () => {
  const runner = createRunner({ provider: mockProvider(), telegram: fakeTelegram(), watchlist, chatId: 'c', stateDir: tmp(), holidays: { 2026: [] }, log: () => {} });
  assert.strictEqual(runner.finishedFor(at(9 * 60)), false);
  await runDay(runner);
  assert.strictEqual(runner.finishedFor(at(11 * 60 + 46)), true);
  assert.strictEqual(createRunner({ provider: mockProvider(), telegram: fakeTelegram(), watchlist, chatId: 'c', stateDir: tmp(), holidays: { 2026: ['2026-10-30'] }, log: () => {} }).finishedFor(at(9 * 60)), true);
});

test('opening rule: opening signals are never alerted, the stock is held till 10:15, later signals count', () => {
  const { openingHold } = require('../src/scanner.js');
  const day = TODAY;
  const t = (min) => utcOf(day, min); // candle open time
  const at = (cp) => ({ day, cp });
  // Signal on the 09:30 candle: held 09:45-10:10, then skipped for the rest of the day.
  for (const cp of [9 * 60 + 45, 9 * 60 + 50, 10 * 60 + 10]) assert.strictEqual(openingHold('BUY', [t(9 * 60 + 30)], at(cp)), 'HOLD');
  assert.strictEqual(openingHold('BUY', [t(9 * 60 + 30)], at(10 * 60 + 15)), 'OPENING');
  assert.strictEqual(openingHold('SELL', [t(9 * 60 + 30)], at(11 * 60 + 45)), 'OPENING');
  // The 09:40 candle closes at 09:45, so it is an opening signal.
  assert.strictEqual(openingHold('SELL', [t(9 * 60 + 40)], at(10 * 60 + 30)), 'OPENING');
  // First signal on the 09:45 candle (closes 09:50): normal from the start.
  assert.strictEqual(openingHold('BUY', [t(9 * 60 + 45)], at(9 * 60 + 50)), 'BUY');
  // Opening signal, then a new one at 09:55: held till 10:15, then the new signal counts.
  assert.strictEqual(openingHold('SELL', [t(9 * 60 + 20), t(9 * 60 + 55)], at(10 * 60)), 'HOLD');
  assert.strictEqual(openingHold('SELL', [t(9 * 60 + 20), t(9 * 60 + 55)], at(10 * 60 + 15)), 'SELL');
  assert.strictEqual(openingHold('WATCH', [t(9 * 60 + 20), t(10 * 60 + 30)], at(10 * 60 + 35)), 'WATCH');
});

test('Dual MACD trend needs fast MACD, histogram and EMA 9/21 to agree', () => {
  const D = require('../src/engine/dualMacd.js');
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'nifty15.json'), 'utf8'));
  const r = D.compute({ c: d.c });
  let histDisagrees = 0;
  for (let i = 300; i < d.c.length; i++) {
    const fast = r.macd1[i] > r.signal1[i] ? 1 : -1, hist = r.hist2[i] > 0 ? 1 : -1, ema = r.ema9[i] > r.ema21[i] ? 1 : -1;
    const want = fast + hist + ema === 3 ? 'BULL' : fast + hist + ema === -3 ? 'BEAR' : 'MIXED';
    assert.strictEqual(r.trend[i], want);
    // The HAL case: fast MACD and EMAs point down but the histogram is green.
    if (fast === -1 && ema === -1 && hist === 1) { histDisagrees++; assert.strictEqual(r.trend[i], 'MIXED'); }
  }
  assert.ok(histDisagrees > 0, 'data includes candles where only the histogram disagrees');
});

test('check 3 is judged on the signal candle, not the latest candle', () => {
  const { evaluate } = require('../src/scanner.js');
  const STM = require('../src/engine/stMomentum.js');
  const D = require('../src/engine/dualMacd.js');
  const p = mockProvider();
  return Promise.all([p.fiveMinute('X'), p.daily('X')]).then(([b, d]) => {
    const st = STM.compute(b), dm = D.compute(b);
    let checked = 0;
    for (const s of st.signals) {
      const day = dayOf(s.t);
      const cp = Math.floor(((s.t + 19800) % 86400) / 60) + 5 + 30; // 30 minutes after the signal candle closed
      if (cp < 9 * 60 + 45 || cp > 11 * 60 + 45) continue;
      const r = evaluate(b, d, { day, cp });
      if (r.error || !r.signal || r.signal.t !== s.t) continue;
      const want = s.side === 'BUY' ? 'BULL' : 'BEAR';
      assert.strictEqual(r.macdTrend, dm.trend[s.i]);
      assert.strictEqual(r.c3, dm.trend[s.i] === want && (st.st.dir[s.i] === 1 ? 'BULL' : 'BEAR') === want);
      checked++;
    }
    assert.ok(checked > 0, 'at least one signal checked');
  });
});

test('pause rules: after 09:45 paused till 10:45, after 10:00 paused till 11:40', () => {
  const { pauseCheckpoint } = require('../src/scanner.js');
  const day = TODAY;
  const t = (min) => utcOf(day, min); // candle open time; the candle closes 5 minutes later
  const at = (cp) => ({ day, cp });
  const P = (cp, until) => ({ cp, until });
  // Seen at 09:50 (09:45 candle): paused 09:55-10:40, back at 10:45.
  assert.strictEqual(pauseCheckpoint([t(9 * 60 + 45)], at(9 * 60 + 50)), null);
  assert.deepStrictEqual(pauseCheckpoint([t(9 * 60 + 45)], at(10 * 60 + 40)), P(9 * 60 + 50, 10 * 60 + 45));
  assert.strictEqual(pauseCheckpoint([t(9 * 60 + 45)], at(10 * 60 + 45)), null);
  // Seen at 10:00 exactly (09:55 candle): still the 10:45 pause.
  assert.deepStrictEqual(pauseCheckpoint([t(9 * 60 + 55)], at(10 * 60 + 5)), P(10 * 60, 10 * 60 + 45));
  // Seen at 10:05 (10:00 candle): paused until 11:40.
  assert.strictEqual(pauseCheckpoint([t(10 * 60)], at(10 * 60 + 5)), null);
  assert.deepStrictEqual(pauseCheckpoint([t(10 * 60)], at(10 * 60 + 50)), P(10 * 60 + 5, 11 * 60 + 40));
  assert.deepStrictEqual(pauseCheckpoint([t(10 * 60)], at(11 * 60 + 35)), P(10 * 60 + 5, 11 * 60 + 40));
  assert.strictEqual(pauseCheckpoint([t(10 * 60)], at(11 * 60 + 40)), null);
  // Signals during a pause are ignored.
  assert.deepStrictEqual(pauseCheckpoint([t(10 * 60), t(10 * 60 + 30)], at(11 * 60)), P(10 * 60 + 5, 11 * 60 + 40));
  // After the 10:45 pause ends, a new signal (seen 11:00) starts a pause until 11:40.
  assert.deepStrictEqual(pauseCheckpoint([t(9 * 60 + 45), t(10 * 60 + 55)], at(11 * 60 + 10)), P(11 * 60, 11 * 60 + 40));
  // A signal seen exactly at 10:45 after the first pause ends: new pause until 11:40.
  assert.deepStrictEqual(pauseCheckpoint([t(9 * 60 + 45), t(10 * 60 + 40)], at(10 * 60 + 50)), P(10 * 60 + 45, 11 * 60 + 40));
  // Opening signals never pause; a later one does. Signals seen at 11:40 or later never pause.
  assert.strictEqual(pauseCheckpoint([t(9 * 60 + 30)], at(10 * 60)), null);
  assert.deepStrictEqual(pauseCheckpoint([t(9 * 60 + 30), t(10 * 60 + 15)], at(10 * 60 + 30)), P(10 * 60 + 20, 11 * 60 + 40));
  assert.strictEqual(pauseCheckpoint([t(11 * 60 + 35)], at(11 * 60 + 45)), null);
});
