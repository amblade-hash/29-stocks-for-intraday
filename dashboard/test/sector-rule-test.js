// Builds sim-sector.js from simulate-morning.js (copy it next to this file as sim.js first). Pair with a test copy of the page where 'const c2 = !!bounce;' is forced to true.
// Variant of the morning simulation: INFY (IT sector, IT +1.25% in the fake feed) vs BBB (no sector), bounce window 12.
const fs = require('fs');
let s = fs.readFileSync(__dirname + '/sim.js', 'utf8');
s = s.replace("const SYMS = ['NSE:AAA', 'NSE:BBB', 'NSE:CCC'];", "const SYMS = ['NSE:INFY', 'NSE:BBB'];");
s = s.replace("      if (followFrom) w.localStorage.setItem('followFromMin', String(followFrom));", "      w.localStorage.setItem('lookback', '12');");
s = s.replace(/\(async \(\) => \{\n  const A = await run[\s\S]*$/, `(async () => {
  const A = await run({ startMin: 9 * 60 + 40, endMin: 11 * 60 + 50, label: 'S: sector rule' });
  for (const sym of SYMS) { const r = A.last.results[sym]; console.log(sym, '->', r.verdict, r.sectorAgainst ? '(sector against)' : '', '| sector at signal:', JSON.stringify(r.sectorAtSignal), '| sig', r.sig && r.sig.side); }
  console.log('telegram messages:', (global.tg || []).length, (global.tg || []).map((m) => (m.match(/CONFIRMED \\w+ · \\w+/g) || []).join(',')).join(' | '));
})();
`);
fs.writeFileSync(__dirname + '/sim-sector.js', s);
