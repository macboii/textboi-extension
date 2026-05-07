import { getSettings, saveSettings } from "../utils/storage.js";
import { DOUBLE_COPY_THRESHOLD_MS, MODELS, LANGUAGES, REWRITE_TYPES } from "../utils/constants.js";

// ═══════════════════════════════════════════════════════
// 전역 상태
// ═══════════════════════════════════════════════════════

let lastSelectionRange = null;
let lastSelectionRect = null;
let lastCopyAt = 0;

// ═══════════════════════════════════════════════════════
// 사이트 감지
// ═══════════════════════════════════════════════════════

function isGoogleDocsLike() {
  // Sheets는 DOM 기반 → 일반 copy 이벤트 방식 사용
  // Docs(document), Slides만 canvas 기반 → keydown + clipboard 방식
  const path = location.pathname;
  if (location.hostname.includes("docs.google.com")) {
    return path.includes("/document/") || path.includes("/presentation/");
  }
  return location.hostname.includes("slides.google.com");
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

function isContextAlive() {
  try { return !!chrome.runtime?.id; } catch { return false; }
}

// Suppress "Extension context invalidated" unhandled rejections
// (occurs when extension reloads while content script is still alive)
window.addEventListener("unhandledrejection", (event) => {
  if (event.reason?.message?.includes("Extension context invalidated")) {
    event.preventDefault();
  }
});

async function triggerProcessing(text) {
  try {
    if (!isContextAlive()) return;
    const settings = await getSettings();
    chrome.runtime.sendMessage({
      type: "PROCESS_TEXT",
      mode: settings.mode,
      text,
      targetLang: settings.targetLang,
      model: settings.model,
      rewritePrompt: settings.rewritePrompt,
    }).catch(() => {});
  } catch {}
}

function onDoubleCopy(text) {
  Bubble.remove();
  SidePanel.show(text);
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
    try {
      this.remove();
      this.state = "loading";
      this.currentResult = "";
      this.originalText = text;

      this.el = document.createElement("div");
      this.el.id = "textboi-panel";
      this.el.innerHTML = this._buildHTML();
      document.body.appendChild(this.el);

      this._position();

      this.el.querySelector(".tb-original").value = text;

      const settings = await getSettings();
      this._populateSelects(settings);
      this._bindEvents(settings);

      requestAnimationFrame(() => this.el?.classList.add("tb-panel--open"));
    } catch (e) {
      if (!e?.message?.includes("Extension context invalidated")) throw e;
    }
  },

  _position() {
    const W = 380, margin = 16;
    const vw = window.innerWidth, vh = window.innerHeight;
    const rect = lastSelectionRect;

    // 항상 우측 고정
    const left = vw - W - margin;

    let top;
    if (rect && (rect.top || rect.bottom)) {
      // 선택 영역 기준 수직 정렬 (아래 공간 있으면 아래, 없으면 위)
      const panelH = Math.min(560, vh - margin * 2);
      const spaceBelow = vh - rect.bottom - margin;
      if (spaceBelow >= panelH) {
        top = rect.bottom + margin;
      } else if (rect.top - margin >= panelH) {
        top = rect.top - panelH - margin;
      } else {
        // 화면 중앙
        top = Math.max(margin, (vh - panelH) / 2);
      }
    } else {
      top = Math.max(margin, (vh - 500) / 2);
    }

    Object.assign(this.el.style, {
      top: `${Math.max(margin, Math.min(top, vh - margin - 200))}px`,
      left: `${Math.max(margin, left)}px`,
    });
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
      resultEl.textContent = message || "An error occurred.";
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
    banner.textContent = "Free usage limit reached. Sign in to continue.";
    resultEl.appendChild(banner);
  },

  showGuestBanner(remaining) {
    const banner = this.el?.querySelector(".tb-guest-banner");
    if (!banner) return;
    banner.textContent = `${remaining} free use${remaining === 1 ? "" : "s"} remaining · Sign in for unlimited`;
    banner.style.display = "";
  },

  remove() {
    if (this.el) {
      this.el.classList.remove("tb-panel--open");
      const el = this.el;
      setTimeout(() => el.remove(), 220);
      this.el = null;
    }
    try {
      chrome.runtime.sendMessage({ type: "ABORT_STREAM" }).catch(() => {});
    } catch {}
  },

  _buildHTML() {
    const modelOptions = MODELS.map(
      (m) => `<option value="${m.id}">${m.label}</option>`
    ).join("");
    const langOptions = LANGUAGES.map(
      (l) => `<option value="${l.code}">${l.label}</option>`
    ).join("");
    const rewriteOptions = REWRITE_TYPES.map(
      (r) => `<option value="${r.id}">${r.label}</option>`
    ).join("");

    return `
      <div class="tb-header">
        <div class="tb-mode-btns">
          <button class="tb-mode-btn tb-mode-btn--active" data-mode="translate">
            <span class="tb-mode-icon">交</span> Translate
          </button>
          <button class="tb-mode-btn" data-mode="correct">
            <span class="tb-mode-icon">A✓</span> Correct
          </button>
        </div>
        <button class="tb-close-btn" aria-label="Close">✕</button>
      </div>
      <div class="tb-model-row">
        <select class="tb-model-select">${modelOptions}</select>
      </div>
      <div class="tb-guest-banner" style="display:none"></div>
      <div class="tb-section tb-section--top">
        <div class="tb-section-bar">
          <span class="tb-lang-badge">🌐 Auto-detect</span>
        </div>
        <div class="tb-text-box">
          <textarea class="tb-original" placeholder="Selected text appears here..." rows="4"></textarea>
        </div>
      </div>
      <div class="tb-divider"></div>
      <div class="tb-section tb-section--bottom">
        <div class="tb-section-bar">
          <select class="tb-target-lang-select tb-translate-only">${langOptions}</select>
          <select class="tb-rewrite-select tb-correct-only" style="display:none">${rewriteOptions}</select>
        </div>
        <div class="tb-text-box">
          <div class="tb-result-wrap">
            <div class="tb-spinner"></div>
            <div class="tb-result"></div>
          </div>
        </div>
        <div class="tb-custom-prompt-wrap tb-correct-only" style="display:none">
          <textarea class="tb-custom-prompt" placeholder="Custom instruction (optional)..." rows="2"></textarea>
        </div>
      </div>
      <div class="tb-footer">
        <button class="tb-retry-btn" aria-label="Retry">↺</button>
        <button class="tb-replace-btn" disabled>Apply <kbd>⌘↵</kbd></button>
      </div>
    `;
  },

  _populateSelects(settings) {
    const targetLangSel = this.el.querySelector(".tb-target-lang-select");
    const modelSel = this.el.querySelector(".tb-model-select");
    const rewriteSel = this.el.querySelector(".tb-rewrite-select");

    if (targetLangSel) targetLangSel.value = settings.targetLang;
    if (modelSel) modelSel.value = settings.model;
    if (rewriteSel) {
      // Backward compat: rewritePrompt may be old id ("proofread") or full prompt text
      const matchedByPrompt = REWRITE_TYPES.find(r => r.prompt === settings.rewritePrompt);
      const matchedById = REWRITE_TYPES.find(r => r.id === settings.rewritePrompt);
      rewriteSel.value = matchedByPrompt?.id || matchedById?.id || "proofread";
    }

    // 모드 버튼 active 상태 반영
    this.el.querySelectorAll(".tb-mode-btn").forEach((btn) => {
      btn.classList.toggle("tb-mode-btn--active", btn.dataset.mode === settings.mode);
    });

    // translate-only / correct-only 요소 표시
    this._switchMode(settings.mode);
  },

  _switchMode(mode) {
    const isCorrect = mode === "correct";
    this.el.querySelectorAll(".tb-translate-only").forEach(el => {
      el.style.display = isCorrect ? "none" : "";
    });
    this.el.querySelectorAll(".tb-correct-only").forEach(el => {
      el.style.display = isCorrect ? "" : "none";
    });
  },

  _bindEvents(settings) {
    // 닫기
    this.el.querySelector(".tb-close-btn").addEventListener("click", () => this.remove());

    // 모드 버튼 전환
    this.el.querySelectorAll(".tb-mode-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (btn.dataset.mode === settings.mode) return;
        this.el.querySelectorAll(".tb-mode-btn").forEach((b) => b.classList.remove("tb-mode-btn--active"));
        btn.classList.add("tb-mode-btn--active");
        settings.mode = btn.dataset.mode;
        this._switchMode(settings.mode);
        await saveSettings({ mode: settings.mode });
        this._rerun(settings);
      });
    });

    // 대상 언어 변경 (translate 모드)
    this.el.querySelector(".tb-target-lang-select").addEventListener("change", async (e) => {
      settings.targetLang = e.target.value;
      await saveSettings({ targetLang: e.target.value });
    });

    // 교정 스타일 변경 (correct 모드)
    this.el.querySelector(".tb-rewrite-select").addEventListener("change", async (e) => {
      const found = REWRITE_TYPES.find(r => r.id === e.target.value);
      const customVal = this.el.querySelector(".tb-custom-prompt")?.value?.trim();
      const prompt = customVal || found?.prompt || "";
      settings.rewritePrompt = prompt;
      await saveSettings({ rewritePrompt: prompt });
    });

    // 커스텀 프롬프트 — input 시 메모리 업데이트, blur 시 저장
    const customPromptEl = this.el.querySelector(".tb-custom-prompt");
    customPromptEl.addEventListener("input", (e) => {
      const customVal = e.target.value.trim();
      if (customVal) {
        settings.rewritePrompt = customVal;
      } else {
        const id = this.el.querySelector(".tb-rewrite-select")?.value || "proofread";
        const found = REWRITE_TYPES.find(r => r.id === id);
        settings.rewritePrompt = found?.prompt || "";
      }
    });
    customPromptEl.addEventListener("blur", async () => {
      await saveSettings({ rewritePrompt: settings.rewritePrompt });
    });

    // 모델 변경
    this.el.querySelector(".tb-model-select").addEventListener("change", async (e) => {
      settings.model = e.target.value;
      await saveSettings({ model: e.target.value });
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
    if (!text || !isContextAlive()) return;

    // correct 모드: 커스텀 프롬프트가 있으면 우선 사용
    if (settings.mode === "correct") {
      const customVal = this.el?.querySelector(".tb-custom-prompt")?.value?.trim();
      if (customVal) {
        settings.rewritePrompt = customVal;
      } else {
        const id = this.el?.querySelector(".tb-rewrite-select")?.value || "proofread";
        const found = REWRITE_TYPES.find(r => r.id === id);
        if (found) settings.rewritePrompt = found.prompt;
      }
    }

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

    try {
      chrome.runtime.sendMessage({
        type: "PROCESS_TEXT",
        mode: settings.mode,
        text,
        targetLang: settings.targetLang,
        model: settings.model,
        rewritePrompt: settings.rewritePrompt,
      }).catch(() => {});
    } catch {}
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
        <button class="tb-pop-replace-btn tb-pop-replace-btn--loading">✅ Replace <kbd>⌘↵</kbd></button>
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
    this.el.querySelector(".tb-pop-replace-btn")?.classList.remove("tb-pop-replace-btn--loading");
  },

  setError(message) {
    if (!this.el) return;
    this.state = "error";
    this.el.querySelector(".tb-spinner")?.remove();
    const resultEl = this.el.querySelector(".tb-pop-result");
    if (resultEl) resultEl.textContent = message || "An error occurred.";
  },

  remove() {
    this.el?.remove();
    this.el = null;
    this.state = null;
    try {
      chrome.runtime.sendMessage({ type: "ABORT_STREAM" }).catch(() => {});
    } catch {}
  },

  _bindEvents() {
    this.el.querySelector(".tb-pop-replace-btn").addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.state !== "done") return;
      handleReplace(this.currentResult);
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
    showToast("Selection lost. Please select text again.", "error");
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
      showToast("Could not find editable area.", "error");
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
  const iframe =
    document.querySelector("iframe.docs-texteventtarget-iframe") ||
    document.querySelector('iframe[tabindex="1"]');

  // ── Strategy 1: sync copy → sync paste (stays in user-gesture context) ──
  // navigator.clipboard.writeText is async and loses user-gesture context,
  // making execCommand('paste') fail. Using the deprecated-but-functional
  // execCommand('copy') keeps everything synchronous and trusted.
  let syncCopyOk = false;
  try {
    const ta = document.createElement("textarea");
    Object.assign(ta.style, {
      position: "fixed", top: "-9999px", left: "-9999px", opacity: "0",
    });
    ta.value = newText;
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    syncCopyOk = document.execCommand("copy");
    ta.remove();
  } catch {}

  if (iframe && syncCopyOk) {
    try {
      iframe.focus();
      iframe.contentDocument.body.focus();
      const pasted = iframe.contentDocument.execCommand("paste");
      if (pasted) {
        showToast("✅ Replaced");
        return;
      }
    } catch {}
  }

  // ── Strategy 2: ClipboardEvent with DataTransfer ──
  try { await navigator.clipboard.writeText(newText); } catch {}

  if (iframe) {
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", newText);
      dt.setData("text/html", newText);
      const notHandled = iframe.contentDocument.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        })
      );
      if (!notHandled) {
        showToast("✅ Replaced");
        return;
      }
    } catch {}
  }

  // ── Final fallback: clipboard is already written, guide manual paste ──
  showToast("Copied! Press Cmd+V to paste.", "error");
}

