// ======================================================
// TextBoi – Full Refactor Content Script
// Works on: Web / Gmail / Google Docs / Slides
// ======================================================

/* ------------------------------------------------------
   Utils
------------------------------------------------------ */

let lastSelectionRange = null;
let lastGmailRange = null;


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

function getDeepActiveSelection() {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  if (
    el &&
    (el.isContentEditable ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "INPUT")
  ) {
    try {
      const sel = el.ownerDocument.getSelection();
      if (sel && sel.toString().trim()) return sel.toString().trim();

      if (el.value && el.selectionStart !== el.selectionEnd)
        return el.value.substring(el.selectionStart, el.selectionEnd);
    } catch {}
  }
  return "";
}

function getIframeSelection() {
  for (const frame of document.querySelectorAll("iframe")) {
    try {
      const sel = frame.contentWindow.getSelection();
      if (sel && sel.toString().trim()) return sel.toString().trim();
    } catch {}
  }
  return "";
}

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
        right: rect.right + iframeRect.left
      };
    } catch {}
  }
  return null;
}

async function getSelectedTextUnified() {
  const sel = window.getSelection();
  if (sel && sel.toString().trim()) return sel.toString().trim();

  const deepSel = getDeepActiveSelection();
  if (deepSel) return deepSel;

  const iframeSel = getIframeSelection();
  if (iframeSel) return iframeSel;

  return "";
}

/* ------------------------------------------------------
   Overlay UI
------------------------------------------------------ */

let overlayEl = null, inputEl = null, resultEl = null, pendingResult = null;

const Overlay = {
  show(text) {
    Overlay.remove();

    overlayEl = document.createElement("div");
    Object.assign(overlayEl.style, {
      position: "fixed",
      top: 0,
      right: 0,
      width: "420px",
      height: "100vh",
      background: "#fff",
      zIndex: 2147483647,
      boxShadow: "-4px 0 16px rgba(0,0,0,0.18)",
      display: "flex",
      flexDirection: "column",
      padding: "12px"
    });

    // textarea
    inputEl = document.createElement("textarea");
    inputEl.value = text;
    inputEl.style.height = "120px";

    // 번역 결과
    resultEl = document.createElement("div");
    resultEl.textContent = "번역 중...";
    resultEl.style.marginTop = "12px";

    // 👇 추가되는 부분 — 변형 텍스트 박스
    let appendBox = document.createElement("div");
    appendBox.style.marginTop = "12px";
    appendBox.style.padding = "10px";
    appendBox.style.background = "#f3f3f3";
    appendBox.style.borderRadius = "8px";
    appendBox.style.whiteSpace = "pre-wrap";
    appendBox.style.fontSize = "13px";
    appendBox.style.color = "#333";
    appendBox.textContent = text + " 1@3$5^7*9)success";


    /* -------------------------------
       Replace 버튼 (웹 전용)
    -------------------------------- */
    const replaceBtn = document.createElement("button");
    replaceBtn.textContent = "Replace Selected Text";
    Object.assign(replaceBtn.style, {
      marginTop: "16px",
      padding: "10px 12px",
      background: "#007aff",
      color: "#fff",
      border: "none",
      borderRadius: "6px",
      cursor: "pointer",
      fontSize: "14px"
    });

    // 웹 전용 Replace 활성화
    replaceBtn.onclick = () => {
      const newText = appendBox.textContent;

      if (isGoogleDocsLike()) {
        alert("Google Docs / Slides는 Replace가 제한됩니다.");
        return;
      }

      if (isGmailDomain()) {
        replaceSelectedTextInWebandGmail(newText);
        return;
      }

      // 기본 웹
      replaceSelectedTextInWebandGmail(newText);
    };


    overlayEl.append(inputEl, resultEl, appendBox, replaceBtn);

    document.body.appendChild(overlayEl);

    if (pendingResult) {
      Overlay.update(pendingResult);
      pendingResult = null;
    }
  },


  update(payload) {
    if (!overlayEl || !resultEl) {
      pendingResult = payload;
      return;
    }
    if (payload.error) {
      resultEl.textContent = payload.message || "오류 발생";
      return;
    }
    resultEl.textContent =
      payload.text ??
      payload.result ??
      JSON.stringify(payload, null, 2);
  },

  remove() {
    overlayEl?.remove();
    overlayEl = null;
    inputEl = null;
    resultEl = null;
  }
};

