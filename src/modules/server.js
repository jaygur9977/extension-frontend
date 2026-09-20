import { log, logError, sleep, estimateTokens, waitForTokenBudget, config } from './helpers.js';

export async function callServerLLM(prompt, image = null, retries = 3) {
  const port = config.currentMode === 'coding' ? 3031 : 3000;
  const estimated = estimateTokens(prompt) + (image ? 500 : 0);
  await waitForTokenBudget(estimated);

  const body = { prompt };
  if (image) body.image = image;

  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);

      const res = await fetch(`http://localhost:${port}/api/reason`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 429) {
          logError(`429 on port ${port} — waiting 20s`);
          await sleep(20000);
          throw new Error(`HTTP 429`);
        }
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 100)}`);
      }

      const data = await res.json();
      return data.response;
    } catch (e) {
      lastErr = e;
      logError(`Server(${port}) attempt ${attempt}/${retries}:`, e.message);
      if (attempt < retries) await sleep(3000 * attempt);
    }
  }
  throw lastErr;
}

// Navigator cache
const navigatorCache = new Map();
const CACHE_MAX = 100;

function cacheKey(step, url) {
  return `${step.action}::${(step.target || '').toLowerCase().trim()}::${url}`;
}

export function getCachedNavigator(step, url) {
  const key = cacheKey(step, url);
  const cached = navigatorCache.get(key);
  if (cached && Date.now() - cached.ts < 60000) {
    log(`📦 Navigator cache hit: ${step.target}`);
    return cached.value;
  }
  return null;
}

export function setNavigatorCache(step, url, value) {
  if (navigatorCache.size > CACHE_MAX) {
    navigatorCache.delete(navigatorCache.keys().next().value);
  }
  navigatorCache.set(cacheKey(step, url), { value, ts: Date.now() });
}