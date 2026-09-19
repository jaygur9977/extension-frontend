


// /// with form with all 



// // ==================== STATE ====================
// let agentState = {
//   task: '',
//   plan: [],
//   currentStep: 0,
//   isRunning: false,
//   history: []
// };

// // ==================== HELPERS ====================
// function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
// function log(...a) { console.log('[Agent]', ...a); }
// function logError(...a) { console.error('[Agent ERROR]', ...a); }

// function isScriptableUrl(url) {
//   if (!url) return false;
//   return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://');
// }

// function broadcastToUI(data) {
//   chrome.runtime.sendMessage({ target: 'sidebar', ...data }).catch(() => {});
// }

// function safeJSONParse(text) {
//   if (!text) return null;
//   try {
//     let cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
//     const first = cleaned.search(/[\[{]/);
//     const last = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
//     if (first !== -1 && last !== -1) cleaned = cleaned.slice(first, last + 1);
//     return JSON.parse(cleaned);
//   } catch (e) {
//     logError('JSON parse failed:', e.message);
//     return null;
//   }
// }

// function extractUrlFromTask(task) {
//   if (!task) return null;
//   const matches = task.match(/(https?:\/\/[^\s]+)/gi);
//   if (!matches) return null;
//   return matches[0].replace(/[.,;!?)\]]+$/, '');
// }

// function normalizeUrl(url) {
//   if (!url) return '';
//   try {
//     const u = new URL(url);
//     return (u.origin + u.pathname).replace(/\/$/, '');
//   } catch { return url; }
// }

// function waitForTabLoad(tabId, timeoutMs = 15000) {
//   return new Promise((resolve) => {
//     let done = false;
//     const listener = (id, info) => {
//       if (id === tabId && info.status === 'complete' && !done) {
//         done = true;
//         chrome.tabs.onUpdated.removeListener(listener);
//         resolve();
//       }
//     };
//     chrome.tabs.onUpdated.addListener(listener);
//     setTimeout(() => {
//       if (!done) {
//         done = true;
//         chrome.tabs.onUpdated.removeListener(listener);
//         resolve();
//       }
//     }, timeoutMs);
//   });
// }

// async function waitForPageReady(tabId, minFields = 1, timeoutMs = 8000) {
//   const start = Date.now();
//   while (Date.now() - start < timeoutMs) {
//     try {
//       const state = await getPageState(tabId);
//       if (state.formFields.length >= minFields || state.visibleElements.length > 5) return state;
//     } catch (e) {}
//     await sleep(800);
//   }
//   try { return await getPageState(tabId); } catch { return null; }
// }

// // ==================== KEEPALIVE ====================
// let keepaliveInterval = null;
// function startKeepalive() {
//   stopKeepalive();
//   keepaliveInterval = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
// }
// function stopKeepalive() {
//   if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }
// }

// // ==================== OFFSCREEN ====================
// async function ensureOffscreen() {
//   try {
//     const exists = await chrome.offscreen.hasDocument();
//     if (!exists) {
//       await chrome.offscreen.createDocument({
//         url: 'src/offscreen.html',
//         reasons: ['DOM_SCRAPING'],
//         justification: 'Local vision model'
//       });
//     }
//   } catch (e) { logError('Offscreen:', e.message); }
// }

// // ==================== SERVER LLM ====================
// async function callServerLLM(prompt, image = null, retries = 2) {
//   const body = { prompt };
//   if (image) body.image = image;

//   let lastErr = null;
//   for (let attempt = 1; attempt <= retries; attempt++) {
//     try {
//       const controller = new AbortController();
//       const timeoutId = setTimeout(() => controller.abort(), 90000);

//       const res = await fetch('http://localhost:3000/api/reason', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify(body),
//         signal: controller.signal
//       });
//       clearTimeout(timeoutId);

//       if (!res.ok) {
//         const err = await res.text();
//         throw new Error(`HTTP ${res.status}: ${err}`);
//       }

//       const data = await res.json();
//       return data.response;
//     } catch (e) {
//       lastErr = e;
//       logError(`Server attempt ${attempt}/${retries} failed:`, e.message);
//       if (attempt < retries) await sleep(2000 * attempt);
//     }
//   }
//   throw lastErr;
// }

// // ==================== PAGE STATE ====================
// async function getPageState(tabId) {
//   const tab = await chrome.tabs.get(tabId);
//   if (!isScriptableUrl(tab.url)) throw new Error(`Cannot access ${tab.url}`);

//   const results = await chrome.scripting.executeScript({
//     target: { tabId, allFrames: true },
//     func: extractPageStateInFrame
//   });

//   const frames = results.filter(r => r.result).map(r => ({ frameId: r.frameId, ...r.result }));
//   const mainFrame = frames.find(f => f.url === tab.url) || frames[0];

//   const allElements = frames.flatMap(f => (f.elements || []).map(el => ({ ...el, frameId: f.frameId })));
//   const allFormFields = frames.flatMap(f => (f.formFields || []).map(el => ({ ...el, frameId: f.frameId })));
//   const allHeadings = frames.flatMap(f => (f.headings || []));

//   log(`Extracted ${allElements.length} elements, ${allFormFields.length} form fields, ${allHeadings.length} headings`);

//   return {
//     url: tab.url,
//     title: mainFrame?.title || '',
//     textPreview: mainFrame?.textPreview || '',
//     headings: allHeadings.slice(0, 20),
//     formFields: allFormFields,
//     visibleElements: allElements.filter(e => e.isVisible && !e.disabled).slice(0, 100),
//     hiddenElements: allElements.filter(e => !e.isVisible && !e.disabled).slice(0, 40),
//     timestamp: Date.now()
//   };
// }

// // ==================== EXTRACTION (UNIVERSAL) ====================
// function extractPageStateInFrame() {
//   const elements = [];
//   const formFields = [];
//   const headings = [];
//   const seen = new WeakSet();

//   function tagWithAgentId(el) {
//     if (!el.hasAttribute('data-agent-id')) {
//       const id = `ag-${Math.random().toString(36).slice(2, 9)}`;
//       el.setAttribute('data-agent-id', id);
//     }
//     return el.getAttribute('data-agent-id');
//   }

//   function findLabel(el) {
//     const labelledBy = el.getAttribute('aria-labelledby');
//     if (labelledBy) {
//       const parts = labelledBy.split(/\s+/)
//         .map(id => document.getElementById(id))
//         .filter(Boolean)
//         .map(n => (n.innerText || n.textContent || '').trim())
//         .filter(Boolean);
//       if (parts.length) return parts.join(' ');
//     }

//     const ariaLabel = el.getAttribute('aria-label');
//     if (ariaLabel) return ariaLabel.trim();

//     const placeholder = el.getAttribute('placeholder');
//     if (placeholder) return placeholder.trim();

//     if (el.id) {
//       try {
//         const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
//         if (lbl) { const t = (lbl.innerText || '').trim(); if (t) return t; }
//       } catch (e) {}
//     }

//     const wrap = el.closest('label');
//     if (wrap) {
//       const clone = wrap.cloneNode(true);
//       clone.querySelectorAll('input, textarea, select').forEach(n => n.remove());
//       const t = (clone.innerText || '').trim();
//       if (t) return t;
//     }

//     // Parent walk (Google Forms, Material UI, etc.)
//     let cur = el.parentElement;
//     for (let depth = 0; depth < 8 && cur; depth++) {
//       const children = Array.from(cur.children);
//       const textNodes = children.filter(c => {
//         if (c.contains(el)) return false;
//         if (['INPUT', 'TEXTAREA', 'SELECT'].includes(c.tagName)) return false;
//         if (c.querySelector('input, textarea, select')) return false;
//         const t = (c.innerText || '').trim();
//         return t && t.length > 0 && t.length < 200;
//       });
//       if (textNodes.length) {
//         const label = (textNodes[0].innerText || '').trim();
//         if (label && !/^(required|\*|optional)$/i.test(label)) return label;
//       }
//       let sib = cur.previousElementSibling;
//       while (sib) {
//         if (!sib.querySelector('input, textarea, select')) {
//           const t = (sib.innerText || '').trim();
//           if (t && t.length < 200 && !/^(required|\*)$/i.test(t)) return t;
//         }
//         sib = sib.previousElementSibling;
//       }
//       cur = cur.parentElement;
//     }
//     return el.name || el.id || '';
//   }

//   function isVisible(el) {
//     const style = window.getComputedStyle(el);
//     if (style.display === 'none' || style.visibility === 'hidden') return false;
//     if (parseFloat(style.opacity) === 0) return false;
//     const r = el.getBoundingClientRect();
//     if (r.width === 0 && r.height === 0) return false;
//     return true;
//   }

//   function isInViewport(el) {
//     const r = el.getBoundingClientRect();
//     return r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;
//   }

//   function categorize(el) {
//     const tag = el.tagName.toLowerCase();
//     const role = el.getAttribute('role') || '';
//     if (['input','textarea','select'].includes(tag)) return 'form-field';
//     if (['textbox','combobox','listbox','checkbox','radio','switch','slider','spinbutton'].includes(role)) return 'form-field';
//     if (tag === 'button' || role === 'button') return 'button';
//     if (tag === 'a' && el.href) return 'link';
//     if (role === 'tab') return 'tab';
//     if (role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio') return 'menu-item';
//     if (role === 'option') return 'option';
//     if (tag === 'summary') return 'disclosure';
//     if (el.hasAttribute('aria-expanded')) return 'expandable';
//     if (el.hasAttribute('aria-haspopup')) return 'dropdown-trigger';
//     if (['nav','header','footer','aside','main'].includes(tag)) return 'landmark';
//     return 'interactive';
//   }

//   function getSelectors(el, agentId) {
//     const sels = [`[data-agent-id="${agentId}"]`];
//     const tag = el.tagName.toLowerCase();

//     const lb = el.getAttribute('aria-labelledby');
//     if (lb) sels.push(`${tag}[aria-labelledby="${CSS.escape(lb)}"]`);

//     const ariaLabel = el.getAttribute('aria-label');
//     if (ariaLabel && !/^(your\s*answer|answer|input|text|search)$/i.test(ariaLabel)) {
//       sels.push(`[aria-label="${CSS.escape(ariaLabel)}"]`);
//     }

//     for (const attr of ['data-testid', 'data-test', 'data-qa', 'data-cy']) {
//       const v = el.getAttribute(attr);
//       if (v) sels.push(`[${attr}="${CSS.escape(v)}"]`);
//     }

//     if (el.id && !/^[0-9]/.test(el.id)) sels.push(`#${CSS.escape(el.id)}`);
//     if (el.name) sels.push(`${tag}[name="${CSS.escape(el.name)}"]`);
//     if (el.placeholder) sels.push(`${tag}[placeholder="${CSS.escape(el.placeholder)}"]`);

//     // Text-based fallback for links/buttons
//     const txt = (el.innerText || '').trim();
//     if (txt && txt.length < 50 && (tag === 'a' || tag === 'button')) {
//       sels.push(`${tag}[data-agent-text="${CSS.escape(txt)}"]`);
//     }

//     return [...new Set(sels)];
//   }

//   function isFormField(el) {
//     const tag = el.tagName.toLowerCase();
//     if (['input', 'textarea', 'select'].includes(tag)) return true;
//     const role = el.getAttribute('role');
//     return ['textbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch'].includes(role);
//   }

//   function getFieldType(el) {
//     const tag = el.tagName.toLowerCase();
//     if (tag === 'textarea') return 'textarea';
//     if (tag === 'select') return 'select';
//     if (tag === 'input') return el.type || 'text';
//     return el.getAttribute('role') || 'unknown';
//   }

//   function visit(root) {
//     if (!root || !root.querySelectorAll) return;
//     let nodes;
//     try {
//       // Universal selector — includes hidden-relevant triggers
//       nodes = root.querySelectorAll([
//         'input', 'textarea', 'select', 'button',
//         'a[href]',
//         '[role]',
//         '[contenteditable="true"]',
//         '[onclick]',
//         '[aria-expanded]',
//         '[aria-haspopup]',
//         'summary',
//         '[tabindex]:not([tabindex="-1"])'
//       ].join(','));
//     } catch (e) { return; }

//     nodes.forEach(el => {
//       if (seen.has(el)) return;
//       seen.add(el);

//       const tag = el.tagName.toLowerCase();
//       if (['script', 'style', 'meta', 'head', 'link'].includes(tag)) return;
//       if (el.type === 'hidden') return;

//       const agentId = tagWithAgentId(el);
//       const rect = el.getBoundingClientRect();
//       const visible = isVisible(el);
//       const inViewport = isInViewport(el);
//       const label = findLabel(el);
//       const selectors = getSelectors(el, agentId);
//       const category = categorize(el);

//       const entry = {
//         tag: el.tagName,
//         type: el.type || '',
//         role: el.getAttribute('role') || '',
//         category,
//         label,
//         ariaLabel: el.getAttribute('aria-label') || '',
//         placeholder: el.placeholder || '',
//         text: (el.innerText || el.value || '').slice(0, 100).trim(),
//         href: el.href || '',
//         isVisible: visible,
//         isInViewport: inViewport,
//         ariaExpanded: el.getAttribute('aria-expanded'),
//         ariaHasPopup: el.getAttribute('aria-haspopup'),
//         agentId,
//         selectors
//       };

//       elements.push(entry);

//       if (isFormField(el)) {
//         formFields.push({
//           label: label || `(unlabeled ${tag})`,
//           fieldType: getFieldType(el),
//           required: el.required || el.getAttribute('aria-required') === 'true',
//           currentValue: el.value || '',
//           isVisible: visible,
//           isDisabled: el.disabled || false,
//           agentId,
//           selectors
//         });
//       }

//       if (el.shadowRoot) visit(el.shadowRoot);
//     });
//   }

//   visit(document);

//   // Headings (page context)
//   document.querySelectorAll('h1, h2, h3, [role="heading"]').forEach(h => {
//     const t = (h.innerText || '').trim();
//     if (t && t.length < 200) {
//       headings.push({ level: h.tagName, text: t });
//     }
//   });

//   // Text preview (main content)
//   let textPreview = '';
//   try {
//     const main = document.querySelector('main, [role="main"], article') || document.body;
//     textPreview = (main.innerText || '').replace(/\s+/g, ' ').slice(0, 600);
//   } catch (e) {}

//   return {
//     url: location.href,
//     title: document.title,
//     textPreview,
//     headings: headings.slice(0, 20),
//     elements: elements.slice(0, 250),
//     formFields: formFields.slice(0, 100)
//   };
// }

// // ==================== ACTION EXECUTION ====================
// async function findAndExecute(tabId, frameId, selectors, executorFn, args = []) {
//   for (const sel of selectors) {
//     try {
//       const results = await chrome.scripting.executeScript({
//         target: frameId != null ? { tabId, frameIds: [frameId] } : { tabId },
//         func: executorFn,
//         args: [sel, ...args]
//       });
//       const r = results[0]?.result;
//       if (r && r.success) {
//         log(`✅ Selector worked: ${sel}`);
//         return { success: true, selector: sel, result: r };
//       }
//     } catch (e) {
//       log(`Selector failed: ${sel} — ${e.message}`);
//     }
//   }
//   return { success: false };
// }

// function clickExecutor(selector) {
//   const el = document.querySelector(selector);
//   if (!el) return { success: false, reason: 'not found' };
//   try { el.scrollIntoView({ block: 'center' }); } catch (e) {}

//   const style = window.getComputedStyle(el);
//   if (style.display === 'none' || style.visibility === 'hidden' || el.offsetParent === null) {
//     el.removeAttribute('hidden');
//     el.style.display = el.style.display === 'none' ? 'block' : el.style.display;
//     el.style.visibility = 'visible';
//     el.style.opacity = '1';
//   }

//   try { el.click(); } catch (e) {}
//   ['mousedown', 'mouseup', 'click'].forEach(type => {
//     try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
//   });
//   return { success: true, tag: el.tagName };
// }

// function typeExecutor(selector, value) {
//   const el = document.querySelector(selector);
//   if (!el) return { success: false, reason: 'not found' };

//   try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
//   try { el.focus(); } catch (e) {}

//   // Handle contenteditable
//   if (el.getAttribute('contenteditable') === 'true') {
//     el.innerText = value;
//     ['input', 'change', 'blur'].forEach(evt => {
//       try { el.dispatchEvent(new Event(evt, { bubbles: true })); } catch (e) {}
//     });
//     return { success: true, tag: el.tagName, filledValue: value };
//   }

