import { log, logError, isScriptableUrl } from './helpers.js';

export async function getPageState(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!isScriptableUrl(tab.url)) throw new Error(`Cannot access ${tab.url}`);

  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: extractPageStateInFrame
  });

  const frames = results.filter(r => r.result).map(r => ({ frameId: r.frameId, ...r.result }));
  const mainFrame = frames.find(f => f.url === tab.url) || frames[0];

  const allElements = frames.flatMap(f => (f.elements || []).map(el => ({ ...el, frameId: f.frameId })));
  const allFormFields = frames.flatMap(f => (f.formFields || []).map(el => ({ ...el, frameId: f.frameId })));
  const allHeadings = frames.flatMap(f => (f.headings || []));

  // ⚡ PRIORITIZE clickable-cards, links, buttons — put them FIRST
  const priority = { 'clickable-card': 0, 'clickable': 1, 'button': 2, 'link': 3, 'tab': 4, 'menu-item': 5, 'form-field': 6, 'interactive': 7 };
  const sortedElements = allElements
    .filter(e => e.isVisible && !e.disabled)
    .sort((a, b) => (priority[a.category] ?? 99) - (priority[b.category] ?? 99));

  return {
    url: tab.url,
    title: mainFrame?.title || '',
    textPreview: mainFrame?.textPreview || '',
    headings: allHeadings.slice(0, 10),
    formFields: allFormFields,
    visibleElements: sortedElements.slice(0, 150),
    hiddenElements: allElements.filter(e => !e.isVisible).slice(0, 30),
    disabledElements: allElements.filter(e => e.disabled).slice(0, 20),
    timestamp: Date.now()
  };
}

