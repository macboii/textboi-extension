//content.js

let lastSelectedText = "";
let lastRect = null;

// ⭐ Docs / Slides에서는 최상위 frame에서만 동작
if (window !== window.top) {
  // bubble은 iframe에서도 필요할 수 있으니 return ❌
  // Docs FAB만 막기 위해 flag 사용
  window.__TEXTBOI_IS_IFRAME__ = true;
}


const isGoogleDocs =
  location.hostname === "docs.google.com" ||
  location.hostname === "slides.google.com";

document.addEventListener("selectionchange", () => {
  const sel = window.getSelection();
  const text = sel?.toString()?.trim();

  // 공통: 선택 없으면 제거
  if (!text) {
    TextBoiBubble.removeBubble();
    hideDocsFAB();
    return;
  }

  // ✅ Docs / Slides
  if (isGoogleDocs) {
    // ⭐ iframe에서는 FAB 만들지 않음
    if (window.__TEXTBOI_IS_IFRAME__) return;

    showDocsFAB(text);
    return;
  }

  // ✅ 일반 웹 / Gmail / Notion → 기존 bubble
  let rect;
  try {
    rect = sel.getRangeAt(0).getBoundingClientRect();
  } catch {
    TextBoiBubble.removeBubble();
    return;
  }

  if (!rect) return;

  TextBoiBubble.showBubble({ rect, text });
});

function showDocsFAB(text) {
  // ⭐ 이미 있으면 재사용
  let fab = document.getElementById("textboi-docs-fab");
  if (fab) {
    fab.style.display = "block";
    return;
  }

  fab = document.createElement("div");
  fab.id = "textboi-docs-fab";
  fab.textContent = "✨ TextBoi";

  Object.assign(fab.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    zIndex: 2147483647,
    background: "#111",
    color: "#fff",
    padding: "10px 14px",
    borderRadius: "999px",
    cursor: "pointer",
    boxShadow: "0 6px 16px rgba(0,0,0,0.3)",
    fontSize: "13px",
    userSelect: "none"
  });

  fab.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const selected = window.getSelection()?.toString()?.trim();
    if (!selected) return;

    window.TextBoiOverlay.showOverlay(selected);

    chrome.runtime.sendMessage({
      type: "PROCESS_TEXT",
      mode: "translate",
      text: selected
    });
  });

  document.body.appendChild(fab);
}

function hideDocsFAB() {
  const fab = document.getElementById("textboi-docs-fab");
  if (fab) fab.style.display = "none";
}
