import { getSettings, saveSettings } from "../utils/storage.js";
import { DOUBLE_COPY_THRESHOLD_MS, MODELS, LANGUAGES, REWRITE_TYPES } from "../utils/constants.js";

// ═══════════════════════════════════════════════════════
// 전역 상태
// ═══════════════════════════════════════════════════════

let lastSelectionRange = null;
let lastSelectionRect = null;
let lastCopyAt = 0;
let _activeDropdown = null;

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
// Dropdown helpers
// ═══════════════════════════════════════════════════════

function closeActiveDropdown() {
  if (_activeDropdown) {
    _activeDropdown.el.remove();
    document.removeEventListener("mousedown", _activeDropdown.outside, true);
    document.removeEventListener("keydown", _activeDropdown.keydown, true);
    _activeDropdown = null;
  }
}

function openDropdown(triggerBtn, panelEl, width = 260) {
  closeActiveDropdown();

  panelEl.className = "tb-dd-panel";
  document.body.appendChild(panelEl);

  const rect = triggerBtn.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 4;

  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;

  const maxH = 320;
  if (top + maxH > window.innerHeight - 8) {
    panelEl.style.cssText += "transform:translateY(-100%) !important;";
    top = rect.top - 4;
  }

  Object.assign(panelEl.style, {
    position: "fixed",
    top: `${Math.max(8, top)}px`,
    left: `${Math.max(8, left)}px`,
    width: `${width}px`,
    zIndex: "2147483648",
  });

  const outside = (e) => {
    if (!panelEl.contains(e.target) && !triggerBtn.contains(e.target)) {
      closeActiveDropdown();
    }
  };
  const keydown = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closeActiveDropdown(); }
  };
  document.addEventListener("mousedown", outside, true);
  document.addEventListener("keydown", keydown, true);
  _activeDropdown = { el: panelEl, outside, keydown };

  panelEl.querySelector(".tb-dd-search")?.focus();
}

function buildLangDropdown(langs, currentCode, onSelect) {
  const panel = document.createElement("div");
  panel.innerHTML = `
    <div class="tb-dd-search-wrap">
      <input class="tb-dd-search" type="text" placeholder="언어 검색..." autocomplete="off" spellcheck="false" />
    </div>
    <div class="tb-dd-list"></div>
  `;

  const searchInput = panel.querySelector(".tb-dd-search");
  const list = panel.querySelector(".tb-dd-list");

  function renderList(filter) {
    const q = filter.toLowerCase();
    const filtered = q
      ? langs.filter(l => l.label.toLowerCase().includes(q) || l.code.toLowerCase().includes(q))
      : langs;
    list.innerHTML = "";
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tb-dd-empty";
      empty.textContent = "결과 없음";
      list.appendChild(empty);
      return;
    }
    filtered.forEach(lang => {
      const item = document.createElement("div");
      item.className = "tb-dd-item" + (lang.code === currentCode ? " tb-dd-item--selected" : "");
      item.textContent = lang.label;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        onSelect(lang.code, lang.label);
        closeActiveDropdown();
      });
      list.appendChild(item);
    });
  }

  renderList("");
  searchInput.addEventListener("input", () => renderList(searchInput.value.trim()));
  return panel;
}

