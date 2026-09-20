import { log, logError, safeJSONParse } from './helpers.js';
import { callServerLLM, getCachedNavigator, setNavigatorCache } from './server.js';
import { localTextMatch, localMatch } from './matching.js';

import { config } from './helpers.js';

export async function plannerAgent(task, pageState, tabId = null) {
  if (config.currentMode === 'coding' && pageState.url.includes('localhost:3030')) {
    return await codingPlanner(task, pageState, tabId);
  }

  const fields = (pageState.formFields || [])
    .filter(f => f.isVisible && !f.disabled)
    .slice(0, 20)
    .map(f => `${f.label} [${f.fieldType}${f.required ? ',REQ' : ''}]`);

  const buttons = pageState.visibleElements
    .filter(e => ['button','expandable','dropdown-trigger'].includes(e.category) && !e.disabled)
    .slice(0, 25)
    .map(e => `"${(e.text || e.label || '').slice(0, 40)}"`)
    .filter(t => t.length > 3);

  const links = pageState.visibleElements
    .filter(e => e.category === 'link' && !e.disabled)
    .slice(0, 20)
    .map(e => `"${(e.text || '').slice(0, 40)}"`)
    .filter(t => t.length > 3);

  const tabs = pageState.visibleElements
    .filter(e => ['tab','menu-item','option'].includes(e.category) && !e.disabled)
    .slice(0, 15)
    .map(e => `"${(e.text || '').slice(0, 30)}"`)
    .filter(t => t.length > 3);

  const headings = (pageState.headings || []).slice(0, 8).map(h => h.text).join(' | ');
  const preview = (pageState.textPreview || '').slice(0, 300);

  // STAGE 1: ANALYZE
  const analyzePrompt = `Analyze this browser task.

TASK: ${task}

PAGE:
URL: ${pageState.url}
Title: ${pageState.title}
Headings: ${headings}
Preview: ${preview}

ELEMENTS:
Form fields: ${JSON.stringify(fields)}
Buttons: ${JSON.stringify(buttons)}
Links: ${JSON.stringify(links)}
Tabs/Menu: ${JSON.stringify(tabs)}

Answer with JSON: {"goal":"1 line","taskType":"SEARCH|FORM|NAV|INTERACT|EXTRACT|MULTI","currentState":"already on target page OR need to navigate to X","prerequisites":[],"mainAction":"...","followUps":[],"pitfalls":[],"derivedValues":{}}`;

  log('Planner Stage 1: analyzing');
  let analysis = null;
  try {
    const aRaw = await callServerLLM(analyzePrompt);
    log('Analysis:', aRaw?.slice(0, 150));
    analysis = safeJSONParse(aRaw);
  } catch (e) { logError('Analysis failed:', e.message); }

  // STAGE 2: PLAN
  const analysisContext = analysis
    ? `ANALYSIS:\nGoal: ${analysis.goal || '?'}\nType: ${analysis.taskType || '?'}\nState: ${analysis.currentState || '?'}\nMain: ${analysis.mainAction || '?'}\nDerived: ${JSON.stringify(analysis.derivedValues || {})}`
    : '';

  const planPrompt = `Create a browser automation plan.

TASK: ${task}

${analysisContext}

PAGE URL: ${pageState.url}
Form fields: ${JSON.stringify(fields)}
Buttons: ${JSON.stringify(buttons)}
Links: ${JSON.stringify(links)}
Tabs/Menu: ${JSON.stringify(tabs)}

RULES:
1. Page already loaded. Plan for THIS page.
2. Use ONLY elements listed above. NEVER invent.
3. Add "wait" 2500-3500ms after navigation.
4. For Google/YouTube/Amazon use direct URL:
   Google: https://www.google.com/search?q=QUERY
   YouTube: https://www.youtube.com/results?search_query=QUERY
5. YouTube: target video TITLE (long, has spaces), NEVER channel name.
6. For form fields: one "type" per field.
7. Values: "full name"→"John Doe", "email"→"john.doe@example.com", "phone"→"5551234567"

ACTIONS:
- {"action":"navigate","target":"url"}
- {"action":"search","target":"search box","value":"query"}
- {"action":"type","target":"label","value":"text"}
- {"action":"click","target":"element text"}
- {"action":"wait","value":"3000"}

Respond JSON ONLY:
{"steps":[...],"reasoning":"1 line"}`;

  log('Planner Stage 2: planning');
  const response = await callServerLLM(planPrompt);
  log('Plan raw:', response?.slice(0, 250));

  const parsed = safeJSONParse(response);
  if (parsed && Array.isArray(parsed.steps)) {
    if (parsed.reasoning) log('Plan:', parsed.reasoning);
    return parsed.steps;
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && parsed.action) return [parsed];
  return [];
}

