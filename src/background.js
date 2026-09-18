


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
  try {
    const u = new URL(url);
    return (u.origin + u.pathname).replace(/\/$/, '');
  } catch { return url; }
}

function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete' && !done) {
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      if (!done) {
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }, timeoutMs);
  });
}

async function waitForPageReady(tabId, minFields = 1, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const state = await getPageState(tabId);
      if (state.formFields.length >= minFields || state.visibleElements.length > 5) return state;
    } catch (e) {}
    await sleep(800);
  }
  try { return await getPageState(tabId); } catch { return null; }
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

// ==================== SERVER LLM ====================
async function callServerLLM(prompt, image = null, retries = 2) {
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
        const err = await res.text();
        throw new Error(`HTTP ${res.status}: ${err}`);
      }

      const data = await res.json();
      return data.response;
    } catch (e) {
      lastErr = e;
      logError(`Server attempt ${attempt}/${retries} failed:`, e.message);
      if (attempt < retries) await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

// ==================== PAGE STATE ====================
async function getPageState(tabId) {
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

  log(`Extracted ${allElements.length} elements, ${allFormFields.length} form fields, ${allHeadings.length} headings`);

  return {
    url: tab.url,
    title: mainFrame?.title || '',
    textPreview: mainFrame?.textPreview || '',
    headings: allHeadings.slice(0, 20),
    formFields: allFormFields,
    visibleElements: allElements.filter(e => e.isVisible && !e.disabled).slice(0, 100),
    hiddenElements: allElements.filter(e => !e.isVisible && !e.disabled).slice(0, 40),
    timestamp: Date.now()
  };
}

// ==================== EXTRACTION (UNIVERSAL) ====================
function extractPageStateInFrame() {
  const elements = [];
  const formFields = [];
  const headings = [];
  const seen = new WeakSet();

  function tagWithAgentId(el) {
    if (!el.hasAttribute('data-agent-id')) {
      const id = `ag-${Math.random().toString(36).slice(2, 9)}`;
      el.setAttribute('data-agent-id', id);
    }
    return el.getAttribute('data-agent-id');
  }

  function findLabel(el) {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/)
        .map(id => document.getElementById(id))
        .filter(Boolean)
        .map(n => (n.innerText || n.textContent || '').trim())
        .filter(Boolean);
      if (parts.length) return parts.join(' ');
    }

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();

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
      const t = (clone.innerText || '').trim();
      if (t) return t;
    }

    // Parent walk (Google Forms, Material UI, etc.)
    let cur = el.parentElement;
    for (let depth = 0; depth < 8 && cur; depth++) {
      const children = Array.from(cur.children);
      const textNodes = children.filter(c => {
        if (c.contains(el)) return false;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(c.tagName)) return false;
        if (c.querySelector('input, textarea, select')) return false;
        const t = (c.innerText || '').trim();
        return t && t.length > 0 && t.length < 200;
      });
      if (textNodes.length) {
        const label = (textNodes[0].innerText || '').trim();
        if (label && !/^(required|\*|optional)$/i.test(label)) return label;
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
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    return true;
  }

  function isInViewport(el) {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;
  }

  function categorize(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    if (['input','textarea','select'].includes(tag)) return 'form-field';
    if (['textbox','combobox','listbox','checkbox','radio','switch','slider','spinbutton'].includes(role)) return 'form-field';
    if (tag === 'button' || role === 'button') return 'button';
    if (tag === 'a' && el.href) return 'link';
    if (role === 'tab') return 'tab';
    if (role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio') return 'menu-item';
    if (role === 'option') return 'option';
    if (tag === 'summary') return 'disclosure';
    if (el.hasAttribute('aria-expanded')) return 'expandable';
    if (el.hasAttribute('aria-haspopup')) return 'dropdown-trigger';
    if (['nav','header','footer','aside','main'].includes(tag)) return 'landmark';
    return 'interactive';
  }

  function getSelectors(el, agentId) {
    const sels = [`[data-agent-id="${agentId}"]`];
    const tag = el.tagName.toLowerCase();

    const lb = el.getAttribute('aria-labelledby');
    if (lb) sels.push(`${tag}[aria-labelledby="${CSS.escape(lb)}"]`);

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && !/^(your\s*answer|answer|input|text|search)$/i.test(ariaLabel)) {
      sels.push(`[aria-label="${CSS.escape(ariaLabel)}"]`);
    }

    for (const attr of ['data-testid', 'data-test', 'data-qa', 'data-cy']) {
      const v = el.getAttribute(attr);
      if (v) sels.push(`[${attr}="${CSS.escape(v)}"]`);
    }

    if (el.id && !/^[0-9]/.test(el.id)) sels.push(`#${CSS.escape(el.id)}`);
    if (el.name) sels.push(`${tag}[name="${CSS.escape(el.name)}"]`);
    if (el.placeholder) sels.push(`${tag}[placeholder="${CSS.escape(el.placeholder)}"]`);

    // Text-based fallback for links/buttons
    const txt = (el.innerText || '').trim();
    if (txt && txt.length < 50 && (tag === 'a' || tag === 'button')) {
      sels.push(`${tag}[data-agent-text="${CSS.escape(txt)}"]`);
    }

    return [...new Set(sels)];
  }

  function isFormField(el) {
    const tag = el.tagName.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return true;
    const role = el.getAttribute('role');
    return ['textbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch'].includes(role);
  }

  function getFieldType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    if (tag === 'input') return el.type || 'text';
    return el.getAttribute('role') || 'unknown';
  }

  function visit(root) {
    if (!root || !root.querySelectorAll) return;
    let nodes;
    try {
      // Universal selector — includes hidden-relevant triggers
      nodes = root.querySelectorAll([
        'input', 'textarea', 'select', 'button',
        'a[href]',
        '[role]',
        '[contenteditable="true"]',
        '[onclick]',
        '[aria-expanded]',
        '[aria-haspopup]',
        'summary',
        '[tabindex]:not([tabindex="-1"])'
      ].join(','));
    } catch (e) { return; }

    nodes.forEach(el => {
      if (seen.has(el)) return;
      seen.add(el);

      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'meta', 'head', 'link'].includes(tag)) return;
      if (el.type === 'hidden') return;

      const agentId = tagWithAgentId(el);
      const rect = el.getBoundingClientRect();
      const visible = isVisible(el);
      const inViewport = isInViewport(el);
      const label = findLabel(el);
      const selectors = getSelectors(el, agentId);
      const category = categorize(el);

      const entry = {
        tag: el.tagName,
        type: el.type || '',
        role: el.getAttribute('role') || '',
        category,
        label,
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.placeholder || '',
        text: (el.innerText || el.value || '').slice(0, 100).trim(),
        href: el.href || '',
        isVisible: visible,
        isInViewport: inViewport,
        ariaExpanded: el.getAttribute('aria-expanded'),
        ariaHasPopup: el.getAttribute('aria-haspopup'),
        agentId,
        selectors
      };

      elements.push(entry);

      if (isFormField(el)) {
        formFields.push({
          label: label || `(unlabeled ${tag})`,
          fieldType: getFieldType(el),
          required: el.required || el.getAttribute('aria-required') === 'true',
          currentValue: el.value || '',
          isVisible: visible,
          isDisabled: el.disabled || false,
          agentId,
          selectors
        });
      }

      if (el.shadowRoot) visit(el.shadowRoot);
    });
  }

  visit(document);

  // Headings (page context)
  document.querySelectorAll('h1, h2, h3, [role="heading"]').forEach(h => {
    const t = (h.innerText || '').trim();
    if (t && t.length < 200) {
      headings.push({ level: h.tagName, text: t });
    }
  });

  // Text preview (main content)
  let textPreview = '';
  try {
    const main = document.querySelector('main, [role="main"], article') || document.body;
    textPreview = (main.innerText || '').replace(/\s+/g, ' ').slice(0, 600);
  } catch (e) {}

  return {
    url: location.href,
    title: document.title,
    textPreview,
    headings: headings.slice(0, 20),
    elements: elements.slice(0, 250),
    formFields: formFields.slice(0, 100)
  };
}