/* ------------------------------------------------------
   Bubble UI
------------------------------------------------------ */

let bubbleEl = null;

const Bubble = {
  show(rect) {
    Bubble.remove();

    bubbleEl = document.createElement("div");
    bubbleEl.textContent = "✨ TextBoi";

    const w = 90, m = 8;
    let top = rect.bottom + m;
    let left = rect.right - w;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));

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
      zIndex: 2147483647,
      boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
      userSelect: "none",
      webkitUserSelect: "none",
      MozUserSelect: "none",
      pointerEvents: "auto"
    });

    document.body.appendChild(bubbleEl);
  },

  remove() {
    bubbleEl?.remove();
    bubbleEl = null;
  }
};


/* ------------------------------------------------------
   MODULE 1: Web
------------------------------------------------------ */

const WebModule = {
  lastText: "",
  dragging: false,
  mouseDown: false,

  init() {
    document.addEventListener("mousedown", () => {
      WebModule.mouseDown = true;
      WebModule.dragging = false;
      WebModule.lastText = "";
      Bubble.remove();
    });

    document.addEventListener("mousemove", () => {
      if (WebModule.mouseDown) WebModule.dragging = true;
    });

    document.addEventListener("mouseup", () => {
      WebModule.mouseDown = false;

      const sel = window.getSelection();
      const text = sel?.toString()?.trim() ?? "";
      if (!text) return Bubble.remove();

      // 🔥 Range 저장
      if (sel.rangeCount > 0) {
        lastSelectionRange = sel.getRangeAt(0).cloneRange();
      }

      WebModule.lastText = text;

      let rect;
      try {
        rect = sel.getRangeAt(0).getBoundingClientRect();
      } catch {
        return;
      }
      if (!rect.width || !rect.height) return;

      Bubble.show(rect);

      bubbleEl.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();

        Overlay.show(WebModule.lastText);

        chrome.runtime.sendMessage({
          type: "PROCESS_TEXT",
          mode: "translate",
          text: WebModule.lastText
        });

        Bubble.remove();
      };
    });
  }
};

/* ------------------------------------------------------
   MODULE 2: Gmail (FINAL REAL FIX)
------------------------------------------------------ */
const GmailModule = {
  lastText: "",
  dragging: false,
  mouseDown: false,

  init() {
    document.addEventListener("mousedown", () => {
      WebModule.mouseDown = true;
      WebModule.dragging = false;
      WebModule.lastText = "";
      Bubble.remove();
    });

    document.addEventListener("mousemove", () => {
      if (WebModule.mouseDown) WebModule.dragging = true;
    });

    document.addEventListener("mouseup", () => {
      WebModule.mouseDown = false;

      const sel = window.getSelection();
      const text = sel?.toString()?.trim() ?? "";
      if (!text) return Bubble.remove();


      // 🔥 Range 저장
      if (sel.rangeCount > 0) {
        lastSelectionRange = sel.getRangeAt(0).cloneRange();
      }
      WebModule.lastText = text;

      let rect;
      try {
        rect = sel.getRangeAt(0).getBoundingClientRect();
      } catch {
        return;
      }
      if (!rect.width || !rect.height) return;

      Bubble.show(rect);

      bubbleEl.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();

        Overlay.show(WebModule.lastText);

        chrome.runtime.sendMessage({
          type: "PROCESS_TEXT",
          mode: "translate",
          text: WebModule.lastText
        });

        Bubble.remove();
      };
    });
  }
};




/* ------------------------------------------------------
   MODULE 3: Google Docs / Slides
------------------------------------------------------ */