//   if (el.tagName === 'SELECT') {
//     // Try matching by text or value
//     let matched = false;
//     for (const opt of el.options) {
//       if (opt.value === value || opt.text.toLowerCase() === value.toLowerCase()) {
//         el.value = opt.value;
//         matched = true;
//         break;
//       }
//     }
//     if (!matched) el.value = value;
//     el.dispatchEvent(new Event('change', { bubbles: true }));
//     return { success: true, tag: 'SELECT' };
//   }

//   try {
//     const proto = el.tagName === 'TEXTAREA'
//       ? window.HTMLTextAreaElement.prototype
//       : window.HTMLInputElement.prototype;
//     const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
//     if (setter) setter.call(el, value);
//     else el.value = value;
//   } catch (e) { el.value = value; }

//   ['input', 'change', 'blur'].forEach(evt => {
//     try { el.dispatchEvent(new Event(evt, { bubbles: true })); } catch (e) {}
//   });

//   return { success: true, tag: el.tagName, filledValue: el.value };
// }

// function hoverExecutor(selector) {
//   const el = document.querySelector(selector);
//   if (!el) return { success: false };
//   try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
//   ['mouseenter', 'mouseover', 'mousemove', 'pointerenter', 'pointerover'].forEach(type => {
//     try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
//   });
//   return { success: true, tag: el.tagName };
// }

// function pressExecutor(selector, key) {
//   const el = selector ? document.querySelector(selector) : document.activeElement;
//   if (!el) return { success: false };
//   try { el.focus(); } catch (e) {}
//   const k = key || 'Enter';
//   ['keydown', 'keypress', 'keyup'].forEach(type => {
//     try { el.dispatchEvent(new KeyboardEvent(type, { key: k, code: k === 'Enter' ? 'Enter' : '', bubbles: true })); } catch (e) {}
//   });
//   return { success: true, key: k };
// }

// async function executeAction(tabId, frameId, action) {
//   if (!action || !action.action) return { success: false };

//   const selectors = action.selectors || (action.selector ? [action.selector] : []);

//   // NAVIGATE
//   if (action.action === 'navigate') {
//     const url = action.target || action.value;
//     if (!url) return { success: false, reason: 'no url' };
//     await chrome.tabs.update(tabId, { url });
//     await waitForTabLoad(tabId);
//     return { success: true };
//   }

//   // SCROLL
//   if (action.action === 'scroll') {
//     await chrome.scripting.executeScript({
//       target: { tabId },
//       func: (dir) => window.scrollBy({ top: dir === 'up' ? -500 : 500, behavior: 'smooth' }),
//       args: [action.value || 'down']
//     });
//     await sleep(600);
//     return { success: true };
//   }

//   // WAIT
//   if (action.action === 'wait') {
//     const ms = parseInt(action.value) || 2000;
//     await sleep(Math.min(ms, 10000));
//     return { success: true };
//   }

//   if (selectors.length === 0) return { success: false };

//   // CLICK / TYPE / HOVER / PRESS
//   if (action.action === 'click') return await findAndExecute(tabId, frameId, selectors, clickExecutor);
//   if (action.action === 'type') return await findAndExecute(tabId, frameId, selectors, typeExecutor, [action.value || '']);
//   if (action.action === 'hover') return await findAndExecute(tabId, frameId, selectors, hoverExecutor);
//   if (action.action === 'press') return await findAndExecute(tabId, frameId, selectors, pressExecutor, [action.value || 'Enter']);

//   return { success: false, reason: 'unknown action' };
// }

// // ==================== PLANNER (UNIVERSAL) ====================
// async function plannerAgent(task, pageState) {
//   const formFieldsClean = (pageState.formFields || []).slice(0, 25).map(f => ({
//     label: f.label, type: f.fieldType, required: f.required
//   }));

//   const buttonsClean = pageState.visibleElements
//     .filter(e => e.category === 'button' || e.category === 'expandable' || e.category === 'dropdown-trigger')
//     .slice(0, 20)
//     .map(e => ({ text: (e.text || e.label || '').slice(0, 50), ariaExpanded: e.ariaExpanded }));

//   const linksClean = pageState.visibleElements
//     .filter(e => e.category === 'link')
//     .slice(0, 20)
//     .map(e => ({ text: (e.text || '').slice(0, 50), href: (e.href || '').slice(0, 80) }))
//     .filter(e => e.text);

//   const menuClean = pageState.visibleElements
//     .filter(e => ['tab', 'menu-item', 'option'].includes(e.category))
//     .slice(0, 20)
//     .map(e => ({ text: (e.text || '').slice(0, 40), role: e.role }))
//     .filter(e => e.text);

//   const headingsClean = (pageState.headings || []).slice(0, 15).map(h => h.text);

//   // Detect task type
//   const taskLower = task.toLowerCase();
//   const isFormTask = taskLower.includes('fill') || taskLower.includes('form') ||
//                      taskLower.includes('submit') || taskLower.includes('register');
//   const isSearchTask = taskLower.includes('search') || taskLower.includes('find') || taskLower.includes('look for');
//   const isNavTask = taskLower.includes('go to') || taskLower.includes('open') || taskLower.includes('navigate');

//   let taskTypeHint = 'general';
//   if (isFormTask) taskTypeHint = 'FORM FILLING — use form fields';
//   else if (isSearchTask) taskTypeHint = 'SEARCH — type in search box then press Enter or click search button';
//   else if (isNavTask) taskTypeHint = 'NAVIGATION — click appropriate link/button';

//   const prompt = `You are a universal browser automation planner.

// USER TASK: ${task}

// TASK TYPE HINT: ${taskTypeHint}

// CURRENT PAGE:
// URL: ${pageState.url}
// Title: ${pageState.title}
// Text preview: ${pageState.textPreview.slice(0, 400)}

// Page headings: ${JSON.stringify(headingsClean)}

// FORM FIELDS (${formFieldsClean.length}):
// ${JSON.stringify(formFieldsClean, null, 2)}

// BUTTONS (${buttonsClean.length}):
// ${JSON.stringify(buttonsClean, null, 2)}

// LINKS (${linksClean.length}):
// ${JSON.stringify(linksClean, null, 2)}

// TABS / MENU ITEMS (${menuClean.length}):
// ${JSON.stringify(menuClean, null, 2)}

// RULES:
// 1. Page is ALREADY loaded. Plan ONLY for this page.
// 2. Match task type:
//    - FORM: use form fields. NEVER invent fields — use only the list above.
//    - SEARCH: type in the search input, then either press Enter OR click search button.
//    - NAVIGATION: click a link/button whose text matches the task.
//    - INTERACTION (open menu, expand): first add "hover" or "click" to reveal, then interact.
// 3. Hidden elements (dropdowns, submenus): first add a "hover" or "click" step on the PARENT (expandable/dropdown-trigger), then the target becomes visible in next step.
// 4. For values matching labels:
//    - "full name" → "John Doe"
//    - "email" → "john.doe@example.com"
//    - "mobile/phone" → "5551234567"
//    - "password" → "Test@12345"
//    - "address" → "123 Main Street"
//    - "search query" → use the search term from task
// 5. Do NOT split "full name" into first/last.

// AVAILABLE ACTIONS:
// - navigate: {"action":"navigate","target":"url"}
// - click:    {"action":"click","target":"description of element"}
// - type:     {"action":"type","target":"description","value":"text"}
// - hover:    {"action":"hover","target":"description"}    ← for dropdowns/menus
// - press:    {"action":"press","target":"description","value":"Enter"}  ← submit search
// - scroll:   {"action":"scroll","value":"down|up"}
// - wait:     {"action":"wait","value":"2000"}    ← milliseconds

// JSON ONLY, no markdown:
// {"steps":[{"action":"...","target":"...","value":"..."}]}`;

//   log('Planner: sending. Type:', taskTypeHint, '| Fields:', formFieldsClean.length, '| Buttons:', buttonsClean.length);
//   const response = await callServerLLM(prompt);
//   log('Planner raw:', response);

//   const parsed = safeJSONParse(response);
//   if (parsed && Array.isArray(parsed.steps)) return parsed.steps;
//   if (Array.isArray(parsed)) return parsed;
//   if (parsed && parsed.action) return [parsed];
//   return [];
// }

// // ==================== NAVIGATOR (UNIVERSAL) ====================
// async function navigatorAgent(step, pageState) {
//   const candidates = [];

//   // Form fields
//   (pageState.formFields || []).forEach(f => {
//     candidates.push({
//       category: 'form-field',
//       label: f.label,
//       type: f.fieldType,
//       agentId: f.agentId,
//       primarySelector: `[data-agent-id="${f.agentId}"]`
//     });
//   });

//   // Buttons and interactive elements
//   pageState.visibleElements
//     .filter(e => ['button', 'expandable', 'dropdown-trigger', 'disclosure', 'landmark'].includes(e.category))
//     .forEach(e => {
//       candidates.push({
//         category: e.category,
//         text: (e.text || e.label || '').slice(0, 60),
//         agentId: e.agentId,
//         primarySelector: `[data-agent-id="${e.agentId}"]`
//       });
//     });

//   // Links
//   pageState.visibleElements
//     .filter(e => e.category === 'link')
//     .slice(0, 30)
//     .forEach(e => {
//       candidates.push({
//         category: 'link',
//         text: (e.text || '').slice(0, 60),
//         href: (e.href || '').slice(0, 80),
//         agentId: e.agentId,
//         primarySelector: `[data-agent-id="${e.agentId}"]`
//       });
//     });

//   // Tabs / menu items
//   pageState.visibleElements
//     .filter(e => ['tab', 'menu-item', 'option'].includes(e.category))
//     .forEach(e => {
//       candidates.push({
//         category: e.category,
//         text: (e.text || '').slice(0, 50),
//         agentId: e.agentId,
//         primarySelector: `[data-agent-id="${e.agentId}"]`
//       });
//     });

//   // Hidden elements (in case step targets a hidden dropdown content)
//   (pageState.hiddenElements || []).forEach(e => {
//     candidates.push({
//       category: e.category + ' (HIDDEN)',
//       text: (e.text || e.label || '').slice(0, 50),
//       agentId: e.agentId,
//       primarySelector: `[data-agent-id="${e.agentId}"]`
//     });
//   });

//   const prompt = `You are a universal browser navigator. Match a step to a CSS selector.

// STEP: ${JSON.stringify(step)}

// PAGE: ${pageState.url}

// CANDIDATES (each has a guaranteed primarySelector):
// ${JSON.stringify(candidates.slice(0, 60), null, 2)}

// RULES:
// - Match by TEXT / LABEL (case-insensitive, partial OK, semantic match OK).
// - For step.action "type", prefer matching "form-field" category.
// - For step.action "click", match button/link/tab/menu-item by text.
// - For step.action "hover"/"press", match by text.
// - Return the "primarySelector" of the best match as FIRST item in selectors array.
// - If exact match not found, pick closest semantic match.
// - If step is navigate, return {"action":"navigate","target":"url"}

// JSON ONLY:
// {"action":"<${step.action}>","selectors":["<primarySelector>"],"value":"${step.value || ''}","textHint":"<matched text>"}`;

//   log('Navigator:', JSON.stringify(step));
//   const response = await callServerLLM(prompt);
//   log('Navigator raw:', response);

//   const parsed = safeJSONParse(response);
//   if (!parsed) return null;

//   if (parsed.selectors && !Array.isArray(parsed.selectors)) parsed.selectors = [parsed.selectors];
//   if (!parsed.selectors && parsed.selector) parsed.selectors = [parsed.selector];

//   // FALLBACK: local matching if LLM failed
//   if (step.target && (!parsed.selectors || !parsed.selectors.length)) {
//     const needle = step.target.toLowerCase();
//     let match = pageState.formFields?.find(f =>
//       f.label.toLowerCase().includes(needle) || needle.includes(f.label.toLowerCase())
//     );
//     if (!match) {
//       match = pageState.visibleElements?.find(e =>
//         (e.text || e.label || '').toLowerCase().includes(needle)
//       );
//     }
//     if (match && match.agentId) {
//       parsed.selectors = [`[data-agent-id="${match.agentId}"]`];
//     }
//   }

//   return parsed;
// }

// // ==================== VALIDATOR ====================
// async function validatorAgent(task, history, pageState) {
//   const summary = history.slice(-10).map(h => ({
//     step: h.step?.action + (h.step?.target ? ` "${h.step.target}"` : ''),
//     success: h.result?.success || false,
//     filledValue: h.result?.result?.filledValue || null,
//     error: h.error || null
//   }));

//   const succeeded = summary.filter(s => s.success).length;

//   const prompt = `Task: ${task}

// Step summary:
// ${JSON.stringify(summary, null, 2)}

// Progress: ${succeeded}/${summary.length} steps succeeded.
// Current URL: ${pageState.url}

// Is the task FULLY completed?
// - FORM: all fields filled AND submit clicked
// - SEARCH: query submitted AND results page loaded
// - NAVIGATION: URL matches target
// - INTERACTION: element clicked/hovered successfully

// If CORE goal achieved even with minor failures → completed: true.

// JSON ONLY: {"completed": true/false, "reason": "<short>"}`;

//   log('Validator:');
//   const response = await callServerLLM(prompt);
//   log('Validator raw:', response);
//   return safeJSONParse(response) || { completed: false, reason: 'parse error' };
// }

// // ==================== MAIN LOOP ====================
// async function runAgent(task, tabId) {
//   agentState = { task, plan: [], currentStep: 0, isRunning: true, history: [] };
//   log('========== AGENT START ==========');
//   log('Task:', task);

//   startKeepalive();

//   try {
//     let tab = await chrome.tabs.get(tabId);
//     if (!isScriptableUrl(tab.url)) {
//       broadcastToUI({ type: 'COMPLETE', reason: `❌ Cannot work on "${tab.url}"` });
//       return;
//     }

//     // AUTO-NAVIGATE
//     const targetUrl = extractUrlFromTask(task);
//     if (targetUrl && normalizeUrl(targetUrl) !== normalizeUrl(tab.url)) {
//       broadcastToUI({ type: 'STATUS', message: `🌐 Navigating to target...` });
//       await chrome.tabs.update(tabId, { url: targetUrl });
//       await waitForTabLoad(tabId);
//       await sleep(2500);
//       tab = await chrome.tabs.get(tabId);
//     }

//     // PAGE STATE
//     broadcastToUI({ type: 'STATUS', message: '📄 Reading page...' });
//     let pageState = await waitForPageReady(tabId, 1, 8000);
//     if (!pageState) pageState = await getPageState(tabId);

//     // PLAN
//     broadcastToUI({ type: 'STATUS', message: '🧠 Planning...' });
//     agentState.plan = await plannerAgent(task, pageState);
//     log('Plan:', JSON.stringify(agentState.plan, null, 2));

//     if (!agentState.plan.length) {
//       broadcastToUI({ type: 'COMPLETE', reason: '❌ Planner failed' });
//       return;
//     }
//     broadcastToUI({ type: 'PLAN', plan: agentState.plan });

//     // EXECUTE
//     let failedSteps = 0;

//     while (agentState.currentStep < agentState.plan.length && agentState.isRunning) {
//       const step = agentState.plan[agentState.currentStep];
//       log(`--- Step ${agentState.currentStep + 1}/${agentState.plan.length}:`, JSON.stringify(step));

//       broadcastToUI({ type: 'STEP', step, index: agentState.currentStep });
//       broadcastToUI({ type: 'STATUS', message: `🔍 Step ${agentState.currentStep + 1}/${agentState.plan.length}` });

//       // No-selector actions
//       if (['navigate', 'scroll', 'wait'].includes(step.action)) {
//         const res = await executeAction(tabId, null, step);
//         agentState.history.push({ step, result: res, timestamp: Date.now() });
//         agentState.currentStep++;
//         await sleep(1000);
//         continue;
//       }

//       // Get fresh state
//       let currentPage;
//       try {
//         currentPage = await getPageState(tabId);
//       } catch (e) {
//         logError('getPageState failed:', e.message);
//         agentState.history.push({ step, error: e.message });
//         agentState.currentStep++;
//         continue;
//       }

//       // Resolve
//       let action;
//       try {
//         action = await navigatorAgent(step, currentPage);
//       } catch (e) {
//         logError('Navigator failed:', e.message);
//         agentState.history.push({ step, error: 'navigator error: ' + e.message });
//         failedSteps++;
//         agentState.currentStep++;
//         await sleep(800);
//         continue;
//       }

//       if (!action || !action.selectors || !action.selectors.length) {
//         logError('Navigator no selectors');
//         agentState.history.push({ step, error: 'no selectors' });
//         failedSteps++;
//         agentState.currentStep++;
//         await sleep(800);
//         continue;
//       }