// ==================== ACTION EXECUTION ====================
async function findAndExecute(tabId, frameId, selectors, executorFn, args = []) {
  for (const sel of selectors) {
    try {
      const results = await chrome.scripting.executeScript({
        target: frameId != null ? { tabId, frameIds: [frameId] } : { tabId },
        func: executorFn,
        args: [sel, ...args]
      });
      const r = results[0]?.result;
      if (r && r.success) {
        log(`✅ Selector worked: ${sel}`);
        return { success: true, selector: sel, result: r };
      }
    } catch (e) {
      log(`Selector failed: ${sel} — ${e.message}`);
    }
  }
  return { success: false };
}

function clickExecutor(selector) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, reason: 'not found' };
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}

  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || el.offsetParent === null) {
    el.removeAttribute('hidden');
    el.style.display = el.style.display === 'none' ? 'block' : el.style.display;
    el.style.visibility = 'visible';
    el.style.opacity = '1';
  }

  try { el.click(); } catch (e) {}
  ['mousedown', 'mouseup', 'click'].forEach(type => {
    try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
  });
  return { success: true, tag: el.tagName };
}

function typeExecutor(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, reason: 'not found' };

  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  try { el.focus(); } catch (e) {}

  // Handle contenteditable
  if (el.getAttribute('contenteditable') === 'true') {
    el.innerText = value;
    ['input', 'change', 'blur'].forEach(evt => {
      try { el.dispatchEvent(new Event(evt, { bubbles: true })); } catch (e) {}
    });
    return { success: true, tag: el.tagName, filledValue: value };
  }

  if (el.tagName === 'SELECT') {
    // Try matching by text or value
    let matched = false;
    for (const opt of el.options) {
      if (opt.value === value || opt.text.toLowerCase() === value.toLowerCase()) {
        el.value = opt.value;
        matched = true;
        break;
      }
    }
    if (!matched) el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, tag: 'SELECT' };
  }

  try {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  } catch (e) { el.value = value; }

  ['input', 'change', 'blur'].forEach(evt => {
    try { el.dispatchEvent(new Event(evt, { bubbles: true })); } catch (e) {}
  });

  return { success: true, tag: el.tagName, filledValue: el.value };
}

function hoverExecutor(selector) {
  const el = document.querySelector(selector);
  if (!el) return { success: false };
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  ['mouseenter', 'mouseover', 'mousemove', 'pointerenter', 'pointerover'].forEach(type => {
    try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
  });
  return { success: true, tag: el.tagName };
}

function pressExecutor(selector, key) {
  const el = selector ? document.querySelector(selector) : document.activeElement;
  if (!el) return { success: false };
  try { el.focus(); } catch (e) {}
  const k = key || 'Enter';
  ['keydown', 'keypress', 'keyup'].forEach(type => {
    try { el.dispatchEvent(new KeyboardEvent(type, { key: k, code: k === 'Enter' ? 'Enter' : '', bubbles: true })); } catch (e) {}
  });
  return { success: true, key: k };
}

