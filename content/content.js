import { getSettings, saveSettings } from "../utils/storage.js";
import { DOUBLE_COPY_THRESHOLD_MS, MODELS, LANGUAGES } from "../utils/constants.js";

// ═══════════════════════════════════════════════════════
// 전역 상태
// ═══════════════════════════════════════════════════════

let lastSelectionRange = null;
let lastCopyAt = 0;

// ═══════════════════════════════════════════════════════
// 사이트 감지
// ═══════════════════════════════════════════════════════

function isGoogleDocsLike() {
  return (
    location.hostname.includes("docs.google.com") ||
    location.hostname.includes("slides.google.com")
  );
}

function isGmailDomain() {
  return (
    location.hostname.includes("mail.google.com") ||
    location.hostname.includes("inbox.google.com")
  );
}

function isGmailEditable() {
  return (
    !!document.querySelector('div[aria-label*="Message Body"]') ||
    !!document.querySelector("div.Am.Al")
  );
}

// ═══════════════════════════════════════════════════════
// 선택 텍스트 추출
// ═══════════════════════════════════════════════════════

function getDeepActiveSelection() {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  if (!el) return "";
  try {
    const sel = el.ownerDocument.getSelection();
    if (sel && sel.toString().trim()) return sel.toString().trim();
    if (
      (el.tagName === "TEXTAREA" || el.tagName === "INPUT") &&
      el.selectionStart !== el.selectionEnd
    ) {
      return el.value.substring(el.selectionStart, el.selectionEnd);
    }
  } catch {}
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

function getSelectedTextUnified() {
  const sel = window.getSelection();
  if (sel && sel.toString().trim()) return sel.toString().trim();
  const deep = getDeepActiveSelection();
  if (deep) return deep;
  return getIframeSelection();
}

// ═══════════════════════════════════════════════════════
// Range 저장
// ═══════════════════════════════════════════════════════

function saveSelectionRange() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && sel.toString().trim()) {
    lastSelectionRange = sel.getRangeAt(0).cloneRange();
    return;
  }
  for (const frame of document.querySelectorAll("iframe")) {
    try {
      const iSel = frame.contentWindow.getSelection();
      if (iSel && iSel.rangeCount > 0 && iSel.toString().trim()) {
        lastSelectionRange = iSel.getRangeAt(0).cloneRange();
        return;
      }
    } catch {}
  }
}

// ═══════════════════════════════════════════════════════
// Toast
// ═══════════════════════════════════════════════════════