//       // Execute
//       broadcastToUI({ type: 'STATUS', message: `⚡ ${action.action}` });
//       const execResult = await executeAction(tabId, null, action);
//       log('Execute result:', JSON.stringify(execResult));
//       agentState.history.push({ step, action, result: execResult, timestamp: Date.now() });

//       if (!execResult.success) failedSteps++;

//       await sleep(1200);
//       agentState.currentStep++;
//     }

//     // FINAL VALIDATION
//     broadcastToUI({ type: 'STATUS', message: '✅ Final validation...' });
//     let finalPage;
//     try { finalPage = await getPageState(tabId); } catch (e) { finalPage = pageState; }

//     let validation;
//     try {
//       validation = await validatorAgent(task, agentState.history, finalPage);
//     } catch (e) {
//       validation = { completed: failedSteps === 0, reason: `Validator unavailable — ${failedSteps} step(s) failed` };
//     }
//     log('Final validation:', JSON.stringify(validation));

//     if (validation.completed) {
//       broadcastToUI({ type: 'COMPLETE', reason: `✅ ${validation.reason}` });
//     } else if (failedSteps > 0) {
//       broadcastToUI({ type: 'COMPLETE', reason: `⚠️ ${validation.reason} (${failedSteps} step(s) failed)` });
//     } else {
//       broadcastToUI({ type: 'COMPLETE', reason: `✅ All ${agentState.plan.length} steps executed` });
//     }

//   } catch (err) {
//     logError('Agent error:', err.message);
//     broadcastToUI({ type: 'COMPLETE', reason: `❌ Error: ${err.message}` });
//   } finally {
//     agentState.isRunning = false;
//     stopKeepalive();
//     log('========== AGENT END ==========');
//   }
// }

// // ==================== MESSAGE HANDLING ====================
// chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
//   if (msg.type === 'START_TASK') {
//     chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
//       if (!tabs[0]) return sendResponse({ started: false });
//       runAgent(msg.task, tabs[0].id);
//       sendResponse({ started: true });
//     });
//     return true;
//   }
//   if (msg.type === 'STOP_TASK') {
//     agentState.isRunning = false;
//     sendResponse({ stopped: true });
//     return true;
//   }
// });

// log('Background loaded');
// ensureOffscreen();

















/// with form with all 



// // ==================== STATE ====================
// let agentState = {
//   task: '',
//   plan: [],
//   currentStep: 0,
//   isRunning: false,
//   history: []
// };

// // ==================== HELPERS ====================
// function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
// function log(...a) { console.log('[Agent]', ...a); }
// function logError(...a) { console.error('[Agent ERROR]', ...a); }

// function isScriptableUrl(url) {
//   if (!url) return false;
//   return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://');
// }

// function broadcastToUI(data) {
//   chrome.runtime.sendMessage({ target: 'sidebar', ...data }).catch(() => {});
// }

// function safeJSONParse(text) {
//   if (!text) return null;
//   try {
//     let cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
//     const first = cleaned.search(/[\[{]/);
//     const last = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
//     if (first !== -1 && last !== -1) cleaned = cleaned.slice(first, last + 1);
//     return JSON.parse(cleaned);
//   } catch (e) {
//     logError('JSON parse failed:', e.message);
//     return null;
//   }
// }

// function extractUrlFromTask(task) {
//   if (!task) return null;
//   const matches = task.match(/(https?:\/\/[^\s]+)/gi);
//   if (!matches) return null;
//   return matches[0].replace(/[.,;!?)\]]+$/, '');
// }

// function normalizeUrl(url) {
//   if (!url) return '';
//   try {
//     const u = new URL(url);
//     return (u.origin + u.pathname).replace(/\/$/, '');
//   } catch { return url; }
// }

// function waitForTabLoad(tabId, timeoutMs = 15000) {
//   return new Promise((resolve) => {
//     let done = false;
//     const listener = (id, info) => {
//       if (id === tabId && info.status === 'complete' && !done) {
//         done = true;
//         chrome.tabs.onUpdated.removeListener(listener);
//         resolve();
//       }
//     };
//     chrome.tabs.onUpdated.addListener(listener);
//     setTimeout(() => {
//       if (!done) {
//         done = true;
//         chrome.tabs.onUpdated.removeListener(listener);
//         resolve();
//       }
//     }, timeoutMs);
//   });
// }

// async function waitForPageReady(tabId, minFields = 1, timeoutMs = 8000) {
//   const start = Date.now();
//   while (Date.now() - start < timeoutMs) {
//     try {
//       const state = await getPageState(tabId);
//       if (state.formFields.length >= minFields || state.visibleElements.length > 5) return state;
//     } catch (e) {}
//     await sleep(800);
//   }
//   try { return await getPageState(tabId); } catch { return null; }
// }

// // ==================== KEEPALIVE ====================
// let keepaliveInterval = null;
// function startKeepalive() {
//   stopKeepalive();
//   keepaliveInterval = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
// }
// function stopKeepalive() {
//   if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }
// }

// // ==================== OFFSCREEN ====================
// async function ensureOffscreen() {
//   try {
//     const exists = await chrome.offscreen.hasDocument();
//     if (!exists) {
//       await chrome.offscreen.createDocument({
//         url: 'src/offscreen.html',
//         reasons: ['DOM_SCRAPING'],
//         justification: 'Local vision model'
//       });
//     }
//   } catch (e) { logError('Offscreen:', e.message); }
// }

// // ==================== SERVER LLM ====================
// async function callServerLLM(prompt, image = null, retries = 2) {
//   const body = { prompt };
//   if (image) body.image = image;

//   let lastErr = null;
//   for (let attempt = 1; attempt <= retries; attempt++) {
//     try {
//       const controller = new AbortController();
//       const timeoutId = setTimeout(() => controller.abort(), 90000);

//       const res = await fetch('http://localhost:3000/api/reason', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify(body),
//         signal: controller.signal
//       });
//       clearTimeout(timeoutId);

//       if (!res.ok) {
//         const err = await res.text();
//         throw new Error(`HTTP ${res.status}: ${err}`);
//       }

//       const data = await res.json();
//       return data.response;
//     } catch (e) {
//       lastErr = e;
//       logError(`Server attempt ${attempt}/${retries} failed:`, e.message);
//       if (attempt < retries) await sleep(2000 * attempt);
//     }
//   }
//   throw lastErr;
// }

// // ==================== PAGE STATE ====================
// async function getPageState(tabId) {
//   const tab = await chrome.tabs.get(tabId);
//   if (!isScriptableUrl(tab.url)) throw new Error(`Cannot access ${tab.url}`);

//   const results = await chrome.scripting.executeScript({
//     target: { tabId, allFrames: true },
//     func: extractPageStateInFrame
//   });

//   const frames = results.filter(r => r.result).map(r => ({ frameId: r.frameId, ...r.result }));
//   const mainFrame = frames.find(f => f.url === tab.url) || frames[0];

//   const allElements = frames.flatMap(f => (f.elements || []).map(el => ({ ...el, frameId: f.frameId })));
//   const allFormFields = frames.flatMap(f => (f.formFields || []).map(el => ({ ...el, frameId: f.frameId })));
//   const allHeadings = frames.flatMap(f => (f.headings || []));

//   log(`Extracted ${allElements.length} elements, ${allFormFields.length} form fields, ${allHeadings.length} headings`);

//   return {
//     url: tab.url,
//     title: mainFrame?.title || '',
//     textPreview: mainFrame?.textPreview || '',
//     headings: allHeadings.slice(0, 20),
//     formFields: allFormFields,
//     visibleElements: allElements.filter(e => e.isVisible && !e.disabled).slice(0, 100),
//     hiddenElements: allElements.filter(e => !e.isVisible && !e.disabled).slice(0, 40),
//     timestamp: Date.now()
//   };
// }

// // ==================== EXTRACTION (UNIVERSAL) ====================
// function extractPageStateInFrame() {
//   const elements = [];
//   const formFields = [];
//   const headings = [];
//   const seen = new WeakSet();

//   function tagWithAgentId(el) {
//     if (!el.hasAttribute('data-agent-id')) {
//       const id = `ag-${Math.random().toString(36).slice(2, 9)}`;
//       el.setAttribute('data-agent-id', id);
//     }
//     return el.getAttribute('data-agent-id');
//   }

//   function findLabel(el) {
//     const labelledBy = el.getAttribute('aria-labelledby');
//     if (labelledBy) {
//       const parts = labelledBy.split(/\s+/)
//         .map(id => document.getElementById(id))
//         .filter(Boolean)
//         .map(n => (n.innerText || n.textContent || '').trim())
//         .filter(Boolean);
//       if (parts.length) return parts.join(' ');
//     }

//     const ariaLabel = el.getAttribute('aria-label');
//     if (ariaLabel) return ariaLabel.trim();

//     const placeholder = el.getAttribute('placeholder');
//     if (placeholder) return placeholder.trim();

//     if (el.id) {
//       try {
//         const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
//         if (lbl) { const t = (lbl.innerText || '').trim(); if (t) return t; }
//       } catch (e) {}
//     }

//     const wrap = el.closest('label');
//     if (wrap) {
//       const clone = wrap.cloneNode(true);
//       clone.querySelectorAll('input, textarea, select').forEach(n => n.remove());
//       const t = (clone.innerText || '').trim();
//       if (t) return t;
//     }

//     // Parent walk (Google Forms, Material UI, etc.)
//     let cur = el.parentElement;
//     for (let depth = 0; depth < 8 && cur; depth++) {
//       const children = Array.from(cur.children);
//       const textNodes = children.filter(c => {
//         if (c.contains(el)) return false;
//         if (['INPUT', 'TEXTAREA', 'SELECT'].includes(c.tagName)) return false;
//         if (c.querySelector('input, textarea, select')) return false;
//         const t = (c.innerText || '').trim();
//         return t && t.length > 0 && t.length < 200;
//       });
//       if (textNodes.length) {
//         const label = (textNodes[0].innerText || '').trim();
//         if (label && !/^(required|\*|optional)$/i.test(label)) return label;
//       }
//       let sib = cur.previousElementSibling;
//       while (sib) {
//         if (!sib.querySelector('input, textarea, select')) {
//           const t = (sib.innerText || '').trim();
//           if (t && t.length < 200 && !/^(required|\*)$/i.test(t)) return t;
//         }
//         sib = sib.previousElementSibling;
//       }
//       cur = cur.parentElement;
//     }
//     return el.name || el.id || '';
//   }

//   function isVisible(el) {
//     const style = window.getComputedStyle(el);
//     if (style.display === 'none' || style.visibility === 'hidden') return false;
//     if (parseFloat(style.opacity) === 0) return false;
//     const r = el.getBoundingClientRect();
//     if (r.width === 0 && r.height === 0) return false;
//     return true;
//   }

//   function isInViewport(el) {
//     const r = el.getBoundingClientRect();
//     return r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;
//   }

//   function categorize(el) {
//     const tag = el.tagName.toLowerCase();
//     const role = el.getAttribute('role') || '';
//     if (['input','textarea','select'].includes(tag)) return 'form-field';
//     if (['textbox','combobox','listbox','checkbox','radio','switch','slider','spinbutton'].includes(role)) return 'form-field';
//     if (tag === 'button' || role === 'button') return 'button';
//     if (tag === 'a' && el.href) return 'link';
//     if (role === 'tab') return 'tab';
//     if (role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio') return 'menu-item';
//     if (role === 'option') return 'option';
//     if (tag === 'summary') return 'disclosure';
//     if (el.hasAttribute('aria-expanded')) return 'expandable';
//     if (el.hasAttribute('aria-haspopup')) return 'dropdown-trigger';
//     if (['nav','header','footer','aside','main'].includes(tag)) return 'landmark';
//     return 'interactive';
//   }

//   function getSelectors(el, agentId) {
//     const sels = [`[data-agent-id="${agentId}"]`];
//     const tag = el.tagName.toLowerCase();

//     const lb = el.getAttribute('aria-labelledby');
//     if (lb) sels.push(`${tag}[aria-labelledby="${CSS.escape(lb)}"]`);

//     const ariaLabel = el.getAttribute('aria-label');
//     if (ariaLabel && !/^(your\s*answer|answer|input|text|search)$/i.test(ariaLabel)) {
//       sels.push(`[aria-label="${CSS.escape(ariaLabel)}"]`);
//     }

//     for (const attr of ['data-testid', 'data-test', 'data-qa', 'data-cy']) {
//       const v = el.getAttribute(attr);
//       if (v) sels.push(`[${attr}="${CSS.escape(v)}"]`);
//     }

//     if (el.id && !/^[0-9]/.test(el.id)) sels.push(`#${CSS.escape(el.id)}`);
//     if (el.name) sels.push(`${tag}[name="${CSS.escape(el.name)}"]`);
//     if (el.placeholder) sels.push(`${tag}[placeholder="${CSS.escape(el.placeholder)}"]`);

//     // Text-based fallback for links/buttons
//     const txt = (el.innerText || '').trim();
//     if (txt && txt.length < 50 && (tag === 'a' || tag === 'button')) {
//       sels.push(`${tag}[data-agent-text="${CSS.escape(txt)}"]`);
//     }

//     return [...new Set(sels)];
//   }

//   function isFormField(el) {
//     const tag = el.tagName.toLowerCase();
//     if (['input', 'textarea', 'select'].includes(tag)) return true;
//     const role = el.getAttribute('role');
//     return ['textbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch'].includes(role);
//   }

//   function getFieldType(el) {
//     const tag = el.tagName.toLowerCase();
//     if (tag === 'textarea') return 'textarea';
//     if (tag === 'select') return 'select';
//     if (tag === 'input') return el.type || 'text';
//     return el.getAttribute('role') || 'unknown';
//   }

//   function visit(root) {
//     if (!root || !root.querySelectorAll) return;
//     let nodes;
//     try {
//       // Universal selector — includes hidden-relevant triggers
//       nodes = root.querySelectorAll([
//         'input', 'textarea', 'select', 'button',
//         'a[href]',
//         '[role]',
//         '[contenteditable="true"]',
//         '[onclick]',
//         '[aria-expanded]',
//         '[aria-haspopup]',
//         'summary',
//         '[tabindex]:not([tabindex="-1"])'
//       ].join(','));
//     } catch (e) { return; }

//     nodes.forEach(el => {
//       if (seen.has(el)) return;
//       seen.add(el);

//       const tag = el.tagName.toLowerCase();
//       if (['script', 'style', 'meta', 'head', 'link'].includes(tag)) return;
//       if (el.type === 'hidden') return;

//       const agentId = tagWithAgentId(el);
//       const rect = el.getBoundingClientRect();
//       const visible = isVisible(el);
//       const inViewport = isInViewport(el);
//       const label = findLabel(el);
//       const selectors = getSelectors(el, agentId);
//       const category = categorize(el);

//       const entry = {
//         tag: el.tagName,
//         type: el.type || '',
//         role: el.getAttribute('role') || '',
//         category,
//         label,
//         ariaLabel: el.getAttribute('aria-label') || '',
//         placeholder: el.placeholder || '',
//         text: (el.innerText || el.value || '').slice(0, 100).trim(),
//         href: el.href || '',
//         isVisible: visible,
//         isInViewport: inViewport,
//         ariaExpanded: el.getAttribute('aria-expanded'),
//         ariaHasPopup: el.getAttribute('aria-haspopup'),
//         agentId,
//         selectors
//       };

//       elements.push(entry);

//       if (isFormField(el)) {
//         formFields.push({
//           label: label || `(unlabeled ${tag})`,
//           fieldType: getFieldType(el),
//           required: el.required || el.getAttribute('aria-required') === 'true',
//           currentValue: el.value || '',
//           isVisible: visible,
//           isDisabled: el.disabled || false,
//           agentId,
//           selectors
//         });
//       }

//       if (el.shadowRoot) visit(el.shadowRoot);
//     });
//   }

//   visit(document);

//   // Headings (page context)
//   document.querySelectorAll('h1, h2, h3, [role="heading"]').forEach(h => {
//     const t = (h.innerText || '').trim();
//     if (t && t.length < 200) {
//       headings.push({ level: h.tagName, text: t });
//     }
//   });

//   // Text preview (main content)
//   let textPreview = '';
//   try {
//     const main = document.querySelector('main, [role="main"], article') || document.body;
//     textPreview = (main.innerText || '').replace(/\s+/g, ' ').slice(0, 600);
//   } catch (e) {}

//   return {
//     url: location.href,
//     title: document.title,
//     textPreview,
//     headings: headings.slice(0, 20),
//     elements: elements.slice(0, 250),
//     formFields: formFields.slice(0, 100)
//   };
// }

