// Posts messages to a Telegram chat or channel through the Bot API (no library needed).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createTelegram({ token, fetchImpl = fetch }) {
  async function send(chatId, html, attempt = 0) {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => ({}));
    if (json.ok) return json.result;
    const retry = json.parameters && json.parameters.retry_after;
    if (retry && attempt < 3) { await sleep(retry * 1000 + 250); return send(chatId, html, attempt + 1); }
    throw new Error(`Telegram sendMessage: ${json.description || 'HTTP ' + res.status}`);
  }
  return { send };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

module.exports = { createTelegram, esc };
