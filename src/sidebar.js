const taskInput = document.getElementById('task-input');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusEl = document.getElementById('status');
const planEl = document.getElementById('plan');
const explorerToggle = document.getElementById('explorerToggle');
const explorerHint = document.getElementById('explorerHint');
const modeIndicator = document.getElementById('modeIndicator');

const EXPLORER_URL = 'http://localhost:3030';
const CODING_SERVER = 'http://localhost:3031';

let explorerReady = false;

// ==================== REASONING PANEL STATE ====================
const reasoningPanel = document.getElementById('reasoningPanel');
const reasoningBody = document.getElementById('reasoningBody');
const reasoningClear = document.getElementById('reasoningClear');

let reasoningEntries = [];

function formatTime() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function addReasoning(type, label, message) {
  const entry = { type, label, message, time: formatTime() };
  reasoningEntries.push(entry);
  if (reasoningEntries.length > 50) reasoningEntries = reasoningEntries.slice(-50);
  renderReasoning();
}

function renderReasoning() {
  if (!reasoningBody) return;
  if (reasoningEntries.length === 0) {
    reasoningBody.innerHTML = '<div class="reasoning-empty">Waiting for task...</div>';
    return;
  }
  reasoningBody.innerHTML = reasoningEntries.map(e => `
    <div class="reasoning-entry ${e.type}">
      <span class="timestamp">${e.time}</span>
      <span class="label">${e.label}</span>
      <span class="msg">${escapeHtml(e.message)}</span>
    </div>
  `).join('');
  reasoningBody.scrollTop = reasoningBody.scrollHeight;
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateReasoningVisibility() {
  if (!reasoningPanel) return;
  reasoningPanel.style.display = explorerToggle.checked ? 'flex' : 'none';
}

if (reasoningClear) {
  reasoningClear.addEventListener('click', () => {
    reasoningEntries = [];
    renderReasoning();
  });
}

// ==================== AGENT CONTROLS ====================
startBtn.addEventListener('click', () => {
  const task = taskInput.value.trim();
  if (!task) return;

  const mode = explorerToggle.checked ? 'coding' : 'normal';
  statusEl.style.background = '#16213e';
  statusEl.textContent = mode === 'coding' ? 'Starting (coding mode)...' : 'Starting...';
  planEl.innerHTML = '';

  chrome.runtime.sendMessage({ type: 'START_TASK', task, mode });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_TASK' });
  statusEl.textContent = 'Stopped';
  statusEl.style.background = '#16213e';
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'sidebar') return;

  if (msg.type === 'STATUS') {
    statusEl.textContent = msg.message;
  }

  if (msg.type === 'PLAN') {
    planEl.innerHTML = msg.plan.map((s, i) => {
      const target = s.target || s.selector || s.value || '';
      const safe = typeof target === 'string' ? target : '';
      return `<div class="step" id="step-${i}">${i + 1}. ${s.action}${safe ? ' -> ' + safe : ''}</div>`;
    }).join('');
  }

  if (msg.type === 'STEP') {
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    const el = document.getElementById(`step-${msg.index}`);
    if (el) el.classList.add('active');
  }

  if (msg.type === 'COMPLETE') {
    const reason = msg.reason || '';
    const isError = reason.includes('Error') || reason.includes('failed') || reason.startsWith('X ');
    statusEl.textContent = reason;
    statusEl.style.background = isError ? '#5e1b1b' : '#1b5e20';
  }
});

// ==================== SERVER CHECKS ====================
async function checkExplorerServer() {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 2000);
    const res = await fetch(EXPLORER_URL + '/health', { signal: c.signal });
    clearTimeout(t);
    if (res.ok) {
      explorerReady = true;
      explorerToggle.disabled = false;
      explorerHint.textContent = 'Server ready (port 3030)';
      explorerHint.className = 'explorer-hint ready';
      return true;
    }
  } catch (e) {}

  explorerReady = false;
  explorerToggle.disabled = true;
  explorerHint.textContent = 'Start explorer/server.vscode.js first';
  explorerHint.className = 'explorer-hint warn';
  return false;
}

async function checkCodingServer() {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 2000);
    const res = await fetch(CODING_SERVER + '/health', { signal: c.signal });
    clearTimeout(t);
    return res.ok;
  } catch (e) { return false; }
}

// ==================== TOGGLE HANDLER ====================
explorerToggle.addEventListener('change', async (e) => {
  if (e.target.checked) {
    // ON → open explorer + switch to coding mode
    if (!explorerReady) {
      const ok = await checkExplorerServer();
      if (!ok) {
        alert(
          'Code Explorer server is not running.\n\n' +
          'Start it with:\n' +
          '  cd agent-server/explorer\n' +
          '  node server.vscode.js\n\n' +
          'Then toggle again.'
        );
        e.target.checked = false;
        return;
      }
    }

    const codingOk = await checkCodingServer();
    if (!codingOk) {
      alert(
        'Coding server (port 3031) is not running.\n\n' +
        'Start it with:\n' +
        '  cd agent-server\n' +
        '  node server.coding.js\n\n' +
        'Then toggle again.'
      );
      e.target.checked = false;
      return;
    }

    try {
      await chrome.tabs.create({ url: EXPLORER_URL, active: true });
      explorerHint.textContent = 'Opened - coding mode active';
      explorerHint.className = 'explorer-hint search';

      modeIndicator.textContent = 'Mode: Coding Agent (port 3031)';
      modeIndicator.className = 'mode-indicator coding';

      chrome.runtime.sendMessage({ type: 'SET_MODE', mode: 'coding' });

      // ✅ ADD: Show reasoning panel
      updateReasoningVisibility();

    } catch (err) {
      alert('Error opening explorer: ' + err.message);
      e.target.checked = false;
    }
  } else {
    // OFF → back to normal agent
    explorerHint.textContent = 'Server ready (port 3030)';
    explorerHint.className = 'explorer-hint ready';
    modeIndicator.textContent = 'Mode: Normal Agent (port 3000)';
    modeIndicator.className = 'mode-indicator agent';
    chrome.runtime.sendMessage({ type: 'SET_MODE', mode: 'normal' });

    // ✅ ADD: Hide reasoning panel
    if (reasoningPanel) reasoningPanel.style.display = 'none';
  }
});

// ==================== INIT ====================
(async () => {
  await checkExplorerServer();
  setInterval(checkExplorerServer, 10000);
})();





// Hook into toggle
const origToggleHandler = explorerToggle.onchange;
// Reuse via addEventListener (already added) — we'll hook message listener instead

// Watch for REASONING messages from background
const originalMessageHandler = chrome.runtime.onMessage.addListener;

// Add reasoning listener (alongside existing)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'sidebar') return;

  if (msg.type === 'REASONING') {
    addReasoning(msg.level || 'info', msg.label || 'INFO', msg.message || '');
  }

  if (msg.type === 'MODE_CHANGED') {
    updateReasoningVisibility();
  }
});

// Initialize visibility
updateReasoningVisibility();