// // ==================== ACTION EXECUTION ====================
// async function findAndExecute(tabId, frameId, selectors, executorFn, args = []) {
//   for (const sel of selectors) {
//     try {
//       const results = await chrome.scripting.executeScript({
//         target: frameId != null ? { tabId, frameIds: [frameId] } : { tabId },
//         func: executorFn,
//         args: [sel, ...args]
//       });
//       const r = results[0]?.result;
//       if (r && r.success) {
//         log(`✅ Selector worked: ${sel}`);
//         return { success: true, selector: sel, result: r };
//       }
//     } catch (e) {
//       log(`Selector failed: ${sel} — ${e.message}`);
//     }
//   }
//   return { success: false };
// }

// function clickExecutor(selector) {
//   const el = document.querySelector(selector);
//   if (!el) return { success: false, reason: 'not found' };
//   try { el.scrollIntoView({ block: 'center' }); } catch (e) {}

//   const style = window.getComputedStyle(el);
//   if (style.display === 'none' || style.visibility === 'hidden' || el.offsetParent === null) {
//     el.removeAttribute('hidden');
//     el.style.display = el.style.display === 'none' ? 'block' : el.style.display;
//     el.style.visibility = 'visible';
//     el.style.opacity = '1';
//   }

//   try { el.click(); } catch (e) {}
//   ['mousedown', 'mouseup', 'click'].forEach(type => {
//     try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
//   });
//   return { success: true, tag: el.tagName };
// }

// function typeExecutor(selector, value) {
//   const el = document.querySelector(selector);
//   if (!el) return { success: false, reason: 'not found' };

//   try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
//   try { el.focus(); } catch (e) {}

//   // Handle contenteditable
//   if (el.getAttribute('contenteditable') === 'true') {
//     el.innerText = value;
//     ['input', 'change', 'blur'].forEach(evt => {
//       try { el.dispatchEvent(new Event(evt, { bubbles: true })); } catch (e) {}
//     });
//     return { success: true, tag: el.tagName, filledValue: value };
//   }

//   if (el.tagName === 'SELECT') {
//     // Try matching by text or value
//     let matched = false;
//     for (const opt of el.options) {
//       if (opt.value === value || opt.text.toLowerCase() === value.toLowerCase()) {
//         el.value = opt.value;
//         matched = true;
//         break;
//       }
//     }
//     if (!matched) el.value = value;
//     el.dispatchEvent(new Event('change', { bubbles: true }));
//     return { success: true, tag: 'SELECT' };
//   }

//   try {
//     const proto = el.tagName === 'TEXTAREA'
//       ? window.HTMLTextAreaElement.prototype
//       : window.HTMLInputElement.prototype;
//     const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
//     if (setter) setter.call(el, value);
//     else el.value = value;
//   } catch (e) { el.value = value; }

//   ['input', 'change', 'blur'].forEach(evt => {
//     try { el.dispatchEvent(new Event(evt, { bubbles: true })); } catch (e) {}
//   });

//   return { success: true, tag: el.tagName, filledValue: el.value };
// }

// function hoverExecutor(selector) {
//   const el = document.querySelector(selector);
//   if (!el) return { success: false };
//   try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
//   ['mouseenter', 'mouseover', 'mousemove', 'pointerenter', 'pointerover'].forEach(type => {
//     try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
//   });
//   return { success: true, tag: el.tagName };
// }

// function pressExecutor(selector, key) {
//   const el = selector ? document.querySelector(selector) : document.activeElement;
//   if (!el) return { success: false };
//   try { el.focus(); } catch (e) {}
//   const k = key || 'Enter';
//   ['keydown', 'keypress', 'keyup'].forEach(type => {
//     try { el.dispatchEvent(new KeyboardEvent(type, { key: k, code: k === 'Enter' ? 'Enter' : '', bubbles: true })); } catch (e) {}
//   });
//   return { success: true, key: k };
// }

// async function executeAction(tabId, frameId, action) {
//   if (!action || !action.action) return { success: false };

//   const selectors = action.selectors || (action.selector ? [action.selector] : []);

//   // === NO-SELECTOR ACTIONS ===
//   if (action.action === 'navigate') {
//     const url = action.target || action.value;
//     if (!url) return { success: false };
//     await chrome.tabs.update(tabId, { url });
//     await waitForTabLoad(tabId);
//     return { success: true };
//   }

//   if (action.action === 'scroll') {
//     await chrome.scripting.executeScript({
//       target: { tabId },
//       func: (dir) => window.scrollBy({ top: dir === 'up' ? -500 : 500, behavior: 'smooth' }),
//       args: [action.value || 'down']
//     });
//     await sleep(600);
//     return { success: true };
//   }

//   if (action.action === 'wait') {
//     const ms = parseInt(action.value) || 2000;
//     await sleep(Math.min(ms, 15000));
//     return { success: true };
//   }

//   // === TAB MANAGEMENT ===
//   if (action.action === 'newTab') {
//     const url = action.target || action.value;
//     const newTab = await chrome.tabs.create({ url: url || 'about:blank', active: true });
//     await waitForTabLoad(newTab.id);
//     return { success: true, tabId: newTab.id };
//   }

//   if (action.action === 'closeTab') {
//     try { await chrome.tabs.remove(tabId); } catch (e) {}
//     return { success: true };
//   }

//   if (action.action === 'switchTab') {
//     const idx = parseInt(action.value) || 0;
//     const tabs = await chrome.tabs.query({ currentWindow: true });
//     if (tabs[idx]) {
//       await chrome.tabs.update(tabs[idx].id, { active: true });
//       await sleep(500);
//       return { success: true, tabId: tabs[idx].id };
//     }
//     return { success: false, reason: 'tab index out of range' };
//   }

//   // === KEYBOARD SHORTCUTS ===
//   if (action.action === 'shortcut') {
//     const target = { tabId };
//     const results = await chrome.scripting.executeScript({
//       target,
//       func: keyboardShortcutExecutor,
//       args: [null, action.value]
//     });
//     return { success: true, result: results[0]?.result };
//   }

//   // === SELECTOR-BASED ACTIONS ===
//   if (selectors.length === 0) return { success: false, reason: 'no selectors' };

//   if (action.action === 'click') return await findAndExecute(tabId, frameId, selectors, clickExecutor);
//   if (action.action === 'doubleClick') return await findAndExecute(tabId, frameId, selectors, doubleClickExecutor);
//   if (action.action === 'rightClick') return await findAndExecute(tabId, frameId, selectors, rightClickExecutor);
//   if (action.action === 'type') return await findAndExecute(tabId, frameId, selectors, typeExecutor, [action.value || '']);
//   if (action.action === 'hover') return await findAndExecute(tabId, frameId, selectors, hoverExecutor);
//   if (action.action === 'search') {
//   return await findAndExecute(tabId, frameId, selectors, searchExecutor, [action.value || '']);
// }
//   if (action.action === 'press') return await findAndExecute(tabId, frameId, selectors, pressExecutor, [action.value || 'Enter']);
//   if (action.action === 'clear') return await findAndExecute(tabId, frameId, selectors, clearFieldExecutor);
//   if (action.action === 'selectAll') return await findAndExecute(tabId, frameId, selectors, selectAllExecutor);
//   if (action.action === 'waitFor') {
//     return await findAndExecute(tabId, frameId, selectors, waitForSelectorExecutor, [action.value || '5000']);
//   }
//   if (action.action === 'dragDrop') {
//     // action.value should contain target selector description
//     const targetSel = action.value ? [action.value] : [];
//     if (targetSel.length) {
//       const src = selectors[0];
//       const tgt = targetSel[0];
//       const results = await chrome.scripting.executeScript({
//         target: { tabId },
//         func: dragDropExecutor,
//         args: [src, tgt]
//       });
//       return { success: results[0]?.result?.success };
//     }
//     return { success: false, reason: 'dragDrop needs value=targetSelector' };
//   }
//   if (action.action === 'upload') {
//     return await findAndExecute(tabId, frameId, selectors, uploadExecutor, [action.value || '']);
//   }

//   // EXTRACT
//   if (action.action === 'extract') {
//     const results = await chrome.scripting.executeScript({
//       target: { tabId },
//       func: (sel) => {
//         const el = document.querySelector(sel);
//         return { success: !!el, text: el ? el.innerText : '' };
//       },
//       args: [selectors[0]]
//     });
//     return { success: results[0]?.result?.success, text: results[0]?.result?.text };
//   }

//   return { success: false, reason: 'unknown action: ' + action.action };
// }


// // ==================== PRESS (improved) ====================
// function pressExecutor(selector, key) {
//   const el = selector ? document.querySelector(selector) : document.activeElement;
//   if (!el) return { success: false, reason: 'no target' };
//   try { el.focus(); } catch (e) {}

//   const k = key || 'Enter';
//   const kLower = k.toLowerCase();
//   const keyCode = kLower === 'enter' ? 13 : kLower === 'tab' ? 9 : kLower === 'escape' ? 27 : 0;

//   const eventInit = {
//     key: k, code: k, keyCode, which: keyCode,
//     bubbles: true, cancelable: true
//   };

//   try {
//     el.dispatchEvent(new KeyboardEvent('keydown', eventInit));
//     el.dispatchEvent(new KeyboardEvent('keypress', eventInit));
//     el.dispatchEvent(new KeyboardEvent('keyup', eventInit));
//   } catch (e) {}

//   // If Enter and inside a form — try submitting
//   if (kLower === 'enter' && el.form) {
//     try {
//       if (typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
//       else el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
//     } catch (e) {}
//   }

//   return { success: true, key: k, wasInForm: !!el.form };
// }




// // ==================== SEARCH (type + submit in one go) ====================
// function searchExecutor(selector, value) {
//   const el = document.querySelector(selector);
//   if (!el) return { success: false, reason: 'search input not found' };

//   try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
//   try { el.focus(); } catch (e) {}

//   // === STEP 1: Type value (native setter for React/Vue) ===
//   if (el.getAttribute('contenteditable') === 'true') {
//     el.innerText = value;
//   } else {
//     try {
//       const proto = el.tagName === 'TEXTAREA'
//         ? window.HTMLTextAreaElement.prototype
//         : window.HTMLInputElement.prototype;
//       const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
//       if (setter) setter.call(el, value);
//       else el.value = value;
//     } catch (e) { el.value = value; }
//   }

//   // Dispatch input events
//   ['input', 'change'].forEach(evt => {
//     try { el.dispatchEvent(new Event(evt, { bubbles: true })); } catch (e) {}
//   });

//   // === STEP 2: Simulate real typing (character by character) ===
//   // This helps frameworks recognize the value as "user typed"
//   try {
//     for (const ch of value) {
//       el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
//       el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
//       el.dispatchEvent(new KeyboardEvent('input', { data: ch, inputType: 'insertText', bubbles: true }));
//       el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
//     }
//   } catch (e) {}

//   // === STEP 3: Press Enter (multiple strategies) ===
//   const enterEvent = {
//     key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
//     bubbles: true, cancelable: true
//   };

//   let submitted = false;

//   // Strategy A: Enter keydown on the element
//   try {
//     el.dispatchEvent(new KeyboardEvent('keydown', enterEvent));
//     el.dispatchEvent(new KeyboardEvent('keypress', enterEvent));
//     el.dispatchEvent(new KeyboardEvent('keyup', enterEvent));
//   } catch (e) {}

//   // Strategy B: Look for a search/submit button nearby
//   const findSearchButton = () => {
//     // Look in the same form first
//     if (el.form) {
//       const btn = el.form.querySelector(
//         'button[type="submit"], input[type="submit"], ' +
//         'button[aria-label*="Search" i], button[aria-label*="search" i], ' +
//         'button[title*="Search" i], [role="button"][aria-label*="Search" i]'
//       );
//       if (btn) return btn;
//     }
//     // Look in parent containers (up to 5 levels)
//     let parent = el.parentElement;
//     for (let i = 0; i < 5 && parent; i++) {
//       const btn = parent.querySelector(
//         'button[type="submit"], input[type="submit"], ' +
//         'button[aria-label*="Search" i], button[aria-label*="search" i], ' +
//         '[role="button"][aria-label*="Search" i], ' +
//         'button[title*="Search" i]'
//       );
//       if (btn) return btn;
//       parent = parent.parentElement;
//     }
//     return null;
//   };

//   const searchBtn = findSearchButton();
//   if (searchBtn) {
//     try {
//       searchBtn.click();
//       ['mousedown', 'mouseup', 'click'].forEach(type => {
//         searchBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
//       });
//       submitted = true;
//     } catch (e) {}
//   }

//   // Strategy C: If in a form, requestSubmit (fires submit event properly)
//   if (!submitted && el.form) {
//     try {
//       if (typeof el.form.requestSubmit === 'function') {
//         el.form.requestSubmit();
//         submitted = true;
//       } else if (typeof el.form.submit === 'function') {
//         el.form.submit();
//         submitted = true;
//       }
//     } catch (e) {}
//   }

//   // Strategy D: Dispatch submit event on form
//   if (!submitted && el.form) {
//     try {
//       el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
//       submitted = true;
//     } catch (e) {}
//   }

//   return {
//     success: true,
//     filled: el.value,
//     submitted,
//     buttonFound: !!searchBtn,
//     tag: el.tagName
//   };
// }

// // ==================== ADVANCED EXECUTORS ====================

// function doubleClickExecutor(selector) {
//   const el = document.querySelector(selector);
//   if (!el) return { success: false, reason: 'not found' };
//   try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
//   ['mousedown', 'mouseup', 'click', 'mousedown', 'mouseup', 'click', 'dblclick'].forEach(type => {
//     try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, detail: 2 })); } catch (e) {}
//   });
//   return { success: true, tag: el.tagName };
// }

// function rightClickExecutor(selector) {
//   const el = document.querySelector(selector);
//   if (!el) return { success: false, reason: 'not found' };
//   try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
//   const rect = el.getBoundingClientRect();
//   const x = rect.left + rect.width / 2;
//   const y = rect.top + rect.height / 2;
//   ['mousedown', 'mouseup', 'contextmenu'].forEach(type => {
//     try {
//       el.dispatchEvent(new MouseEvent(type, {
//         bubbles: true, cancelable: true, view: window,
//         button: 2, buttons: 2, clientX: x, clientY: y
//       }));
//     } catch (e) {}
//   });
//   return { success: true, tag: el.tagName };
// }

// function clearFieldExecutor(selector) {
//   const el = document.querySelector(selector);
//   if (!el) return { success: false, reason: 'not found' };
//   try { el.focus(); } catch (e) {}

//   if (el.getAttribute('contenteditable') === 'true') {
//     el.innerText = '';
//   } else {
//     try {
//       const proto = el.tagName === 'TEXTAREA'
//         ? window.HTMLTextAreaElement.prototype
//         : window.HTMLInputElement.prototype;
//       const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
//       if (setter) setter.call(el, '');
//       else el.value = '';
//     } catch (e) { el.value = ''; }
//   }
//   ['input', 'change', 'blur'].forEach(evt => {
//     try { el.dispatchEvent(new Event(evt, { bubbles: true })); } catch (e) {}
//   });
//   return { success: true };
// }

// function selectAllExecutor(selector) {
//   const el = document.querySelector(selector);
//   if (!el) return { success: false };
//   try { el.focus(); } catch (e) {}
//   if (el.select) { try { el.select(); } catch (e) {} }
//   if (el.setSelectionRange && el.value) {
//     try { el.setSelectionRange(0, el.value.length); } catch (e) {}
//   }
//   return { success: true };
// }

// function keyboardShortcutExecutor(_selector, combo) {
//   // combo like "Control+S", "Ctrl+A", "Meta+K"
//   if (!combo) return { success: false, reason: 'no combo' };
//   const parts = combo.split('+').map(p => p.trim());
//   const key = parts[parts.length - 1];
//   const modifiers = parts.slice(0, -1).map(m => m.toLowerCase());

//   const eventInit = {
//     key: key.length === 1 ? key : key,
//     code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
//     ctrlKey: modifiers.includes('ctrl') || modifiers.includes('control'),
//     shiftKey: modifiers.includes('shift'),
//     altKey: modifiers.includes('alt'),
//     metaKey: modifiers.includes('meta') || modifiers.includes('cmd'),
//     bubbles: true,
//     cancelable: true
//   };

//   const target = document.activeElement || document.body;
//   ['keydown', 'keypress', 'keyup'].forEach(type => {
//     try { target.dispatchEvent(new KeyboardEvent(type, eventInit)); } catch (e) {}
//   });
//   // Also try on document
//   ['keydown', 'keyup'].forEach(type => {
//     try { document.dispatchEvent(new KeyboardEvent(type, eventInit)); } catch (e) {}
//   });
//   return { success: true, combo };
// }