async function executeAction(tabId, frameId, action) {
  if (!action || !action.action) return { success: false };

  const selectors = action.selectors || (action.selector ? [action.selector] : []);

  // === NO-SELECTOR ACTIONS ===
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
      func: (dir) => window.scrollBy({ top: dir === 'up' ? -500 : 500, behavior: 'smooth' }),
      args: [action.value || 'down']
    });
    await sleep(600);
    return { success: true };
  }

  if (action.action === 'wait') {
    const ms = parseInt(action.value) || 2000;
    await sleep(Math.min(ms, 15000));
    return { success: true };
  }

  // === TAB MANAGEMENT ===
  if (action.action === 'newTab') {
    const url = action.target || action.value;
    const newTab = await chrome.tabs.create({ url: url || 'about:blank', active: true });
    await waitForTabLoad(newTab.id);
    return { success: true, tabId: newTab.id };
  }

  if (action.action === 'closeTab') {
    try { await chrome.tabs.remove(tabId); } catch (e) {}
    return { success: true };
  }

  if (action.action === 'switchTab') {
    const idx = parseInt(action.value) || 0;
    const tabs = await chrome.tabs.query({ currentWindow: true });
    if (tabs[idx]) {
      await chrome.tabs.update(tabs[idx].id, { active: true });
      await sleep(500);
      return { success: true, tabId: tabs[idx].id };
    }
    return { success: false, reason: 'tab index out of range' };
  }

  // === KEYBOARD SHORTCUTS ===
  if (action.action === 'shortcut') {
    const target = { tabId };
    const results = await chrome.scripting.executeScript({
      target,
      func: keyboardShortcutExecutor,
      args: [null, action.value]
    });
    return { success: true, result: results[0]?.result };
  }

  // === SELECTOR-BASED ACTIONS ===
  if (selectors.length === 0) return { success: false, reason: 'no selectors' };

  if (action.action === 'click') return await findAndExecute(tabId, frameId, selectors, clickExecutor);
  if (action.action === 'doubleClick') return await findAndExecute(tabId, frameId, selectors, doubleClickExecutor);
  if (action.action === 'rightClick') return await findAndExecute(tabId, frameId, selectors, rightClickExecutor);
  if (action.action === 'type') return await findAndExecute(tabId, frameId, selectors, typeExecutor, [action.value || '']);
  if (action.action === 'hover') return await findAndExecute(tabId, frameId, selectors, hoverExecutor);
  if (action.action === 'search') {
  return await findAndExecute(tabId, frameId, selectors, searchExecutor, [action.value || '']);
}
  if (action.action === 'press') return await findAndExecute(tabId, frameId, selectors, pressExecutor, [action.value || 'Enter']);
  if (action.action === 'clear') return await findAndExecute(tabId, frameId, selectors, clearFieldExecutor);
  if (action.action === 'selectAll') return await findAndExecute(tabId, frameId, selectors, selectAllExecutor);
  if (action.action === 'waitFor') {
    return await findAndExecute(tabId, frameId, selectors, waitForSelectorExecutor, [action.value || '5000']);
  }
  if (action.action === 'dragDrop') {
    // action.value should contain target selector description
    const targetSel = action.value ? [action.value] : [];
    if (targetSel.length) {
      const src = selectors[0];
      const tgt = targetSel[0];
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: dragDropExecutor,
        args: [src, tgt]
      });
      return { success: results[0]?.result?.success };
    }
    return { success: false, reason: 'dragDrop needs value=targetSelector' };
  }
  if (action.action === 'upload') {
    return await findAndExecute(tabId, frameId, selectors, uploadExecutor, [action.value || '']);
  }

  // EXTRACT
  if (action.action === 'extract') {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        return { success: !!el, text: el ? el.innerText : '' };
      },
      args: [selectors[0]]
    });
    return { success: results[0]?.result?.success, text: results[0]?.result?.text };
  }

  return { success: false, reason: 'unknown action: ' + action.action };
}