async function codingPlanner(task, pageState, tabId = null) {
  log('=== CODING PLANNER ===');

  // ⚡ STEP 1: Get explorer state — try BOTH methods
  let explorerState = null;

  // Method A: HTTP fetch (fast, no scripting)
  try {
    const res = await fetch('http://localhost:3030/api/state');
    if (res.ok) {
      explorerState = await res.json();
      explorerState.success = true;
      log('✅ State via HTTP:', explorerState.rootFolderName || 'no folder');
    }
  } catch (e) {
    log('HTTP state fetch failed:', e.message);
  }

  // Method B: scripting fallback
  if (!explorerState || !explorerState.hasRootFolder) {
    try {
      const { explorerAPI } = await import('./explorer-api.js');
      const apiState = await explorerAPI('getState');
      if (apiState?.success) {
        explorerState = apiState;
        log('✅ State via scripting:', apiState.rootFolderName || 'no folder');
      }
    } catch (e) {
      log('Scripting state fetch failed:', e.message);
    }
  }

  // ⚡ STEP 2: HARD CHECK — do it in JS, not LLM
  if (!explorerState || !explorerState.hasRootFolder) {
    log('❌ No folder open — returning blocker');
    return [{
      action: 'codingGetState',
      _blocker: true,
      reason: 'Please click "Open Folder" in the explorer tab first'
    }];
  }

  log('✅ Folder open:', explorerState.rootFolderName);

  // ⚡ STEP 3: Get tree for context
  let treeInfo = 'unknown';
  try {
    const treeRes = await fetch('http://localhost:3030/api/tree');
    if (treeRes.ok) {
      const treeData = await treeRes.json();
      // Compact tree: show first level
      const firstLevel = (treeData.tree || [])
        .slice(0, 15)
        .map(n => n.kind === 'directory' ? `${n.name}/` : n.name)
        .join(', ');
      treeInfo = firstLevel || '(empty)';
    }
  } catch (e) {}

  const activeFile = explorerState.activeFile?.path || 'none';
  const openFiles = (explorerState.openFiles || []).map(f => f.path).join(', ') || 'none';

  // ⚡ STEP 4: LLM plans — with clear info
  const prompt = `You are a CODING agent. Plan file operations.

TASK: ${task}

CURRENT STATE:
- Root folder: ${explorerState.rootFolderName}
- Files in folder: ${treeInfo}
- Open in editor: ${openFiles}
- Active file: ${activeFile}

DO NOT plan DOM clicks. Use ONLY these actions:

- {"action":"codingCreateAndWrite","value":"file.js","content":"...","folder":""}
   → Creates file + writes content + opens in editor

- {"action":"codingCreateFolder","value":"folderName","folder":""}
   → Creates folder

- {"action":"codingWriteFile","path":"existing.js","value":"new content"}
   → Overwrites existing file

- {"action":"codingReadFile","path":"file.js"}
   → Reads file content

- {"action":"codingOpenFile","path":"file.js"}
   → Opens file in editor

EXAMPLES:

Task: "Create test.js that prints hello"
→ [{"action":"codingCreateAndWrite","value":"test.js","content":"console.log('hello');"}]

Task: "Create folder components"
→ [{"action":"codingCreateFolder","value":"components"}]

Task: "Create jay.js with loop printing name 100 times"
→ [{"action":"codingCreateAndWrite","value":"jay.js","content":"for (let i = 0; i < 100; i++) {\\n  console.log('Jay');\\n}"}]

Task: "Write hello in the current file"
→ [{"action":"codingWriteFile","path":"${activeFile}","value":"hello"}]

Task: "Add console.log at top of test.js"
→ [{"action":"codingReadFile","path":"test.js"}, ...then write]

RULES:
- Use ONE codingCreateAndWrite for file creation (never separate steps)
- If task says "same file" or "current file", use active file path
- Infer extension if missing (js, py, html, etc)
- Never plan DOM clicks

Respond JSON ONLY:
{"steps":[...],"reasoning":"1 line"}`;

  log('Coding planner prompt len:', prompt.length);
  const response = await callServerLLM(prompt);
  log('Coding plan raw:', response?.slice(0, 250));

  const parsed = safeJSONParse(response);
  if (parsed && Array.isArray(parsed.steps)) {
    if (parsed.reasoning) log('Reason:', parsed.reasoning);
    return parsed.steps;
  }
  if (Array.isArray(parsed)) return parsed;
  return [];
}


