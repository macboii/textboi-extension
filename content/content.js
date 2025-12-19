// ======================================================
// TextBoi – Universal Content Script (NO modules)
// Works on: Web / Gmail / Google Docs / Slides
// ======================================================

/* ------------------------------------------------------
   Utils
------------------------------------------------------ */
function isGoogleDocsLike() {
  return (
    location.hostname.includes("docs.google.com") ||
    location.hostname.includes("slides.google.com")
  );
}

function isGmailDomain() {
  const h = location.hostname;
  return h.includes("mail.google.com") || h.includes("inbox.google.com");
}

// ShadowRoot 내부 selection 추출
function getDeepActiveSelection() {
  let el = document.activeElement;

  while (el && el.shadowRoot && el.shadowRoot.activeElement) {
    el = el.shadowRoot.activeElement;
  }

  if (el && (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
    try {
      const sel = el.ownerDocument.getSelection();
      if (sel && sel.toString().trim()) return sel.toString().trim();

      if (el.value && el.selectionStart !== el.selectionEnd) {
        return el.value.substring(el.selectionStart, el.selectionEnd);
      }
    } catch {}
  }
  return "";
}

// Gmail/iframe selection 추출
function getIframeSelection() {
  for (const frame of document.querySelectorAll("iframe")) {
    try {
      const sel = frame.contentWindow.getSelection();
      if (sel && sel.toString().trim()) return sel.toString().trim();
    } catch {}
  }
  return "";
}

// Gmail iframe selection rect
function getIframeSelectionRect() {
  for (const frame of document.querySelectorAll("iframe")) {
    try {
      const sel = frame.contentWindow.getSelection();
      if (!sel || sel.isCollapsed) continue;

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const iframeRect = frame.getBoundingClientRect();

      return {
        top: rect.top + iframeRect.top,
        bottom: rect.bottom + iframeRect.top,
        left: rect.left + iframeRect.left,
        right: rect.right + iframeRect.left,
        width: rect.width,
        height: rect.height,
      };
    } catch {}
  }
  return null;
}

/* ------------------------------------------------------
   Unified Selection
------------------------------------------------------ */
async function getSelectedTextUnified() {
  const sel = window.getSelection();
  if (sel && sel.toString().trim()) return sel.toString().trim();

  const deepSel = getDeepActiveSelection();
  if (deepSel) return deepSel;

  const iframeSel = getIframeSelection();
  if (iframeSel) return iframeSel;

  try {
    await new Promise((r) => setTimeout(r, 40));
    const clipText = await navigator.clipboard.readText();
    if (clipText?.trim()) return clipText.trim();
  } catch {}

  return "";
}

/* ------------------------------------------------------
   Overlay UI
------------------------------------------------------ */
let overlayEl = null;
let inputEl = null;
let resultEl = null;
let pendingResult = null;

function showOverlay(selectedText) {
  removeOverlay();

  overlayEl = document.createElement("div");
  overlayEl.id = "textboi-overlay";

  Object.assign(overlayEl.style, {
    position: "fixed",
    top: "0",
    right: "0",
    width: "420px",
    height: "100vh",
    background: "#fff",
    zIndex: "2147483647",
    boxShadow: "-4px 0 16px rgba(0,0,0,0.18)",
    display: "flex",
    flexDirection: "column",
    padding: "12px",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont",
  });

  inputEl = document.createElement("textarea");
  inputEl.value = selectedText;
  inputEl.style.height = "120px";
  inputEl.style.resize = "vertical";

  resultEl = document.createElement("div");
  resultEl.textContent = "번역 중...";
  resultEl.style.marginTop = "12px";
  resultEl.style.whiteSpace = "pre-wrap";

  overlayEl.append(inputEl, resultEl);
  document.body.appendChild(overlayEl);

  if (pendingResult) {
    updateResult(pendingResult);
    pendingResult = null;
  }
}

function updateResult(payload) {
  if (!overlayEl || !resultEl) {
    pendingResult = payload;
    return;
  }

  if (payload?.error) {
    resultEl.textContent = payload.message || "오류가 발생했습니다.";
    return;
  }

  resultEl.textContent =
    payload?.text ??
    payload?.result ??
    JSON.stringify(payload, null, 2);
}

function removeOverlay() {
  overlayEl?.remove();
  overlayEl = null;
  inputEl = null;
  resultEl = null;
  pendingResult = null;
}

/* ------------------------------------------------------
   Bubble UI
------------------------------------------------------ */
let bubbleEl = null;

function showBubble(rect) {
  removeBubble();

  bubbleEl = document.createElement("div");
  bubbleEl.id = "textboi-bubble";
  bubbleEl.textContent = "✨ TextBoi";

  const bubbleWidth = 90;
  const margin = 8;

  let top = rect.bottom + margin;
  let left = rect.right - bubbleWidth;

  left = Math.max(8, Math.min(left, window.innerWidth - bubbleWidth - 8));
  top = Math.min(top, window.innerHeight - 40);

  Object.assign(bubbleEl.style, {
    position: "fixed",
    top: `${top}px`,
    left: `${left}px`,
    padding: "6px 10px",
    fontSize: "12px",
    background: "#111",
    color: "#fff",
    borderRadius: "999px",
    cursor: "pointer",
    zIndex: "2147483647",
    userSelect: "none",
    boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
  });

  document.body.appendChild(bubbleEl);

  registerBubbleHandlers(bubbleEl);
}

function removeBubble() {
  bubbleEl?.remove();
  bubbleEl = null;
}

/* ------------------------------------------------------
   Bubble Handlers (Platform-specific)
------------------------------------------------------ */

let gmailSelectionCache = "";

function registerBubbleHandlers(bubble) {
  let handled = false;

  /* -----------------------------------------
     ① Gmail 전용 핸들러 (mousedown)
  ----------------------------------------- */
  bubble.addEventListener("click", (e) => {
    if (!isGmailDomain()) return;

    e.preventDefault();
    e.stopPropagation();

    if (!gmailSelectionCache) {
      removeBubble();
      return;
    }

    showOverlay(gmailSelectionCache);

    chrome.runtime.sendMessage({
      type: "PROCESS_TEXT",
      mode: "translate",
      text: gmailSelectionCache,
    });

    removeBubble();
  });

  /* -----------------------------------------
     ② Google Docs / Slides 전용 핸들러
     (mousedown에서 selection 살아있음)
  ----------------------------------------- */
  bubble.addEventListener("mousedown", async (e) => {
    if (!isGoogleDocsLike()) return;

    if (handled) return;
    handled = true;

    e.preventDefault();
    e.stopPropagation();

    const text = await getSelectedTextUnified();
    if (!text) {
      removeBubble();
      return;
    }

    showOverlay(text);

    chrome.runtime.sendMessage({
      type: "PROCESS_TEXT",
      mode: "translate",
      text,
    });

    removeBubble();
  });

  /* -----------------------------------------
     ③ 일반 웹 전용 click 핸들러
  ----------------------------------------- */
  bubble.addEventListener("click", async (e) => {
    if (isGoogleDocsLike() || isGmailDomain()) return; // Gmail/Docs는 click 금지

    if (handled) return;
    handled = true;

    e.preventDefault();
    e.stopPropagation();

    document.execCommand("copy");
    await new Promise((r) => setTimeout(r, 30));

    const text = await getSelectedTextUnified();
    if (!text) return removeBubble();

    showOverlay(text);

    chrome.runtime.sendMessage({
      type: "PROCESS_TEXT",
      mode: "translate",
      text,
    });

    removeBubble();
  });
}

/* ------------------------------------------------------
   Selection Detection
------------------------------------------------------ */

let lastSelectionText = "";
let debounceTimer = null;

document.addEventListener("selectionchange", () => {
  if (isGoogleDocsLike()) return;

  let text = "";

  if (isGmailDomain()) {
    text = getIframeSelection();
    if (text?.trim()) gmailSelectionCache = text.trim();
  } else {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      removeBubble();
      lastSelectionText = "";
      return;
    }
    text = sel.toString().trim();
  }

  if (!text || text === lastSelectionText) return;
  lastSelectionText = text;

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    let rect = null;

    if (isGmailDomain()) {
      rect = getIframeSelectionRect();
    } else {
      const sel = window.getSelection();
      rect = sel.getRangeAt(0).getBoundingClientRect();
    }

    if (!rect || rect.width === 0 || rect.height === 0) return;

    showBubble(rect);
  }, 120);
});

