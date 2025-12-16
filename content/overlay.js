// overlay.js

let resultEl;

function showOverlay(selectedText) {
  removeOverlay();

  const overlay = document.createElement("div");
  overlay.id = "textboi-overlay";

  Object.assign(overlay.style, {
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
    padding: "12px"
  });

  const input = document.createElement("textarea");
  input.value = selectedText;
  input.style.height = "120px";

  resultEl = document.createElement("div");
  resultEl.textContent = "번역 중...";
  resultEl.style.marginTop = "12px";

  overlay.append(input, resultEl);
  document.body.appendChild(overlay);
}

function updateResult(result) {
  if (resultEl) {
    resultEl.textContent = result.text ?? JSON.stringify(result);
  }
}

function removeOverlay() {
  document.getElementById("textboi-overlay")?.remove();
}

// ⭐ content.js에서 쓰기 위해 window에 노출
window.TextBoiOverlay = {
  showOverlay,
  updateResult,
  removeOverlay
};