// ==================== PRESS (improved) ====================
function pressExecutor(selector, key) {
  const el = selector ? document.querySelector(selector) : document.activeElement;
  if (!el) return { success: false, reason: 'no target' };
  try { el.focus(); } catch (e) {}

  const k = key || 'Enter';
  const kLower = k.toLowerCase();
  const keyCode = kLower === 'enter' ? 13 : kLower === 'tab' ? 9 : kLower === 'escape' ? 27 : 0;

  const eventInit = {
    key: k, code: k, keyCode, which: keyCode,
    bubbles: true, cancelable: true
  };

  try {
    el.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    el.dispatchEvent(new KeyboardEvent('keypress', eventInit));
    el.dispatchEvent(new KeyboardEvent('keyup', eventInit));
  } catch (e) {}

  // If Enter and inside a form — try submitting
  if (kLower === 'enter' && el.form) {
    try {
      if (typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
      else el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    } catch (e) {}
  }

  return { success: true, key: k, wasInForm: !!el.form };
}




// ==================== SEARCH (type + submit in one go) ====================
function searchExecutor(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, reason: 'search input not found' };

  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  try { el.focus(); } catch (e) {}

  // === STEP 1: Type value (native setter for React/Vue) ===
  if (el.getAttribute('contenteditable') === 'true') {
    el.innerText = value;
  } else {
    try {
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
    } catch (e) { el.value = value; }
  }

  // Dispatch input events
  ['input', 'change'].forEach(evt => {
    try { el.dispatchEvent(new Event(evt, { bubbles: true })); } catch (e) {}
  });

  // === STEP 2: Simulate real typing (character by character) ===
  // This helps frameworks recognize the value as "user typed"
  try {
    for (const ch of value) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('input', { data: ch, inputType: 'insertText', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
    }
  } catch (e) {}

  // === STEP 3: Press Enter (multiple strategies) ===
  const enterEvent = {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
    bubbles: true, cancelable: true
  };

  let submitted = false;

  // Strategy A: Enter keydown on the element
  try {
    el.dispatchEvent(new KeyboardEvent('keydown', enterEvent));
    el.dispatchEvent(new KeyboardEvent('keypress', enterEvent));
    el.dispatchEvent(new KeyboardEvent('keyup', enterEvent));
  } catch (e) {}

  // Strategy B: Look for a search/submit button nearby
  const findSearchButton = () => {
    // Look in the same form first
    if (el.form) {
      const btn = el.form.querySelector(
        'button[type="submit"], input[type="submit"], ' +
        'button[aria-label*="Search" i], button[aria-label*="search" i], ' +
        'button[title*="Search" i], [role="button"][aria-label*="Search" i]'
      );
      if (btn) return btn;
    }
    // Look in parent containers (up to 5 levels)
    let parent = el.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      const btn = parent.querySelector(
        'button[type="submit"], input[type="submit"], ' +
        'button[aria-label*="Search" i], button[aria-label*="search" i], ' +
        '[role="button"][aria-label*="Search" i], ' +
        'button[title*="Search" i]'
      );
      if (btn) return btn;
      parent = parent.parentElement;
    }
    return null;
  };

  const searchBtn = findSearchButton();
  if (searchBtn) {
    try {
      searchBtn.click();
      ['mousedown', 'mouseup', 'click'].forEach(type => {
        searchBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
      submitted = true;
    } catch (e) {}
  }

  // Strategy C: If in a form, requestSubmit (fires submit event properly)
  if (!submitted && el.form) {
    try {
      if (typeof el.form.requestSubmit === 'function') {
        el.form.requestSubmit();
        submitted = true;
      } else if (typeof el.form.submit === 'function') {
        el.form.submit();
        submitted = true;
      }
    } catch (e) {}
  }

  // Strategy D: Dispatch submit event on form
  if (!submitted && el.form) {
    try {
      el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      submitted = true;
    } catch (e) {}
  }

  return {
    success: true,
    filled: el.value,
    submitted,
    buttonFound: !!searchBtn,
    tag: el.tagName
  };
}

// ==================== ADVANCED EXECUTORS ====================

function doubleClickExecutor(selector) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, reason: 'not found' };
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  ['mousedown', 'mouseup', 'click', 'mousedown', 'mouseup', 'click', 'dblclick'].forEach(type => {
    try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, detail: 2 })); } catch (e) {}
  });
  return { success: true, tag: el.tagName };
}

function rightClickExecutor(selector) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, reason: 'not found' };
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  ['mousedown', 'mouseup', 'contextmenu'].forEach(type => {
    try {
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        button: 2, buttons: 2, clientX: x, clientY: y
      }));
    } catch (e) {}
  });
  return { success: true, tag: el.tagName };
}

function clearFieldExecutor(selector) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, reason: 'not found' };
  try { el.focus(); } catch (e) {}

  if (el.getAttribute('contenteditable') === 'true') {
    el.innerText = '';
  } else {
    try {
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, '');
      else el.value = '';
    } catch (e) { el.value = ''; }
  }
  ['input', 'change', 'blur'].forEach(evt => {
    try { el.dispatchEvent(new Event(evt, { bubbles: true })); } catch (e) {}
  });
  return { success: true };
}

function selectAllExecutor(selector) {
  const el = document.querySelector(selector);
  if (!el) return { success: false };
  try { el.focus(); } catch (e) {}
  if (el.select) { try { el.select(); } catch (e) {} }
  if (el.setSelectionRange && el.value) {
    try { el.setSelectionRange(0, el.value.length); } catch (e) {}
  }
  return { success: true };
}

function keyboardShortcutExecutor(_selector, combo) {
  // combo like "Control+S", "Ctrl+A", "Meta+K"
  if (!combo) return { success: false, reason: 'no combo' };
  const parts = combo.split('+').map(p => p.trim());
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1).map(m => m.toLowerCase());

  const eventInit = {
    key: key.length === 1 ? key : key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    ctrlKey: modifiers.includes('ctrl') || modifiers.includes('control'),
    shiftKey: modifiers.includes('shift'),
    altKey: modifiers.includes('alt'),
    metaKey: modifiers.includes('meta') || modifiers.includes('cmd'),
    bubbles: true,
    cancelable: true
  };

  const target = document.activeElement || document.body;
  ['keydown', 'keypress', 'keyup'].forEach(type => {
    try { target.dispatchEvent(new KeyboardEvent(type, eventInit)); } catch (e) {}
  });
  // Also try on document
  ['keydown', 'keyup'].forEach(type => {
    try { document.dispatchEvent(new KeyboardEvent(type, eventInit)); } catch (e) {}
  });
  return { success: true, combo };
}