/* ------------------------------------------------------
   Google Docs Drag Detection
------------------------------------------------------ */
let lastMousePos = { x: 0, y: 0 };
let isMouseDown = false;
let dragDistance = 0;
let startPos = { x: 0, y: 0 };

document.addEventListener(
  "mousedown",
  (e) => {
    if (!isGoogleDocsLike()) return;
    isMouseDown = true;

    dragDistance = 0;
    startPos = { x: e.clientX, y: e.clientY };
  },
  true
);

document.addEventListener(
  "mousemove",
  (e) => {
    lastMousePos = { x: e.clientX, y: e.clientY };

    if (!isGoogleDocsLike() || !isMouseDown) return;

    dragDistance = Math.sqrt(
      (e.clientX - startPos.x) ** 2 +
      (e.clientY - startPos.y) ** 2
    );
  },
  true
);

document.addEventListener(
  "mouseup",
  async () => {
    if (!isGoogleDocsLike()) return;

    isMouseDown = false;

    if (dragDistance < 6) {
      removeBubble();
      return;
    }

    const text = await getSelectedTextUnified();
    if (!text) return removeBubble();

    showBubble({
      top: lastMousePos.y,
      bottom: lastMousePos.y,
      left: lastMousePos.x,
      right: lastMousePos.x,
    });
  },
  true
);

/* ------------------------------------------------------
   Messages (Hotkey Trigger)
------------------------------------------------------ */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "SHOW_RESULT") updateResult(msg.payload);

  if (msg?.type === "COMMAND") {
    showBubble({
      top: lastMousePos.y,
      bottom: lastMousePos.y,
      left: lastMousePos.x,
      right: lastMousePos.x,
    });
  }
});

/* ------------------------------------------------------
   ESC key closes everything
------------------------------------------------------ */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    removeBubble();
    removeOverlay();
  }
});


/* ------------------------------------------------------
   Gmail mouseup → 버블 표시 (핵심)
------------------------------------------------------ */
document.addEventListener("mouseup", () => {
  if (!isGmailDomain()) return;

  const text = getIframeSelection();
  if (!text?.trim()) {
    removeBubble();
    return;
  }

  gmailSelectionCache = text.trim();

  const rect = getIframeSelectionRect();
  if (rect) showBubble(rect);
});
