/* Nexus Markets support chatbot — floating widget, included on every page.
   Talks to /api/chatbot/message (server-side call to the Anthropic API).
   For signed-in users, visibility respects the admin-controlled dashboard
   access setting (feature key: ai_chatbot) via /api/access/me. */
(function () {
  function buildWidget() {
    if (document.getElementById('nexus-chat-root')) return;

    const style = document.createElement('style');
    style.textContent = `
      #nexus-chat-root{position:fixed;right:20px;bottom:20px;z-index:9999;font-family:Arial,Helvetica,sans-serif}
      #nexus-chat-toggle{width:56px;height:56px;border-radius:50%;background:#2d8cff;color:#fff;border:0;box-shadow:0 10px 30px #0006;cursor:pointer;font-size:22px;display:flex;align-items:center;justify-content:center}
      #nexus-chat-panel{display:none;position:absolute;right:0;bottom:70px;width:min(340px,88vw);max-height:70vh;background:#0d1b2d;border:1px solid #1e334c;border-radius:14px;box-shadow:0 20px 60px #0008;overflow:hidden;flex-direction:column}
      #nexus-chat-panel.open{display:flex}
      #nexus-chat-head{background:#10233a;color:#eef5fb;padding:12px 14px;font-weight:700;font-size:14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1e334c}
      #nexus-chat-head span.sub{display:block;font-weight:400;color:#9fb0c5;font-size:11px;margin-top:2px}
      #nexus-chat-close{background:none;border:0;color:#9fb0c5;cursor:pointer;font-size:16px}
      #nexus-chat-log{flex:1;overflow-y:auto;padding:12px;font-size:13px;color:#eef5fb;display:flex;flex-direction:column;gap:8px;min-height:180px}
      .nexus-chat-msg{padding:9px 11px;border-radius:10px;max-width:85%;line-height:1.4;white-space:pre-wrap}
      .nexus-chat-msg.user{align-self:flex-end;background:#2d8cff;color:#fff}
      .nexus-chat-msg.bot{align-self:flex-start;background:#15283a;color:#dce9f3}
      .nexus-chat-msg.err{align-self:flex-start;background:#3a1520;color:#ffb4c0}
      #nexus-chat-form{display:flex;gap:8px;padding:10px;border-top:1px solid #1e334c;background:#0d1b2d}
      #nexus-chat-input{flex:1;background:#081522;color:#fff;border:1px solid #304863;border-radius:9px;padding:9px 11px;font-size:13px}
      #nexus-chat-send{background:#2d8cff;color:#fff;border:0;border-radius:9px;padding:0 14px;font-weight:700;cursor:pointer}
      #nexus-chat-send:disabled{opacity:.6;cursor:default}
    `;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'nexus-chat-root';
    root.innerHTML = `
      <div id="nexus-chat-panel">
        <div id="nexus-chat-head"><div>Nexus Support<span class="sub">Platform help — not financial advice</span></div><button id="nexus-chat-close" aria-label="Close chat">✕</button></div>
        <div id="nexus-chat-log"></div>
        <form id="nexus-chat-form"><input id="nexus-chat-input" autocomplete="off" placeholder="Ask about KYC, deposits, trading…" maxlength="1000"><button id="nexus-chat-send" type="submit">Send</button></form>
      </div>
      <button id="nexus-chat-toggle" aria-label="Open support chat">💬</button>
    `;
    document.body.appendChild(root);

    const panel = document.getElementById('nexus-chat-panel');
    const log = document.getElementById('nexus-chat-log');
    const form = document.getElementById('nexus-chat-form');
    const input = document.getElementById('nexus-chat-input');
    const sendBtn = document.getElementById('nexus-chat-send');
    let history = [];
    let greeted = false;

    function addMsg(role, text) {
      const div = document.createElement('div');
      div.className = 'nexus-chat-msg ' + role;
      div.textContent = text;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }

    document.getElementById('nexus-chat-toggle').onclick = () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open') && !greeted) {
        greeted = true;
        addMsg('bot', "Hi! I'm the Nexus Markets support assistant. I can help with account setup, KYC verification, deposits, or how the trading workspace works. What do you need?");
      }
      if (panel.classList.contains('open')) input.focus();
    };
    document.getElementById('nexus-chat-close').onclick = () => panel.classList.remove('open');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const message = input.value.trim();
      if (!message) return;
      addMsg('user', message);
      input.value = '';
      sendBtn.disabled = true;
      try {
        const r = await fetch('/api/chatbot/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'The assistant is unavailable right now.');
        addMsg('bot', d.reply);
        history.push({ role: 'user', content: message }, { role: 'assistant', content: d.reply });
        history = history.slice(-10);
      } catch (err) {
        addMsg('err', err.message);
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  const token = localStorage.getItem('nexus_token');
  if (token) {
    fetch('/api/access/me', { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.json() : { features: {} }))
      .then((d) => { if (d.features?.ai_chatbot !== false) buildWidget(); })
      .catch(() => buildWidget());
  } else {
    buildWidget();
  }
})();