// function dragDropExecutor(sourceSel, targetSel) {
//   const src = document.querySelector(sourceSel);
//   const tgt = document.querySelector(targetSel);
//   if (!src || !tgt) return { success: false, reason: 'source or target not found' };

//   const dt = new DataTransfer();

//   const fire = (el, type, x, y) => {
//     const ev = new DragEvent(type, {
//       bubbles: true, cancelable: true, view: window,
//       dataTransfer: dt, clientX: x, clientY: y
//     });
//     try { el.dispatchEvent(ev); } catch (e) {}
//   };

//   const srcRect = src.getBoundingClientRect();
//   const tgtRect = tgt.getBoundingClientRect();
//   const sx = srcRect.left + srcRect.width / 2;
//   const sy = srcRect.top + srcRect.height / 2;
//   const tx = tgtRect.left + tgtRect.width / 2;
//   const ty = tgtRect.top + tgtRect.height / 2;

//   fire(src, 'dragstart', sx, sy);
//   fire(src, 'drag', sx, sy);
//   fire(tgt, 'dragenter', tx, ty);
//   fire(tgt, 'dragover', tx, ty);
//   fire(tgt, 'drop', tx, ty);
//   fire(src, 'dragend', tx, ty);

//   return { success: true };
// }

// function uploadExecutor(selector, fileInfo) {
//   // fileInfo: JSON string like {"name":"file.txt","type":"text/plain","content":"hello"}
//   const el = document.querySelector(selector);
//   if (!el) return { success: false, reason: 'not found' };
//   if (el.type !== 'file') return { success: false, reason: 'not a file input' };

//   let info;
//   try { info = typeof fileInfo === 'string' ? JSON.parse(fileInfo) : fileInfo; }
//   catch { info = { name: 'upload.txt', type: 'text/plain', content: 'test' }; }

//   try {
//     const blob = new Blob([info.content || ''], { type: info.type || 'text/plain' });
//     const file = new File([blob], info.name || 'upload.txt', { type: info.type || 'text/plain' });
//     const dt = new DataTransfer();
//     dt.items.add(file);
//     el.files = dt.files;
//     ['input', 'change'].forEach(evt => {
//       try { el.dispatchEvent(new Event(evt, { bubbles: true })); } catch (e) {}
//     });
//     return { success: true, fileName: file.name };
//   } catch (e) {
//     return { success: false, reason: e.message };
//   }
// }

// function waitForSelectorExecutor(selector, timeoutStr) {
//   const timeout = parseInt(timeoutStr) || 5000;
//   return new Promise((resolve) => {
//     const start = Date.now();
//     const check = () => {
//       const el = document.querySelector(selector);
//       if (el) return resolve({ success: true, found: true });
//       if (Date.now() - start > timeout) return resolve({ success: false, reason: 'timeout' });
//       setTimeout(check, 200);
//     };
//     check();
//   });
// }

// // ==================== PLANNER (UNIVERSAL) ====================
// // ==================== PLANNER (FULLY UNIVERSAL) ====================
// async function plannerAgent(task, pageState) {
//   // Prepare context — no bias, all element types
//   const formFields = (pageState.formFields || []).slice(0, 25).map(f => ({
//     label: f.label, type: f.fieldType, required: f.required
//   }));

//   const buttons = pageState.visibleElements
//     .filter(e => e.category === 'button' || e.category === 'expandable' || e.category === 'dropdown-trigger')
//     .slice(0, 25)
//     .map(e => ({ text: (e.text || e.label || '').slice(0, 60), ariaExpanded: e.ariaExpanded }));

//   const links = pageState.visibleElements
//     .filter(e => e.category === 'link')
//     .slice(0, 25)
//     .map(e => ({ text: (e.text || '').slice(0, 60), href: (e.href || '').slice(0, 80) }))
//     .filter(e => e.text);

//   const tabs = pageState.visibleElements
//     .filter(e => ['tab', 'menu-item', 'option'].includes(e.category))
//     .slice(0, 25)
//     .map(e => ({ text: (e.text || '').slice(0, 40), role: e.role }))
//     .filter(e => e.text);

//   const headings = (pageState.headings || []).slice(0, 15).map(h => h.text);

//   const prompt = `You are a UNIVERSAL browser automation planner. You handle ANY web task.

// USER TASK: ${task}

// CURRENT PAGE CONTEXT:
// URL: ${pageState.url}
// Title: ${pageState.title}
// Headings: ${JSON.stringify(headings)}
// Text preview: ${(pageState.textPreview || '').slice(0, 400)}

// AVAILABLE ELEMENTS ON PAGE:
// Form fields (${formFields.length}):
// ${JSON.stringify(formFields, null, 2)}

// Buttons (${buttons.length}):
// ${JSON.stringify(buttons, null, 2)}

// Links (${links.length}):
// ${JSON.stringify(links, null, 2)}

// Tabs/Menu items (${tabs.length}):
// ${JSON.stringify(tabs, null, 2)}

// YOUR JOB:
// 1. FIRST, analyze the user task and current page. What kind of task is this?
//    - Search? Navigation? Form filling? Data extraction? Interaction (open/expand)? Multi-step?
// 2. THEN plan the minimal steps needed.

// TASK TYPE EXAMPLES:
// - "Search X on Google" → type in search box → press Enter
// - "Go to Wikipedia ISRO article" → click search or navigate → type → click result
// - "Fill this form" → type each field → click submit
// - "Open YouTube profile menu" → click profile icon → wait for menu → click menu item
// - "Add cheapest item to cart" → scroll → find items → click add-to-cart
// - "Log in with user/pass" → type username → type password → click login
// - "Extract top 5 headlines" → scroll → extract
// - "Download the report" → click download button

// AVAILABLE ACTIONS (use exact action names):
// - navigate: {"action":"navigate","target":"https://..."}
// - click:    {"action":"click","target":"description of element"}
// - type:     {"action":"type","target":"description","value":"text"}
// - press:    {"action":"press","target":"description","value":"Enter"}
// - hover:    {"action":"hover","target":"description"}
// - scroll:   {"action":"scroll","value":"down|up"}
// - wait:     {"action":"wait","value":"2000"}
// - extract:  {"action":"extract","target":"description"}
// - doubleClick: {"action":"doubleClick","target":"description"}
// - rightClick:  {"action":"rightClick","target":"description"}
// - clear:    {"action":"clear","target":"description"}
// - waitFor:  {"action":"waitFor","target":"description","value":"5000"}
// - newTab:   {"action":"newTab","target":"https://..."}
// - closeTab: {"action":"closeTab"}
// - switchTab:{"action":"switchTab","value":"1"}
// - shortcut: {"action":"shortcut","value":"Control+S"}
// - selectAll:{"action":"selectAll","target":"description"}
// - dragDrop: {"action":"dragDrop","target":"source","value":"destination"}
// - upload:   {"action":"upload","target":"description","value":"filename"}
// - search:   {"action":"search","target":"search box","value":"query"}   ← BEST for search

// CONDITIONAL & LOOP ACTIONS (Phase 3):
// - if:    {"action":"if","condition":{"selectorExists":"..."},"then":[...],"else":[...]}
// - loop:  {"action":"loop","while":{"selectorExists":"..."},"maxIterations":10,"steps":[...]}
// - retry: {"action":"retry","maxAttempts":3,"until":{"urlContains":"..."},"steps":[...]}

// CONDITIONAL EXAMPLES:
// - "Login if not logged in" → 
//   {"action":"if","condition":{"selectorExists":"#login-button"},"then":[{"action":"click","target":"login button"},{"action":"type","target":"username","value":"user"}],"else":[{"action":"wait","value":"500"}]}

// - "Load all comments" →
//   {"action":"loop","while":{"selectorExists":".load-more-button"},"maxIterations":10,"steps":[{"action":"click","target":"load more"}]}

// - "Submit and retry if failed" →
//   {"action":"retry","maxAttempts":3,"until":{"urlContains":"success"},"steps":[{"action":"click","target":"submit"}]}


// CRITICAL RULES:
// 1. Use ONLY elements that exist on this page. NEVER invent fields/buttons.
// 2. Use "target" as a DESCRIPTION (the navigator will resolve it to a selector).
// 3. Generate values ONLY when you know what the value should be (from user task, or naturally derived).
// 4. Do NOT hardcode names/emails unless task specifically asks. If task says "random details", generate plausible values.
// 5. Keep plan MINIMAL — don't over-engineer.
// 6. If task is not possible on this page (e.g., user said "fill form" but no form exists), say so with:
//    {"steps":[],"reason":"No form found on this page"}
// 7. FOR SEARCH TASKS: Use "search" action (type+Enter in one go) instead of separate "type"+"press".
//    - WRONG: [{"action":"type","target":"search box","value":"X"}, {"action":"press","target":"search box","value":"Enter"}]
//    - RIGHT: [{"action":"search","target":"search box","value":"X"}]\
// 8. After "search" action, always add "wait" with value 3000-4000 for results to load.
// 9. After "navigate", add "wait" with value 2000-3000 if the page is dynamic.


// TASK TYPE EXAMPLES:
// - "Search X on Google" → [{"action":"search","target":"search box","value":"X"}, {"action":"wait","value":"3000"}, {"action":"click","target":"result"}]
// - "Find X on YouTube" → [{"action":"navigate","target":"https://youtube.com"},{"action":"search","target":"search box","value":"X"},{"action":"wait","value":"3000"}]

// Respond with JSON ONLY (no markdown):
// {"steps":[{"action":"...","target":"...","value":"..."}]}`;

//   log('Planner: analyzing task...');
//   const response = await callServerLLM(prompt);
//   log('Planner raw:', response);

//   const parsed = safeJSONParse(response);
//   if (parsed && Array.isArray(parsed.steps)) return parsed.steps;
//   if (Array.isArray(parsed)) return parsed;
//   if (parsed && parsed.action) return [parsed];
//   return [];
// }

// // ==================== NAVIGATOR (UNIVERSAL) ====================
// async function navigatorAgent(step, pageState) {
//   const candidates = [];

//   // Form fields
//   (pageState.formFields || []).forEach(f => {
//     candidates.push({
//       category: 'form-field',
//       label: f.label,
//       type: f.fieldType,
//       agentId: f.agentId,
//       primarySelector: `[data-agent-id="${f.agentId}"]`
//     });
//   });

//   // Buttons and interactive elements
//   pageState.visibleElements
//     .filter(e => ['button', 'expandable', 'dropdown-trigger', 'disclosure', 'landmark'].includes(e.category))
//     .forEach(e => {
//       candidates.push({
//         category: e.category,
//         text: (e.text || e.label || '').slice(0, 60),
//         agentId: e.agentId,
//         primarySelector: `[data-agent-id="${e.agentId}"]`
//       });
//     });

//   // Links
//   pageState.visibleElements
//     .filter(e => e.category === 'link')
//     .slice(0, 30)
//     .forEach(e => {
//       candidates.push({
//         category: 'link',
//         text: (e.text || '').slice(0, 60),
//         href: (e.href || '').slice(0, 80),
//         agentId: e.agentId,
//         primarySelector: `[data-agent-id="${e.agentId}"]`
//       });
//     });

//   // Tabs / menu items
//   pageState.visibleElements
//     .filter(e => ['tab', 'menu-item', 'option'].includes(e.category))
//     .forEach(e => {
//       candidates.push({
//         category: e.category,
//         text: (e.text || '').slice(0, 50),
//         agentId: e.agentId,
//         primarySelector: `[data-agent-id="${e.agentId}"]`
//       });
//     });

//   // Hidden elements (in case step targets a hidden dropdown content)
//   (pageState.hiddenElements || []).forEach(e => {
//     candidates.push({
//       category: e.category + ' (HIDDEN)',
//       text: (e.text || e.label || '').slice(0, 50),
//       agentId: e.agentId,
//       primarySelector: `[data-agent-id="${e.agentId}"]`
//     });
//   });

//  const prompt = `You are a universal browser navigator. Match a step to a CSS selector.

// STEP: ${JSON.stringify(step)}
// PAGE: ${pageState.url}

// CANDIDATES:
// ${JSON.stringify(candidates.slice(0, 60), null, 2)}

// RULES:
// - Match by TEXT/LABEL (case-insensitive, partial OK, semantic match OK).
// - For "type" → prefer form-field.
// - For "click"/"doubleClick"/"rightClick" → match button/link/tab/menu.
// - For "hover" → match expandable/menu-trigger.
// - For "clear"/"selectAll" → match form-field.
// - Return primarySelector as FIRST item.
// - For shortcut/newTab/closeTab/switchTab → return {"action":"<action>","value":"<value>"}

// JSON ONLY:
// {"action":"<action>","selectors":["<primarySelector>"],"value":"<value>","textHint":"<match>"}`;

//   log('Navigator:', JSON.stringify(step));
//   const response = await callServerLLM(prompt);
//   log('Navigator raw:', response);

//   const parsed = safeJSONParse(response);
//   if (!parsed) return null;

//   if (parsed.selectors && !Array.isArray(parsed.selectors)) parsed.selectors = [parsed.selectors];
//   if (!parsed.selectors && parsed.selector) parsed.selectors = [parsed.selector];

//   // FALLBACK: local matching if LLM failed
//   if (step.target && (!parsed.selectors || !parsed.selectors.length)) {
//     const needle = step.target.toLowerCase();
//     let match = pageState.formFields?.find(f =>
//       f.label.toLowerCase().includes(needle) || needle.includes(f.label.toLowerCase())
//     );
//     if (!match) {
//       match = pageState.visibleElements?.find(e =>
//         (e.text || e.label || '').toLowerCase().includes(needle)
//       );
//     }
//     if (match && match.agentId) {
//       parsed.selectors = [`[data-agent-id="${match.agentId}"]`];
//     }
//   }

//   return parsed;
// }

// // ==================== VALIDATOR ====================
// async function validatorAgent(task, history, pageState) {
//   const summary = history.slice(-10).map(h => ({
//     step: h.step?.action + (h.step?.target ? ` "${h.step.target}"` : ''),
//     success: h.result?.success || false,
//     filledValue: h.result?.result?.filledValue || null,
//     error: h.error || null
//   }));

//   const succeeded = summary.filter(s => s.success).length;

//   const prompt = `Task: ${task}

// Step summary:
// ${JSON.stringify(summary, null, 2)}

// Progress: ${succeeded}/${summary.length} steps succeeded.
// Current URL: ${pageState.url}

// Is the task FULLY completed?
// - FORM: all fields filled AND submit clicked
// - SEARCH: query submitted AND results page loaded
// - NAVIGATION: URL matches target
// - INTERACTION: element clicked/hovered successfully

// If CORE goal achieved even with minor failures → completed: true.

// JSON ONLY: {"completed": true/false, "reason": "<short>"}`;

//   log('Validator:');
//   const response = await callServerLLM(prompt);
//   log('Validator raw:', response);
//   return safeJSONParse(response) || { completed: false, reason: 'parse error' };
// }




// // ==================== RECURSIVE STEP EXECUTOR ====================
// async function executeStepRecursive(step, tabId, depth = 0) {
//   if (depth > 8) {
//     logError('Max recursion depth reached');
//     return { success: false, reason: 'too deep' };
//   }

//   log(`Executing step [depth=${depth}]:`, step.action);

//   // ============ IF ============
//   if (step.action === 'if') {
//     const cond = step.condition || {};
//     let result = false;

//     if (cond.selectorExists) {
//       const r = await chrome.scripting.executeScript({
//         target: { tabId },
//         func: (sel) => !!document.querySelector(sel),
//         args: [cond.selectorExists]
//       });
//       result = r[0]?.result === true;
//     } else if (cond.textContains) {
//       const r = await chrome.scripting.executeScript({
//         target: { tabId },
//         func: (txt) => document.body.innerText.includes(txt),
//         args: [cond.textContains]
//       });
//       result = r[0]?.result === true;
//     } else if (cond.urlContains) {
//       const tab = await chrome.tabs.get(tabId);
//       result = tab.url.includes(cond.urlContains);
//     }

//     log(`IF condition result: ${result}`);
//     const branch = result ? (step.then || []) : (step.else || []);
//     for (const s of branch) {
//       await executeStepRecursive(s, tabId, depth + 1);
//     }
//     return { success: true, branch: result ? 'then' : 'else' };
//   }

//   // ============ LOOP ============
//   if (step.action === 'loop') {
//     const max = step.maxIterations || 5;
//     const whileCond = step.while || {};
//     const body = step.steps || [];

