/**
 * Forbes Secrets — Telegram Notification Module
 * Sends alerts for LONG signals and macro risk events.
 * Config stored in localStorage.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'tg_config';
  const SENT_IDS_KEY = 'tg_sent_ids';

  // ─────────────────────────────────────────
  // Config helpers
  // ─────────────────────────────────────────
  function loadConfig() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
  }

  function saveConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function isActive() {
    const c = loadConfig();
    return !!(c.token && c.chatId && c.enabled);
  }

  // ─────────────────────────────────────────
  // Dedup: avoid sending same signal twice
  // ─────────────────────────────────────────
  function getSentIds() {
    try { return JSON.parse(localStorage.getItem(SENT_IDS_KEY)) || []; } catch { return []; }
  }

  function markSent(id) {
    const ids = getSentIds();
    ids.push(id);
    // Keep only last 50
    if (ids.length > 50) ids.splice(0, ids.length - 50);
    localStorage.setItem(SENT_IDS_KEY, JSON.stringify(ids));
  }

  function alreadySent(id) {
    return getSentIds().includes(id);
  }

  // ─────────────────────────────────────────
  // Telegram API
  // ─────────────────────────────────────────
  async function sendMessage(token, chatId, text) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    return res.json();
  }

  async function getUpdates(token) {
    const url = `https://api.telegram.org/bot${token.trim()}/getUpdates?limit=20&timeout=0`;
    const res = await fetch(url);
    return res.json();
  }

  async function getBotUsername(token) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token.trim()}/getMe`);
      const data = await res.json();
      return data.ok ? data.result.username : null;
    } catch { return null; }
  }

  // ─────────────────────────────────────────
  // Formatters
  // ─────────────────────────────────────────
  function formatSignalMsg(signal, btcPrice) {
    const fp = (n) => n ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
    const conf = signal.confidence === 'HIGH' ? '🟢 HIGH' : signal.confidence === 'MEDIUM' ? '🟡 MEDIUM' : '🔵 LOW';
    const kzLabel = signal.confluences && signal.confluences.find(c => c.includes('KZ')) ? `\n⏰ <b>Killzone:</b> ${signal.confluences.find(c => c.includes('KZ'))}` : '';
    const confluences = signal.confluences && signal.confluences.length
      ? `\n📋 <b>Confluencias:</b> ${signal.confluences.join(' · ')}`
      : '';

    return (
      `🚀 <b>SEÑAL LONG — BTC/USDT</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📈 <b>Tipo:</b> LONG (Alcista)\n` +
      `💰 <b>Precio actual:</b> $${fp(btcPrice)}\n` +
      `🎯 <b>Entrada:</b> $${fp(signal.entry)}\n` +
      `🛑 <b>Stop Loss:</b> $${fp(signal.sl)}\n` +
      `✅ <b>Take Profit:</b> $${fp(signal.tp)}\n` +
      `⚖️ <b>R:R:</b> 1:${signal.rr}\n` +
      `🔥 <b>Confianza:</b> ${conf}` +
      kzLabel +
      confluences +
      `\n\n📝 ${signal.reason || ''}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `⏱ ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`
    );
  }

  function formatMacroMsg(text) {
    return (
      `⚠️ <b>ALERTA MACROECONÓMICA — BTC/USDT</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `${text}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `⏱ ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`
    );
  }

  // ─────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────
  window.TelegramNotifier = {

    /** Called from app.js each analysis cycle with the active signals list */
    notifySignals(signals, btcPrice) {
      if (!isActive()) return;
      const cfg = loadConfig();
      const list = Array.isArray(signals) ? signals : [];

      for (const signal of list) {
        if (signal.type !== 'long') continue;

        // Build a unique ID for this signal to avoid duplicates
        const sigId = `${signal.type}_${Math.round(signal.entry)}_${signal.confidence}_${Math.round((signal.time || Date.now() / 1000) / 300)}`;
        if (alreadySent(sigId)) continue;

        const shouldSend =
          (signal.confidence === 'HIGH' && cfg.notifyHigh !== false) ||
          (signal.confidence === 'MEDIUM' && cfg.notifyMedium !== false) ||
          (signal.confidence === 'LOW');

        if (!shouldSend) continue;

        markSent(sigId);
        sendMessage(cfg.token, cfg.chatId, formatSignalMsg(signal, btcPrice))
          .catch(e => console.warn('Telegram signal error:', e));
      }
    },

    /** Called when a macro risk event is detected */
    notifyMacro(text) {
      if (!isActive()) return;
      const cfg = loadConfig();
      if (cfg.notifyMacro === false) return;

      const macroId = `macro_${new Date().toISOString().slice(0, 13)}`; // once per hour max
      if (alreadySent(macroId)) return;
      markSent(macroId);

      sendMessage(cfg.token, cfg.chatId, formatMacroMsg(text))
        .catch(e => console.warn('Telegram macro error:', e));
    },

    /** Test message */
    async test(token, chatId) {
      const msg =
        `✅ <b>Forbes Secrets — Notificaciones activadas</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `Todo listo. Recibirás alertas aquí cuando se detecten señales LONG con alta confluencia.\n` +
        `⏱ ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`;
      return sendMessage(token, chatId, msg);
    },

    /** Fetch Chat ID from the most recent message to the bot */
    async fetchChatId(token) {
      const cleanToken = token.trim();
      const data = await getUpdates(cleanToken);
      if (!data.ok) return { error: data.description || 'Token inv\u00e1lido' };
      if (!data.result || data.result.length === 0) {
        // Try to get bot username to build a helpful link
        const username = await getBotUsername(cleanToken);
        return { notFound: true, username };
      }
      const last = data.result[data.result.length - 1];
      const chatId = last.message && last.message.chat && last.message.chat.id
        ? String(last.message.chat.id)
        : null;
      return { chatId };
    }
  };

  // ─────────────────────────────────────────
  // UI Logic — wires the modal
  // ─────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const overlay  = document.getElementById('tgOverlay');
    const openBtn  = document.getElementById('tgBtn');
    const closeBtn = document.getElementById('tgClose');
    const tokenIn  = document.getElementById('tgTokenInput');
    const chatIn   = document.getElementById('tgChatIdInput');
    const getChatBtn = document.getElementById('tgGetChatId');
    const chatStatus = document.getElementById('tgChatIdStatus');
    const notifyHigh   = document.getElementById('tgNotifyHigh');
    const notifyMedium = document.getElementById('tgNotifyMedium');
    const notifyMacro  = document.getElementById('tgNotifyMacro');
    const saveBtn  = document.getElementById('tgSaveBtn');
    const testBtn  = document.getElementById('tgTestBtn');
    const saveStatus = document.getElementById('tgSaveStatus');

    if (!overlay) return;

    // Load saved config into inputs
    function loadUI() {
      const cfg = loadConfig();
      if (tokenIn)  tokenIn.value = cfg.token || '';
      if (chatIn)   chatIn.value  = cfg.chatId || '';
      if (notifyHigh)   notifyHigh.checked   = cfg.notifyHigh   !== false;
      if (notifyMedium) notifyMedium.checked = cfg.notifyMedium !== false;
      if (notifyMacro)  notifyMacro.checked  = cfg.notifyMacro  !== false;

      // Style button to indicate active state
      if (openBtn) {
        openBtn.style.borderColor = cfg.token && cfg.chatId && cfg.enabled ? '#00e676' : '';
        openBtn.style.color       = cfg.token && cfg.chatId && cfg.enabled ? '#00e676' : '';
      }
    }

    openBtn  && openBtn.addEventListener('click',  () => { loadUI(); overlay.classList.add('visible'); });
    closeBtn && closeBtn.addEventListener('click', () => overlay.classList.remove('visible'));
    overlay  && overlay.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) overlay.classList.remove('visible');
    });

    getChatBtn && getChatBtn.addEventListener('click', async () => {
      const token = tokenIn.value.trim();
      if (!token) { chatStatus.innerHTML = '⚠️ Ingresa el Bot Token primero.'; chatStatus.style.color = '#ef5350'; return; }
      chatStatus.innerHTML = '⌛ Conectando con Telegram...';
      chatStatus.style.color = '#8b949e';
      try {
        const result = await window.TelegramNotifier.fetchChatId(token);

        if (result.error) {
          chatStatus.innerHTML = `❌ Token inválido: <b>${result.error}</b>. Verifica que copiaste el token completo desde @BotFather.`;
          chatStatus.style.color = '#ef5350';
          return;
        }

        if (result.notFound) {
          const link = result.username
            ? `<br>👉 <a href="https://t.me/${result.username}" target="_blank" style="color:#229ed9;text-decoration:underline">Abre tu bot @${result.username} aquí</a>, envíale cualquier mensaje (p.ej. <b>Hola</b>), y luego vuelve a presionar este botón.`
            : '<br>👉 Busca tu bot en Telegram, envíale cualquier mensaje (p.ej. <b>Hola</b>), y luego vuelve a presionar este botón.';
          chatStatus.innerHTML = `⚠️ El bot aún no ha recibido mensajes.${link}`;
          chatStatus.style.color = '#d29922';
          return;
        }

        if (result.chatId) {
          chatIn.value = result.chatId;
          chatStatus.innerHTML = `✅ Chat ID encontrado: <b>${result.chatId}</b>`;
          chatStatus.style.color = '#00e676';
        } else {
          chatStatus.innerHTML = '❌ No se pudo extraer el Chat ID. Envía otro mensaje al bot e intenta de nuevo.';
          chatStatus.style.color = '#ef5350';
        }
      } catch (e) {
        chatStatus.textContent = '❌ Error al conectar con Telegram. Verifica el token.';
        chatStatus.style.color = '#ef5350';
      }
    });

    saveBtn && saveBtn.addEventListener('click', () => {
      const token  = tokenIn.value.trim();
      const chatId = chatIn.value.trim();
      if (!token || !chatId) {
        saveStatus.textContent = '⚠ Completa el Bot Token y el Chat ID.';
        saveStatus.style.color = '#ef5350';
        return;
      }
      saveConfig({
        token, chatId, enabled: true,
        notifyHigh:   notifyHigh   ? notifyHigh.checked   : true,
        notifyMedium: notifyMedium ? notifyMedium.checked : true,
        notifyMacro:  notifyMacro  ? notifyMacro.checked  : true
      });
      saveStatus.textContent = '✅ Configuración guardada. Recibirás notificaciones en Telegram.';
      saveStatus.style.color = '#00e676';
      loadUI();
    });

    testBtn && testBtn.addEventListener('click', async () => {
      const token  = tokenIn.value.trim();
      const chatId = chatIn.value.trim();
      if (!token || !chatId) {
        saveStatus.textContent = '⚠ Completa el Bot Token y el Chat ID primero.';
        saveStatus.style.color = '#ef5350';
        return;
      }
      saveStatus.textContent = '⌛ Enviando mensaje de prueba...';
      saveStatus.style.color = '#8b949e';
      try {
        const result = await window.TelegramNotifier.test(token, chatId);
        if (result.ok) {
          saveStatus.textContent = '✅ ¡Mensaje enviado! Revisa tu Telegram.';
          saveStatus.style.color = '#00e676';
        } else {
          saveStatus.textContent = `❌ Error: ${result.description || 'Verifica el token y chat ID.'}`;
          saveStatus.style.color = '#ef5350';
        }
      } catch (e) {
        saveStatus.textContent = '❌ No se pudo conectar con Telegram.';
        saveStatus.style.color = '#ef5350';
      }
    });

    loadUI();
  });

})();
