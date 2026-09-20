import { log, logError, sleep } from './helpers.js';
import { realClick, realKeyPress } from './cdp.js';
import { explorerAPI } from './explorer-api.js';


export async function findAndExecute(tabId, frameId, selectors, fn, args = []) {
  for (const sel of selectors) {
    try {
      const r = await chrome.scripting.executeScript({
        target: frameId != null ? { tabId, frameIds: [frameId] } : { tabId },
        func: fn, args: [sel, ...args]
      });
      const res = r[0]?.result;
      if (res?.success) return { success: true, selector: sel, result: res };
      if (res?.reason) log(`Selector "${sel}":`, res.reason);
    } catch (e) { log('Selector failed:', sel, e.message); }
  }
  return { success: false };
}

export async function findAndExecuteSingle(tabId, selectors, fn, args = []) {
  return await findAndExecute(tabId, null, selectors, fn, args);
}

// === CLICK ===
function clickExecutor(selector) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, reason: 'not found' };
  if (el.disabled) return { success: false, reason: 'element is disabled' };

  try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) {}

  const s = window.getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden') {
    el.style.display = 'block';
    el.style.visibility = 'visible';
    el.style.opacity = '1';
  }

  let target = el;
  const innerAnchor = el.querySelector('a[href]');
  if (innerAnchor && el.tagName.toLowerCase().startsWith('ytd-')) target = innerAnchor;
  else {
    const innerBtn = el.querySelector('button, [role="button"], [role="link"]');
    if (innerBtn) target = innerBtn;
  }

  try { target.click(); } catch (e) {}
  try {
    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => {
      target.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
    });
  } catch (e) {}

  if (target.tagName === 'A' && target.href) {
    try { window.location.href = target.href; } catch (e) {}
  }
  return { success: true, tag: el.tagName };
}

// === TYPE ===
function typeExecutor(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, reason: 'not found' };
  if (el.disabled) return { success: false, reason: 'element is disabled' };

  try { el.scrollIntoView({ block: 'center' }); el.focus(); } catch (e) {}

  if (el.getAttribute('contenteditable') === 'true') {
    el.innerText = value;
    ['input','change','blur'].forEach(e => {
      try { el.dispatchEvent(new Event(e, { bubbles: true })); } catch (x) {}
    });
    return { success: true, filledValue: value };
  }

  if (el.tagName === 'SELECT') {
    for (const opt of el.options) {
      if (opt.value === value || opt.text.toLowerCase() === value.toLowerCase()) {
        el.value = opt.value; break;
      }
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  }

  try {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
  } catch (e) { el.value = value; }

  ['input','change','blur'].forEach(e => {
    try { el.dispatchEvent(new Event(e, { bubbles: true })); } catch (x) {}
  });
  return { success: true, filledValue: el.value };
}

// === SEARCH ===
function searchTypeExecutor(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, reason: 'not found' };

  try { el.scrollIntoView({ block: 'center' }); el.focus(); } catch (e) {}

  try {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
  } catch (e) { el.value = value; }

  ['input','change'].forEach(evt => {
    try { el.dispatchEvent(new Event(evt, { bubbles: true })); } catch (e) {}
  });
  return { success: true, filledValue: el.value };
}

export async function searchExecutor(tabId, selector, value) {
  const typeRes = await findAndExecuteSingle(tabId, [selector], searchTypeExecutor, [value]);
  if (!typeRes.success) return { success: false, reason: 'type failed' };

  await sleep(300);
  const cdpOk = await realKeyPress(tabId, 'Enter');
  if (cdpOk) {
    await sleep(1500);
    return { success: true, method: 'cdp-enter' };
  }

  // Fallback: click submit button
  const btnClick = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const input = document.querySelector(sel);
      if (!input) return { success: false };
      let btn = null;
      if (input.form) btn = input.form.querySelector('button[type="submit"], input[type="submit"], button[aria-label*="Search" i]');
      if (!btn) {
        let p = input.parentElement;
        for (let i = 0; i < 6 && p && !btn; i++) {
          btn = p.querySelector('button[type="submit"], input[type="submit"], button[aria-label*="Search" i]');
          p = p.parentElement;
        }
      }
      if (!btn) return { success: false };
      btn.click();
      return { success: true };
    },
    args: [selector]
  });
  if (btnClick[0]?.result?.success) {
    await sleep(1500);
    return { success: true, method: 'button-click' };
  }

  return { success: false, reason: 'all submit methods failed' };
}

// === HOVER / PRESS / WAIT ===
function hoverExecutor(selector) {
  const el = document.querySelector(selector);
  if (!el) return { success: false };
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  ['mouseenter','mouseover','mousemove','pointerenter'].forEach(t => {
    try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
  });
  return { success: true };
}