//     let iterations = 0;
//     while (iterations < max) {
//       // Check while condition
//       let shouldContinue = true;
//       if (whileCond.selectorExists) {
//         const r = await chrome.scripting.executeScript({
//           target: { tabId },
//           func: (sel) => !!document.querySelector(sel),
//           args: [whileCond.selectorExists]
//         });
//         shouldContinue = r[0]?.result === true;
//       } else if (whileCond.textContains) {
//         const r = await chrome.scripting.executeScript({
//           target: { tabId },
//           func: (txt) => document.body.innerText.includes(txt),
//           args: [whileCond.textContains]
//         });
//         shouldContinue = r[0]?.result === true;
//       }

//       if (!shouldContinue) break;

//       log(`Loop iteration ${iterations + 1}/${max}`);
//       for (const s of body) {
//         await executeStepRecursive(s, tabId, depth + 1);
//       }
//       iterations++;
//       await sleep(1000);
//     }
//     return { success: true, iterations };
//   }

//   // ============ RETRY ============
//   if (step.action === 'retry') {
//     const max = step.maxAttempts || 3;
//     const untilCond = step.until || {};
//     const body = step.steps || [];

//     for (let attempt = 1; attempt <= max; attempt++) {
//       log(`Retry attempt ${attempt}/${max}`);
//       let attemptOk = true;
//       for (const s of body) {
//         const r = await executeStepRecursive(s, tabId, depth + 1);
//         if (!r.success) attemptOk = false;
//       }

//       // Check success condition
//       let achieved = false;
//       if (untilCond.selectorExists) {
//         const r = await chrome.scripting.executeScript({
//           target: { tabId },
//           func: (sel) => !!document.querySelector(sel),
//           args: [untilCond.selectorExists]
//         });
//         achieved = r[0]?.result === true;
//       } else if (untilCond.urlContains) {
//         const tab = await chrome.tabs.get(tabId);
//         achieved = tab.url.includes(untilCond.urlContains);
//       } else if (untilCond.textContains) {
//         const r = await chrome.scripting.executeScript({
//           target: { tabId },
//           func: (txt) => document.body.innerText.includes(txt),
//           args: [untilCond.textContains]
//         });
//         achieved = r[0]?.result === true;
//       } else {
//         achieved = attemptOk;
//       }

//       if (achieved) return { success: true, attempts: attempt };
//       await sleep(1500);
//     }
//     return { success: false, reason: 'retries exhausted' };
//   }

//   // ============ SINGLE ACTION ============
//   // No-selector actions
//   if (['navigate', 'scroll', 'wait', 'newTab', 'closeTab', 'switchTab', 'shortcut'].includes(step.action)) {
//     return await executeAction(tabId, null, step);
//   }

//   // Get fresh page state
//   let currentPage;
//   try {
//     currentPage = await getPageState(tabId);
//   } catch (e) {
//     return { success: false, error: e.message };
//   }

//   // Resolve via navigator
//   let action;
//   try {
//     action = await navigatorAgent(step, currentPage);
//   } catch (e) {
//     return { success: false, error: 'navigator: ' + e.message };
//   }

//   if (!action || (!action.selectors?.length && !['newTab', 'closeTab', 'switchTab', 'shortcut', 'navigate'].includes(action.action))) {
//     return { success: false, error: 'no selectors' };
//   }

//   return await executeAction(tabId, null, action);
// }



// // ==================== MAIN LOOP ====================
// async function runAgent(task, tabId) {
//   agentState = { task, plan: [], currentStep: 0, isRunning: true, history: [] };
//   log('========== AGENT START ==========');
//   log('Task:', task);

//   startKeepalive();

//   try {
//     let tab = await chrome.tabs.get(tabId);
//     if (!isScriptableUrl(tab.url)) {
//       broadcastToUI({ type: 'COMPLETE', reason: `❌ Cannot work on "${tab.url}"` });
//       return;
//     }

//     // AUTO-NAVIGATE
//     const targetUrl = extractUrlFromTask(task);
//     if (targetUrl && normalizeUrl(targetUrl) !== normalizeUrl(tab.url)) {
//       broadcastToUI({ type: 'STATUS', message: `🌐 Navigating to target...` });
//       await chrome.tabs.update(tabId, { url: targetUrl });
//       await waitForTabLoad(tabId);
//       await sleep(2500);
//       tab = await chrome.tabs.get(tabId);
//     }

//     // PAGE STATE
//     broadcastToUI({ type: 'STATUS', message: '📄 Reading page...' });
//     let pageState = await waitForPageReady(tabId, 1, 8000);
//     if (!pageState) pageState = await getPageState(tabId);

//     // PLAN
//     broadcastToUI({ type: 'STATUS', message: '🧠 Planning...' });
//     agentState.plan = await plannerAgent(task, pageState);
//     log('Plan:', JSON.stringify(agentState.plan, null, 2));

//     if (!agentState.plan.length) {
//       broadcastToUI({ type: 'COMPLETE', reason: '❌ Planner failed' });
//       return;
//     }
//     broadcastToUI({ type: 'PLAN', plan: agentState.plan });

//     // EXECUTE
//     // EXECUTE
// let failedSteps = 0;

// while (agentState.currentStep < agentState.plan.length && agentState.isRunning) {
//   const step = agentState.plan[agentState.currentStep];
//   log(`--- Step ${agentState.currentStep + 1}/${agentState.plan.length}:`, JSON.stringify(step).slice(0, 200));

//   broadcastToUI({ type: 'STEP', step, index: agentState.currentStep });
//   broadcastToUI({ type: 'STATUS', message: `🔍 Step ${agentState.currentStep + 1}/${agentState.plan.length}` });

//   let execResult;
//   try {
//     execResult = await executeStepRecursive(step, tabId);
//   } catch (e) {
//     logError('Step execution error:', e.message);
//     execResult = { success: false, error: e.message };
//     failedSteps++;
//   }

//   agentState.history.push({ step, result: execResult, timestamp: Date.now() });
//   log('Step result:', JSON.stringify(execResult).slice(0, 200));

//   if (!execResult.success) failedSteps++;

//   await sleep(1000);
//   agentState.currentStep++;
// }
//     // FINAL VALIDATION
//     broadcastToUI({ type: 'STATUS', message: '✅ Final validation...' });
//     let finalPage;
//     try { finalPage = await getPageState(tabId); } catch (e) { finalPage = pageState; }

//     let validation;
//     try {
//       validation = await validatorAgent(task, agentState.history, finalPage);
//     } catch (e) {
//       validation = { completed: failedSteps === 0, reason: `Validator unavailable — ${failedSteps} step(s) failed` };
//     }
//     log('Final validation:', JSON.stringify(validation));

//     if (validation.completed) {
//       broadcastToUI({ type: 'COMPLETE', reason: `✅ ${validation.reason}` });
//     } else if (failedSteps > 0) {
//       broadcastToUI({ type: 'COMPLETE', reason: `⚠️ ${validation.reason} (${failedSteps} step(s) failed)` });
//     } else {
//       broadcastToUI({ type: 'COMPLETE', reason: `✅ All ${agentState.plan.length} steps executed` });
//     }

//   } catch (err) {
//     logError('Agent error:', err.message);
//     broadcastToUI({ type: 'COMPLETE', reason: `❌ Error: ${err.message}` });
//   } finally {
//     agentState.isRunning = false;
//     stopKeepalive();
//     log('========== AGENT END ==========');
//   }
// }

// // ==================== MESSAGE HANDLING ====================
// chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
//   if (msg.type === 'START_TASK') {
//     chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
//       if (!tabs[0]) return sendResponse({ started: false });
//       runAgent(msg.task, tabs[0].id);
//       sendResponse({ started: true });
//     });
//     return true;
//   }
//   if (msg.type === 'STOP_TASK') {
//     agentState.isRunning = false;
//     sendResponse({ stopped: true });
//     return true;
//   }
// });

// log('Background loaded');
// ensureOffscreen();












// ==================== STATE ====================
let agentState = {
  task: '',
  plan: [],
  currentStep: 0,
  isRunning: false,
  history: []
};

// ==================== HELPERS ====================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(...a) { console.log('[Agent]', ...a); }
function logError(...a) { console.error('[Agent ERROR]', ...a); }

function isScriptableUrl(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://');
}

function broadcastToUI(data) {
  chrome.runtime.sendMessage({ target: 'sidebar', ...data }).catch(() => {});
}

function safeJSONParse(text) {
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

function extractUrlFromTask(task) {
  if (!task) return null;
  const matches = task.match(/(https?:\/\/[^\s]+)/gi);
  if (!matches) return null;
  return matches[0].replace(/[.,;!?)\]]+$/, '');
}

function normalizeUrl(url) {
  if (!url) return '';
  try { const u = new URL(url); return (u.origin + u.pathname).replace(/\/$/, ''); }
  catch { return url; }
}



// ==================== CDP — REAL KEYBOARD INPUT ====================
let debuggerAttached = new Map();

async function ensureDebugger(tabId) {
  if (debuggerAttached.get(tabId)) return true;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    debuggerAttached.set(tabId, true);
    log('Debugger attached to tab', tabId);
    return true;
  } catch (e) {
    // Already attached? That's fine
    if (e.message?.includes('Another debugger') || e.message?.includes('Already attached')) {
      debuggerAttached.set(tabId, true);
      return true;
    }
    logError('Failed to attach debugger:', e.message);
    return false;
  }
}

async function detachDebugger(tabId) {
  if (!debuggerAttached.get(tabId)) return;
  try { await chrome.debugger.detach({ tabId }); } catch (e) {}
  debuggerAttached.delete(tabId);
}

// Real keyboard press via CDP
async function realKeyPress(tabId, keyName, modifiers = []) {
  const attached = await ensureDebugger(tabId);
  if (!attached) return false;

  // Key mapping
  const keyMap = {
    'Enter': { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' },
    'Tab':   { key: 'Tab',   code: 'Tab',   windowsVirtualKeyCode: 9,  nativeVirtualKeyCode: 9 },
    'Escape':{ key: 'Escape',code: 'Escape',windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
    'Backspace': { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 },
    'Delete':{ key: 'Delete',code: 'Delete',windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 },
    'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    'ArrowUp':   { key: 'ArrowUp',   code: 'ArrowUp',   windowsVirtualKeyCode: 38 }
  };

  const info = keyMap[keyName] || keyMap['Enter'];

  const modifierBits = (modifiers.includes('alt') ? 1 : 0) |
                      (modifiers.includes('ctrl') ? 2 : 0) |
                      (modifiers.includes('meta') ? 4 : 0) |
                      (modifiers.includes('shift') ? 8 : 0);

  try {
    // keyDown
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: info.text ? 'keyDown' : 'rawKeyDown',
      modifiers: modifierBits,
      key: info.key,
      code: info.code,
      windowsVirtualKeyCode: info.windowsVirtualKeyCode,
      nativeVirtualKeyCode: info.nativeVirtualKeyCode,
      text: info.text || '',
      unmodifiedText: info.text || ''
    });

    // small delay
    await sleep(30);

    // keyUp
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      modifiers: modifierBits,
      key: info.key,
      code: info.code,
      windowsVirtualKeyCode: info.windowsVirtualKeyCode,
      nativeVirtualKeyCode: info.nativeVirtualKeyCode
    });

    log('✅ Real key press sent:', keyName);
    return true;
  } catch (e) {
    logError('CDP key press failed:', e.message);
    return false;
  }
}

// Real typing via CDP (char by char)
async function realTypeText(tabId, text) {
  const attached = await ensureDebugger(tabId);
  if (!attached) return false;

  try {
    for (const ch of text) {
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'char',
        text: ch,
        unmodifiedText: ch,
        key: ch
      });
      await sleep(15);
    }
    return true;
  } catch (e) {
    logError('CDP type failed:', e.message);
    return false;
  }
}

// Focus an element first via DOM, then use CDP
async function focusElement(tabId, selector) {
  const r = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { success: false };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.focus();
      // Click to ensure focus (some sites need this)
      try { el.click(); } catch (e) {}
      return { success: true, tag: el.tagName };
    },
    args: [selector]
  });
  return r[0]?.result?.success === true;
}

// ==================== TOKEN BUDGET + RATE LIMITER ====================
const TOKEN_BUDGET = {
  perMinute: 7000,          // Groq free tier = 8000, we keep 1000 buffer
  windowMs: 60000,
  currentUsed: 0,
  windowStart: Date.now()
};

const requestQueue = [];
let processingQueue = false;

// Estimate tokens (rough: 4 chars = 1 token)
function estimateTokens(text) {
  return Math.ceil((text?.length || 0) / 4);
}

function resetTokenWindowIfNeeded() {
  const now = Date.now();
  if (now - TOKEN_BUDGET.windowStart > TOKEN_BUDGET.windowMs) {
    TOKEN_BUDGET.currentUsed = 0;
    TOKEN_BUDGET.windowStart = now;
  }
}

async function waitForTokenBudget(estimated) {
  resetTokenWindowIfNeeded();

  while (TOKEN_BUDGET.currentUsed + estimated > TOKEN_BUDGET.perMinute) {
    const elapsed = Date.now() - TOKEN_BUDGET.windowStart;
    const waitMs = Math.max(2000, TOKEN_BUDGET.windowMs - elapsed + 500);
    log(`⏳ Rate limit approaching. Waiting ${Math.round(waitMs/1000)}s... (used ${TOKEN_BUDGET.currentUsed}/${TOKEN_BUDGET.perMinute})`);
    broadcastToUI({ type: 'STATUS', message: `⏳ Rate limit — waiting ${Math.round(waitMs/1000)}s` });
    await sleep(waitMs);
    resetTokenWindowIfNeeded();
  }

  TOKEN_BUDGET.currentUsed += estimated;
}

// ==================== NAVIGATOR CACHE ====================
const navigatorCache = new Map();
const CACHE_MAX = 100;

function cacheKey(step, url) {
  const action = step.action || '';
  const target = (step.target || '').toLowerCase().trim();
  return `${action}::${target}::${url}`;
}

function getCachedNavigator(step, url) {
  const key = cacheKey(step, url);
  const cached = navigatorCache.get(key);
  if (cached && Date.now() - cached.ts < 60000) {
    log(`📦 Navigator cache hit: ${step.target}`);
    return cached.value;
  }
  return null;
}

function setNavigatorCache(step, url, value) {
  if (navigatorCache.size > CACHE_MAX) {
    const firstKey = navigatorCache.keys().next().value;
    navigatorCache.delete(firstKey);
  }
  navigatorCache.set(cacheKey(step, url), { value, ts: Date.now() });
}

// ==================== PAGE STATE HASH ====================
let lastPageStateHash = null;
let lastPageState = null;

function hashPageState(state) {
  if (!state) return null;
  return `${state.url}::${state.formFields.length}::${state.visibleElements.length}::${state.title}`;
}

// ==================== OFFSCREEN ====================
async function ensureOffscreen() {
  try {
    const exists = await chrome.offscreen.hasDocument();
    if (!exists) {
      await chrome.offscreen.createDocument({
        url: 'src/offscreen.html',
        reasons: ['DOM_SCRAPING'],
        justification: 'Local vision model'
      });
    }
  } catch (e) { logError('Offscreen:', e.message); }
}

// ==================== KEEPALIVE ====================
let keepaliveInterval = null;
function startKeepalive() {
  stopKeepalive();
  keepaliveInterval = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
}
function stopKeepalive() {
  if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }
}

// ==================== SERVER LLM ====================
async function callServerLLM(prompt, image = null, retries = 3) {
  const estimated = estimateTokens(prompt) + (image ? 500 : 0);
  await waitForTokenBudget(estimated);

  const body = { prompt };
  if (image) body.image = image;

  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);

      const res = await fetch('http://localhost:3000/api/reason', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text();
        // If 429, wait longer and retry
        if (res.status === 429) {
          logError(`429 rate limit — server-side. Waiting 20s...`);
          await sleep(20000);
          throw new Error(`HTTP 429: ${errText}`);
        }
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      return data.response;
    } catch (e) {
      lastErr = e;
      logError(`Server attempt ${attempt}/${retries} failed:`, e.message);
      if (attempt < retries) await sleep(3000 * attempt);
    }
  }
  throw lastErr;
}

// ==================== PAGE STATE ====================
async function getPageState(tabId, useCache = false) {
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

  const state = {
    url: tab.url,
    title: mainFrame?.title || '',
    textPreview: mainFrame?.textPreview || '',
    headings: allHeadings.slice(0, 10),
    formFields: allFormFields,
    visibleElements: allElements.filter(e => e.isVisible && !e.disabled).slice(0, 100),
    hiddenElements: allElements.filter(e => !e.isVisible && !e.disabled).slice(0, 30),
    timestamp: Date.now()
  };

  lastPageState = state;
  lastPageStateHash = hashPageState(state);

  log(`Extracted ${allElements.length} els, ${allFormFields.length} fields`);
  return state;
}

