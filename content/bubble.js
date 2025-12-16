//bubble.js

let bubbleEl = null;

function showBubble({ rect, text }) {
  removeBubble();

  bubbleEl = document.createElement("div");
  bubbleEl.id = "textboi-bubble";
  bubbleEl.textContent = "✨ TextBoi";

  const margin = 8;
  const bubbleWidth = 80;

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
    boxShadow: "0 4px 12px rgba(0,0,0,0.25)"
  });

  bubbleEl.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    window.TextBoiOverlay.showOverlay(text);

    chrome.runtime.sendMessage({
      type: "PROCESS_TEXT",
      mode: "translate",
      text
    });

    removeBubble();
  });

  document.body.appendChild(bubbleEl);
}

function removeBubble() {
  bubbleEl?.remove();
  bubbleEl = null;
}

/* ⭐⭐⭐ 핵심: 전역으로 노출 */
window.TextBoiBubble = {
  showBubble,
  removeBubble
};
