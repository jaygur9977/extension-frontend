// ==================== CONFIG ====================
export const config = {
  currentMode: 'normal',
  tokenBudget: {
    perMinute: 7000,
    windowMs: 60000,
    currentUsed: 0,
    windowStart: Date.now()
  }
};

export function setMode(mode) {
  config.currentMode = mode === 'coding' ? 'coding' : 'normal';
  log('Mode:', config.currentMode);
}

// ==================== LOGGING ====================
export function log(...a) { console.log('[Agent]', ...a); }
export function logError(...a) { console.error('[Agent ERROR]', ...a); }
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ==================== UI ====================
export function broadcastToUI(data) {
  chrome.runtime.sendMessage({ target: 'sidebar', ...data }).catch(() => {});
}

export function sendReasoning(level, label, message) {
  broadcastToUI({ type: 'REASONING', level, label, message });
}

// ==================== UTILS ====================
export function isScriptableUrl(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://');
}

export function safeJSONParse(text) {
  if (!text) return null;
  try {
    let cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    const first = cleaned.search(/[\[{]/);
    const last = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
    if (first !== -1 && last !== -1) cleaned = cleaned.slice(first, last + 1);
    return JSON.parse(cleaned);
  } catch (e) {
    logError('JSON parse failed:', e.message);
    return null;
  }
}

export function extractUrlFromTask(task) {
  if (!task) return null;
  const m = task.match(/(https?:\/\/[^\s]+)/gi);
  return m ? m[0].replace(/[.,;!?)\]]+$/, '') : null;
}

export function normalizeUrl(url) {
  if (!url) return '';
  try { const u = new URL(url); return (u.origin + u.pathname).replace(/\/$/, ''); }
  catch { return url; }
}

// ==================== TOKEN BUDGET ====================
export function estimateTokens(text) {
  return Math.ceil((text?.length || 0) / 4);
}

function resetTokenWindow() {
  const now = Date.now();
  if (now - config.tokenBudget.windowStart > config.tokenBudget.windowMs) {
    config.tokenBudget.currentUsed = 0;
    config.tokenBudget.windowStart = now;
  }
}

export async function waitForTokenBudget(estimated) {
  resetTokenWindow();
  while (config.tokenBudget.currentUsed + estimated > config.tokenBudget.perMinute) {
    const elapsed = Date.now() - config.tokenBudget.windowStart;
    const waitMs = Math.max(2000, config.tokenBudget.windowMs - elapsed + 500);
    log(`⏳ Rate limit wait ${Math.round(waitMs/1000)}s`);
    broadcastToUI({ type: 'STATUS', message: `⏳ Rate limit — ${Math.round(waitMs/1000)}s` });
    await sleep(waitMs);
    resetTokenWindow();
  }
  config.tokenBudget.currentUsed += estimated;
}

// ==================== KEEPALIVE ====================
let keepaliveInterval = null;
export function startKeepalive() {
  stopKeepalive();
  keepaliveInterval = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
}
export function stopKeepalive() {
  if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }
}