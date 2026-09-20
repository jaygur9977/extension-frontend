import { log, logError, sleep } from './helpers.js';

const attached = new Map();

export async function ensureDebugger(tabId) {
  if (attached.get(tabId)) return true;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    attached.set(tabId, true);
    log('Debugger attached:', tabId);
    return true;
  } catch (e) {
    if (e.message?.includes('Another debugger') || e.message?.includes('Already attached')) {
      attached.set(tabId, true);
      return true;
    }
    logError('Debugger attach failed:', e.message);
    return false;
  }
}

export async function detachDebugger(tabId) {
  if (!attached.get(tabId)) return;
  try { await chrome.debugger.detach({ tabId }); } catch (e) {}
  attached.delete(tabId);
}

// ==================== REAL KEY PRESS ====================
export async function realKeyPress(tabId, keyName, modifiers = []) {
  if (!(await ensureDebugger(tabId))) return false;

  const keyMap = {
    'Enter': { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
    'Tab':   { key: 'Tab', code: 'Tab', vk: 9 },
    'Escape':{ key: 'Escape', code: 'Escape', vk: 27 },
    'Backspace': { key: 'Backspace', code: 'Backspace', vk: 8 },
    'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
    'ArrowUp':   { key: 'ArrowUp', code: 'ArrowUp', vk: 38 }
  };
  const info = keyMap[keyName] || keyMap['Enter'];

  const modBits = (modifiers.includes('alt') ? 1 : 0) |
                  (modifiers.includes('ctrl') ? 2 : 0) |
                  (modifiers.includes('meta') ? 4 : 0) |
                  (modifiers.includes('shift') ? 8 : 0);

  try {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: info.text ? 'keyDown' : 'rawKeyDown',
      modifiers: modBits,
      key: info.key, code: info.code,
      windowsVirtualKeyCode: info.vk, nativeVirtualKeyCode: info.vk,
      text: info.text || '', unmodifiedText: info.text || ''
    });
    await sleep(30);
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyUp', modifiers: modBits,
      key: info.key, code: info.code,
      windowsVirtualKeyCode: info.vk, nativeVirtualKeyCode: info.vk
    });
    log('✅ CDP key:', keyName);
    return true;
  } catch (e) {
    logError('CDP key failed:', e.message);
    return false;
  }
}

// ==================== REAL MOUSE CLICK (YouTube fix) ====================
export async function realClick(tabId, selector) {
  if (!(await ensureDebugger(tabId))) return false;

  // Scroll into view + find innermost clickable (YouTube anchor)
  const r = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });

      // YouTube: click the inner anchor, not the wrapper
      let target = el;
      const tag = el.tagName.toLowerCase();
      if (tag.startsWith('ytd-')) {
        const innerAnchor = el.querySelector('a[href*="/watch"], a#video-title, a[href]');
        if (innerAnchor) target = innerAnchor;
      }

      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;

      // Click on the thumbnail area (left-middle) — safer for YouTube
      const clickX = rect.left + Math.min(rect.width * 0.15, 150);
      const clickY = rect.top + Math.min(rect.height * 0.3, 80);

      return {
        x: Math.round(clickX),
        y: Math.round(clickY),
        tag: target.tagName
      };
    },
    args: [selector]
  });

  const coords = r[0]?.result;
  if (!coords) {
    log('CDP click: element not visible');
    return false;
  }

  try {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: coords.x, y: coords.y, button: 'none'
    });
    await sleep(80);
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', clickCount: 1
    });
    await sleep(60);
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', clickCount: 1
    });
    log('✅ CDP click at', coords.x, coords.y, 'on', coords.tag);
    return true;
  } catch (e) {
    logError('CDP click failed:', e.message);
    return false;
  }
}