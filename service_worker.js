// FastCopy - Service Worker (MV3)
// Responsável por: abrir/ativar a aba FG Projects e disparar o fluxo no content.js com retries.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolveTargetUrl(settings) {
  const raw = (settings?.ambiente || "").toString().trim();
  let env = raw ? raw.toLowerCase() : "";
  if (!env) {
    const { last_env } = await chrome.storage.sync.get(["last_env"]);
    if (typeof last_env === "string" && last_env.trim()) {
      env = last_env.trim().toLowerCase();
    }
  }
  if (!env) env = "qa2";
  env = env.replace(/[^a-z0-9\-]/g, "");
  return `https://${env}.facilitygrid.net/main/projects`;
}

// ====== Contador diário ======
async function nextDailyCounter() {
  const today = new Date();
  const key = today.toISOString().slice(0, 10).replace(/-/g, "");
  const st = await chrome.storage.local.get(["counterDate", "counter"]);
  const sameDay = st.counterDate === key;
  const counter = sameDay ? (st.counter || 0) + 1 : 1;
  await chrome.storage.local.set({ counterDate: key, counter });
  return counter;
}

// ====== Envio robusto ao content.js ======
async function sendFastCopyStart(tabId, settings, counterToday) {
  for (let i = 1; i <= 25; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, {
        type: "FASTCOPY_START",
        payload: { settings, counterToday }
      });
      if (res && res.ok) {
        return true;
      }
    } catch (e) {
      // content.js ainda não injetado
    }
    await sleep(400);
  }
  return false;
}

// ====== Lançamento principal ======
async function launchCopyWithSettings(settings) {
  const TARGET_URL = await resolveTargetUrl(settings);
  // Abre ou ativa aba FG
  let tab;
  const tabs = await chrome.tabs.query({ url: `${TARGET_URL}*` });
  if (tabs.length) {
    tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.tabs.reload(tab.id);
  } else {
    tab = await chrome.tabs.create({ url: TARGET_URL, active: true });
  }

  const counterToday = await nextDailyCounter();

  const listener = async (tabId, info) => {
    if (tabId !== tab.id) return;
    if (info.status !== "complete") return;
    chrome.tabs.onUpdated.removeListener(listener);

    // Tenta enviar FASTCOPY_START com retries; content.js também tem bootstrap por pending_profile
    await sendFastCopyStart(tab.id, settings, counterToday);
  };

  chrome.tabs.onUpdated.addListener(listener);
}

// ====== Mensagens do popup ======
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "LAUNCH_COPY_WITH_PROFILE") {
      try {
        const settings = msg.payload?.settings;
        if (!settings?.projeto_base) {
          sendResponse({ ok: false, error: "Configuração inválida: nome base ausente." });
          return;
        }
        await launchCopyWithSettings(settings);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return;
    }

    if (msg?.type === "FASTCOPY_GET_COUNTER_NOW") {
      const n = await nextDailyCounter();
      sendResponse({ ok: true, counterToday: n });
      return;
    }

    sendResponse({ ok: false, error: "Mensagem desconhecida." });
  })();
  return true;
});
