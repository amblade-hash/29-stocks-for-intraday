// Pine Script ta.* primitives, ported with Pine's na semantics (NaN = na).
(function (root) {
  const isNa = (x) => x === null || x === undefined || Number.isNaN(x);
  const nz = (x, d = 0) => (isNa(x) ? d : x);

  function sma(src, len) {
    const out = new Array(src.length).fill(NaN);
    for (let i = len - 1; i < src.length; i++) {
      let s = 0;
      for (let j = i - len + 1; j <= i; j++) s += src[j];
      out[i] = s / len; // NaN propagates like Pine
    }
    return out;
  }

  // ta.rma: seeded with the SMA of the first `len` values, then alpha = 1/len.
  function rma(src, len) {
    const out = new Array(src.length).fill(NaN);
    const alpha = 1 / len;
    const seed = sma(src, len);
    for (let i = 0; i < src.length; i++) {
      const prev = i > 0 ? out[i - 1] : NaN;
      out[i] = isNa(prev) ? seed[i] : alpha * src[i] + (1 - alpha) * prev;
    }
    return out;
  }

  // ta.ema: seeded with the SMA of the first `len` values.
  function ema(src, len) {
    const out = new Array(src.length).fill(NaN);
    const alpha = 2 / (len + 1);
    const seed = sma(src, len);
    for (let i = 0; i < src.length; i++) {
      const prev = i > 0 ? out[i - 1] : NaN;
      out[i] = isNa(prev) ? seed[i] : alpha * src[i] + (1 - alpha) * prev;
    }
    return out;
  }

  // ta.tr(handle_na): first bar is high-low when handle_na, else na.
  function tr(h, l, c, handleNa) {
    return h.map((_, i) => {
      if (i === 0) return handleNa ? h[0] - l[0] : NaN;
      return Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    });
  }

  const atr = (h, l, c, len) => rma(tr(h, l, c, true), len);

  function change(src) {
    return src.map((x, i) => (i === 0 ? NaN : x - src[i - 1]));
  }

  function rsi(src, len) {
    const ch = change(src);
    const up = rma(ch.map((x) => (isNa(x) ? NaN : Math.max(x, 0))), len);
    const dn = rma(ch.map((x) => (isNa(x) ? NaN : Math.max(-x, 0))), len);
    return up.map((u, i) => {
      const d = dn[i];
      if (isNa(u) || isNa(d)) return NaN;
      if (d === 0) return 100;
      if (u === 0) return 0;
      return 100 - 100 / (1 + u / d);
    });
  }

  function highest(src, len) {
    return src.map((_, i) => {
      if (i < len - 1) return NaN;
      let m = -Infinity;
      for (let j = i - len + 1; j <= i; j++) if (!isNa(src[j]) && src[j] > m) m = src[j];
      return m === -Infinity ? NaN : m;
    });
  }

  function lowest(src, len) {
    return src.map((_, i) => {
      if (i < len - 1) return NaN;
      let m = Infinity;
      for (let j = i - len + 1; j <= i; j++) if (!isNa(src[j]) && src[j] < m) m = src[j];
      return m === Infinity ? NaN : m;
    });
  }

  // ta.stoch(src, high, low, len)
  function stoch(src, h, l, len) {
    const hh = highest(h, len);
    const ll = lowest(l, len);
    return src.map((x, i) => {
      const den = hh[i] - ll[i];
      return den === 0 || isNa(den) ? NaN : (100 * (x - ll[i])) / den;
    });
  }

  // ta.dmi(diLen, adxSmooth) -> {plus, minus, adx}
  function dmi(h, l, c, diLen, adxLen) {
    const n = h.length;
    const plusDM = new Array(n).fill(NaN);
    const minusDM = new Array(n).fill(NaN);
    for (let i = 1; i < n; i++) {
      const up = h[i] - h[i - 1];
      const down = l[i - 1] - l[i];
      plusDM[i] = up > down && up > 0 ? up : 0;
      minusDM[i] = down > up && down > 0 ? down : 0;
    }
    const trur = rma(tr(h, l, c, false), diLen);
    const pRma = rma(plusDM, diLen);
    const mRma = rma(minusDM, diLen);
    // fixnan(): carry the last non-na value forward
    const plus = new Array(n).fill(NaN);
    const minus = new Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      const p = (100 * pRma[i]) / trur[i];
      const m = (100 * mRma[i]) / trur[i];
      plus[i] = isNa(p) || !Number.isFinite(p) ? (i > 0 ? plus[i - 1] : NaN) : p;
      minus[i] = isNa(m) || !Number.isFinite(m) ? (i > 0 ? minus[i - 1] : NaN) : m;
    }
    const dx = plus.map((p, i) => {
      const s = p + minus[i];
      return Math.abs(p - minus[i]) / (s === 0 ? 1 : s);
    });
    const adx = rma(dx, adxLen).map((x) => 100 * x);
    return { plus, minus, adx };
  }

  // ta.percentrank: % of the previous `len` values that are <= the current one.
  function percentrank(src, len) {
    return src.map((x, i) => {
      if (i < len || isNa(x)) return NaN;
      let cnt = 0;
      for (let j = 1; j <= len; j++) if (src[i - j] <= x) cnt++;
      return (100 * cnt) / len;
    });
  }

  // ta.pivothigh/pivotlow(src, left, right): value reported on the confirming bar (i = pivot + right).
  function pivot(src, left, right, isHigh) {
    const out = new Array(src.length).fill(NaN);
    for (let i = left + right; i < src.length; i++) {
      const p = i - right;
      const v = src[p];
      let ok = !isNa(v);
      for (let j = p - left; ok && j <= p + right; j++) {
        if (j === p) continue;
        // Pine: strict on the right side, non-strict on the left side
        if (isHigh) ok = j < p ? src[j] <= v : src[j] < v;
        else ok = j < p ? src[j] >= v : src[j] > v;
      }
      if (ok) out[i] = v;
    }
    return out;
  }

  const api = { isNa, nz, sma, rma, ema, tr, atr, change, rsi, highest, lowest, stoch, dmi, percentrank, pivot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TA = api;
})(typeof self !== 'undefined' ? self : this);