// ═══════════════════════════════════════════════════════
// 이중 복사 감지 — Web / Gmail (copy 이벤트 기반)
// ═══════════════════════════════════════════════════════

// copy 이벤트 핸들러 (document + iframe 공유)
function _handleCopyEvent() {
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
}

// mouseup 핸들러 (document + iframe 공유)
function _handleMouseUp() {
  // 1. 메인 document selection
  const sel = window.getSelection();
  let text = sel?.toString().trim() ?? "";
  let rect = null;

  if (text && sel.rangeCount > 0) {
    lastSelectionRange = sel.getRangeAt(0).cloneRange();
    try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch {}
  }

  // 2. iframe selection (Gmail compose 등)
  if (!text) {
    for (const frame of document.querySelectorAll("iframe")) {
      try {
        const iSel = frame.contentWindow.getSelection();
        const iText = iSel?.toString().trim();
        if (iText && iSel.rangeCount > 0) {
          text = iText;
          lastSelectionRange = iSel.getRangeAt(0).cloneRange();
          const iRect = iSel.getRangeAt(0).getBoundingClientRect();
          const fRect = frame.getBoundingClientRect();
          rect = {
            top: iRect.top + fRect.top,
            bottom: iRect.bottom + fRect.top,
            left: iRect.left + fRect.left,
            right: iRect.right + fRect.left,
            width: iRect.width,
            height: iRect.height,
          };
          break;
        }
      } catch {}
    }
  }

  if (!text) return Bubble.remove();
  if (rect) lastSelectionRect = rect;
  if (!lastSelectionRect?.width && !lastSelectionRect?.height) return;
  Bubble.show(lastSelectionRect, text);
}