// ⚡ Navigator — uses target_id approach (NO escaped quotes = NO 400 errors)
export async function navigatorAgent(step, pageState) {
  // 1. Local text match
  const localText = localTextMatch(step, pageState);
  if (localText) return localText;

  // 2. Structured match
  const localStruct = localMatch(step, pageState);
  if (localStruct) return localStruct;

  // 3. Cache
  const cached = getCachedNavigator(step, pageState.url);
  if (cached) return cached;

  // 4. Build candidates
  const candidates = [];

  (pageState.formFields || []).slice(0, 15).filter(f => f.isVisible && !f.disabled).forEach(f => {
    candidates.push(`F|${f.label}|${f.agentId}`);
  });

  pageState.visibleElements
    .filter(e => !e.disabled)
    .filter(e => ['button','expandable','dropdown-trigger','link','tab','menu-item','clickable','clickable-card','option','interactive'].includes(e.category))
    .slice(0, 60)
    .forEach(e => {
      const t = (e.text || e.label || e.ariaLabel || '').slice(0, 50);
      if (t) candidates.push(`${e.category[0].toUpperCase()}|${t}|${e.agentId}`);
    });

  if (candidates.length === 0) {
    log('Navigator: no candidates');
    return null;
  }

  // ⚡ SIMPLE PROMPT — use target_id, NOT selector (avoids quote-escaping 400 errors)
  const prompt = `Match this step to ONE element.

STEP: ${JSON.stringify(step)}

ELEMENTS (type | text | id):
${candidates.join('\n')}

Pick the best matching id. Return JSON only:
{"action":"${step.action}","target_id":"ag-xxxxx","value":"","textHint":"matched"}

If no match, use empty target_id:
{"action":"${step.action}","target_id":"","textHint":"no match"}`;

  log('Navigator: prompt len', prompt.length);
  const response = await callServerLLM(prompt);
  log('Navigator raw:', response?.slice(0, 200));

  const parsed = safeJSONParse(response);
  if (!parsed) return null;

  // Convert target_id → selectors array
  if (parsed.target_id) {
    parsed.selectors = [`[data-agent-id="${parsed.target_id}"]`];
  } else if (parsed.selectors && !Array.isArray(parsed.selectors)) {
    parsed.selectors = [parsed.selectors];
  } else if (!parsed.selectors && parsed.selector) {
    parsed.selectors = [parsed.selector];
  } else if (!parsed.selectors) {
    parsed.selectors = [];
  }

  if (parsed.selectors.length) setNavigatorCache(step, pageState.url, parsed);
  return parsed;
}

export async function validatorAgent(task, history, pageState) {
  const summary = history.slice(-8).map(h =>
    `${h.step?.action || '?'}:${(h.step?.target || '').slice(0, 25)}=${h.result?.success ? 'OK' : 'FAIL'}`
  ).join(' | ');

  const succeeded = history.filter(h => h.result?.success).length;
  const total = history.length;

  const prompt = `Task: ${task}
Steps: ${summary}
Result: ${succeeded}/${total} succeeded
URL: ${pageState.url}

Is the task FULLY completed?
- FORM: all fields filled AND submitted
- SEARCH: results loaded
- NAV: URL matches
- INTERACTION: element clicked + state changed

If any step failed → completed: false
Do NOT say "partial success".

JSON ONLY: {"completed":true/false,"reason":"short"}`;

  log('Validator');
  const response = await callServerLLM(prompt);
  log('Validator raw:', response?.slice(0, 120));
  return safeJSONParse(response) || { completed: false, reason: 'parse error' };
}