// ==================== EXTRACTION (unchanged — same as before) ====================
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

  // Existing checks first
  if (['input','textarea','select'].includes(tag)) return 'form-field';
  if (['textbox','combobox','listbox','checkbox','radio','switch'].includes(role)) return 'form-field';
  if (tag === 'button' || role === 'button') return 'button';
  if (tag === 'a' && el.href) return 'link';
  if (role === 'tab') return 'tab';
  if (role === 'menuitem') return 'menu-item';
  if (el.hasAttribute('aria-expanded')) return 'expandable';

  // NEW — clickable custom elements
  if (isClickable(el)) {
    if (tag.includes('video') || tag.includes('rich-item') || tag === 'article') return 'clickable-card';
    return 'clickable';
  }

  return 'interactive';
}

  function getSelectors(el, agentId) {
    const sels = [`[data-agent-id="${agentId}"]`];
    const tag = el.tagName.toLowerCase();
    if (el.name) sels.push(`${tag}[name="${CSS.escape(el.name)}"]`);
    const al = el.getAttribute('aria-label');
    if (al && !/^(your\s*answer|answer|input|text|search)$/i.test(al)) sels.push(`[aria-label="${CSS.escape(al)}"]`);
    if (el.id && !/^[0-9]/.test(el.id)) sels.push(`#${CSS.escape(el.id)}`);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) sels.push(`${tag}[aria-labelledby="${CSS.escape(lb)}"]`);
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


  function isClickable(el) {
  // Already interactive tags
  const tag = el.tagName.toLowerCase();
  if (['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(tag)) return true;
  if (el.getAttribute('role')) return true;
  if (el.hasAttribute('onclick')) return true;
  if (el.hasAttribute('tabindex')) return true;

  // CSS-based detection
  try {
    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer' || style.cursor === 'hand') return true;
  } catch (e) {}

  // Custom component heuristic
  if (tag.includes('-') && tag.startsWith('ytd-')) return true;
  if (tag === 'article') return true;

  return false;
}

  function visit(root) {
    if (!root?.querySelectorAll) return;
    let nodes;
    try {
      nodes = root.querySelectorAll([
  'input', 'textarea', 'select', 'button', 'a[href]',
  '[role]',
  '[contenteditable="true"]',
  '[aria-expanded]',
  '[aria-haspopup]',
  '[onclick]',
  '[tabindex]:not([tabindex="-1"])',
  'summary',
  // Custom clickable elements (YouTube, Twitter etc.)
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-playlist-renderer',
  'ytd-channel-renderer',
  'ytd-rich-item-renderer',
  'article',
  '[data-testid]',
  '[data-clickable]'
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
      const label = findLabel(el);
      const selectors = getSelectors(el, agentId);

      elements.push({
        tag: el.tagName, type: el.type || '', role: el.getAttribute('role') || '',
        category: categorize(el), label, ariaLabel: el.getAttribute('aria-label') || '',       
        placeholder: el.placeholder || '',
        text: (el.innerText || el.value || '').slice(0, 80).trim(),
        href: el.href || '', isVisible: visible,
        ariaExpanded: el.getAttribute('aria-expanded'),
        agentId, selectors
      });

      if (isFormField(el)) {
        formFields.push({
          label: label || `(unlabeled ${tag})`,
          fieldType: getFieldType(el),
          required: el.required || el.getAttribute('aria-required') === 'true',
          currentValue: el.value || '',
          isVisible: visible, agentId, selectors
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
    url: location.href, title: document.title, textPreview,
    headings: headings.slice(0, 10),
    elements: elements.slice(0, 200),
    formFields: formFields.slice(0, 60)
  };
}

// ==================== LOCAL MATCHING (skip LLM) ====================
function localMatch(step, pageState) {
  const target = (step.target || '').toLowerCase().trim();
  if (!target) return null;

  const score = (text) => {
    const t = (text || '').toLowerCase();
    if (t === target) return 100;
    if (t.includes(target)) return 80;
    if (target.includes(t) && t.length > 2) return 60;
    return 0;
  };

  // For form-field actions
  if (step.action === 'type' || step.action === 'clear' || step.action === 'selectAll') {
    let best = null, bestScore = 0;
    for (const f of pageState.formFields || []) {
      const s = score(f.label);
      if (s > bestScore) { bestScore = s; best = f; }
    }
    if (best && bestScore >= 80) {
      return {
        action: step.action,
        selectors: [`[data-agent-id="${best.agentId}"]`],
        value: step.value || '',
        textHint: best.label,
        _local: true
      };
    }
  }

  // For click/press/hover — search all elements
  if (['click','press','hover','doubleClick'].includes(step.action)) {
    let best = null, bestScore = 0;
    for (const e of pageState.visibleElements || []) {
      const s = Math.max(score(e.text), score(e.label), score(e.ariaLabel));
      if (s > bestScore) { bestScore = s; best = e; }
    }
    if (best && bestScore >= 90) {
      return {
        action: step.action,
        selectors: [`[data-agent-id="${best.agentId}"]`],
        value: step.value || '',
        textHint: best.text || best.label,
        _local: true
      };
    }
  }

  return null;
}

// ==================== COMPACT CONTEXT BUILDER ====================
function buildCompactContext(pageState, maxFormFields = 15, maxButtons = 15, maxLinks = 10) {
  // Compact arrays instead of objects — saves ~60% tokens
  const fields = (pageState.formFields || [])
    .slice(0, maxFormFields)
    .filter(f => f.isVisible)
    .map(f => `${f.label}|${f.fieldType}${f.required ? '|REQ' : ''}`);

  const buttons = pageState.visibleElements
    .filter(e => e.category === 'button' || e.category === 'expandable' || e.category === 'dropdown-trigger')
    .slice(0, maxButtons)
    .map(e => (e.text || e.label || '').slice(0, 40))
    .filter(Boolean);

  const links = pageState.visibleElements
    .filter(e => e.category === 'link')
    .slice(0, maxLinks)
    .map(e => (e.text || '').slice(0, 40))
    .filter(Boolean);

  const tabs = pageState.visibleElements
    .filter(e => ['tab','menu-item','option'].includes(e.category))
    .slice(0, 10)
    .map(e => (e.text || '').slice(0, 30))
    .filter(Boolean);

  return { fields, buttons, links, tabs };
}

// ==================== PLANNER (COMPACT) ====================
// ==================== PLANNER (TWO-STAGE COT) ====================
async function plannerAgent(task, pageState) {
  // ============================================================
  //  STAGE 1: ANALYZE (chain of thought)
  // ============================================================
  const fields = (pageState.formFields || [])
    .filter(f => f.isVisible)
    .slice(0, 20)
    .map(f => `${f.label} [${f.fieldType}${f.required ? ',REQ' : ''}]`);

  const buttons = pageState.visibleElements
    .filter(e => e.category === 'button' || e.category === 'expandable' || e.category === 'dropdown-trigger')
    .slice(0, 25)
    .map(e => `"${(e.text || e.label || '').slice(0, 40)}"`)
    .filter(t => t.length > 3);

  const links = pageState.visibleElements
    .filter(e => e.category === 'link')
    .slice(0, 20)
    .map(e => `"${(e.text || '').slice(0, 40)}"`)
    .filter(t => t.length > 3);

  const tabs = pageState.visibleElements
    .filter(e => ['tab', 'menu-item', 'option'].includes(e.category))
    .slice(0, 15)
    .map(e => `"${(e.text || '').slice(0, 30)}"`)
    .filter(t => t.length > 3);

  const headings = (pageState.headings || []).slice(0, 8).map(h => h.text).join(' | ');
  const preview = (pageState.textPreview || '').slice(0, 300);

  const analyzePrompt = `You are analyzing a browser task. Think STEP BY STEP.

═══════════════════════════════════════════
USER TASK: ${task}
═══════════════════════════════════════════

CURRENT PAGE:
URL: ${pageState.url}
Title: ${pageState.title}
Headings: ${headings}
Text preview: ${preview}

PAGE ELEMENTS:
Form fields: ${JSON.stringify(fields)}
Buttons: ${JSON.stringify(buttons)}
Links: ${JSON.stringify(links)}
Tabs/Menu: ${JSON.stringify(tabs)}

═══════════════════════════════════════════
ANALYZE CAREFULLY. Answer these questions:
═══════════════════════════════════════════

1. TASK GOAL: What is the user ACTUALLY trying to accomplish? (not literal words, but intent)
2. TASK TYPE: Is this: SEARCH / FORM-FILL / NAVIGATION / INTERACTION / DATA-EXTRACTION / MULTI-STEP? 
3. CURRENT STATE: Is the page ALREADY on the right place, or do we need to navigate first?
4. PREREQUISITES: What needs to happen BEFORE the main goal? (e.g., navigate to site first)
5. THE MAIN ACTION: What is the single most important action needed?
6. OPTIONAL FOLLOW-UPS: After main action, is there anything else? (e.g., click result, verify)
7. POSSIBLE PITFALLS: What could go wrong? (e.g., popup, cookie banner, login wall)
8. INFORMATION NEEDED: Do I have all the values I need, or must I derive them?

Respond with JSON ONLY:
{
  "goal": "one-line intent",
  "taskType": "SEARCH|FORM|NAV|INTERACT|EXTRACT|MULTI",
  "currentState": "already on target page OR need to navigate to X",
  "prerequisites": ["list of things to do first"],
  "mainAction": "description of main action",
  "followUps": ["optional followups"],
  "pitfalls": ["things to watch out for"],
  "derivedValues": {"field": "value"}
}`;

  log('Planner Stage 1: analyzing...');
  let analysis = null;
  try {
    const analysisRaw = await callServerLLM(analyzePrompt);
    log('Analysis raw:', analysisRaw?.slice(0, 300));
    analysis = safeJSONParse(analysisRaw);
  } catch (e) {
    logError('Analysis failed:', e.message);
  }

  // ============================================================
  //  STAGE 2: PLAN (informed by analysis)
  // ============================================================
  const analysisContext = analysis
    ? `ANALYSIS FROM PREVIOUS STEP:
Goal: ${analysis.goal || '?'}
Task Type: ${analysis.taskType || '?'}
Current State: ${analysis.currentState || '?'}
Prerequisites: ${JSON.stringify(analysis.prerequisites || [])}
Main Action: ${analysis.mainAction || '?'}
Follow-ups: ${JSON.stringify(analysis.followUps || [])}
Pitfalls: ${JSON.stringify(analysis.pitfalls || [])}
Derived Values: ${JSON.stringify(analysis.derivedValues || {})}`
    : '';

  const planPrompt = `You are creating a browser automation plan.

TASK: ${task}

${analysisContext}

PAGE CONTEXT (for reference only — use ONLY elements that exist here):
Form fields: ${JSON.stringify(fields)}
Buttons: ${JSON.stringify(buttons)}
Links: ${JSON.stringify(links)}
Tabs/Menu: ${JSON.stringify(tabs)}
URL: ${pageState.url}

═══════════════════════════════════════════
PLANNING RULES — FOLLOW STRICTLY
═══════════════════════════════════════════

RULE 1: Be DETAILED. Add every necessary step. Don't skip.
RULE 2: Include navigation step if you're not on the right page.
RULE 3: Include WAIT after navigation/search (2500-4000ms).
RULE 4: For SEARCH tasks, use ONE of:
   - If search box exists: {"action":"search","target":"search box","value":"query"}
   - If it's Google/YouTube/Amazon: use direct URL like:
     Google: https://www.google.com/search?q=QUERY
     YouTube: https://www.youtube.com/results?search_query=QUERY  
     Amazon: https://www.amazon.in/s?k=QUERY
RULE 5: After search, ALWAYS add: {"action":"waitFor","target":"result-selector-description","value":"6000"} 
   OR {"action":"wait","value":"3500"}
RULE 6: For "open X result" — add CLICK step for the result link.
RULE 7: For form filling — one "type" step PER field. Never combine.
RULE 8: Values must MATCH field labels:
   - "full name" → "John Doe" (one field, one value)
   - "email" → "john.doe@example.com"
   - "phone/mobile" → "5551234567"
   - NEVER split "full name" into first/last unless separate fields exist.
RULE 9: Use ONLY elements listed above. NEVER invent fields/buttons.
RULE 10: If task requires multiple pages, add ALL steps in ONE plan.
RULE 11: Before planning a "click" or "type" step, VERIFY the target exists in the lists above.
- If you can't find the element in Form fields / Buttons / Links / Tabs, DO NOT plan it.
- Instead, plan a step to REACH that element first (e.g., navigate to YouTube, wait, then click).
- For YouTube video clicks: video titles are links like "Halka Halka Song Name" — plan a click with the video title text as target.
- For Google search results: use the exact page title as target text.

RULE 12: SEARCH + OPEN RESULT pattern (VERY COMMON):
Step 1: navigate to search URL (Google/YouTube/etc.)
Step 2: wait 3500ms
Step 3: click target with text = exact result title (not "first result")

WRONG: {"action":"click","target":"first result"}
RIGHT: {"action":"click","target":"ISRO - Wikipedia"}
Task: "Search Halka Halka song on YouTube and play it"
Plan: [
  {"action":"navigate","target":"https://www.youtube.com/results?search_query=Halka%20Halka%20song"},
  {"action":"wait","value":"3500"},
  {"action":"click","target":"Halka Halka - full song title from results"}
]

ACTIONS:
- navigate: {"action":"navigate","target":"https://..."}
- search:   {"action":"search","target":"search box description","value":"query"}
- type:     {"action":"type","target":"exact field label","value":"text"}
- click:    {"action":"click","target":"element text or description"}
- hover:    {"action":"hover","target":"description"} 
- press:    {"action":"press","target":"description","value":"Enter"}
- scroll:   {"action":"scroll","value":"down|up"}
- wait:     {"action":"wait","value":"3000"}
- waitFor:  {"action":"waitFor","target":"selector description","value":"6000"}
- extract:  {"action":"extract","target":"description"}
- newTab:   {"action":"newTab","target":"url"}

EXAMPLES:

Task: "Search for ISRO on Google then open Wikipedia result"
Plan: [
  {"action":"navigate","target":"https://www.google.com/search?q=ISRO"},
  {"action":"wait","value":"3500"},
  {"action":"click","target":"Wikipedia result link"}
]

Task: "Fill this form: <URL>"
Plan: [
  {"action":"navigate","target":"<URL>"},
  {"action":"wait","value":"2500"},
  {"action":"type","target":"full name","value":"John Doe"},
  {"action":"type","target":"email address","value":"john.doe@example.com"},
  {"action":"type","target":"mobile number","value":"5551234567"},
  {"action":"click","target":"Submit"}
]

Task: "Search Jay Gurjar on LinkedIn"
Plan: [
  {"action":"navigate","target":"https://www.google.com/search?q=Jay%20Gurjar%20LinkedIn"},
  {"action":"wait","value":"3500"},
  {"action":"click","target":"LinkedIn profile link"}
]

Respond with JSON ONLY:
{"steps":[...], "reasoning": "1-line explanation of the plan"}`;

  log('Planner Stage 2: planning...');
  const response = await callServerLLM(planPrompt);
  log('Plan raw:', response?.slice(0, 400));

  const parsed = safeJSONParse(response);
  if (parsed && Array.isArray(parsed.steps)) {
    if (parsed.reasoning) log('Plan reasoning:', parsed.reasoning);
    return parsed.steps;
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && parsed.action) return [parsed];
  return [];
}


// ==================== LOCAL TEXT MATCH (fallback) ====================
function localTextMatch(step, pageState) {
  const target = (step.target || '').toLowerCase().trim();
  if (!target || target.length < 2) return null;

  // Build all candidate elements (visible)
  const all = [
    ...(pageState.formFields || []).map(f => ({
      text: f.label, agentId: f.agentId, category: 'form-field'
    })),
    ...(pageState.visibleElements || [])
  ];

  // Remove stop words from target
  const stopWords = ['the', 'a', 'an', 'on', 'in', 'to', 'of', 'for', 'link', 'result', 'button', 'click'];
  const targetWords = target.split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));

  let best = null;
  let bestScore = 0;

  for (const el of all) {
    const elText = ((el.text || '') + ' ' + (el.label || '') + ' ' + (el.ariaLabel || '') + ' ' + (el.title || '')).toLowerCase();
    if (!elText.trim()) continue;

    let score = 0;

    // Exact substring
    if (elText.includes(target)) score += 100;

    // Reverse contains
    if (target.includes(elText.trim()) && elText.trim().length > 3) score += 80;

    // Word overlap
    const elWords = elText.split(/\s+/).filter(w => w.length > 2);
    const overlap = targetWords.filter(w => elWords.some(ew => ew.includes(w) || w.includes(ew)));
    score += overlap.length * 15;

    // Penalize very long text (probably not a card)
    if (elText.length > 200) score -= 20;

    // Prefer links/buttons/cards
    if (['link', 'button', 'clickable-card', 'clickable'].includes(el.category)) score += 10;

    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  // Threshold: only return if reasonably confident
  if (best && bestScore >= 30) {
    log(`✅ Local text match: "${step.target}" → "${(best.text || best.label || '').slice(0, 60)}" (score: ${bestScore})`);
    return {
      action: step.action,
      selectors: [`[data-agent-id="${best.agentId}"]`],
      value: step.value || '',
      textHint: (best.text || best.label || '').slice(0, 60),
      _local: true,
      _score: bestScore
    };
  }

  return null;
}

// ==================== NAVIGATOR (COMPACT + LOCAL MATCH) ====================
async function navigatorAgent(step, pageState) {

  const localText = localTextMatch(step, pageState);
  if (localText) return localText;

  // 2. Try structured local match (form fields by label)
  const localStruct = localMatch(step, pageState);
  if (localStruct) return localStruct;

  // 3. Check cache
  const cached = getCachedNavigator(step, pageState.url);
  if (cached) return cached;


  // 1. Try LOCAL matching first
  const local = localMatch(step, pageState);
  if (local) {
    log('✅ Local match:', step.target, '→', local.textHint);
    return local;
  }

  // 3. Build compact candidate list
  const candidates = [];

  (pageState.formFields || []).slice(0, 15).filter(f => f.isVisible).forEach(f => {
    candidates.push(`F|${f.label}|${f.agentId}`);
  });

  pageState.visibleElements
  .filter(e => ['button','expandable','dropdown-trigger','link','tab','menu-item','clickable','clickable-card','option','interactive'].includes(e.category))
  .slice(0, 60)  // ← 30 se 60
  .forEach(e => {
    const t = (e.text || e.label || e.ariaLabel || '').slice(0, 50);
    if (t) candidates.push(`${e.category[0].toUpperCase()}|${t}|${e.agentId}`);
  });

  const prompt = `STEP: ${JSON.stringify(step)}
PAGE: ${pageState.url}

CANDIDATES (FORMAT: type|text|agentId):
${candidates.join('\n')}

Return the best match. JSON ONLY:
{"action":"${step.action}","selectors":["[data-agent-id=\\"ID\\"]"],"value":"${step.value || ''}","textHint":"matched text"}

If no match: {"action":"${step.action}","selectors":[],"textHint":"no match found"}`;

  log('Navigator: sending compact prompt, length:', prompt.length);
  const response = await callServerLLM(prompt);
  log('Navigator raw:', response?.slice(0, 200));

  const parsed = safeJSONParse(response);
  if (!parsed) return null;

  if (parsed.selectors && !Array.isArray(parsed.selectors)) parsed.selectors = [parsed.selectors];
  if (!parsed.selectors && parsed.selector) parsed.selectors = [parsed.selector];

  // Cache it
  if (parsed.selectors?.length) {
    setNavigatorCache(step, pageState.url, parsed);
  }

  return parsed;
}

// ==================== VALIDATOR (COMPACT) ====================
async function validatorAgent(task, history, pageState) {
  const summary = history.slice(-8).map(h =>
    `${h.step?.action || '?'}:${h.step?.target || ''}=${h.result?.success ? 'OK' : 'FAIL'}`
  ).join(' | ');

  const succeeded = history.filter(h => h.result?.success).length;
  const total = history.length;

  const prompt = `TASK: ${task}
STEPS: ${summary}
RESULT: ${succeeded}/${total} succeeded
URL: ${pageState.url}

Is task fully completed? Consider: FORM (all filled+submitted), SEARCH (results loaded), NAV (URL matched), INTERACTION (success).

JSON ONLY: {"completed":true/false,"reason":"short"}`;

  log('Validator: compact prompt, length:', prompt.length);
  const response = await callServerLLM(prompt);
  log('Validator raw:', response?.slice(0, 150));
  return safeJSONParse(response) || { completed: false, reason: 'parse error' };
}

// ==================== EXECUTORS (from Phase 2) ====================
function clickExecutor(selector) {
  let el = document.querySelector(selector);
  if (!el) return { success: false, reason: 'not found' };

  try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) {}

  // Reveal if hidden
  const s = window.getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden') {
    el.style.display = 'block';
    el.style.visibility = 'visible';
    el.style.opacity = '1';
  }

  // Click strategies
  try { el.click(); } catch (e) {}
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => {
    try { el.dispatchEvent(new PointerEvent(t.replace('mouse', 'mouse'), { bubbles: true, cancelable: true, view: window, button: 0 })); } catch (e) {}
  });

  // If custom element, click inner clickable (YouTube)
  const innerClickable = el.querySelector('a[href], button, [role="button"], [role="link"]');
  if (innerClickable && innerClickable !== el) {
    try {
      innerClickable.click();
      innerClickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch (e) {}
  }

  return { success: true, tag: el.tagName, clicked: true };
}

function typeExecutor(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return { success: false };
  try { el.scrollIntoView({ block: 'center' }); el.focus(); } catch (e) {}

  if (el.getAttribute('contenteditable') === 'true') {
    el.innerText = value;
    ['input','change','blur'].forEach(e => { try { el.dispatchEvent(new Event(e, { bubbles: true })); } catch (x) {} });
    return { success: true, filledValue: value };
  }
  if (el.tagName === 'SELECT') {
    for (const opt of el.options) {
      if (opt.value === value || opt.text.toLowerCase() === value.toLowerCase()) { el.value = opt.value; break; }
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  }

  try {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
  } catch (e) { el.value = value; }
  ['input','change','blur'].forEach(e => { try { el.dispatchEvent(new Event(e, { bubbles: true })); } catch (x) {} });
  return { success: true, filledValue: el.value };
}

// ==================== SEARCH (multi-strategy submit) ====================
function searchExecutorDOM(selector, value) {
  // This runs in page context — types value and returns, submit happens via CDP
  const el = document.querySelector(selector);
  if (!el) return { success: false, reason: 'not found' };

  try { el.scrollIntoView({ block: 'center' }); el.focus(); } catch (e) {}

  // Type using native setter
  try {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  } catch (e) { el.value = value; }

  ['input', 'change'].forEach(evt => {
    try { el.dispatchEvent(new Event(evt, { bubbles: true })); } catch (e) {}
  });

  return { success: true, filledValue: el.value };
}

async function searchExecutor(tabId, selector, value) {
  // Step 1: Focus + type via DOM
  const typeRes = await findAndExecuteSingle(tabId, [selector], searchExecutorDOM, [value]);
  if (!typeRes.success) return { success: false, reason: 'type failed' };

  log('Search: typed, now attempting submit...');

  // Step 2: Try REAL Enter via CDP (best)
  await sleep(300);
  const cdpOk = await realKeyPress(tabId, 'Enter');
  if (cdpOk) {
    log('✅ CDP Enter sent');
    await sleep(1500);
    return { success: true, method: 'cdp-enter', filledValue: value };
  }

  // Step 3: Fallback — find and click search button via DOM
  log('CDP failed, trying search button click...');
  const btnClick = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const input = document.querySelector(sel);
      if (!input) return { success: false };

      // Look for search button in order of preference
      const findButton = () => {
        // Same form
        if (input.form) {
          const b = input.form.querySelector(
            'button[type="submit"], input[type="submit"], ' +
            'button[aria-label*="Search" i], button[aria-label*="search" i], ' +
            'button[title*="Search" i], [role="button"][aria-label*="Search" i]'
          );
          if (b) return b;
        }
        // Parent walk
        let p = input.parentElement;
        for (let i = 0; i < 6 && p; i++) {
          const b = p.querySelector(
            'button[type="submit"], input[type="submit"], ' +
            'button[aria-label*="Search" i], button[aria-label*="search" i], ' +
            '[role="button"][aria-label*="Search" i], button[title*="Search" i]'
          );
          if (b) return b;
          p = p.parentElement;
        }
        // Sibling of input
        let sib = input.nextElementSibling;
        for (let i = 0; i < 3 && sib; i++) {
          if (sib.tagName === 'BUTTON' || sib.getAttribute('role') === 'button') return sib;
          sib = sib.nextElementSibling;
        }
        return null;
      };

      const btn = findButton();
      if (!btn) return { success: false, reason: 'no button found' };

      btn.scrollIntoView({ block: 'center' });
      btn.click();
      ['mousedown', 'mouseup', 'click'].forEach(t => {
        try { btn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
      });
      return { success: true, buttonText: (btn.innerText || btn.value || '').slice(0, 30) };
    },
    args: [selector]
  });

  if (btnClick[0]?.result?.success) {
    log('✅ Search button clicked:', btnClick[0].result.buttonText);
    await sleep(1500);
    return { success: true, method: 'button-click', filledValue: value };
  }

  // Step 4: Fallback — form submit
  log('Button click failed, trying form submit...');
  const formSubmit = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const input = document.querySelector(sel);
      if (!input?.form) return { success: false };
      try {
        if (typeof input.form.requestSubmit === 'function') {
          input.form.requestSubmit();
          return { success: true, method: 'requestSubmit' };
        }
        input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return { success: true, method: 'submit-event' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },
    args: [selector]
  });

  if (formSubmit[0]?.result?.success) {
    log('✅ Form submitted via', formSubmit[0].result.method);
    await sleep(1500);
    return { success: true, method: formSubmit[0].result.method, filledValue: value };
  }

  return { success: false, reason: 'all submit methods failed', filledValue: value };
}

// Helper — single selector execute
async function findAndExecuteSingle(tabId, selectors, fn, args = []) {
  for (const sel of selectors) {
    try {
      const r = await chrome.scripting.executeScript({
        target: { tabId },
        func: fn,
        args: [sel, ...args]
      });
      if (r[0]?.result?.success) return { success: true, selector: sel, result: r[0].result };
    } catch (e) {}
  }
  return { success: false };
}
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
  ['keydown','keypress','keyup'].forEach(t => { try { el.dispatchEvent(new KeyboardEvent(t, init)); } catch (e) {} });
  if (k === 'Enter' && el.form) {
    try { el.form.requestSubmit ? el.form.requestSubmit() : el.form.dispatchEvent(new Event('submit', { bubbles: true })); } catch (e) {}
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

// ==================== ACTION ROUTER ====================
async function findAndExecute(tabId, frameId, selectors, fn, args = []) {
  for (const sel of selectors) {
    try {
      const r = await chrome.scripting.executeScript({
        target: frameId != null ? { tabId, frameIds: [frameId] } : { tabId },
        func: fn, args: [sel, ...args]
      });
      if (r[0]?.result?.success) return { success: true, selector: sel, result: r[0].result };
    } catch (e) { log('Selector failed:', sel, e.message); }
  }
  return { success: false };
}

async function executeAction(tabId, frameId, action) {
  if (!action?.action) return { success: false };
  const sels = action.selectors || (action.selector ? [action.selector] : []);

  if (action.action === 'navigate') {
    const url = action.target || action.value;
    if (!url) return { success: false };
    await chrome.tabs.update(tabId, { url });
    await waitForTabLoad(tabId);
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
  if (sels.length === 0) return { success: false };

  if (action.action === 'click') return await findAndExecute(tabId, frameId, sels, clickExecutor);
  if (action.action === 'type') return await findAndExecute(tabId, frameId, sels, typeExecutor, [action.value || '']);
  if (action.action === 'search') {
  return await searchExecutor(tabId, action.selectors[0], action.value || '');
}
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
  return { success: false };
}

function waitForTabLoad(tabId, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let done = false;
    const l = (id, info) => { if (id === tabId && info.status === 'complete' && !done) { done = true; chrome.tabs.onUpdated.removeListener(l); resolve(); } };
    chrome.tabs.onUpdated.addListener(l);
    setTimeout(() => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(l); resolve(); } }, timeoutMs);
  });
}