function dragDropExecutor(sourceSel, targetSel) {
  const src = document.querySelector(sourceSel);
  const tgt = document.querySelector(targetSel);
  if (!src || !tgt) return { success: false, reason: 'source or target not found' };

  const dt = new DataTransfer();

  const fire = (el, type, x, y) => {
    const ev = new DragEvent(type, {
      bubbles: true, cancelable: true, view: window,
      dataTransfer: dt, clientX: x, clientY: y
    });
    try { el.dispatchEvent(ev); } catch (e) {}
  };

  const srcRect = src.getBoundingClientRect();
  const tgtRect = tgt.getBoundingClientRect();
  const sx = srcRect.left + srcRect.width / 2;
  const sy = srcRect.top + srcRect.height / 2;
  const tx = tgtRect.left + tgtRect.width / 2;
  const ty = tgtRect.top + tgtRect.height / 2;

  fire(src, 'dragstart', sx, sy);
  fire(src, 'drag', sx, sy);
  fire(tgt, 'dragenter', tx, ty);
  fire(tgt, 'dragover', tx, ty);
  fire(tgt, 'drop', tx, ty);
  fire(src, 'dragend', tx, ty);

  return { success: true };
}

function uploadExecutor(selector, fileInfo) {
  // fileInfo: JSON string like {"name":"file.txt","type":"text/plain","content":"hello"}
  const el = document.querySelector(selector);
  if (!el) return { success: false, reason: 'not found' };
  if (el.type !== 'file') return { success: false, reason: 'not a file input' };

  let info;
  try { info = typeof fileInfo === 'string' ? JSON.parse(fileInfo) : fileInfo; }
  catch { info = { name: 'upload.txt', type: 'text/plain', content: 'test' }; }

  try {
    const blob = new Blob([info.content || ''], { type: info.type || 'text/plain' });
    const file = new File([blob], info.name || 'upload.txt', { type: info.type || 'text/plain' });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    ['input', 'change'].forEach(evt => {
      try { el.dispatchEvent(new Event(evt, { bubbles: true })); } catch (e) {}
    });
    return { success: true, fileName: file.name };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

function waitForSelectorExecutor(selector, timeoutStr) {
  const timeout = parseInt(timeoutStr) || 5000;
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const el = document.querySelector(selector);
      if (el) return resolve({ success: true, found: true });
      if (Date.now() - start > timeout) return resolve({ success: false, reason: 'timeout' });
      setTimeout(check, 200);
    };
    check();
  });
}