function showToast(message, type = "success") {
  document.getElementById("textboi-toast")?.remove();

  const toast = document.createElement("div");
  toast.id = "textboi-toast";
  toast.className = `tb-toast tb-toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("tb-toast--visible"));
  setTimeout(() => {
    toast.classList.remove("tb-toast--visible");
    setTimeout(() => toast.remove(), 200);
  }, 2200);
}

// ═══════════════════════════════════════════════════════
// 처리 트리거
// ═══════════════════════════════════════════════════════

async function triggerProcessing(text) {
  const settings = await getSettings();
  chrome.runtime.sendMessage({
    type: "PROCESS_TEXT",
    mode: settings.mode,
    text,
    targetLang: settings.targetLang,
    model: settings.model,
    rewritePrompt: settings.rewritePrompt,
  });
}

function onDoubleCopy(text) {
  Bubble.remove();
  if (isGoogleDocsLike()) {
    MiniPopover.show(DocsModule.lastMousePos, text);
  } else {
    SidePanel.show(text);
  }
  triggerProcessing(text);
}

// ═══════════════════════════════════════════════════════
// SidePanel
// ═══════════════════════════════════════════════════════

const SidePanel = {
  el: null,
  state: null,
  currentResult: "",
  originalText: "",

  async show(text) {
    this.remove();
    this.state = "loading";
    this.currentResult = "";
    this.originalText = text;

    this.el = document.createElement("div");
    this.el.id = "textboi-panel";
    this.el.innerHTML = this._buildHTML();
    document.body.appendChild(this.el);

    // 사용자 입력값은 textContent/value로만 설정 (XSS 방지)
    this.el.querySelector(".tb-original").value = text;

    const settings = await getSettings();
    this._populateSelects(settings);
    this._bindEvents(settings);

    requestAnimationFrame(() => this.el.classList.add("tb-panel--open"));
  },

  appendChunk(chunk) {
    if (!this.el) return;
    this.state = "streaming";
    this.currentResult += chunk;
    const resultEl = this.el.querySelector(".tb-result");
    if (resultEl) resultEl.textContent = this.currentResult;
  },

  setDone(result) {
    if (!this.el) return;
    this.state = "done";
    this.currentResult = result;
    const resultEl = this.el.querySelector(".tb-result");
    if (resultEl) resultEl.textContent = result;
    this.el.querySelector(".tb-replace-btn")?.removeAttribute("disabled");
    this.el.querySelector(".tb-spinner")?.remove();
  },

  setError(message) {
    if (!this.el) return;
    this.state = "error";
    const resultEl = this.el.querySelector(".tb-result");
    if (resultEl) {
      resultEl.textContent = message || "오류가 발생했습니다.";
      resultEl.classList.add("tb-result--error");
    }
    this.el.querySelector(".tb-spinner")?.remove();
  },

  showLoginPrompt() {
    if (!this.el) return;
    const resultEl = this.el.querySelector(".tb-result");
    if (!resultEl) return;
    resultEl.innerHTML = "";
    const banner = document.createElement("div");
    banner.className = "tb-login-prompt";
    banner.textContent = "무료 사용 횟수를 모두 사용했습니다. 로그인하면 계속 사용할 수 있습니다.";
    resultEl.appendChild(banner);
  },

  remove() {
    if (this.el) {
      this.el.classList.remove("tb-panel--open");
      const el = this.el;
      setTimeout(() => el.remove(), 220);
      this.el = null;
    }
    chrome.runtime.sendMessage({ type: "ABORT_STREAM" }).catch(() => {});
  },

  _buildHTML() {
    const modelOptions = MODELS.map(
      (m) => `<option value="${m.id}">${m.label}</option>`
    ).join("");
    const langOptions = LANGUAGES.map(
      (l) => `<option value="${l.code}">${l.label}</option>`
    ).join("");

    return `
      <div class="tb-header">
        <button class="tb-close-btn" aria-label="닫기">×</button>
        <span class="tb-title">TextBoi</span>
      </div>
      <div class="tb-mode-tabs">
        <button class="tb-tab tb-tab--active" data-mode="translate">번역</button>
        <button class="tb-tab" data-mode="correct">교정</button>
      </div>
      <div class="tb-body">
        <textarea class="tb-original" rows="4" placeholder="원본 텍스트"></textarea>
        <div class="tb-controls">
          <select class="tb-lang-select">${langOptions}</select>
          <select class="tb-model-select">${modelOptions}</select>
        </div>
        <div class="tb-result-wrap">
          <div class="tb-spinner"></div>
          <div class="tb-result"></div>
        </div>
        <div class="tb-actions">
          <button class="tb-replace-btn" disabled>Replace <kbd>⌘↵</kbd></button>
          <button class="tb-retry-btn" aria-label="재실행">↺</button>
        </div>
      </div>
    `;
  },

  _populateSelects(settings) {
    const langSel = this.el.querySelector(".tb-lang-select");
    const modelSel = this.el.querySelector(".tb-model-select");
    if (langSel) langSel.value = settings.targetLang;
    if (modelSel) modelSel.value = settings.model;

    const activeTab = this.el.querySelector(`.tb-tab[data-mode="${settings.mode}"]`);
    if (activeTab) {
      this.el.querySelectorAll(".tb-tab").forEach((t) => t.classList.remove("tb-tab--active"));
      activeTab.classList.add("tb-tab--active");
    }
  },

  _bindEvents(settings) {
    // 닫기
    this.el.querySelector(".tb-close-btn").addEventListener("click", () => this.remove());

    // 모드 탭 전환
    this.el.querySelectorAll(".tb-tab").forEach((tab) => {
      tab.addEventListener("click", async () => {
        if (tab.dataset.mode === settings.mode) return;
        this.el.querySelectorAll(".tb-tab").forEach((t) => t.classList.remove("tb-tab--active"));
        tab.classList.add("tb-tab--active");
        await saveSettings({ mode: tab.dataset.mode });
        settings.mode = tab.dataset.mode;
        this._rerun(settings);
      });
    });

    // 언어 변경
    this.el.querySelector(".tb-lang-select").addEventListener("change", async (e) => {
      await saveSettings({ targetLang: e.target.value });
      settings.targetLang = e.target.value;
    });

    // 모델 변경
    this.el.querySelector(".tb-model-select").addEventListener("change", async (e) => {
      await saveSettings({ model: e.target.value });
      settings.model = e.target.value;
    });

    // Replace 버튼
    this.el.querySelector(".tb-replace-btn").addEventListener("click", () => {
      if (this.state === "done") handleReplace(this.currentResult);
    });

    // 재실행 버튼
    this.el.querySelector(".tb-retry-btn").addEventListener("click", () => this._rerun(settings));

    // 원본 텍스트 Enter → 재실행 (Shift+Enter는 줄바꿈)
    this.el.querySelector(".tb-original").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this._rerun(settings);
      }
    });
  },

  _rerun(settings) {
    const text = this.el?.querySelector(".tb-original")?.value?.trim();
    if (!text) return;
    this.state = "loading";
    this.currentResult = "";
    const resultEl = this.el.querySelector(".tb-result");
    if (resultEl) {
      resultEl.textContent = "";
      resultEl.classList.remove("tb-result--error");
    }
    this.el.querySelector(".tb-replace-btn")?.setAttribute("disabled", "");

    const spinnerWrap = this.el.querySelector(".tb-result-wrap");
    if (spinnerWrap && !spinnerWrap.querySelector(".tb-spinner")) {
      const spinner = document.createElement("div");
      spinner.className = "tb-spinner";
      spinnerWrap.prepend(spinner);
    }

    chrome.runtime.sendMessage({
      type: "PROCESS_TEXT",
      mode: settings.mode,
      text,
      targetLang: settings.targetLang,
      model: settings.model,
      rewritePrompt: settings.rewritePrompt,
    });
  },
};

// ═══════════════════════════════════════════════════════
// MiniPopover (Google Docs / Slides)
// ═══════════════════════════════════════════════════════

const MiniPopover = {
  el: null,
  state: null,
  currentResult: "",

  show(pos, text) {
    this.remove();
    this.state = "loading";
    this.currentResult = "";

    this.el = document.createElement("div");
    this.el.id = "textboi-popover";
    this.el.innerHTML = `
      <div class="tb-pop-original"></div>
      <div class="tb-pop-result-wrap">
        <div class="tb-spinner"></div>
        <div class="tb-pop-result"></div>
      </div>
      <div class="tb-pop-actions">
        <button class="tb-pop-replace-btn" disabled>✅ Replace <kbd>⌘↵</kbd></button>
      </div>
    `;

    this.el.querySelector(".tb-pop-original").textContent = text;

    Object.assign(this.el.style, {
      top: `${pos.y + window.scrollY + 10}px`,
      left: `${pos.x + window.scrollX}px`,
    });

    document.body.appendChild(this.el);
    this._bindEvents();
  },

  appendChunk(chunk) {
    if (!this.el) return;
    this.state = "streaming";
    this.currentResult += chunk;
    const resultEl = this.el.querySelector(".tb-pop-result");
    if (resultEl) resultEl.textContent = this.currentResult;
  },

  setDone(result) {
    if (!this.el) return;
    this.state = "done";
    this.currentResult = result;
    const resultEl = this.el.querySelector(".tb-pop-result");
    if (resultEl) resultEl.textContent = result;
    this.el.querySelector(".tb-spinner")?.remove();
    this.el.querySelector(".tb-pop-replace-btn")?.removeAttribute("disabled");
  },

  setError(message) {
    if (!this.el) return;
    this.state = "error";
    this.el.querySelector(".tb-spinner")?.remove();
    const resultEl = this.el.querySelector(".tb-pop-result");
    if (resultEl) resultEl.textContent = message || "오류가 발생했습니다.";
  },

  remove() {
    this.el?.remove();
    this.el = null;
    this.state = null;
    chrome.runtime.sendMessage({ type: "ABORT_STREAM" }).catch(() => {});
  },

  _bindEvents() {
    this.el.querySelector(".tb-pop-replace-btn").addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.state === "done") handleReplace(this.currentResult);
    });

    // 외부 클릭 닫기
    const onOutside = (e) => {
      if (this.el && !this.el.contains(e.target)) {
        this.remove();
        document.removeEventListener("mousedown", onOutside, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  },
};

// ═══════════════════════════════════════════════════════
// Bubble
// ═══════════════════════════════════════════════════════

const Bubble = {
  el: null,

  show(rect, text) {
    this.remove();

    this.el = document.createElement("div");
    this.el.id = "textboi-bubble";
    this.el.textContent = "✨ TextBoi";

    const w = 90, m = 8;
    const top = rect.bottom + m;
    const left = Math.max(8, Math.min(rect.right - w, window.innerWidth - w - 8));

    Object.assign(this.el.style, {
      top: `${top}px`,
      left: `${left}px`,
    });

    this.el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onDoubleCopy(text);
    });

    document.body.appendChild(this.el);
  },

  remove() {
    this.el?.remove();
    this.el = null;
  },
};

// ═══════════════════════════════════════════════════════
// Replace
// ═══════════════════════════════════════════════════════

async function handleReplace(newText) {
  if (!newText) return;

  if (isGoogleDocsLike()) {
    await replaceSelectedTextInGoogleDocs(newText);
  } else {
    replaceSelectedTextInWeb(newText);
  }

  SidePanel.remove();
  MiniPopover.remove();
}

function replaceSelectedTextInWeb(newText) {
  if (!lastSelectionRange) {
    showToast("선택 범위가 사라졌습니다. 다시 선택해 주세요.", "error");
    return;
  }

  const rangeDoc = lastSelectionRange.startContainer?.ownerDocument || document;
  let sel;

  if (rangeDoc !== document) {
    // iframe 내부 (Gmail compose 등)
    for (const frame of document.querySelectorAll("iframe")) {
      try {
        if (frame.contentDocument === rangeDoc) {
          sel = frame.contentWindow.getSelection();
          break;
        }
      } catch {}
    }
    if (!sel) {
      showToast("편집 영역을 찾을 수 없습니다.", "error");
      return;
    }
  } else {
    sel = window.getSelection();
  }

  sel.removeAllRanges();
  sel.addRange(lastSelectionRange);

  const range = sel.getRangeAt(0);
  range.deleteContents();

  const textNode = rangeDoc.createTextNode(newText);
  range.insertNode(textNode);

  sel.removeAllRanges();
  const newRange = rangeDoc.createRange();
  newRange.setStartAfter(textNode);
  newRange.collapse(true);
  sel.addRange(newRange);

  // React / Vue 등 프레임워크 대응
  const container = textNode.parentElement;
  if (container) {
    container.dispatchEvent(new Event("input", { bubbles: true }));
    container.dispatchEvent(new Event("change", { bubbles: true }));
  }

  showToast("✅ Replaced");
  lastSelectionRange = null;
}

async function replaceSelectedTextInGoogleDocs(newText) {
  try {
    await navigator.clipboard.writeText(newText);

    const iframe =
      document.querySelector("iframe.docs-texteventtarget-iframe") ||
      document.querySelector('iframe[tabindex="1"]');

    if (!iframe) {
      showToast("Google Docs 편집 영역을 찾을 수 없습니다.", "error");
      return;
    }

    iframe.focus();
    iframe.contentWindow.document.body.focus();

    const isMac = navigator.platform.includes("Mac");
    iframe.contentWindow.document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "v",
        code: "KeyV",
        metaKey: isMac,
        ctrlKey: !isMac,
        bubbles: true,
      })
    );

    showToast("✅ Replaced");
  } catch (e) {
    console.error("[TextBoi] Docs replace failed", e);
    showToast("자동 붙여넣기 실패. Cmd+V로 직접 붙여넣기 해주세요.", "error");
  }
}

// ═══════════════════════════════════════════════════════
// 이중 복사 감지 — Web / Gmail (copy 이벤트 기반)
// ═══════════════════════════════════════════════════════

function initCopyDetector() {
  // mouseup: Bubble 표시 + Range 저장
  document.addEventListener("mousedown", () => {
    Bubble.remove();
  });

  document.addEventListener("mouseup", () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text) return Bubble.remove();

    if (sel.rangeCount > 0) {
      lastSelectionRange = sel.getRangeAt(0).cloneRange();
    }

    let rect;
    try {
      rect = sel.getRangeAt(0).getBoundingClientRect();
    } catch {
      return;
    }
    if (!rect.width && !rect.height) return;

    // Gmail 읽기 영역이면 Bubble 표시 (Replace는 setDone에서 조건 처리)
    Bubble.show(rect, text);
  });

  // copy 이벤트 × 2 → 이중 복사 트리거
  document.addEventListener("copy", () => {
    const now = Date.now();
    const text = getSelectedTextUnified();

    if ((now - lastCopyAt) < DOUBLE_COPY_THRESHOLD_MS && text) {
      lastCopyAt = 0;
      saveSelectionRange();
      onDoubleCopy(text);
    } else {
      lastCopyAt = now;
      saveSelectionRange();
    }
  });
}

// ═══════════════════════════════════════════════════════
// DocsModule — Google Docs / Slides
// ═══════════════════════════════════════════════════════

const DocsModule = {
  lastMousePos: { x: 0, y: 0 },
  isMouseDown: false,
  dragDistance: 0,
  startPos: { x: 0, y: 0 },

  init() {
    document.addEventListener("mousemove", (e) => {
      DocsModule.lastMousePos = { x: e.clientX, y: e.clientY };
      if (!DocsModule.isMouseDown) return;
      DocsModule.dragDistance = Math.hypot(
        e.clientX - DocsModule.startPos.x,
        e.clientY - DocsModule.startPos.y
      );
    }, true);

    document.addEventListener("mousedown", (e) => {
      DocsModule.isMouseDown = true;
      DocsModule.dragDistance = 0;
      DocsModule.startPos = { x: e.clientX, y: e.clientY };
      Bubble.remove();
    }, true);

    document.addEventListener("mouseup", async () => {
      DocsModule.isMouseDown = false;
      if (DocsModule.dragDistance < 6) return;

      const text = getSelectedTextUnified();
      if (!text) return;

      const pos = DocsModule.lastMousePos;
      const rect = { top: pos.y, bottom: pos.y, left: pos.x, right: pos.x };
      Bubble.show(rect, text);
    }, true);

    // Docs 편집 iframe에 keydown 리스너 부착 (iframe 안 이벤트는 부모 document까지 버블링 안 됨)
    if (!this._attachKeydown()) {
      const observer = new MutationObserver(() => {
        if (DocsModule._attachKeydown()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  },

  _attachKeydown() {
    const iframe = document.querySelector("iframe.docs-texteventtarget-iframe");
    if (!iframe?.contentDocument) return false;

    iframe.contentDocument.addEventListener("keydown", (e) => {
      if (!((e.metaKey || e.ctrlKey) && e.key === "c")) return;
      const now = Date.now();
      if ((now - lastCopyAt) < DOUBLE_COPY_THRESHOLD_MS) {
        lastCopyAt = 0;
        const text = getSelectedTextUnified();
        if (text) onDoubleCopy(text);
      } else {
        lastCopyAt = now;
      }
    }, true);

    return true;
  },
};

// ═══════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════

if (isGoogleDocsLike()) {
  DocsModule.init();
} else {
  initCopyDetector();
}

// ═══════════════════════════════════════════════════════
// 전역 키보드 단축키 (bubble phase — Docs keydown과 분리)
// ═══════════════════════════════════════════════════════

document.addEventListener("keydown", (e) => {
  // Esc: 모든 UI 닫기
  if (e.key === "Escape") {
    SidePanel.remove();
    MiniPopover.remove();
    Bubble.remove();
    return;
  }

  // Cmd/Ctrl+Enter: Replace 실행
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    if (SidePanel.state === "done") {
      e.preventDefault();
      handleReplace(SidePanel.currentResult);
    } else if (MiniPopover.state === "done") {
      e.preventDefault();
      handleReplace(MiniPopover.currentResult);
    }
  }
}, false);

// ═══════════════════════════════════════════════════════
// 메시지 수신 (background → content)
// ═══════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "STREAM_CHUNK":
      if (isGoogleDocsLike()) MiniPopover.appendChunk(msg.chunk);
      else SidePanel.appendChunk(msg.chunk);
      break;

    case "STREAM_DONE":
      if (isGoogleDocsLike()) MiniPopover.setDone(msg.result);
      else SidePanel.setDone(msg.result);
      break;

    case "STREAM_ERROR":
      if (isGoogleDocsLike()) MiniPopover.setError(msg.message);
      else SidePanel.setError(msg.message);
      break;

    case "GUEST_LIMIT_REACHED":
      SidePanel.showLoginPrompt();
      break;

    case "AUTH_CHANGED":
      // 필요 시 UI 상태 업데이트 (현재는 panel 닫기만)
      if (!msg.loggedIn) {
        SidePanel.remove();
        MiniPopover.remove();
      }
      break;

    case "COMMAND":
      // chrome.commands 단축키 (Alt+Shift+T 등)
      // 현재 선택 텍스트가 있으면 트리거
      {
        const text = getSelectedTextUnified();
        if (text) onDoubleCopy(text);
      }
      break;
  }
});