// ==================== MAIN LOOP ====================
async function runAgent(task, tabId) {
  agentState = { task, plan: [], currentStep: 0, isRunning: true, history: [] };
  log('========== AGENT START ==========');
  startKeepalive();

  try {
    let tab = await chrome.tabs.get(tabId);
    if (!isScriptableUrl(tab.url)) {
      broadcastToUI({ type: 'COMPLETE', reason: `❌ Cannot work on "${tab.url}"` });
      return;
    }

    // Auto-navigate
    const targetUrl = extractUrlFromTask(task);
    if (targetUrl && normalizeUrl(targetUrl) !== normalizeUrl(tab.url)) {
      broadcastToUI({ type: 'STATUS', message: '🌐 Navigating...' });
      await chrome.tabs.update(tabId, { url: targetUrl });
      await waitForTabLoad(tabId);
      await sleep(2000);
    }

    // Page state
    broadcastToUI({ type: 'STATUS', message: '📄 Reading page...' });
    let pageState = await getPageState(tabId);

    // Plan
    broadcastToUI({ type: 'STATUS', message: '🧠 Planning...' });
    agentState.plan = await plannerAgent(task, pageState);
    log('Plan:', JSON.stringify(agentState.plan));

    if (!agentState.plan.length) {
      broadcastToUI({ type: 'COMPLETE', reason: '❌ Planner failed' });
      return;
    }
    broadcastToUI({ type: 'PLAN', plan: agentState.plan });

    // Execute
    let failedSteps = 0;

    for (agentState.currentStep = 0; agentState.currentStep < agentState.plan.length && agentState.isRunning; agentState.currentStep++) {
      const step = agentState.plan[agentState.currentStep];
      log(`--- Step ${agentState.currentStep + 1}/${agentState.plan.length}:`, JSON.stringify(step));

      broadcastToUI({ type: 'STEP', step, index: agentState.currentStep });

      // Non-selector actions
      if (['navigate','scroll','wait','newTab'].includes(step.action)) {
        const r = await executeAction(tabId, null, step);
        agentState.history.push({ step, result: r });
        if (!r.success) failedSteps++;
        await sleep(500);
        continue;
      }

      // Get fresh state
      let currentPage;
      try { currentPage = await getPageState(tabId); }
      catch (e) { agentState.history.push({ step, error: e.message }); failedSteps++; continue; }

      // Resolve
      let action;
      try { action = await navigatorAgent(step, currentPage); }
      catch (e) {
        logError('Navigator failed:', e.message);
        agentState.history.push({ step, error: e.message });
        failedSteps++;
        continue;
      }

      if (!action?.selectors?.length && action?.action !== 'navigate') {
        logError('No selectors for step:', step.target);
        agentState.history.push({ step, error: 'no selectors' });
        failedSteps++;
        continue;
      }

      // Execute
      broadcastToUI({ type: 'STATUS', message: `⚡ ${action.action}` });
      const execResult = await executeAction(tabId, null, action);
      log('Execute result:', JSON.stringify(execResult));

      agentState.history.push({ step, action, result: execResult });
      if (!execResult.success) failedSteps++;

      await sleep(800);
    }

    // Final validation — skip if all succeeded and task is simple
    let validation;
    if (failedSteps === 0 && agentState.history.length <= 3) {
      validation = { completed: true, reason: 'All steps executed successfully' };
      log('Skipping validator — all steps OK');
    } else {
      broadcastToUI({ type: 'STATUS', message: '✅ Validating...' });
      let finalPage;
      try { finalPage = await getPageState(tabId); } catch { finalPage = pageState; }
      try { validation = await validatorAgent(task, agentState.history, finalPage); }
      catch (e) { validation = { completed: failedSteps === 0, reason: `${failedSteps} failed` }; }
    }

    log('Final:', JSON.stringify(validation));

    if (validation.completed) {
      broadcastToUI({ type: 'COMPLETE', reason: `✅ ${validation.reason}` });
    } else {
      broadcastToUI({ type: 'COMPLETE', reason: `⚠️ ${validation.reason}` });
    }
  } catch (err) {
    logError('Agent error:', err.message);
    broadcastToUI({ type: 'COMPLETE', reason: `❌ ${err.message}` });
  } finally {
    agentState.isRunning = false;
    stopKeepalive();
    log('========== AGENT END ==========');
  }
}

// ==================== MESSAGE HANDLING ====================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_TASK') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return sendResponse({ started: false });
      runAgent(msg.task, tabs[0].id);
      sendResponse({ started: true });
    });
    return true;
  }
  if (msg.type === 'STOP_TASK') {
    agentState.isRunning = false;
    sendResponse({ stopped: true });
    return true;
  }
});

log('Background loaded');
ensureOffscreen();