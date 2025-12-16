//selection.js

function getSelectedText() {
  const sel = window.getSelection();
  if (sel && sel.toString().trim()) {
    return sel.toString();
  }

  const iframes = document.querySelectorAll("iframe");

  for (const iframe of Array.from(iframes)) {
    try {
      const frameSel = iframe.contentWindow && iframe.contentWindow.getSelection();
      if (frameSel && frameSel.toString().trim()) {
        return frameSel.toString();
      }
    } catch (e) {
      // cross-origin iframe 무시
    }
  }

  return "";
}
