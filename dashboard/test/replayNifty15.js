// Replays the user's two real NIFTY 15m ST Momentum alerts (BUY bar 27-Oct 10:00 IST, SELL bar 23-Oct 11:00 IST).
const S = require('../engine/stMomentum.js');
const d = require('../../test/nifty15.json');
const n = d.c.length;
// 2 bars on the first day, then 24 bars/day (09:15..15:00 IST); synthesize timestamps (day key is all that matters).
const t = [], label = [];
for (let i = 0; i < n; i++) {
  const day = i < 2 ? 0 : 1 + Math.floor((i - 2) / 24);
  const slot = i < 2 ? 22 + i : (i - 2) % 24;
  t.push(1789550100 + day * 86400 + (slot - 22) * 900);
  label.push(`day${day} ${String(9 + Math.floor((15 + slot * 15) / 60)).padStart(2, '0')}:${String((15 + slot * 15) % 60).padStart(2, '0')}`);
}
const r = S.compute({ t, o: d.c, h: d.h, l: d.l, c: d.c }, { tfSeconds: 900 });
const want = { 585: 'SELL', 629: 'BUY' };
for (const s of r.signals.filter((s) => s.i >= 550)) console.log(label[s.i], s.side, s.i in want ? '<= alert bar' : '');
for (const [i, side] of Object.entries(want)) console.log(`alert bar ${label[i]} expected ${side}: state=${r.state[i]} prev=${r.state[i - 1]} stDir=${r.st.dir[i]} adx=${r.adx[i].toFixed(1)} rsi=${r.rsi[i].toFixed(1)} K=${r.stochK[i].toFixed(1)}`);
