import { log, logError } from './helpers.js';

// ⚡ FIX: Accept tabId optionally, better tab detection
export async function explorerAPI(method, ...args) {
  log(`🔧 explorerAPI.${method}(${args.map(a => JSON.stringify(a).slice(0, 30)).join(', ')})`);

  // Find explorer tab — query ALL tabs, filter by URL
  const allTabs = await chrome.tabs.query({});
  const explorerTab = allTabs.find(t => 
    t.url && t.url.startsWith('http://localhost:3030')
  );

  if (!explorerTab) {
    log(`❌ No explorer tab found among ${allTabs.length} tabs`);
    return { success: false, error: 'Explorer tab not open. Toggle Code Explorer first.' };
  }

  const tabId = explorerTab.id;
  log(`   Using explorer tab ${tabId}: ${explorerTab.url}`);

  // Verify API exists
  let hasAPI = false;
  try {
    const check = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => typeof window.__agentAPI === 'object' && window.__agentAPI !== null
    });
    hasAPI = check[0]?.result === true;
  } catch (e) {
    logError('Cannot access explorer tab:', e.message);
    return { success: false, error: 'Cannot access tab: ' + e.message };
  }

  log(`   __agentAPI available: ${hasAPI}`);

  if (!hasAPI) {
    return { success: false, error: 'window.__agentAPI not found. Refresh explorer tab (F5).' };
  }

  // Call the method
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (methodName, callArgs) => {
        try {
          if (!window.__agentAPI || typeof window.__agentAPI[methodName] !== 'function') {
            return { success: false, error: 'Method not available: ' + methodName };
          }
          const result = await window.__agentAPI[methodName](...callArgs);
          return result || { success: false, error: 'no return value' };
        } catch (e) {
          return { success: false, error: e.message };
        }
      },
      args: [method, args]
    });
    const result = r[0]?.result;
    log(`   ✓ Result:`, JSON.stringify(result).slice(0, 200));
    return result || { success: false, error: 'no result' };
  } catch (e) {
    logError('explorerAPI execute failed:', e.message);
    return { success: false, error: e.message };
  }
}

export async function fetchExplorerState() {
  try {
    const res = await fetch('http://localhost:3030/api/state');
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}