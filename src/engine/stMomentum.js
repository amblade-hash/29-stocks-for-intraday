// Port of "Supertrend + ADX/RSI/StochRSI Signals + Zones" (ST Momentum Signals), signal path only.
// Defaults mirror the Pine inputs and the user's saved alert settings.
// bars: {t[], o[], h[], l[], c[], v[]} of CLOSED candles, oldest first; t = unix seconds UTC.
(function (root) {
  const TA = typeof module !== 'undefined' && module.exports ? require('./ta.js') : root.TA;
  const { isNa, nz } = TA;

  const DEFAULTS = {
    adxMin: 20, rsiBuy: 55, rsiSell: 45, stochBuyLvl: 60, stochSellLvl: 40, stochSellDir: 'Below', stochLine: '%K',
    stochRsiLen: 14, stochKLen: 34, stochKSmth: 5, stochDSmth: 21,
    ema1Len: 10, ema2Len: 20,
    adxLen: 14, adxSmooth: 14, rsiLen: 14,
    preset: 'Modern (auto, TF-aware)',
    atrPeriod: 7, mult: 1.2,
    kerLen: 20, kerPctWin: 500, pivot: 0.5, trendGain: 0.8, chopGain: 0.5, multMin: 1.0, multMax: 6.0,
    hystAtr: 0.5, hystBars: 1,
    rr1: 1.0, rr2: 1.5, rr3: 2.0, maxTradeBars: 500, beTrigger: 'Candle close', resetDaily: true,
    tfSeconds: 300,
    tzOffsetSec: 19800, // IST, used for "new day"
  };

  // Modern Adaptive Supertrend. L1 (adaptive period) is off for the Modern preset, so the
  // Hilbert-transform period block never feeds the output and is omitted.
  function supertrend(bars, p) {
    const { h, l, c } = bars;
    const n = c.length;
    const isModern = p.preset === 'Modern (auto, TF-aware)';
    const useL2 = isModern ? p.tfSeconds <= 3600 : false;
    const useL3 = isModern ? true : false;
    const hl2 = h.map((x, i) => (x + l[i]) / 2);
    const stAtr = TA.atr(h, l, c, p.atrPeriod);

    // KER (Kaufman efficiency ratio), ranked vs its own distribution
    const ker = new Array(n);
    for (let i = 0; i < n; i++) {
      let vol = NaN;
      if (i >= p.kerLen) {
        vol = 0;
        for (let j = i - p.kerLen + 1; j <= i; j++) vol += Math.abs(c[j] - c[j - 1]);
      }
      const dir = i >= p.kerLen ? Math.abs(c[i] - c[i - p.kerLen]) : NaN;
      ker[i] = vol > 0 ? dir / vol : 0.0;
    }
    const kerSig = TA.percentrank(ker, p.kerPctWin).map((x) => x / 100);

    const dirArr = new Array(n), stArr = new Array(n), multArr = new Array(n);
    let upperPrev = NaN, lowerPrev = NaN, stDir = 1, candDir = 0, candCount = 0;
    for (let i = 0; i < n; i++) {
      const fTrend = Math.max(0, (kerSig[i] - p.pivot) / (1 - p.pivot));
      const fChop = Math.max(0, (p.pivot - kerSig[i]) / p.pivot);
      const hinge = p.mult * (1 + p.trendGain * fTrend + p.chopGain * fChop);
      const multEff = useL2 ? Math.min(Math.max(hinge, p.multMin), p.multMax) : p.mult;

      const upperBasic = hl2[i] + multEff * stAtr[i];
      const lowerBasic = hl2[i] - multEff * stAtr[i];
      const ubPrev = nz(upperPrev, upperBasic);
      const lbPrev = nz(lowerPrev, lowerBasic);
      const closePrev = i > 0 ? c[i - 1] : NaN;
      const upper = upperBasic < ubPrev || closePrev > ubPrev ? upperBasic : ubPrev;
      const lower = lowerBasic > lbPrev || closePrev < lbPrev ? lowerBasic : lbPrev;

      const prevDir = stDir;
      let newDir = prevDir;
      if (!useL3) {
        newDir = c[i] > ubPrev ? 1 : c[i] < lbPrev ? -1 : prevDir;
      } else {
        const buf = p.hystAtr * stAtr[i];
        if (prevDir === 1) {
          if (c[i] < lbPrev - buf) {
            candCount = candDir === -1 ? candCount + 1 : 1;
            candDir = -1;
            if (candCount >= p.hystBars) { newDir = -1; candDir = 0; candCount = 0; }
          } else { candDir = 0; candCount = 0; }
        } else {
          if (c[i] > ubPrev + buf) {
            candCount = candDir === 1 ? candCount + 1 : 1;
            candDir = 1;
            if (candCount >= p.hystBars) { newDir = 1; candDir = 0; candCount = 0; }
          } else { candDir = 0; candCount = 0; }
        }
      }
      stDir = newDir;
      upperPrev = upper;
      lowerPrev = lower;
      dirArr[i] = stDir;
      stArr[i] = stDir === 1 ? lower : upper;
      multArr[i] = multEff;
    }
    return { dir: dirArr, line: stArr, mult: multArr, atr: stAtr };
  }

  // confirmDir: optional per-bar Supertrend direction on the confirmation TF (5m). When the chart
  // TF is 5m it is the chart's own direction, which is the default.
  function compute(bars, opts = {}, confirmDir = null) {
    const p = { ...DEFAULTS, ...opts };
    const { t, h, l, c } = bars;
    const n = c.length;
    const st = supertrend(bars, p);
    const cDir = confirmDir || st.dir;
    const { adx } = TA.dmi(h, l, c, p.adxLen, p.adxSmooth);
    const rsi = TA.rsi(c, p.rsiLen);
    const sRsi = TA.rsi(c, p.stochRsiLen);
    const stochK = TA.sma(TA.stoch(sRsi, sRsi, sRsi, p.stochKLen), p.stochKSmth);
    const stochD = TA.sma(stochK, p.stochDSmth);
    const ema1 = TA.ema(c, p.ema1Len);

    const above = (i, lvl) => (p.stochLine === '%K' ? stochK[i] > lvl : p.stochLine === '%D' ? stochD[i] > lvl : stochK[i] > lvl && stochD[i] > lvl);
    const below = (i, lvl) => (p.stochLine === '%K' ? stochK[i] < lvl : p.stochLine === '%D' ? stochD[i] < lvl : stochK[i] < lvl && stochD[i] < lvl);

    const state = new Array(n);
    for (let i = 0; i < n; i++) {
      const stochBuyOk = above(i, p.stochBuyLvl);
      const stochSellOk = p.stochSellDir === 'Below' ? below(i, p.stochSellLvl) : above(i, p.stochSellLvl);
      const buy = st.dir[i] === 1 && cDir[i] === 1 && adx[i] > p.adxMin && rsi[i] > p.rsiBuy && stochBuyOk;
      const sell = st.dir[i] === -1 && cDir[i] === -1 && adx[i] > p.adxMin && rsi[i] < p.rsiSell && stochSellOk;
      state[i] = buy ? 'BUY' : sell ? 'SELL' : 'NO TRADE';
    }

    // Trade tracking: a fresh same-side signal is blocked while that side's trade is live and pre-Exit 1.
    const dayKey = (ts) => Math.floor((ts + p.tzOffsetSec) / 86400);
    const signals = [];
    let buyTr = null, sellTr = null;
    const newTrade = (dir, i) => {
      const e = c[i];
      const r = dir === 1 ? c[i] - st.line[i] : st.line[i] - c[i];
      return { dir, entry: e, risk: r, t1: e + dir * p.rr1 * r, t2: e + dir * p.rr2 * r, t3: e + dir * p.rr3 * r, t1Hit: false, t2Hit: false, t3Hit: false, active: true, startBar: i };
    };
    const update = (tr, i) => {
      if (!tr || !tr.active || i <= tr.startBar) return;
      const isBuy = tr.dir === 1;
      let stopped = false;
      if (!tr.t1Hit) {
        if (isBuy ? c[i] < st.line[i] : c[i] > st.line[i]) { stopped = true; tr.exit = 'SL'; }
      } else {
        const hit = p.beTrigger === 'Candle close' ? (isBuy ? c[i] < ema1[i] : c[i] > ema1[i]) : (isBuy ? l[i] <= ema1[i] : h[i] >= ema1[i]);
        if (hit) { stopped = true; tr.exit = 'TSL'; }
      }
      if (stopped) { tr.active = false; tr.exitBar = i; return; }
      if (!tr.t1Hit && (isBuy ? h[i] >= tr.t1 : l[i] <= tr.t1)) tr.t1Hit = true;
      if (!tr.t2Hit && (isBuy ? h[i] >= tr.t2 : l[i] <= tr.t2)) tr.t2Hit = true;
      if (!tr.t3Hit && (isBuy ? h[i] >= tr.t3 : l[i] <= tr.t3)) { tr.t3Hit = true; tr.active = false; tr.exit = 'T3'; tr.exitBar = i; }
      if (tr.active && i - tr.startBar > p.maxTradeBars) tr.active = false;
    };
    const blocking = (tr) => !!tr && tr.active && !tr.t1Hit;

    for (let i = 0; i < n; i++) {
      if (p.resetDaily && i > 0 && dayKey(t[i]) !== dayKey(t[i - 1])) {
        if (buyTr) buyTr.active = false;
        if (sellTr) sellTr.active = false;
      }
      update(buyTr, i);
      update(sellTr, i);
      const prev = i > 0 ? state[i - 1] : undefined;
      if (state[i] === 'BUY' && prev !== 'BUY' && !blocking(buyTr) && c[i] > st.line[i]) {
        buyTr = newTrade(1, i);
        signals.push({ i, t: t[i], side: 'BUY', trade: buyTr });
      }
      if (state[i] === 'SELL' && prev !== 'SELL' && !blocking(sellTr) && c[i] < st.line[i]) {
        sellTr = newTrade(-1, i);
        signals.push({ i, t: t[i], side: 'SELL', trade: sellTr });
      }
    }

    return { st, adx, rsi, stochK, stochD, ema1, state, signals };
  }

  const api = { DEFAULTS, supertrend, compute };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.STMomentum = api;
})(typeof self !== 'undefined' ? self : this);