function buildRewriteDropdown(types, currentId, onSelect) {
  const panel = document.createElement("div");
  panel.innerHTML = `
    <div class="tb-dd-search-wrap">
      <input class="tb-dd-search" type="text" placeholder="검색 또는 사용자 지정 프롬프트 + Enter" autocomplete="off" spellcheck="false" />
    </div>
    <div class="tb-dd-list"></div>
  `;

  const searchInput = panel.querySelector(".tb-dd-search");
  const list = panel.querySelector(".tb-dd-list");

  function renderList(filter) {
    const q = filter.toLowerCase();
    const filtered = q
      ? types.filter(t =>
          t.label.toLowerCase().includes(q) ||
          (t.description || "").toLowerCase().includes(q)
        )
      : types;
    list.innerHTML = "";
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tb-dd-empty";
      empty.textContent = "결과 없음";
      list.appendChild(empty);
      return;
    }
    filtered.forEach(type => {
      const item = document.createElement("div");
      item.className = "tb-dd-item tb-dd-item--rich" + (type.id === currentId ? " tb-dd-item--selected" : "");
      const labelEl = document.createElement("div");
      labelEl.className = "tb-dd-item-label";
      labelEl.textContent = type.label;
      item.appendChild(labelEl);
      if (type.description) {
        const descEl = document.createElement("div");
        descEl.className = "tb-dd-item-desc";
        descEl.textContent = type.description;
        item.appendChild(descEl);
      }
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        onSelect(type.id, type.label, type.prompt);
        closeActiveDropdown();
      });
      list.appendChild(item);
    });
  }

  renderList("");
  searchInput.addEventListener("input", () => renderList(searchInput.value.trim()));
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const custom = searchInput.value.trim();
      if (custom) { e.preventDefault(); onSelect(null, "✏️ Custom", custom); closeActiveDropdown(); }
    }
  });
  return panel;
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
    const W = 522, margin = 24;
    const vw = window.innerWidth, vh = window.innerHeight;
    const panelH = Math.min(930, Math.max(755, vh - margin * 2));
    const left = vw - W - margin;
    const top = Math.max(margin, (vh - panelH) / 2);

    Object.assign(this.el.style, {
      top: `${top}px`,
      left: `${Math.max(margin, left)}px`,
      height: `${panelH}px`,
    });
  },

  appendChunk(chunk) {
    if (!this.el) return;
    this.state = "streaming";
    this.currentResult += chunk;
    const resultEl = this.el.querySelector(".tb-result");
    if (resultEl) resultEl.textContent = this.currentResult;
    this.el.querySelector(".tb-empty-guide")?.remove();
  },

  setDone(result) {
    if (!this.el) return;
    this.state = "done";
    this.currentResult = result;
    const resultEl = this.el.querySelector(".tb-result");
    if (resultEl) resultEl.textContent = result;
    this.el.querySelector(".tb-replace-btn")?.removeAttribute("disabled");
    this.el.querySelector(".tb-spinner")?.remove();
    this.el.querySelector(".tb-empty-guide")?.remove();
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
    closeActiveDropdown();
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

    const isMac = navigator.platform.includes("Mac");
    const mod = isMac ? "⌘" : "Ctrl";

    return `
      <div class="tb-model-row">
        <div class="tb-model-selector">
          <span class="tb-model-dot"></span>
          <select class="tb-model-select">${modelOptions}</select>
        </div>
        <button class="tb-close-btn" aria-label="Close">✕</button>
      </div>
      <div class="tb-header">
        <div class="tb-mode-btns">
          <button class="tb-mode-btn tb-mode-btn--active" data-mode="translate">
            <span class="tb-mode-icon">交</span> Translate
          </button>
          <button class="tb-mode-btn" data-mode="correct">
            <span class="tb-mode-icon">A✓</span> Correct
          </button>
        </div>
      </div>
      <div class="tb-guest-banner" style="display:none"></div>
      <div class="tb-section tb-section--top">
        <div class="tb-section-bar">
          <button class="tb-source-lang-btn tb-lang-trigger">🌐 Auto-detect ▾</button>
        </div>
        <div class="tb-text-box">
          <textarea class="tb-original" placeholder="Selected text appears here..."></textarea>
        </div>
      </div>
      <div class="tb-divider"></div>
      <div class="tb-section tb-section--bottom">
        <div class="tb-section-bar">
          <button class="tb-target-lang-btn tb-lang-trigger tb-translate-only">— ▾</button>
          <button class="tb-rewrite-btn tb-lang-trigger tb-correct-only" style="display:none">— ▾</button>
        </div>
        <div class="tb-text-box">
          <div class="tb-result-wrap">
            <div class="tb-spinner"></div>
            <div class="tb-result"></div>
            <div class="tb-empty-guide">
              <div class="tb-empty-shortcut">
                <span class="tb-kbd">${mod}</span><span class="tb-kbd">C+C</span>
                <span class="tb-empty-desc">선택한 텍스트 두 번 복사로 불러오기</span>
              </div>
              <div class="tb-empty-shortcut">
                <span class="tb-kbd">${mod}</span><span class="tb-kbd">↵</span>
                <span class="tb-empty-desc">결과를 원문에 바로 적용</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="tb-footer">
        <button class="tb-retry-btn" aria-label="Retry">↺</button>
        <button class="tb-replace-btn" disabled>Apply <kbd>⌘↵</kbd></button>
      </div>
    `;
  },

  _updateModelDot(modelId) {
    const dot = this.el?.querySelector(".tb-model-dot");
    if (!dot) return;
    const colors = {
      "gpt-4o-mini":       "#FFD60A",
      "gpt-4.1-mini":      "#30D158",
      "gpt-4.1":           "#0A84FF",
      "gpt-5-chat-latest": "#BF5AF2",
    };
    dot.style.background = colors[modelId] || "#636366";
  },

  _populateSelects(settings) {
    const modelSel = this.el.querySelector(".tb-model-select");
    if (modelSel) {
      modelSel.value = settings.model;
      this._updateModelDot(settings.model);
    }

    const targetLangBtn = this.el.querySelector(".tb-target-lang-btn");
    if (targetLangBtn) {
      const lang = LANGUAGES.find(l => l.code === settings.targetLang);
      targetLangBtn.textContent = (lang?.label || settings.targetLang) + " ▾";
    }

    const rewriteBtn = this.el.querySelector(".tb-rewrite-btn");
    if (rewriteBtn) {
      const matchedByPrompt = REWRITE_TYPES.find(r => r.prompt === settings.rewritePrompt);
      const matchedById = REWRITE_TYPES.find(r => r.id === settings.rewritePrompt);
      const type = matchedByPrompt || matchedById || REWRITE_TYPES[0];
      rewriteBtn.textContent = type.label + " ▾";
    }

    this.el.querySelectorAll(".tb-mode-btn").forEach((btn) => {
      btn.classList.toggle("tb-mode-btn--active", btn.dataset.mode === settings.mode);
    });

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
    this.el.querySelector(".tb-close-btn").addEventListener("click", () => this.remove());

    this.el.querySelectorAll(".tb-mode-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (btn.dataset.mode === settings.mode) return;
        closeActiveDropdown();
        this.el.querySelectorAll(".tb-mode-btn").forEach((b) => b.classList.remove("tb-mode-btn--active"));
        btn.classList.add("tb-mode-btn--active");
        settings.mode = btn.dataset.mode;
        this._switchMode(settings.mode);
        await saveSettings({ mode: settings.mode });
        this._rerun(settings);
      });
    });

    // Source language dropdown
    this.el.querySelector(".tb-source-lang-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const panelEl = buildLangDropdown(LANGUAGES, null, (code, label) => {
        btn.textContent = label + " ▾";
      });
      openDropdown(btn, panelEl, 240);
    });

    // Target language dropdown
    this.el.querySelector(".tb-target-lang-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const panelEl = buildLangDropdown(LANGUAGES, settings.targetLang, async (code, label) => {
        settings.targetLang = code;
        btn.textContent = label + " ▾";
        await saveSettings({ targetLang: code });
      });
      openDropdown(btn, panelEl, 240);
    });

    // Rewrite style dropdown
    this.el.querySelector(".tb-rewrite-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const matchedByPrompt = REWRITE_TYPES.find(r => r.prompt === settings.rewritePrompt);
      const matchedById = REWRITE_TYPES.find(r => r.id === settings.rewritePrompt);
      const currentId = (matchedByPrompt || matchedById || REWRITE_TYPES[0]).id;
      const panelEl = buildRewriteDropdown(REWRITE_TYPES, currentId, async (id, label, prompt) => {
        settings.rewritePrompt = prompt;
        btn.textContent = label + " ▾";
        await saveSettings({ rewritePrompt: prompt });
      });
      openDropdown(btn, panelEl, 280);
    });

    this.el.querySelector(".tb-model-select").addEventListener("change", async (e) => {
      settings.model = e.target.value;
      this._updateModelDot(e.target.value);
      await saveSettings({ model: e.target.value });
    });

    this.el.querySelector(".tb-replace-btn").addEventListener("click", () => {
      if (this.state === "done") handleReplace(this.currentResult);
    });

    this.el.querySelector(".tb-retry-btn").addEventListener("click", () => this._rerun(settings));

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

    const iconUrl = chrome.runtime.getURL("icons/icon48.png");
    const img = document.createElement("img");
    img.src = iconUrl;
    img.style.cssText = "width:100% !important; height:100% !important; object-fit:cover !important; border-radius:50% !important; display:block !important; pointer-events:none !important;";
    this.el.appendChild(img);

    const size = 36; // bubble diameter
    // 선택 영역 우측 하단 바로 옆에 붙임
    const top = rect.bottom - size / 2;
    const left = Math.min(rect.right + 4, window.innerWidth - size - 8);

    Object.assign(this.el.style, {
      top: `${Math.max(8, top)}px`,
      left: `${Math.max(8, left)}px`,
    });

    this.el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      Bubble.remove();
      SidePanel.show(text);
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
  if (e.key === "Escape") {
    if (_activeDropdown) { closeActiveDropdown(); return; }
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
