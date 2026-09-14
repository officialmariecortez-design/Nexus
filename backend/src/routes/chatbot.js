const express = require('express');
const router = express.Router();

// Lightweight support chatbot. Runs server-side so the API key is never
// exposed to the browser. This is intentionally scoped to platform support
// (how KYC/deposits/demo trading work) and explicitly refuses to give
// personalized financial, investment or trading advice.
const SYSTEM_PROMPT = `You are the Nexus Markets support assistant, embedded on a demo trading platform.
Scope: help visitors understand how the website works — account creation, KYC verification, the demo/paper trading workspace, and the crypto deposit workflow (BTC, USDT, SOL).
Hard rules:
- This platform offers simulated/paper trading only. No real orders are executed and you must never imply otherwise.
- Never give personalized financial, investment or trading advice, price predictions, or tell anyone to buy/sell/deposit a specific amount.
- Never ask for or accept passwords, private keys, seed phrases, one-time codes, or full ID numbers.
- If asked about account-specific data (balances, KYC status, deposit status) explain you can't access personal account data and direct them to the relevant dashboard page.
- If asked something outside platform support, answer briefly and steer back to what you can help with.
- Keep answers short and plain.`;

// Best-effort in-memory rate limit (per server instance). Not a substitute
// for a shared store in a multi-instance deployment, but stops obvious abuse.
const hits = new Map();
const WINDOW_MS = 60000;
const MAX_PER_WINDOW = 15;

function rateLimited(key) {
  const now = Date.now();
  const record = hits.get(key);
  if (!record || now - record.start > WINDOW_MS) {
    hits.set(key, { start: now, count: 1 });
    return false;
  }
  record.count += 1;
  return record.count > MAX_PER_WINDOW;
}

router.post('/message', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'The chat assistant is not configured yet. Add ANTHROPIC_API_KEY in the environment.' });
  }
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many messages. Please wait a moment before sending another.' });
  }

  const message = String(req.body?.message || '').trim();
  const historyIn = Array.isArray(req.body?.history) ? req.body.history : [];
  if (!message) return res.status(400).json({ error: 'Enter a message.' });
  if (message.length > 1000) return res.status(400).json({ error: 'Message is too long (1000 character limit).' });

  const history = historyIn
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.CHATBOT_MODEL || 'claude-sonnet-4-6',
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [...history, { role: 'user', content: message }]
      })
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail?.error?.message || `Chat provider returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    const reply = (payload.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    res.json({ reply: reply || "Sorry, I couldn't come up with a reply. Could you rephrase that?" });
  } catch (error) {
    console.error('Chatbot error:', error.message);
    res.status(502).json({ error: 'The chat assistant is temporarily unavailable. Please try again shortly.' });
  }
});

module.exports = router;
