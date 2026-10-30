// Entry point: reads settings from the environment and checks every 10 seconds whether a scan is due.
const fs = require('node:fs');
const path = require('node:path');
const { createProvider } = require('./data/angelone.js');
const { createTelegram } = require('./telegram.js');
const { createRunner } = require('./runner.js');

const env = (k, d) => {
  const v = process.env[k];
  if (v === undefined || v === '') {
    if (d === undefined) { console.error(`Missing setting ${k}. See .env.example.`); process.exit(1); }
    return d;
  }
  return v;
};

const root = path.join(__dirname, '..');
const dataDir = env('DATA_DIR', path.join(root, 'data'));
const watchlist = JSON.parse(fs.readFileSync(env('WATCHLIST_FILE', path.join(root, 'config', 'watchlist.json')), 'utf8'));

const setupOnly = process.argv.includes('--find-chat') || process.argv.includes('--test-message');
const provider = setupOnly ? { name: 'none' } : createProvider({
  apiKey: env('ANGEL_API_KEY'),
  clientCode: env('ANGEL_CLIENT_CODE'),
  pin: env('ANGEL_PIN'),
  totpSecret: env('ANGEL_TOTP_SECRET'),
  cacheDir: dataDir,
});
const telegram = createTelegram({ token: env('TELEGRAM_BOT_TOKEN') });

const runner = createRunner({
  provider,
  telegram,
  watchlist,
  chatId: process.argv.includes('--find-chat') ? '' : env('TELEGRAM_CHAT_ID'),
  adminChatId: env('TELEGRAM_ADMIN_CHAT_ID', ''),
  stateDir: dataDir,
  lookback: Number(env('BOUNCE_LOOKBACK_CANDLES', '6')),
  alertWatch: env('ALERT_WATCH', 'false') === 'true',
  holidays: JSON.parse(fs.readFileSync(env('HOLIDAYS_FILE', path.join(root, 'config', 'nse-holidays.json')), 'utf8')),
  log: (...a) => console.log(new Date().toISOString(), ...a),
});

async function findChats() {
  const res = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/getUpdates`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.description);
  const chats = new Map();
  for (const u of json.result) {
    const m = u.message || u.channel_post || u.my_chat_member;
    if (m && m.chat) chats.set(m.chat.id, `${m.chat.type}: ${m.chat.title || m.chat.username || m.chat.first_name}`);
  }
  if (!chats.size) console.log('No chats yet. Add the bot to your channel as an admin, post any message there, then run this again.');
  for (const [id, name] of chats) console.log(`${id}  ${name}`);
}

// One trading morning, then exit (used by the GitHub Actions schedule).
async function runSession() {
  const { nowIst } = require('./time.js');
  const now = nowIst();
  if (now.secOfDay > (11 * 60 + 40) * 60) {
    console.log('Started after 11:40 IST: today\'s scan window is over (or another run covered it). Nothing to do.');
    return;
  }
  if (runner.finishedFor()) { console.log('Weekend or NSE holiday: no scan today.'); return; }
  console.log('Session started; scanning 09:45-11:45 IST, then exiting.');
  for (;;) {
    await runner.tick().catch((e) => console.error('tick failed:', e));
    if (runner.finishedFor()) break;
    await new Promise((r) => setTimeout(r, 10000));
  }
  const st = runner.getState();
  console.log(`Session finished${st ? `: last scan ${st.lastCp != null ? require('./time.js').hhmm(st.lastCp) : 'none'}, alerts sent ${Object.keys(st.alerted).length}${st.holiday ? ', market closed today' : ''}` : ''}.`);
}

async function main() {
  if (process.argv.includes('--find-chat')) return findChats();
  if (process.argv.includes('--test-message')) {
    await telegram.send(env('TELEGRAM_CHAT_ID'), '✅ Intraday Top 27 alerts are connected to this chat.');
    console.log('Test message sent.');
    return;
  }
  if (process.argv.includes('--session')) return runSession();
  console.log(`Intraday Top 27 alerts running: ${watchlist.tiers.reduce((n, t) => n + t.symbols.length, 0)} stocks, data from ${provider.name}, scans 09:45-11:45 IST, Monday to Friday, skipping NSE holidays.`);
  await runner.tick();
  setInterval(() => runner.tick().catch((e) => console.error('tick failed:', e)), 10000);
}
main().catch((e) => { console.error(e); process.exit(1); });