function pressExecutor(selector, key) {
  const el = selector ? document.querySelector(selector) : document.activeElement;
  if (!el) return { success: false };
  try { el.focus(); } catch (e) {}
  const k = key || 'Enter';
  const code = k === 'Enter' ? 13 : 0;
  const init = { key: k, code: k, keyCode: code, which: code, bubbles: true, cancelable: true };
  ['keydown','keypress','keyup'].forEach(t => {
    try { el.dispatchEvent(new KeyboardEvent(t, init)); } catch (e) {}
  });
  if (k === 'Enter' && el.form) {
    try {
      if (el.form.requestSubmit) el.form.requestSubmit();
      else el.form.dispatchEvent(new Event('submit', { bubbles: true }));
    } catch (e) {}
  }
  return { success: true };
}

function waitForSelectorExecutor(selector, timeoutStr) {
  const timeout = parseInt(timeoutStr) || 5000;
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (document.querySelector(selector)) return resolve({ success: true });
      if (Date.now() - start > timeout) return resolve({ success: false, reason: 'timeout' });
      setTimeout(check, 200);
    };
    check();
  });
}

// === ROUTER ===
export async function executeAction(tabId, frameId, action) {

   if (!action?.action) return { success: false };

  // ==================== CODING ACTIONS ====================
  if (action.action === 'codingGetState') {
    const r = await explorerAPI('getState');
    return r;
  }

  if (action.action === 'codingListFiles') {
    return await explorerAPI('listFiles', action.value || '');
  }

  if (action.action === 'codingCreateFile') {
    return await explorerAPI('createFile', action.value, action.folder || '');
  }

  if (action.action === 'codingCreateFolder') {
    return await explorerAPI('createFolder', action.value, action.folder || '');
  }

  if (action.action === 'codingWriteFile') {
    return await explorerAPI('writeFile', action.path || action.target, action.value);
  }

  if (action.action === 'codingReadFile') {
    return await explorerAPI('readFile', action.path || action.target);
  }

  if (action.action === 'codingOpenFile') {
    return await explorerAPI('openFile', action.path || action.target);
  }

  if (action.action === 'codingCreateAndWrite') {
    return await explorerAPI(
      'createAndWrite',
      action.value,   // filename
      action.content, // content
      action.folder || ''
    );
  }

  if (action.action === 'codingSave') {
    return await explorerAPI('saveActive');
  }

const sels = action.selectors || (action.selector ? [action.selector] : []);


  if (action.action === 'navigate') {
    const url = action.target || action.value;
    if (!url) return { success: false };
    await chrome.tabs.update(tabId, { url });
    return { success: true };
  }
  if (action.action === 'scroll') {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (d) => window.scrollBy({ top: d === 'up' ? -500 : 500, behavior: 'smooth' }),
      args: [action.value || 'down']
    });
    await sleep(500);
    return { success: true };
  }
  if (action.action === 'wait') {
    await sleep(Math.min(parseInt(action.value) || 2000, 10000));
    return { success: true };
  }
  if (action.action === 'newTab') {
    await chrome.tabs.create({ url: action.target || 'about:blank', active: false });
    return { success: true };
  }
  if (sels.length === 0) return { success: false, reason: 'no selectors' };

  if (action.action === 'click') {
    // ⚡ Try CDP real click first (YouTube, complex sites)
    const cdpOk = await realClick(tabId, sels[0]);
    if (cdpOk) {
      await sleep(800);
      return { success: true, method: 'cdp-click' };
    }
    // Fallback: DOM synthetic click
    return await findAndExecute(tabId, frameId, sels, clickExecutor);
  }

  if (action.action === 'type') return await findAndExecute(tabId, frameId, sels, typeExecutor, [action.value || '']);
  if (action.action === 'search') return await searchExecutor(tabId, sels[0], action.value || '');
  if (action.action === 'hover') return await findAndExecute(tabId, frameId, sels, hoverExecutor);
  if (action.action === 'press') return await findAndExecute(tabId, frameId, sels, pressExecutor, [action.value || 'Enter']);
  if (action.action === 'waitFor') return await findAndExecute(tabId, frameId, sels, waitForSelectorExecutor, [action.value || '5000']);
  if (action.action === 'extract') {
    const r = await chrome.scripting.executeScript({
      target: { tabId },
      func: (s) => { const el = document.querySelector(s); return { success: !!el, text: el?.innerText || '' }; },
      args: [sels[0]]
    });
    return { success: r[0]?.result?.success, text: r[0]?.result?.text };
  }
  return { success: false, reason: 'unknown action' };
}