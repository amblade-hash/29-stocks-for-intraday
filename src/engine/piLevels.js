// Port of "PI LVLS" (Full-day fixed zones mode, defaults) + the dashboard's zone-bounce check.
// daily: {t[], o[], h[], l[], c[]} daily candles, oldest first, LAST one = today's session.
(function (root) {
  const TA = typeof module !== 'undefined' && module.exports ? require('./ta.js') : root.TA;

  const DEFAULTS = { atrLen: 22, volMa: 'SMA', volScale: 0.813, m1: 0.2514, m2: 0.381, m3: 0.7821, m4: 1.0 };

  // Today's zones: centre = today's open, unit = SMA(22) of previous days' High-Low x 0.813.
  function levels(daily, opts = {}) {
    const p = { ...DEFAULTS, ...opts };
    const n = daily.c.length;
    if (n < p.atrLen + 1) return null;
    const range = daily.h.map((x, i) => x - daily.l[i]);
    const sm = p.volMa === 'SMA' ? TA.sma(range, p.atrLen) : p.volMa === 'EMA' ? TA.ema(range, p.atrLen) : TA.rma(range, p.atrLen);
    const unit = sm[n - 2] * p.volScale; // f_vol()[1]: previous day's value, never today's partial range
    const o = daily.o[n - 1];
    const pH = daily.h[n - 2], pL = daily.l[n - 2], pC = daily.c[n - 2];
    const z = (a, b) => ({ lo: Math.min(a, b), hi: Math.max(a, b) });
    return {
      center: o,
      unit,
      pivot: (pH + pL + pC) / 3,
      zones: [
        { name: 'R2', kind: 'res', ...z(o + unit * p.m3, o + unit * p.m4) },
        { name: 'R1', kind: 'res', ...z(o + unit * p.m1, o + unit * p.m2) },
        { name: 'S1', kind: 'sup', ...z(o - unit * p.m1, o - unit * p.m2) },
        { name: 'S2', kind: 'sup', ...z(o - unit * p.m3, o - unit * p.m4) },
      ],
    };
  }

  // Did a candle bounce off a zone in the `lookback` bars up to and including bar `i`?
  //  BUY : candle low tags the zone (low <= zone top) and the candle closes ABOVE the zone top.
  //  SELL: candle high tags the zone (high >= zone bottom) and closes BELOW the zone bottom.
  // Any zone counts in either direction, so a broken R1 retested from above supports a BUY.
  // Only today's candles (index >= dayStart) are checked: the zones are for today only.
  function bounce(bars, i, side, lv, lookback, dayStart) {
    if (!lv) return null;
    for (let k = i; k >= Math.max(dayStart, i - lookback + 1); k--) {
      for (const zn of lv.zones) {
        if (side === 'BUY' && bars.l[k] <= zn.hi && bars.c[k] > zn.hi) return { zone: zn.name, bar: k, t: bars.t[k] };
        if (side === 'SELL' && bars.h[k] >= zn.lo && bars.c[k] < zn.lo) return { zone: zn.name, bar: k, t: bars.t[k] };
      }
    }
    return null;
  }

  const api = { DEFAULTS, levels, bounce };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PILevels = api;
})(typeof self !== 'undefined' ? self : this);