const DocsModule = {
  lastMousePos: { x: 0, y: 0 },
  isMouseDown: false,
  dragDistance: 0,
  startPos: { x: 0, y: 0 },

  init() {
    document.addEventListener("mousedown", (e) => {
      DocsModule.isMouseDown = true;
      DocsModule.dragDistance = 0;
      DocsModule.startPos = { x: e.clientX, y: e.clientY };
    }, true);

    document.addEventListener("mousemove", (e) => {
      DocsModule.lastMousePos = { x: e.clientX, y: e.clientY };
      if (!DocsModule.isMouseDown) return;

      DocsModule.dragDistance = Math.sqrt(
        (e.clientX - DocsModule.startPos.x) ** 2 +
        (e.clientY - DocsModule.startPos.y) ** 2
      );
    }, true);

    document.addEventListener("mouseup", async () => {
      DocsModule.isMouseDown = false;

      if (DocsModule.dragDistance < 6) return Bubble.remove();

      const text = await getSelectedTextUnified();
      if (!text) return Bubble.remove();

      Bubble.show({
        top: DocsModule.lastMousePos.y,
        bottom: DocsModule.lastMousePos.y,
        left: DocsModule.lastMousePos.x,
        right: DocsModule.lastMousePos.x
      });

      bubbleEl.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();

        Overlay.show(text);

        chrome.runtime.sendMessage({
          type: "PROCESS_TEXT",
          mode: "translate",
          text
        });

        Bubble.remove();
      };
    }, true);
  }
};


/* ------------------------------------------------------
   Router
------------------------------------------------------ */

if (isGoogleDocsLike()) {
  DocsModule.init();
} else if (isGmailDomain()) {
  GmailModule.init();
} else {
  WebModule.init();
}


/* ------------------------------------------------------
   Hotkey + Result Handling
------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SHOW_RESULT") Overlay.update(msg.payload);
});


function findGmailEditorIframe() {
  // Gmail compose iframe 추적
  return (
    document.querySelector('iframe[tabindex="1"]') || 
    document.querySelector('iframe.editable') ||
    document.querySelector('iframe.Am.Al') ||
    document.querySelector('iframe[allowfullscreen]') ||
    null
  );
}


/* ------------------------------------------------------
   Replace Function (Web + Gmail 동일 처리)
------------------------------------------------------ */
function replaceSelectedTextInWebandGmail(newText) {

  // 🔥 저장된 Range가 없으면 치환 불가능
  if (!lastSelectionRange) {
    alert("선택된 텍스트 범위를 찾을 수 없습니다.");
    return;
  }

  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(lastSelectionRange);

  let range = sel.getRangeAt(0);

  // 기존 선택 내용 삭제
  range.deleteContents();

  // 새 텍스트 삽입
  const textNode = document.createTextNode(newText);
  range.insertNode(textNode);

  // 🔥 커서 위치를 삽입된 텍스트 뒤로 이동
  sel.removeAllRanges();
  const newRange = document.createRange();
  newRange.setStartAfter(textNode);
  newRange.collapse(true);
  sel.addRange(newRange);

  console.log("Replaced:", newText);
}



// /* ------------------------------------------------------
//    Gmail Replace Function (iframe 내부 치환)
// ------------------------------------------------------ */
// function replaceSelectedTextInGmail(newText) {
//   // Gmail iframe 찾기
//   const iframe =
//     document.querySelector('iframe.Am.Al') || // 일반 Gmail 작성기
//     document.querySelector('iframe[tabindex="1"]') ||
//     document.querySelector("iframe.editable");

//   if (!iframe) {
//     alert("Gmail 편집 영역을 찾을 수 없습니다.");
//     return;
//   }

//   let sel, range;

//   try {
//     sel = iframe.contentWindow.getSelection();
//     if (!sel || sel.rangeCount === 0) {
//       alert("Gmail에서 선택된 텍스트가 없습니다.");
//       return;
//     }

//     range = sel.getRangeAt(0);
//   } catch (e) {
//     console.error("Gmail selection error:", e);
//     alert("Gmail 텍스트를 변경할 수 없습니다.");
//     return;
//   }

//   // 기존 내용 삭제
//   range.deleteContents();

//   // 새 텍스트 삽입
//   const textNode = iframe.contentWindow.document.createTextNode(newText);
//   range.insertNode(textNode);

//   // 커서를 텍스트 뒤로 이동
//   sel.removeAllRanges();
//   const newRange = iframe.contentWindow.document.createRange();
//   newRange.setStartAfter(textNode);
//   newRange.collapse(true);
//   sel.addRange(newRange);

//   console.log("Gmail text replaced:", newText);
// }
