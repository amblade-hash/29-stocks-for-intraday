# Intraday Top 27 dashboard

The claude.ai page that scans the Intraday Top 27 TradingView watchlist every 5 minutes from 09:45 to 11:45 IST using your TradingView connection. Live page: https://claude.ai/artifact/8y1igVsjbTYiet4wDxe8Sj

- `engine/`: the ST Momentum Signals, PI LVLS and Dual MACD Pro ports (the alert server uses copies of the same files).
- `src/page.html`: the page; `node build.js` inlines the engine into `intraday-top-27.html`, which is what gets published.
- `test/replayNifty15.js`: replays the two real NIFTY ST Momentum alerts (SELL 23 Oct 11:00, BUY 27 Oct 10:00) through the port.
