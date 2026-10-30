// Runs the scan at each checkpoint (09:45-11:45 IST), posts new setups, then stops for the day.
const fs = require('node:fs');
const path = require('node:path');
const { evaluate } = require('./scanner.js');
const { alertMessage, summaryMessage } = require('./messages.js');
const { LAST, FIRST, nowIst, dueCheckpoint, dateOf, hhmm } = require('./time.js');

function createRunner({ provider, telegram, watchlist, chatId, adminChatId, stateDir, graceSec = 20, lookback = 6, alertWatch = false, holidays = {}, log = console.log }) {
  const rows = watchlist.tiers.flatMap((t) => t.symbols.map((symbol) => ({ symbol, tier: t.name })));
  const symbols = rows.map((r) => r.symbol);
  let state = null;
  let busy = false;
  let retryAfter = 0; // ms timestamp: back off after a failed checkpoint
  const dailyCache = { day: null, bars: {} };

  const stateFile = (day) => path.join(stateDir, `state-${dateOf(day)}.json`);
  function loadState(day) {
    try { return JSON.parse(fs.readFileSync(stateFile(day), 'utf8')); } catch { return { day, lastCp: null, alerted: {}, done: false, holiday: false, emptyScans: 0, adminNotes: {} }; }
  }
  function saveState() {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(stateFile(state.day), JSON.stringify(state, null, 2));
  }

  async function notifyAdmin(key, text) {
    if (!adminChatId || state.adminNotes[key]) return;
    state.adminNotes[key] = true;
    try { await telegram.send(adminChatId, `⚠️ Intraday Top 27 alerts: ${text}`); } catch (e) { log('admin notify failed:', e.message); }
  }

  async function fetchAll(day) {
    if (dailyCache.day !== day) { dailyCache.day = day; dailyCache.bars = {}; }
    await provider.prepare(symbols);
    const out = {};
    for (const s of symbols) {
      try {
        const bars5 = await provider.fiveMinute(s);
        if (!dailyCache.bars[s]) dailyCache.bars[s] = await provider.daily(s);
        out[s] = { bars5, daily: dailyCache.bars[s] };
      } catch (e) {
        out[s] = { error: e.message };
      }
    }
    return out;
  }

  async function runCheckpoint(day, cp) {
    let data;
    try {
      data = await fetchAll(day);
    } catch (e) {
      log(`[${hhmm(cp)}] data source failed: ${e.message}`);
      await notifyAdmin('source:' + e.message, `couldn’t reach ${provider.name}: ${e.message}`);
      return null;
    }
    const results = rows.map((r) => {
      const d = data[r.symbol];
      if (d.error) return { ...r, error: d.error };
      const res = evaluate(d.bars5, d.daily, { day, cp }, lookback);
      return res.error ? { ...r, error: res.error } : { ...r, result: res };
    });

    const scanned = results.filter((r) => r.result);
    const errors = results.filter((r) => r.error && r.error !== 'no_session');
    if (errors.length) await notifyAdmin('errors:' + errors.map((e) => e.error).join('|'), `${errors.length} stock(s) failed at ${hhmm(cp)}: ${errors.slice(0, 3).map((e) => `${e.symbol} (${e.error})`).join('; ')}`);
    if (!scanned.length) {
      // Every stock errored: an outage, not a holiday. Retried after a back-off.
      if (errors.length) return null;
      return { results, empty: true };
    }

    const fresh = scanned.filter((r) => {
      const v = r.result.verdict;
      if (v !== 'BUY' && v !== 'SELL' && !(alertWatch && v === 'WATCH')) return false;
      return !state.alerted[`${v}|${r.symbol}|${r.result.signal.t}`];
    });
    if (fresh.length) {
      await telegram.send(chatId, alertMessage(fresh, cp));
      for (const r of fresh) state.alerted[`${r.result.verdict}|${r.symbol}|${r.result.signal.t}`] = hhmm(cp);
    }
    log(`[${hhmm(cp)}] scanned ${scanned.length}/${rows.length}, new alerts: ${fresh.map((r) => r.symbol + ' ' + r.result.verdict).join(', ') || 'none'}`);
    return { results, empty: false };
  }

  async function tick(ms = Date.now()) {
    if (busy || ms < retryAfter) return;
    const now = nowIst(ms);
    if (now.weekday === 0 || now.weekday === 6) return;
    const date = dateOf(now.day);
    const yearList = holidays[date.slice(0, 4)];
    if (yearList && yearList.includes(date)) return; // NSE trading holiday
    if (!state || state.day !== now.day) state = loadState(now.day);
    if (state.done || state.holiday) return;
    if (!yearList && !state.adminNotes.noHolidayList) {
      // Unknown year: the automatic no-candles check still catches holidays, but say so once a day.
      log(`no NSE holiday list for ${date.slice(0, 4)} in config/nse-holidays.json`);
      await notifyAdmin('noHolidayList', `there is no NSE holiday list for ${date.slice(0, 4)} in config/nse-holidays.json. Holidays are still detected automatically (no candles by 10:00), but please add the new list.`);
      saveState();
    }

    const due = dueCheckpoint(now.secOfDay, graceSec);
    if (due == null || due === state.lastCp) return;
    // Hard stop: nothing runs after 11:55, even if the server was down at 11:45.
    if (now.secOfDay > (LAST + 10) * 60) { state.done = true; saveState(); return; }

    busy = true;
    try {
      const out = await runCheckpoint(now.day, due);
      if (!out) { retryAfter = ms + 60000; return; } // source unreachable: retry in a minute
      state.lastCp = due;
      if (out.empty) {
        state.emptyScans += 1;
        // No candles for today by 10:00: market holiday.
        if (due >= FIRST + 15 && state.emptyScans >= 3) { state.holiday = true; log('no session today, stopping'); }
      } else if (due === LAST) {
        await telegram.send(chatId, summaryMessage(out.results, dateOf(now.day), state.alerted));
        state.done = true;
      }
      saveState();
    } catch (e) {
      log(`[${hhmm(due)}] scan failed: ${e.message}`);
      await notifyAdmin('scan:' + e.message, `scan at ${hhmm(due)} failed: ${e.message}`);
      retryAfter = ms + 60000;
    } finally {
      busy = false;
    }
  }

  return { tick, runCheckpoint, getState: () => state };
}

module.exports = { createRunner };