// ==================== PLANNER (UNIVERSAL) ====================
// ==================== PLANNER (FULLY UNIVERSAL) ====================
async function plannerAgent(task, pageState) {
  // Prepare context — no bias, all element types
  const formFields = (pageState.formFields || []).slice(0, 25).map(f => ({
    label: f.label, type: f.fieldType, required: f.required
  }));

  const buttons = pageState.visibleElements
    .filter(e => e.category === 'button' || e.category === 'expandable' || e.category === 'dropdown-trigger')
    .slice(0, 25)
    .map(e => ({ text: (e.text || e.label || '').slice(0, 60), ariaExpanded: e.ariaExpanded }));

  const links = pageState.visibleElements
    .filter(e => e.category === 'link')
    .slice(0, 25)
    .map(e => ({ text: (e.text || '').slice(0, 60), href: (e.href || '').slice(0, 80) }))
    .filter(e => e.text);

  const tabs = pageState.visibleElements
    .filter(e => ['tab', 'menu-item', 'option'].includes(e.category))
    .slice(0, 25)
    .map(e => ({ text: (e.text || '').slice(0, 40), role: e.role }))
    .filter(e => e.text);

  const headings = (pageState.headings || []).slice(0, 15).map(h => h.text);

  const prompt = `You are a UNIVERSAL browser automation planner. You handle ANY web task.

USER TASK: ${task}

CURRENT PAGE CONTEXT:
URL: ${pageState.url}
Title: ${pageState.title}
Headings: ${JSON.stringify(headings)}
Text preview: ${(pageState.textPreview || '').slice(0, 400)}

AVAILABLE ELEMENTS ON PAGE:
Form fields (${formFields.length}):
${JSON.stringify(formFields, null, 2)}

Buttons (${buttons.length}):
${JSON.stringify(buttons, null, 2)}

Links (${links.length}):
${JSON.stringify(links, null, 2)}

Tabs/Menu items (${tabs.length}):
${JSON.stringify(tabs, null, 2)}

YOUR JOB:
1. FIRST, analyze the user task and current page. What kind of task is this?
   - Search? Navigation? Form filling? Data extraction? Interaction (open/expand)? Multi-step?
2. THEN plan the minimal steps needed.

TASK TYPE EXAMPLES:
- "Search X on Google" → type in search box → press Enter
- "Go to Wikipedia ISRO article" → click search or navigate → type → click result
- "Fill this form" → type each field → click submit
- "Open YouTube profile menu" → click profile icon → wait for menu → click menu item
- "Add cheapest item to cart" → scroll → find items → click add-to-cart
- "Log in with user/pass" → type username → type password → click login
- "Extract top 5 headlines" → scroll → extract
- "Download the report" → click download button

AVAILABLE ACTIONS (use exact action names):
- navigate: {"action":"navigate","target":"https://..."}
- click:    {"action":"click","target":"description of element"}
- type:     {"action":"type","target":"description","value":"text"}
- press:    {"action":"press","target":"description","value":"Enter"}
- hover:    {"action":"hover","target":"description"}
- scroll:   {"action":"scroll","value":"down|up"}
- wait:     {"action":"wait","value":"2000"}
- extract:  {"action":"extract","target":"description"}
- doubleClick: {"action":"doubleClick","target":"description"}
- rightClick:  {"action":"rightClick","target":"description"}
- clear:    {"action":"clear","target":"description"}
- waitFor:  {"action":"waitFor","target":"description","value":"5000"}
- newTab:   {"action":"newTab","target":"https://..."}
- closeTab: {"action":"closeTab"}
- switchTab:{"action":"switchTab","value":"1"}
- shortcut: {"action":"shortcut","value":"Control+S"}
- selectAll:{"action":"selectAll","target":"description"}
- dragDrop: {"action":"dragDrop","target":"source","value":"destination"}
- upload:   {"action":"upload","target":"description","value":"filename"}
- search:   {"action":"search","target":"search box","value":"query"}   ← BEST for search

CONDITIONAL & LOOP ACTIONS (Phase 3):
- if:    {"action":"if","condition":{"selectorExists":"..."},"then":[...],"else":[...]}
- loop:  {"action":"loop","while":{"selectorExists":"..."},"maxIterations":10,"steps":[...]}
- retry: {"action":"retry","maxAttempts":3,"until":{"urlContains":"..."},"steps":[...]}

CONDITIONAL EXAMPLES:
- "Login if not logged in" → 
  {"action":"if","condition":{"selectorExists":"#login-button"},"then":[{"action":"click","target":"login button"},{"action":"type","target":"username","value":"user"}],"else":[{"action":"wait","value":"500"}]}

- "Load all comments" →
  {"action":"loop","while":{"selectorExists":".load-more-button"},"maxIterations":10,"steps":[{"action":"click","target":"load more"}]}

- "Submit and retry if failed" →
  {"action":"retry","maxAttempts":3,"until":{"urlContains":"success"},"steps":[{"action":"click","target":"submit"}]}


CRITICAL RULES:
1. Use ONLY elements that exist on this page. NEVER invent fields/buttons.
2. Use "target" as a DESCRIPTION (the navigator will resolve it to a selector).
3. Generate values ONLY when you know what the value should be (from user task, or naturally derived).
4. Do NOT hardcode names/emails unless task specifically asks. If task says "random details", generate plausible values.
5. Keep plan MINIMAL — don't over-engineer.
6. If task is not possible on this page (e.g., user said "fill form" but no form exists), say so with:
   {"steps":[],"reason":"No form found on this page"}
7. FOR SEARCH TASKS: Use "search" action (type+Enter in one go) instead of separate "type"+"press".
   - WRONG: [{"action":"type","target":"search box","value":"X"}, {"action":"press","target":"search box","value":"Enter"}]
   - RIGHT: [{"action":"search","target":"search box","value":"X"}]\
8. After "search" action, always add "wait" with value 3000-4000 for results to load.
9. After "navigate", add "wait" with value 2000-3000 if the page is dynamic.


TASK TYPE EXAMPLES:
- "Search X on Google" → [{"action":"search","target":"search box","value":"X"}, {"action":"wait","value":"3000"}, {"action":"click","target":"result"}]
- "Find X on YouTube" → [{"action":"navigate","target":"https://youtube.com"},{"action":"search","target":"search box","value":"X"},{"action":"wait","value":"3000"}]

Respond with JSON ONLY (no markdown):
{"steps":[{"action":"...","target":"...","value":"..."}]}`;

  log('Planner: analyzing task...');
  const response = await callServerLLM(prompt);
  log('Planner raw:', response);

  const parsed = safeJSONParse(response);
  if (parsed && Array.isArray(parsed.steps)) return parsed.steps;
  if (Array.isArray(parsed)) return parsed;
  if (parsed && parsed.action) return [parsed];
  return [];
}

// ==================== NAVIGATOR (UNIVERSAL) ====================
async function navigatorAgent(step, pageState) {
  const candidates = [];

  // Form fields
  (pageState.formFields || []).forEach(f => {
    candidates.push({
      category: 'form-field',
      label: f.label,
      type: f.fieldType,
      agentId: f.agentId,
      primarySelector: `[data-agent-id="${f.agentId}"]`
    });
  });

  // Buttons and interactive elements
  pageState.visibleElements
    .filter(e => ['button', 'expandable', 'dropdown-trigger', 'disclosure', 'landmark'].includes(e.category))
    .forEach(e => {
      candidates.push({
        category: e.category,
        text: (e.text || e.label || '').slice(0, 60),
        agentId: e.agentId,
        primarySelector: `[data-agent-id="${e.agentId}"]`
      });
    });

  // Links
  pageState.visibleElements
    .filter(e => e.category === 'link')
    .slice(0, 30)
    .forEach(e => {
      candidates.push({
        category: 'link',
        text: (e.text || '').slice(0, 60),
        href: (e.href || '').slice(0, 80),
        agentId: e.agentId,
        primarySelector: `[data-agent-id="${e.agentId}"]`
      });
    });

  // Tabs / menu items
  pageState.visibleElements
    .filter(e => ['tab', 'menu-item', 'option'].includes(e.category))
    .forEach(e => {
      candidates.push({
        category: e.category,
        text: (e.text || '').slice(0, 50),
        agentId: e.agentId,
        primarySelector: `[data-agent-id="${e.agentId}"]`
      });
    });

  // Hidden elements (in case step targets a hidden dropdown content)
  (pageState.hiddenElements || []).forEach(e => {
    candidates.push({
      category: e.category + ' (HIDDEN)',
      text: (e.text || e.label || '').slice(0, 50),
      agentId: e.agentId,
      primarySelector: `[data-agent-id="${e.agentId}"]`
    });
  });

 const prompt = `You are a universal browser navigator. Match a step to a CSS selector.

STEP: ${JSON.stringify(step)}
PAGE: ${pageState.url}

CANDIDATES:
${JSON.stringify(candidates.slice(0, 60), null, 2)}

RULES:
- Match by TEXT/LABEL (case-insensitive, partial OK, semantic match OK).
- For "type" → prefer form-field.
- For "click"/"doubleClick"/"rightClick" → match button/link/tab/menu.
- For "hover" → match expandable/menu-trigger.
- For "clear"/"selectAll" → match form-field.
- Return primarySelector as FIRST item.
- For shortcut/newTab/closeTab/switchTab → return {"action":"<action>","value":"<value>"}

JSON ONLY:
{"action":"<action>","selectors":["<primarySelector>"],"value":"<value>","textHint":"<match>"}`;

  log('Navigator:', JSON.stringify(step));
  const response = await callServerLLM(prompt);
  log('Navigator raw:', response);

  const parsed = safeJSONParse(response);
  if (!parsed) return null;

  if (parsed.selectors && !Array.isArray(parsed.selectors)) parsed.selectors = [parsed.selectors];
  if (!parsed.selectors && parsed.selector) parsed.selectors = [parsed.selector];

  // FALLBACK: local matching if LLM failed
  if (step.target && (!parsed.selectors || !parsed.selectors.length)) {
    const needle = step.target.toLowerCase();
    let match = pageState.formFields?.find(f =>
      f.label.toLowerCase().includes(needle) || needle.includes(f.label.toLowerCase())
    );
    if (!match) {
      match = pageState.visibleElements?.find(e =>
        (e.text || e.label || '').toLowerCase().includes(needle)
      );
    }
    if (match && match.agentId) {
      parsed.selectors = [`[data-agent-id="${match.agentId}"]`];
    }
  }

  return parsed;
}

