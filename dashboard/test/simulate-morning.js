// Run: npm install jsdom@24.1.3 jspdf@2.5.1 jspdf-autotable@3.8.2 (anywhere), then [SIM_DAY=4] node dashboard/test/simulate-morning.js dashboard/intraday-top-27.html test/nifty15.json
// Simulates the dashboard through a trading morning with a fake TradingView connector.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(process.argv[2], 'utf8');
const nifty = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const IST = 19800;
const TODAY = Math.floor(Date.UTC(2026, 10, +(process.env.SIM_DAY || 3)) / 86400000); // Tue 3 Nov 2026
const utcOf = (day, min) => day * 86400 + min * 60 - IST;

// Real NIFTY candles re-stamped as 5-minute candles, 75 per session, ending today 15:25.
const n = nifty.c.length;
const bars = { t: [], o: [], h: [], l: [], c: [], v: [] };
for (let k = 0; k < n; k++) {
  const fromEnd = n - 1 - k;
  bars.t.push(utcOf(TODAY - Math.floor(fromEnd / 75), 9 * 60 + 15 + (74 - (fromEnd % 75)) * 5));
  bars.o.push(k ? nifty.c[k - 1] : nifty.c[0]); bars.h.push(nifty.h[k]); bars.l.push(nifty.l[k]); bars.c.push(nifty.c[k]); bars.v.push(1000 + k);
}
const SYMS = ['NSE:AAA', 'NSE:BBB', 'NSE:CCC'];

function run({ startMin, endMin, prevSupported = true, label }) {
  let saved = null;
  let now = utcOf(TODAY, startMin) * 1000;
  const calls = {};
  let ticker = null;
  const dom = new JSDOM(html, {
    url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      const RealDate = w.Date;
      class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(now); } static now() { return now; } }
      w.Date = FakeDate;
      w.setInterval = (fn) => { ticker = fn; return 1; };
      w.setTimeout = (fn) => { Promise.resolve().then(fn); return 1; };
      if (!w.AbortSignal.timeout) w.AbortSignal.timeout = () => undefined;
      const upTo = (T, closed) => { let m = 0; while (m < bars.t.length && (closed ? bars.t[m] + 300 <= T : bars.t[m] <= T)) m++; return m; };
      const mcp = {
        callTool: async (server, tool, input) => {
          const key = server + ':' + tool; calls[key] = (calls[key] || 0) + 1;
          const T = now / 1000;
          if (server === 'Zapier') { (global.tg = global.tg || []).push(input.params.text); return { payload: { results: [{ ok: 1 }] } }; }
          if (tool === 'mcp-watchlist-get-watchlist') return { payload: { watchlist: { symbols: ['###TIER 1', ...SYMS] } } };
          if (tool === 'mcp-tv-get-ohlcv') {
            const m = upTo(T, false), from = Math.max(0, m - input.count);
            const sl = (a) => a.slice(from, m);
            return { payload: { bars: { t: sl(bars.t), o: sl(bars.o), h: sl(bars.h), l: sl(bars.l), c: sl(bars.c), v: sl(bars.v) } } };
          }
          if (tool === 'mcp-tv-get-symbol-data-batch') {
            const prev = input.columns[0].includes('[1]');
            if (prev && !prevSupported) return { payload: { data: input.symbols.map((s) => ({ symbol: s })) } };
            // prev: candle that last closed; live: the candle forming now (served with its final values).
            const k = prev ? upTo(T, true) - 1 : upTo(T, false) - 1;
            const vals = [bars.o[k], bars.h[k], bars.l[k], bars.c[k], bars.v[k]];
            return { payload: { data: input.symbols.map((s) => ({ symbol: s, ...Object.fromEntries(input.columns.map((c, j) => [c, vals[j]])) })) } };
          }
          throw { code: 'tool_error', message: 'unknown tool ' + tool };
        },
      };
      const jspdf = require('jspdf'); const at = require('jspdf-autotable'); (at.applyPlugin || at.default && at.default.applyPlugin || (() => {}))(jspdf.jsPDF);
      w.jspdf = jspdf;
      const downloads = { save: async ({ filename, data }) => { saved = { filename, size: data.size || data.length }; if (data.arrayBuffer)  return { status: 'saved' }; } };
      w.claude = { use: async (name) => (name === 'mcp' ? mcp : name === 'downloads' ? downloads : null) };
    },
  });
  const w = dom.window;
  const flush = async () => { for (let i = 0; i < 400; i++) await new Promise((r) => setImmediate(r)); };
  return (async () => {
    await flush();
    for (let t = utcOf(TODAY, startMin) * 1000; t <= utcOf(TODAY, endMin) * 1000; t += 10000) {
      now = t;
      if (ticker) { ticker(); await flush(); }
    }
    const btn = w.document.getElementById('pdf');
    if (!btn.hidden) { btn.click(); await flush(); }
    const last = JSON.parse(w.localStorage.getItem('lastScan') || 'null');
    const status = w.document.getElementById('stateText').textContent + ' | ' + w.document.getElementById('meta').textContent;
    const banner = w.document.getElementById('banner');
    console.log(`[${label}] calls`, JSON.stringify(calls), '| mode', w.localStorage.getItem('candleMode'), '| last scan', last && last.cp, '| pdf button:', btn.hidden ? 'hidden' : btn.textContent, '| saved:', JSON.stringify(saved), '| status:', status, banner.hidden ? '' : '| banner: ' + banner.textContent);
    return { last, calls, w };
  })();
}

const pick = (res) => Object.fromEntries(Object.entries(res.results).map(([s, r]) => [s, r.error ? { error: r.error } : { v: r.verdict, sig: r.sig && [r.sig.side, r.sig.t], c: [r.c1, r.c2, r.c3], bounce: r.bounce && r.bounce.zone, ltp: r.ltp, lastT: r.lastT, paused: !!r.paused }]));
(async () => {
  const A = await run({ startMin: 9 * 60 + 40, endMin: 11 * 60 + 50, label: 'A: whole morning, prev candles' });
  const R = await run({ startMin: 9 * 60 + 40, endMin: 12 * 60 + 5, label: 'R: morning + 11:50/11:55 collect + 12:00 report' });
  const RB = await run({ startMin: 12 * 60, endMin: 12 * 60 + 2, label: 'RB: opened at 12:00, full history' });
  console.log('R 12:00 report identical to full-history RB:', JSON.stringify(pick(R.last)) === JSON.stringify(pick(RB.last)), '| report cp', R.last.cp);
  const B = await run({ startMin: 11 * 60 + 45, endMin: 11 * 60 + 47, label: 'B: opened at 11:45, full history' });
  const C = await run({ startMin: 9 * 60 + 40, endMin: 11 * 60 + 50, prevSupported: false, label: 'C: whole morning, live-candle fallback' });
  const same = (x, y) => JSON.stringify(pick(x.last)) === JSON.stringify(pick(y.last));
  console.log('A 11:45 results identical to full-history B:', same(A, B));
  console.log('C 11:45 results identical to full-history B:', same(C, B));
  if (!same(A, B)) console.log(JSON.stringify(pick(A.last)), '\n', JSON.stringify(pick(B.last)));
  console.log('telegram messages:', (global.tg || []).length, '\n' + (global.tg || []).slice(0, 1).join('\n---\n').replace(/<[^>]+>/g, '')); console.log('sample:', JSON.stringify(pick(A.last)['NSE:AAA']));
})();
// debug: diff C vs B
(async () => {})();