function extractPageStateInFrame() {
  const elements = [];
  const formFields = [];
  const headings = [];
  const seen = new WeakSet();

  function tagWithAgentId(el) {
    if (!el.hasAttribute('data-agent-id')) {
      el.setAttribute('data-agent-id', `ag-${Math.random().toString(36).slice(2, 9)}`);
    }
    return el.getAttribute('data-agent-id');
  }

  function findLabel(el) {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const parts = lb.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean)
        .map(n => (n.innerText || n.textContent || '').trim()).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    const al = el.getAttribute('aria-label'); if (al) return al.trim();
    const ph = el.getAttribute('placeholder'); if (ph) return ph.trim();
    if (el.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) { const t = (lbl.innerText || '').trim(); if (t) return t; }
      } catch (e) {}
    }
    const wrap = el.closest('label');
    if (wrap) {
      const clone = wrap.cloneNode(true);
      clone.querySelectorAll('input, textarea, select').forEach(n => n.remove());
      const t = (clone.innerText || '').trim(); if (t) return t;
    }
    let cur = el.parentElement;
    for (let d = 0; d < 8 && cur; d++) {
      const kids = Array.from(cur.children);
      const txt = kids.filter(c => {
        if (c.contains(el)) return false;
        if (['INPUT','TEXTAREA','SELECT'].includes(c.tagName)) return false;
        if (c.querySelector('input, textarea, select')) return false;
        const t = (c.innerText || '').trim();
        return t && t.length > 0 && t.length < 200;
      });
      if (txt.length) {
        const l = (txt[0].innerText || '').trim();
        if (l && !/^(required|\*|optional)$/i.test(l)) return l;
      }
      let sib = cur.previousElementSibling;
      while (sib) {
        if (!sib.querySelector('input, textarea, select')) {
          const t = (sib.innerText || '').trim();
          if (t && t.length < 200 && !/^(required|\*)$/i.test(t)) return t;
        }
        sib = sib.previousElementSibling;
      }
      cur = cur.parentElement;
    }
    return el.name || el.id || '';
  }

  function isVisible(el) {
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    if (parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return !(r.width === 0 && r.height === 0);
  }

  function categorize(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    if (['input','textarea','select'].includes(tag)) return 'form-field';
    if (['textbox','combobox','listbox','checkbox','radio','switch'].includes(role)) return 'form-field';
    if (tag === 'button' || role === 'button') return 'button';
    if (tag === 'a' && el.href) return 'link';
    if (role === 'tab') return 'tab';
    if (role === 'menuitem') return 'menu-item';
    if (el.hasAttribute('aria-expanded')) return 'expandable';
    if (tag === 'ytd-video-renderer' || tag === 'ytd-rich-item-renderer') return 'clickable-card';
    if (tag.includes('-') && tag.startsWith('ytd-')) return 'clickable';
    if (tag === 'article') return 'clickable-card';
    if (el.getAttribute('role')) return 'interactive';
    return 'interactive';
  }

  function getSelectors(el, agentId) {
    const sels = [`[data-agent-id="${agentId}"]`];
    const tag = el.tagName.toLowerCase();
    if (el.name) sels.push(`${tag}[name="${CSS.escape(el.name)}"]`);
    const al = el.getAttribute('aria-label');
    if (al && !/^(your\s*answer|answer|input|text|search)$/i.test(al)) {
      sels.push(`[aria-label="${CSS.escape(al)}"]`);
    }
    if (el.id && !/^[0-9]/.test(el.id)) sels.push(`#${CSS.escape(el.id)}`);
    return [...new Set(sels)];
  }

  function isFormField(el) {
    const tag = el.tagName.toLowerCase();
    if (['input','textarea','select'].includes(tag)) return true;
    const role = el.getAttribute('role');
    return ['textbox','combobox','listbox','checkbox','radio','switch'].includes(role);
  }

  function getFieldType(el) {
    const t = el.tagName.toLowerCase();
    if (t === 'textarea') return 'textarea';
    if (t === 'select') return 'select';
    if (t === 'input') return el.type || 'text';
    return el.getAttribute('role') || 'unknown';
  }

  function visit(root) {
    if (!root?.querySelectorAll) return;
    let nodes;
    try {
      nodes = root.querySelectorAll([
        'input', 'textarea', 'select', 'button', 'a[href]',
        '[role]', '[contenteditable="true"]',
        '[aria-expanded]', '[aria-haspopup]',
        '[onclick]', '[tabindex]:not([tabindex="-1"])',
        'summary',
        'ytd-video-renderer', 'ytd-compact-video-renderer',
        'ytd-playlist-renderer', 'ytd-channel-renderer',
        'ytd-rich-item-renderer',
        'article', '[data-testid]', '[data-clickable]'
      ].join(','));
    } catch (e) { return; }

    nodes.forEach(el => {
      if (seen.has(el)) return;
      seen.add(el);
      const tag = el.tagName.toLowerCase();
      if (['script','style','meta','head','link'].includes(tag)) return;
      if (el.type === 'hidden') return;

      const agentId = tagWithAgentId(el);
      const rect = el.getBoundingClientRect();
      const visible = isVisible(el);
      const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
      const label = findLabel(el);
      const selectors = getSelectors(el, agentId);

      elements.push({
        tag: el.tagName,
        type: el.type || '',
        role: el.getAttribute('role') || '',
        category: categorize(el),
        label,
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.placeholder || '',
        text: (el.innerText || el.value || '').slice(0, 80).trim(),
        href: el.href || '',
        isVisible: visible,
        disabled,  // ← CRITICAL
        ariaExpanded: el.getAttribute('aria-expanded'),
        agentId,
        selectors
      });

      if (isFormField(el)) {
        formFields.push({
          label: label || `(unlabeled ${tag})`,
          fieldType: getFieldType(el),
          required: el.required || el.getAttribute('aria-required') === 'true',
          currentValue: el.value || '',
          isVisible: visible,
          disabled,
          agentId,
          selectors
        });
      }

      if (el.shadowRoot) visit(el.shadowRoot);
    });
  }

  visit(document);
  document.querySelectorAll('h1, h2, h3, [role="heading"]').forEach(h => {
    const t = (h.innerText || '').trim();
    if (t && t.length < 200) headings.push({ level: h.tagName, text: t });
  });

  let textPreview = '';
  try {
    const main = document.querySelector('main, [role="main"], article') || document.body;
    textPreview = (main.innerText || '').replace(/\s+/g, ' ').slice(0, 400);
  } catch (e) {}

  return {
    url: location.href,
    title: document.title,
    textPreview,
    headings: headings.slice(0, 10),
    elements: elements.slice(0, 200),
    formFields: formFields.slice(0, 60)
  };
}

export async function waitForPageReady(tabId, minFields = 1, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const state = await getPageState(tabId);
      if (state.formFields.length >= minFields || state.visibleElements.length > 5) return state;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 800));
  }
  try { return await getPageState(tabId); } catch { return null; }
}

export function waitForTabLoad(tabId, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let done = false;
    const l = (id, info) => {
      if (id === tabId && info.status === 'complete' && !done) {
        done = true; chrome.tabs.onUpdated.removeListener(l); resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(l);
    setTimeout(() => {
      if (!done) { done = true; chrome.tabs.onUpdated.removeListener(l); resolve(); }
    }, timeoutMs);
  });
}