// ==================== VALIDATOR ====================
async function validatorAgent(task, history, pageState) {
  const summary = history.slice(-10).map(h => ({
    step: h.step?.action + (h.step?.target ? ` "${h.step.target}"` : ''),
    success: h.result?.success || false,
    filledValue: h.result?.result?.filledValue || null,
    error: h.error || null
  }));

  const succeeded = summary.filter(s => s.success).length;

  const prompt = `Task: ${task}

Step summary:
${JSON.stringify(summary, null, 2)}

Progress: ${succeeded}/${summary.length} steps succeeded.
Current URL: ${pageState.url}

Is the task FULLY completed?
- FORM: all fields filled AND submit clicked
- SEARCH: query submitted AND results page loaded
- NAVIGATION: URL matches target
- INTERACTION: element clicked/hovered successfully

If CORE goal achieved even with minor failures → completed: true.

JSON ONLY: {"completed": true/false, "reason": "<short>"}`;

  log('Validator:');
  const response = await callServerLLM(prompt);
  log('Validator raw:', response);
  return safeJSONParse(response) || { completed: false, reason: 'parse error' };
}




// ==================== RECURSIVE STEP EXECUTOR ====================
async function executeStepRecursive(step, tabId, depth = 0) {
  if (depth > 8) {
    logError('Max recursion depth reached');
    return { success: false, reason: 'too deep' };
  }

  log(`Executing step [depth=${depth}]:`, step.action);

  // ============ IF ============
  if (step.action === 'if') {
    const cond = step.condition || {};
    let result = false;

    if (cond.selectorExists) {
      const r = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel) => !!document.querySelector(sel),
        args: [cond.selectorExists]
      });
      result = r[0]?.result === true;
    } else if (cond.textContains) {
      const r = await chrome.scripting.executeScript({
        target: { tabId },
        func: (txt) => document.body.innerText.includes(txt),
        args: [cond.textContains]
      });
      result = r[0]?.result === true;
    } else if (cond.urlContains) {
      const tab = await chrome.tabs.get(tabId);
      result = tab.url.includes(cond.urlContains);
    }

    log(`IF condition result: ${result}`);
    const branch = result ? (step.then || []) : (step.else || []);
    for (const s of branch) {
      await executeStepRecursive(s, tabId, depth + 1);
    }
    return { success: true, branch: result ? 'then' : 'else' };
  }

  // ============ LOOP ============
  if (step.action === 'loop') {
    const max = step.maxIterations || 5;
    const whileCond = step.while || {};
    const body = step.steps || [];

    let iterations = 0;
    while (iterations < max) {
      // Check while condition
      let shouldContinue = true;
      if (whileCond.selectorExists) {
        const r = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel) => !!document.querySelector(sel),
          args: [whileCond.selectorExists]
        });
        shouldContinue = r[0]?.result === true;
      } else if (whileCond.textContains) {
        const r = await chrome.scripting.executeScript({
          target: { tabId },
          func: (txt) => document.body.innerText.includes(txt),
          args: [whileCond.textContains]
        });
        shouldContinue = r[0]?.result === true;
      }

      if (!shouldContinue) break;

      log(`Loop iteration ${iterations + 1}/${max}`);
      for (const s of body) {
        await executeStepRecursive(s, tabId, depth + 1);
      }
      iterations++;
      await sleep(1000);
    }
    return { success: true, iterations };
  }

  // ============ RETRY ============
  if (step.action === 'retry') {
    const max = step.maxAttempts || 3;
    const untilCond = step.until || {};
    const body = step.steps || [];

    for (let attempt = 1; attempt <= max; attempt++) {
      log(`Retry attempt ${attempt}/${max}`);
      let attemptOk = true;
      for (const s of body) {
        const r = await executeStepRecursive(s, tabId, depth + 1);
        if (!r.success) attemptOk = false;
      }

      // Check success condition
      let achieved = false;
      if (untilCond.selectorExists) {
        const r = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel) => !!document.querySelector(sel),
          args: [untilCond.selectorExists]
        });
        achieved = r[0]?.result === true;
      } else if (untilCond.urlContains) {
        const tab = await chrome.tabs.get(tabId);
        achieved = tab.url.includes(untilCond.urlContains);
      } else if (untilCond.textContains) {
        const r = await chrome.scripting.executeScript({
          target: { tabId },
          func: (txt) => document.body.innerText.includes(txt),
          args: [untilCond.textContains]
        });
        achieved = r[0]?.result === true;
      } else {
        achieved = attemptOk;
      }

      if (achieved) return { success: true, attempts: attempt };
      await sleep(1500);
    }
    return { success: false, reason: 'retries exhausted' };
  }

  // ============ SINGLE ACTION ============
  // No-selector actions
  if (['navigate', 'scroll', 'wait', 'newTab', 'closeTab', 'switchTab', 'shortcut'].includes(step.action)) {
    return await executeAction(tabId, null, step);
  }

  // Get fresh page state
  let currentPage;
  try {
    currentPage = await getPageState(tabId);
  } catch (e) {
    return { success: false, error: e.message };
  }

  // Resolve via navigator
  let action;
  try {
    action = await navigatorAgent(step, currentPage);
  } catch (e) {
    return { success: false, error: 'navigator: ' + e.message };
  }

  if (!action || (!action.selectors?.length && !['newTab', 'closeTab', 'switchTab', 'shortcut', 'navigate'].includes(action.action))) {
    return { success: false, error: 'no selectors' };
  }

  return await executeAction(tabId, null, action);
}



