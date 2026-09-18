// Page se information nikaalo
function extractPageInfo() {
  const elements = [];
  document.querySelectorAll('button, input, a, select, textarea').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      elements.push({
        tag: el.tagName,
        type: el.type || '',
        text: (el.innerText || el.value || '').slice(0, 50),
        id: el.id,
        selector: el.id ? `#${el.id}` : el.tagName.toLowerCase()
      });
    }
  });
  return { url: location.href, title: document.title, elements };
}

// Background se message suno
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_PAGE_INFO') {
    sendResponse(extractPageInfo());
  }
  if (msg.type === 'HIGHLIGHT_ELEMENT') {
    const el = document.querySelector(msg.selector);
    if (el) {
      el.style.outline = '3px solid red';
      setTimeout(() => { el.style.outline = ''; }, 2000);
    }
    sendResponse({ done: true });
  }
  return true;
});