// Gmail iframe에 이벤트 리스너 부착
function _attachIframeListeners() {
  for (const frame of document.querySelectorAll("iframe")) {
    if (frame._tbAttached) continue;
    try {
      const doc = frame.contentDocument;
      if (!doc || !doc.body) continue;
      // capture phase: Gmail이 stopPropagation 하더라도 먼저 받음
      doc.addEventListener("copy", _handleCopyEvent, true);
      doc.addEventListener("mouseup", _handleMouseUp);
      doc.addEventListener("mousedown", () => Bubble.remove());
      frame._tbAttached = true;
    } catch {}
  }
}

function initCopyDetector() {
  document.addEventListener("mousedown", () => Bubble.remove());
  document.addEventListener("mouseup", _handleMouseUp);

  // capture phase로 등록 → Gmail이 copy 이벤트를 막아도 먼저 수신
  document.addEventListener("copy", _handleCopyEvent, true);

  // Gmail: compose 창이 iframe 안에 있어 copy 이벤트가 부모 document까지 버블링 안 됨
  // → iframe에 직접 리스너 부착, 새 iframe 생성도 MutationObserver로 감시
  if (isGmailDomain()) {
    _attachIframeListeners();
    const observer = new MutationObserver(_attachIframeListeners);
    observer.observe(document.body, { childList: true, subtree: true });
  }
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

    iframe.contentDocument.addEventListener("keydown", async (e) => {
      if (!((e.metaKey || e.ctrlKey) && e.key === "c")) return;
      const now = Date.now();
      if ((now - lastCopyAt) < DOUBLE_COPY_THRESHOLD_MS) {
        lastCopyAt = 0;
        // Docs는 canvas 기반 → DOM selection 없음
        // 첫 번째 Cmd+C 시 Docs가 클립보드에 복사했으므로 거기서 읽음
        try {
          const text = await navigator.clipboard.readText();
          if (text?.trim()) onDoubleCopy(text.trim());
        } catch {
          // clipboard-read 실패 시 DOM selection fallback
          const text = getSelectedTextUnified();
          if (text) onDoubleCopy(text);
        }
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
      SidePanel.appendChunk(msg.chunk);
      break;

    case "STREAM_DONE":
      SidePanel.setDone(msg.result);
      break;

    case "STREAM_ERROR":
      SidePanel.setError(msg.message);
      break;

    case "GUEST_LIMIT_REACHED":
      SidePanel.showLoginPrompt();
      break;

    case "GUEST_REMAINING":
      SidePanel.showGuestBanner(msg.remaining);
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
