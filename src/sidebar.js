const taskInput = document.getElementById('task-input');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusEl = document.getElementById('status');
const planEl = document.getElementById('plan');

startBtn.addEventListener('click', () => {
  const task = taskInput.value.trim();
  if (!task) return;
  statusEl.textContent = 'Starting...';
  chrome.runtime.sendMessage({ type: 'START_TASK', task });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_TASK' });
  statusEl.textContent = 'Stopped';
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'sidebar') return;

  if (msg.type === 'STATUS') {
    statusEl.textContent = msg.message;
  }
  if (msg.type === 'PLAN') {
    planEl.innerHTML = msg.plan.map((s, i) =>
      `<div class="step" id="step-${i}">${i + 1}. ${s.action} → ${s.target}</div>`
    ).join('');
  }
  if (msg.type === 'STEP') {
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    const el = document.getElementById(`step-${msg.index}`);
    if (el) el.classList.add('active');
  }
  if (msg.type === 'COMPLETE') {
  statusEl.textContent = `✅ ${msg.reason}`;
  statusEl.style.background = '#1b5e20';
}
});