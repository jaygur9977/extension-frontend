import { log } from './helpers.js';

export function localTextMatch(step, pageState) {
  const target = (step.target || '').toLowerCase().trim();
  if (!target || target.length < 2) return null;



  // ⚡ YOUTUBE GENERIC VIDEO TARGET (target like "first video", "video thumbnail")
  const isYouTube = pageState.url.includes('youtube.com');
  const isGenericVideo = isYouTube && step.action === 'click' && (
    target.includes('first video') ||
    target.includes('video thumbnail') ||
    target.includes('thumbnail') ||
    target.includes('first result') ||
    target === 'video' ||
    target.includes('play')
  );

  if (isGenericVideo) {
    // Find all video renderers
    const videos = pageState.visibleElements.filter(e => {
      const tag = (e.tag || '').toLowerCase();
      return tag.includes('video-renderer') || tag.includes('rich-item-renderer');
    });

    if (videos.length > 0) {
      const first = videos[0];
      log(`✅ YouTube generic video match: "${step.target}" → first video-renderer (${videos.length} found)`);
      return {
        action: 'click',
        selectors: [`[data-agent-id="${first.agentId}"]`],
        value: '',
        textHint: (first.text || '').slice(0, 60),
        _local: true,
        _score: 999
      };
    }
  }


    // ⚡ YOUTUBE ULTIMATE FALLBACK — if URL is YouTube, always click first video
  if (isYouTube && step.action === 'click') {
    // Any video-like element counts
    const anyVideo = pageState.visibleElements.find(e => {
      const tag = (e.tag || '').toLowerCase();
      return tag.includes('video-renderer') || 
             tag.includes('rich-item') ||
             tag.includes('compact-video');
    });

    // If target looks like "video", "first", "play", "song", "watch", etc.
    const looksLikeVideoClick = 
      target.includes('first') ||
      target.includes('video') ||
      target.includes('play') ||
      target.includes('watch') ||
      target.includes('song') ||
      target.includes('thumbnail') ||
      target.includes('result');

    if (anyVideo && looksLikeVideoClick) {
      log(`✅ YouTube ULTIMATE match: "${step.target}" → ${anyVideo.tag} "${(anyVideo.text || '').slice(0, 40)}"`);
      return {
        action: 'click',
        selectors: [`[data-agent-id="${anyVideo.agentId}"]`],
        value: '',
        textHint: (anyVideo.text || 'video').slice(0, 60),
        _local: true,
        _score: 1000
      };
    }
  }


  // Alias expansion
  const targetAliases = {
    'filename input': ['filename', 'file name', 'name', 'enter name', 'new file input', 'new file name'],
    'folder name input': ['folder name', 'folder', 'name', 'enter name', 'new folder name'],
    'search box': ['search', 'search input', 'query'],
    'submit button': ['submit', 'create', 'confirm'],
    'create button': ['create', 'confirm'],
    'new file': ['new file', 'create file'],
    'new folder': ['new folder', 'create folder']
  };

  let expandedTargets = [target];
  for (const [key, aliases] of Object.entries(targetAliases)) {
    if (target.includes(key) || key.includes(target)) {
      expandedTargets = [target, ...aliases];
      break;
    }
  }

  const isYouTubeVideoSearch =
    step.action === 'click' && target.length > 3 &&
    !target.includes('channel') && !target.includes('subscribe') &&
    !target.includes('@') && pageState.url.includes('youtube.com');

  // Build candidates — SKIP DISABLED ELEMENTS
  const all = [
    ...(pageState.formFields || []).map(f => ({
      text: f.label, label: f.label, agentId: f.agentId,
      category: 'form-field', tag: 'INPUT', ariaLabel: '',
      disabled: f.disabled
    })),
    ...(pageState.visibleElements || [])
  ].filter(el => {
    if (el.disabled) return false;  // CRITICAL: skip disabled

    if (isYouTubeVideoSearch) {
      const cat = (el.category || '').toLowerCase();
      const tag = (el.tag || '').toLowerCase();
      const text = ((el.text || el.label || '') + '').toLowerCase();
      if (tag.includes('channel')) return false;
      if (cat === 'link' && text.length < 15 && !text.includes(' ')) return false;
    }
    return true;
  });

  const stopWords = ['the', 'a', 'an', 'on', 'in', 'to', 'of', 'for', 'link', 'result', 'button', 'click'];
  const targetWords = target.split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));

  let best = null;
  let bestScore = 0;

  for (const el of all) {
    const elText = ((el.text || '') + ' ' + (el.label || '') + ' ' + (el.ariaLabel || '') + ' ' + (el.title || '')).toLowerCase();
    if (!elText.trim()) continue;

    let score = 0;
    let matched = false;

    for (const t of expandedTargets) {
      if (elText.includes(t)) { score += 100; matched = true; break; }
    }
    if (!matched && target.includes(elText.trim()) && elText.trim().length > 3) score += 80;

    const elWords = elText.split(/\s+/).filter(w => w.length > 2);
    const overlap = targetWords.filter(w => elWords.some(ew => ew.includes(w) || w.includes(ew)));
    score += overlap.length * 15;

    if (elText.length > 200) score -= 20;
    if (['link','button','clickable-card','clickable','form-field'].includes(el.category)) score += 10;

    // ⚡ YOUTUBE BONUS/PENALTY — INSIDE LOOP (critical fix)
    const tagLower = (el.tag || '').toLowerCase();
    if (tagLower.includes('video-renderer') || tagLower.includes('rich-item')) score += 30;
    if (tagLower.includes('channel-renderer') || tagLower.includes('playlist-renderer')) score -= 60;
    if (isYouTubeVideoSearch && elText.length > 25) score += 15;

    if (score > bestScore) { bestScore = score; best = el; }
  }

  if (best && bestScore >= 30) {
    log(`✅ Local match: "${step.target}" → "${(best.text || best.label || '').slice(0, 60)}" (score: ${bestScore})`);
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

export function localMatch(step, pageState) {
  const target = (step.target || '').toLowerCase().trim();
  if (!target) return null;

  const score = (text) => {
    const t = (text || '').toLowerCase();
    if (t === target) return 100;
    if (t.includes(target)) return 80;
    if (target.includes(t) && t.length > 2) return 60;
    return 0;
  };

  if (['type','clear','selectAll'].includes(step.action)) {
    let best = null, bestScore = 0;
    for (const f of pageState.formFields || []) {
      if (f.disabled) continue;
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

  if (['click','press','hover','doubleClick'].includes(step.action)) {
    let best = null, bestScore = 0;
    for (const e of pageState.visibleElements || []) {
      if (e.disabled) continue;
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