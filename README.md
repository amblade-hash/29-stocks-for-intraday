# Intraday Top 27 alerts

This repository holds two things: the Telegram alert server (this folder) and the claude.ai dashboard (`dashboard/`).

Scans the Intraday Top 27 list at every 5-minute candle close from **09:45 to 11:45 IST** on weekdays and posts setups to a private Telegram channel. It stops completely after the 11:45 scan, with a closing summary.

A stock is alerted as **CONFIRMED BUY / SELL** when all three checks pass on the 5-minute chart:

1. **ST Momentum Signals** fired a fresh BUY or SELL today.
2. Within the 6 candles (30 min) up to the signal, a candle **bounced off a PI LVLS zone** (wick into R2/R1/S1/S2, close back outside it in the signal's direction).
3. On the latest candle, **Supertrend and Dual MACD Pro** (slow histogram and EMA 9/21) both point the signal's way.

The indicator code in `src/engine/` is the same port used by the Intraday Top 27 dashboard; it reproduced the user's real NIFTY ST Momentum alerts exactly. Each setup is posted once; a restart never re-sends it. It runs Monday to Friday only and skips NSE trading holidays listed in `config/nse-holidays.json`. If a holiday is missing from the list, the server still notices that no candles have appeared by 10:00 and stops for the day without posting anything.

## Setup

### 1. Telegram

1. In Telegram, message **@BotFather** → `/newbot` → copy the bot token.
2. Create a **private channel**. Add the bot as an **admin** with permission to post messages.
3. Put the token in `.env` (copy `.env.example`), post any message in the channel, then run `npm start -- --find-chat` and copy the channel ID (starts with `-100`) into `TELEGRAM_CHAT_ID`.
4. Check it: `npm start -- --test-message`.
5. To let people in: channel settings → Invite links → create a link with **Request admin approval** turned on. You approve each person.

For error notices (login failures, outages) send `/start` to your bot from your own account, run `--find-chat` again and put your personal chat ID in `TELEGRAM_ADMIN_CHAT_ID`.

### 2. Angel One SmartAPI (market data)

1. Sign in to the Angel One SmartAPI portal (smartapi.angelone.in), create an app and copy its **API key**.
2. In the same portal, enable TOTP for your account. Save the **secret key** shown next to the QR code; that is `ANGEL_TOTP_SECRET`. The bot uses it to log in by itself each morning.
3. Fill in `ANGEL_CLIENT_CODE` (your client ID) and `ANGEL_PIN`.

The bot only reads candles. It never places orders.

### 3. Run

```bash
npm start
```

Needs Node 22.9 or newer, and no other packages. It must stay running during market hours, so host it on an always-on machine: a small VPS (Hetzner, DigitalOcean, AWS Lightsail, Oracle Cloud free tier) or a service such as Railway or Fly.io. Free tiers that sleep when idle will miss scans.

With Docker:

```bash
docker build -t top27-alerts .
docker run -d --restart unless-stopped --env-file .env -v top27-data:/app/data top27-alerts
```

## Changing things

- **Stocks:** edit `config/watchlist.json` and restart. Use NSE symbols as Angel One writes them (`BAJAJ-AUTO`, `M&M`).
- **Holidays:** when NSE publishes next year's list (usually in December), add it to `config/nse-holidays.json` as `"2027": ["2027-01-26", ...]` and restart. Until then your admin chat gets a daily reminder, and holidays are still detected automatically.
- **Bounce window:** `BOUNCE_LOOKBACK_CANDLES` (3, 6, 9 or 12).
- **Also post 2-of-3 setups:** `ALERT_WATCH=true`.
- **Another broker:** replace `src/data/angelone.js` with a module that has the same `prepare`, `fiveMinute` and `daily` functions.

## Tests

```bash
npm test
```

Runs a full mock trading day (real NIFTY candles, fake Telegram): 25 scans, no duplicate alerts, the 11:45 summary and hard stop, restarts, holidays, Telegram and data outages.

## Before sharing widely

Posting buy/sell calls to other people can count as investment advice or research under SEBI rules, which require registration. Keep the channel to people you know, keep the disclaimer on every message, and get professional advice before opening it up. Alerts include only derived levels (entry, zone, targets), not a live price feed, because exchange data from a broker account is for personal use.
