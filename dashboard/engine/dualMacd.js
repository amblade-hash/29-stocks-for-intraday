// Port of "Dual MACD Pro + EMA Trend Filter".
// Trend used by the scanner: BULL when the fast MACD (8/13) is above its signal line (9), BEAR when it is
// below. parts[i] also gives the slow histogram (100/200/50) and EMA 9/21 directions, shown for information.
(function (root) {
  const TA = typeof module !== 'undefined' && module.exports ? require('./ta.js') : root.TA;

  const DEFAULTS = { fast1: 8, slow1: 13, signal1: 9, fast2: 100, slow2: 200, signal2: 50, rsiLen: 14, rsiBull: 55, rsiBear: 45 };

  function compute(bars, opts = {}) {
    const p = { ...DEFAULTS, ...opts };
    const c = bars.c;
    const n = c.length;
    const ef1 = TA.ema(c, p.fast1), es1 = TA.ema(c, p.slow1);
    const macd1 = ef1.map((x, i) => x - es1[i]);
    const ef2 = TA.ema(c, p.fast2), es2 = TA.ema(c, p.slow2);
    const macd2 = ef2.map((x, i) => x - es2[i]);
    const sig2 = emaSkipNa(macd2, p.signal2);
    const hist2 = macd2.map((x, i) => x - sig2[i]);
    const rsi = TA.rsi(c, p.rsiLen);
    const ema9 = TA.ema(c, 9), ema21 = TA.ema(c, 21);
    const sig1Fixed = emaSkipNa(macd1, p.signal1);

    const trend = new Array(n), parts = new Array(n), buy = new Array(n), sell = new Array(n);
    const dir = (x) => (x > 0 ? 'UP' : x < 0 ? 'DOWN' : 'FLAT');
    for (let i = 0; i < n; i++) {
      const bullTrend = ema9[i] > ema21[i];
      const bearTrend = ema9[i] < ema21[i];
      parts[i] = { fast: dir(macd1[i] - sig1Fixed[i]), slow: dir(hist2[i]), ema: dir(ema9[i] - ema21[i]) };
      const p = parts[i];
      trend[i] = p.fast === 'UP' ? 'BULL' : p.fast === 'DOWN' ? 'BEAR' : 'MIXED';
      const bullCross = i > 0 && macd1[i] > sig1Fixed[i] && macd1[i - 1] <= sig1Fixed[i - 1];
      const bearCross = i > 0 && macd1[i] < sig1Fixed[i] && macd1[i - 1] >= sig1Fixed[i - 1];
      buy[i] = bullCross && rsi[i] > p.rsiBull && hist2[i] > 0 && bullTrend && macd2[i] > sig2[i];
      sell[i] = bearCross && rsi[i] < p.rsiBear && hist2[i] < 0 && bearTrend && macd2[i] < sig2[i];
    }
    return { macd1, signal1: sig1Fixed, macd2, signal2: sig2, hist2, ema9, ema21, rsi, trend, parts, buy, sell };
  }

  // ta.ema on a series whose first values are na: Pine seeds with the SMA of the first `len` non-na values.
  function emaSkipNa(src, len) {
    const first = src.findIndex((x) => !TA.isNa(x));
    const out = new Array(src.length).fill(NaN);
    if (first < 0) return out;
    const tail = TA.ema(src.slice(first), len);
    for (let i = 0; i < tail.length; i++) out[first + i] = tail[i];
    return out;
  }

  const api = { DEFAULTS, compute };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DualMACD = api;
})(typeof self !== 'undefined' ? self : this);
