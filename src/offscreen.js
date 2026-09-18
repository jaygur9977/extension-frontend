

// ==================== OFFSCREEN SCRIPT ====================
// Ye script WebGPU/local model ke liye reserved hai.
// Abhi ke liye khaali hai taaki extension load ho sake.
// Baad mein yahan vision model load karenge.

console.log('[Offscreen] Script loaded');

// Background script se messages suno
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  console.log('[Offscreen] Message received:', message.type);

  if (message.type === 'PING') {
    sendResponse({ success: true, message: 'pong' });
    return true;
  }

  if (message.type === 'CLASSIFY_IMAGE') {
    // Abhi ke liye stub — baad mein vision model add karenge
    sendResponse({
      success: false,
      error: 'Vision model not yet implemented'
    });
    return true;
  }

  return false;
});

console.log('[Offscreen] Ready');