// ==================== MAIN LOOP ====================
async function runAgent(task, tabId) {
  agentState = { task, plan: [], currentStep: 0, isRunning: true, history: [] };
  log('========== AGENT START ==========');
  log('Task:', task);

  startKeepalive();

  try {
    let tab = await chrome.tabs.get(tabId);
    if (!isScriptableUrl(tab.url)) {
      broadcastToUI({ type: 'COMPLETE', reason: `❌ Cannot work on "${tab.url}"` });
      return;
    }

    // AUTO-NAVIGATE
    const targetUrl = extractUrlFromTask(task);
    if (targetUrl && normalizeUrl(targetUrl) !== normalizeUrl(tab.url)) {
      broadcastToUI({ type: 'STATUS', message: `🌐 Navigating to target...` });
      await chrome.tabs.update(tabId, { url: targetUrl });
      await waitForTabLoad(tabId);
      await sleep(2500);
      tab = await chrome.tabs.get(tabId);
    }

    // PAGE STATE
    broadcastToUI({ type: 'STATUS', message: '📄 Reading page...' });
    let pageState = await waitForPageReady(tabId, 1, 8000);
    if (!pageState) pageState = await getPageState(tabId);

    // PLAN
    broadcastToUI({ type: 'STATUS', message: '🧠 Planning...' });
    agentState.plan = await plannerAgent(task, pageState);
    log('Plan:', JSON.stringify(agentState.plan, null, 2));

    if (!agentState.plan.length) {
      broadcastToUI({ type: 'COMPLETE', reason: '❌ Planner failed' });
      return;
    }
    broadcastToUI({ type: 'PLAN', plan: agentState.plan });

    // EXECUTE
    // EXECUTE
let failedSteps = 0;

while (agentState.currentStep < agentState.plan.length && agentState.isRunning) {
  const step = agentState.plan[agentState.currentStep];
  log(`--- Step ${agentState.currentStep + 1}/${agentState.plan.length}:`, JSON.stringify(step).slice(0, 200));

  broadcastToUI({ type: 'STEP', step, index: agentState.currentStep });
  broadcastToUI({ type: 'STATUS', message: `🔍 Step ${agentState.currentStep + 1}/${agentState.plan.length}` });

  let execResult;
  try {
    execResult = await executeStepRecursive(step, tabId);
  } catch (e) {
    logError('Step execution error:', e.message);
    execResult = { success: false, error: e.message };
    failedSteps++;
  }

  agentState.history.push({ step, result: execResult, timestamp: Date.now() });
  log('Step result:', JSON.stringify(execResult).slice(0, 200));

  if (!execResult.success) failedSteps++;

  await sleep(1000);
  agentState.currentStep++;
}
    // FINAL VALIDATION
    broadcastToUI({ type: 'STATUS', message: '✅ Final validation...' });
    let finalPage;
    try { finalPage = await getPageState(tabId); } catch (e) { finalPage = pageState; }

    let validation;
    try {
      validation = await validatorAgent(task, agentState.history, finalPage);
    } catch (e) {
      validation = { completed: failedSteps === 0, reason: `Validator unavailable — ${failedSteps} step(s) failed` };
    }
    log('Final validation:', JSON.stringify(validation));

    if (validation.completed) {
      broadcastToUI({ type: 'COMPLETE', reason: `✅ ${validation.reason}` });
    } else if (failedSteps > 0) {
      broadcastToUI({ type: 'COMPLETE', reason: `⚠️ ${validation.reason} (${failedSteps} step(s) failed)` });
    } else {
      broadcastToUI({ type: 'COMPLETE', reason: `✅ All ${agentState.plan.length} steps executed` });
    }

  } catch (err) {
    logError('Agent error:', err.message);
    broadcastToUI({ type: 'COMPLETE', reason: `❌ Error: ${err.message}` });
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