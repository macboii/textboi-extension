import { getSettings, saveSettings } from "../utils/storage.js";
import { DOUBLE_COPY_THRESHOLD_MS, MODELS, LANGUAGES, SOURCE_LANGUAGES, REWRITE_TYPES, resolveLocale } from "../utils/constants.js";
import { detectLanguage } from "../utils/langDetect.js";

// ═══════════════════════════════════════════════════════
// 전역 상태
// ═══════════════════════════════════════════════════════

let lastSelectionRange = null;
let lastSelectionRect = null;
let lastCopyAt = 0;
let _activeDropdown = null;
let _lastBubbleState = null; // { text, rect } — 패널 닫힐 때 버블 복원용
let _extensionEnabled = true; // tb_enabled 스토리지 값 — false면 트리거/버블 전부 차단

// Mac 여부: userAgentData 우선, 폴백으로 platform/userAgent
const _isMac = (() => {
  if (navigator.userAgentData?.platform) return /mac/i.test(navigator.userAgentData.platform);
  return /mac/i.test(navigator.platform || navigator.userAgent);
})();
const _modSymbol = _isMac ? "⌘" : "Ctrl"; // UI 표시용 (⌘ / Ctrl)
const _modLabel  = _isMac ? "Cmd" : "Ctrl"; // 텍스트 메시지용

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

// 선택 끝점의 정확한 rect 반환 (드래그 방향 무관 — 항상 selection end 기준)
function getSelectionEndRect(range, frameOffset) {
  // range를 end 지점으로 collapse → 커서 위치 rect (width≈0, height=line-height)
  let endRect = null;
  try {
    const collapsed = range.cloneRange();
    collapsed.collapse(false); // false = collapse to end
    endRect = collapsed.getBoundingClientRect();
  } catch {}

  // collapse rect가 유효하지 않으면 getClientRects 마지막 줄로 폴백
  if (!endRect || (endRect.width === 0 && endRect.height === 0)) {
    const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 || r.height > 0);
    if (!rects.length) return null;
    let last = rects[0];
    for (const r of rects) {
      if (r.bottom > last.bottom || (r.bottom === last.bottom && r.right > last.right)) last = r;
    }
    endRect = last;
  }

  if (frameOffset) {
    return {
      top:    endRect.top    + frameOffset.top,
      bottom: endRect.bottom + frameOffset.top,
      left:   endRect.left   + frameOffset.left,
      right:  endRect.right  + frameOffset.left,
      width:  endRect.width,
      height: endRect.height,
    };
  }
  return endRect;
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
    // 드롭다운 닫힌 후 포커스가 body나 트리거 버튼으로 빠져나가면
    // 이후 Enter가 패널 캡처 핸들러에 도달하지 않으므로 textarea로 복귀
    requestAnimationFrame(() => {
      const textarea = SidePanel.el?.querySelector(".tb-original");
      if (textarea && !textarea.contains(document.activeElement)) {
        textarea.focus({ preventScroll: true });
      }
    });
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

function addKeyboardNav(searchInput, list) {
  function visibleItems() {
    return Array.from(list.querySelectorAll(".tb-dd-item[tabindex]"));
  }
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const all = visibleItems();
      if (all.length) all[0].focus();
    }
  });
  list.addEventListener("keydown", (e) => {
    const all = visibleItems();
    const idx = all.indexOf(document.activeElement);
    if (idx === -1) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (idx < all.length - 1) all[idx + 1].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx > 0) all[idx - 1].focus();
      else searchInput.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      all[idx].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    }
  });
}

function buildLangDropdown(langs, currentCode, onSelect) {
  const panel = document.createElement("div");
  panel.innerHTML = `
    <div class="tb-dd-search-wrap">
      <input class="tb-dd-search" type="text" placeholder="Search language..." autocomplete="off" spellcheck="false" />
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
      empty.textContent = "No results";
      list.appendChild(empty);
      return;
    }
    filtered.forEach(lang => {
      const item = document.createElement("div");
      item.className = "tb-dd-item" + (lang.code === currentCode ? " tb-dd-item--selected" : "");
      item.tabIndex = -1;
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
  addKeyboardNav(searchInput, list);
  return panel;
}

function buildRewriteDropdown(types, currentPrompt, customPrompts, onSelect) {
  const panel = document.createElement("div");
  panel.innerHTML = `
    <div class="tb-dd-search-wrap">
      <input class="tb-dd-search" type="text" placeholder="Search or enter custom prompt + Enter" autocomplete="off" spellcheck="false" />
    </div>
    <div class="tb-dd-list"></div>
  `;

  const searchInput = panel.querySelector(".tb-dd-search");
  const list = panel.querySelector(".tb-dd-list");
  const currentId = types.find(t => t.prompt === currentPrompt)?.id || types.find(t => t.id === currentPrompt)?.id;

  function renderList(filter) {
    const q = filter.toLowerCase();
    list.innerHTML = "";

    // Custom prompts section
    const matchedCustom = q
      ? customPrompts.filter(p => p.toLowerCase().includes(q))
      : customPrompts;

    if (matchedCustom.length > 0) {
      const header = document.createElement("div");
      header.className = "tb-dd-section-header";
      header.textContent = "Custom";
      list.appendChild(header);

      matchedCustom.forEach(p => {
        const item = document.createElement("div");
        item.className = "tb-dd-item" + (p === currentPrompt ? " tb-dd-item--selected" : "");
        item.tabIndex = -1;
        item.title = p;
        const labelEl = document.createElement("div");
        labelEl.className = "tb-dd-item-label";
        labelEl.textContent = "✏️ " + _truncateLabel(p, 36);
        item.appendChild(labelEl);
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          onSelect(null, p, p);
          closeActiveDropdown();
        });
        list.appendChild(item);
      });

      const divider = document.createElement("div");
      divider.className = "tb-dd-section-divider";
      list.appendChild(divider);
    }

    // Predefined types
    const filtered = q
      ? types.filter(t =>
          t.label.toLowerCase().includes(q) ||
          (t.description || "").toLowerCase().includes(q)
        )
      : types;

    if (filtered.length === 0 && matchedCustom.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tb-dd-empty";
      empty.textContent = "No results";
      list.appendChild(empty);
      return;
    }

    filtered.forEach(type => {
      const item = document.createElement("div");
      item.className = "tb-dd-item tb-dd-item--rich" + (type.id === currentId ? " tb-dd-item--selected" : "");
      item.tabIndex = -1;
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
  searchInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      const custom = searchInput.value.trim();
      if (custom) {
        e.preventDefault();
        await addCustomRewritePrompt(custom);
        onSelect(null, custom, custom);
        closeActiveDropdown();
      }
    }
  });
  addKeyboardNav(searchInput, list);
  return panel;
}

// ═══════════════════════════════════════════════════════
// Diff renderer (ported from textBoi_desktop/src/renderer/diffRenderer.ts)
// ═══════════════════════════════════════════════════════

import DiffMatchPatch from "diff-match-patch";

function _escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function _isCJK(text) {
  const count = (text.match(/[　-鿿가-힯]/g) || []).length;
  return text.length > 0 && count / text.length > 0.2;
}

function _wordLevelDiff(dmp, text1, text2) {
  const tokenize = (t) => t.split(/(\s+)/).filter(s => s.length > 0);
  const tokens1 = tokenize(text1);
  const tokens2 = tokenize(text2);
  const tokenToChar = new Map();
  let charCode = 0xE000;
  const encode = (token) => {
    if (!tokenToChar.has(token)) tokenToChar.set(token, String.fromCodePoint(charCode++));
    return tokenToChar.get(token);
  };
  const enc1 = tokens1.map(encode).join("");
  const enc2 = tokens2.map(encode).join("");
  const charDiffs = dmp.diff_main(enc1, enc2, false);
  const charToToken = new Map([...tokenToChar.entries()].map(([k, v]) => [v, k]));
  return charDiffs.map(([op, chars]) => {
    const words = [...chars].map(c => charToToken.get(c) ?? "");
    return [op, words.join("")];
  });
}

function _charLevelDiff(dmp, text1, text2) {
  const diffs = dmp.diff_main(text1, text2, false);
  dmp.diff_cleanupSemantic(diffs);
  return diffs;
}

function generateDiffHtml(original, corrected) {
  const dmp = new DiffMatchPatch();
  // 소프트 줄바꿈(textarea 자동 줄바꿈)을 공백으로 치환해 diff 내 \n 제거
  const normalize = (s) => s.trim().replace(/\r\n/g, "\n").replace(/[ \t]*\n[ \t]*/g, " ").replace(/\n+/g, " ").replace(/  +/g, " ");
  const orig = normalize(original);
  const corr = normalize(corrected);

  const diffs = (_isCJK(orig) || _isCJK(corr))
    ? _charLevelDiff(dmp, orig, corr)
    : _wordLevelDiff(dmp, orig, corr);

  const groups = [[]];

  for (const [op, text] of diffs) {
    if (op === -1) {
      groups[groups.length - 1].push([op, text]);
      continue;
    }
    const segments = text.split(/(?<=[.!?])(?=\s)|(?<=[。！？\n])/);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.length > 0) groups[groups.length - 1].push([op, seg]);
      if (i < segments.length - 1) groups.push([]);
    }
    const lastSeg = segments[segments.length - 1];
    if (/[.!?。！？]$/.test(lastSeg.trimEnd())) groups.push([]);
  }

  if (groups[groups.length - 1].length === 0) groups.pop();

  let html = "";
  for (const group of groups) {
    if (group.length === 0) continue;
    const diffHtml = group.map(([op, text]) => {
      if (op === 1) return `<span class="diff-added">${_escapeHtml(text)}</span>`;
      if (op === -1) return `<del class="diff-removed">${_escapeHtml(text)}</del>`;
      return _escapeHtml(text);
    }).join("");
    if (!diffHtml.trim()) continue;
    const hasChange = diffHtml.includes("<del") || diffHtml.includes('<span class="diff-added"');
    const correctedSentence = group.filter(([op]) => op !== -1).map(([, t]) => t).join("");
    html += `<div class="diff-line"><span class="diff-sentence">${diffHtml}</span>${
      hasChange ? `<button class="idea-icon" data-sentence="${_escapeHtml(correctedSentence.trim())}" title="Explain this change">💡</button>` : ""
    }</div>`;
  }

  return html || `<div class="diff-line"><span class="diff-sentence">${_escapeHtml(corr)}</span></div>`;
}

// ═══════════════════════════════════════════════════════
// ExplainPopup — 💡 클릭 시 변경 설명 팝업
// ═══════════════════════════════════════════════════════

const ExplainPopup = {
  el: null,
  _outsideHandler: null,

  async show(iconEl, diffHtml, rewritePrompt) {
    this.remove();
    if (!isContextAlive()) return;

    const popup = document.createElement("div");
    popup.className = "tb-explain-popup";
    popup.innerHTML = `<div class="tb-explain-loading"><span class="tb-explain-spinner"></span> Analyzing changes…</div>`;
    document.body.appendChild(popup);
    this.el = popup;
    this._positionNear(popup, iconEl);

    this._outsideHandler = (e) => {
      if (popup.contains(e.target)) return;
      if (e.target.classList?.contains("idea-icon")) return;
      this.remove();
    };
    document.addEventListener("mousedown", this._outsideHandler, true);

    try {
      const locale = navigator.language || "en-US";
      const settings = await getSettings();
      const model = settings.model || "gpt-4o-mini";

      const response = await new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            { type: "EXPLAIN_DIFF", diffHtml, rewritePrompt, locale, model },
            (res) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else resolve(res);
            }
          );
        } catch (e) { reject(e); }
      });

      if (!this.el) return;
      if (response?.type === "success" && response.changes?.length > 0) {
        this._render(response.changes);
      } else if (response?.type === "error" && response.message?.toLowerCase().includes("sign in")) {
        popup.innerHTML = `<div class="tb-explain-error">Sign in required to use explanations.</div>`;
      } else {
        popup.innerHTML = `<div class="tb-explain-error">No explanation available for this change.</div>`;
      }
    } catch (err) {
      if (this.el) {
        const msg = err?.message?.includes("Extension context") || err?.message?.includes("port closed")
          ? "Extension reloaded — please refresh the page."
          : "Explanation failed. Please try again.";
        this.el.innerHTML = `<div class="tb-explain-error">${msg}</div>`;
      }
    }
  },

  _positionNear(popup, iconEl) {
    const rect = iconEl.getBoundingClientRect();
    const pw = 320;
    let left = rect.right + 8;
    if (left + pw > window.innerWidth - 8) left = rect.left - pw - 8;
    if (left < 8) left = 8;

    Object.assign(popup.style, {
      position: "fixed",
      width: pw + "px",
      left: left + "px",
      zIndex: "2147483648",
    });

    const maxH = 320;
    if (rect.top + maxH > window.innerHeight - 8) {
      popup.style.bottom = (window.innerHeight - rect.bottom) + "px";
      popup.style.top = "auto";
      popup.style.maxHeight = (rect.bottom - 8) + "px";
    } else {
      popup.style.top = rect.top + "px";
      popup.style.bottom = "auto";
      popup.style.maxHeight = (window.innerHeight - rect.top - 8) + "px";
    }
  },

  _render(changes) {
    if (!this.el) return;
    this.el.innerHTML = changes.map((c) => {
      const hasOrig = !!c.original;
      const hasCorr = !!c.corrected;
      let header = "";
      if (hasOrig && hasCorr) {
        header = `<div class="tb-exp-header"><span class="tb-exp-original">${_escapeHtml(c.original)}</span><span class="tb-exp-arrow">→</span><span class="tb-exp-corrected">${_escapeHtml(c.corrected)}</span></div>`;
      } else if (hasOrig) {
        header = `<div class="tb-exp-header"><span class="tb-exp-original">${_escapeHtml(c.original)}</span></div>`;
      } else if (hasCorr) {
        header = `<div class="tb-exp-header"><span class="tb-exp-corrected">${_escapeHtml(c.corrected)}</span></div>`;
      }
      return `<div class="tb-explain-entry">${header}<div class="tb-exp-text">${_escapeHtml(c.explanation)}</div></div>`;
    }).join("");
  },

  remove() {
    if (this._outsideHandler) {
      document.removeEventListener("mousedown", this._outsideHandler, true);
      this._outsideHandler = null;
    }
    this.el?.remove();
    this.el = null;
  },
};

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

function _truncateLabel(text, maxLen = 24) {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 1) + "…";
}

async function getCustomRewritePrompts() {
  if (!isContextAlive()) return [];
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get("tb_custom_rewrites", ({ tb_custom_rewrites }) => {
        resolve(Array.isArray(tb_custom_rewrites) ? tb_custom_rewrites : []);
      });
    } catch { resolve([]); }
  });
}

async function addCustomRewritePrompt(text) {
  if (!isContextAlive()) return;
  const existing = await getCustomRewritePrompts();
  const filtered = existing.filter(p => p !== text);
  const updated = [text, ...filtered].slice(0, 5);
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ tb_custom_rewrites: updated }, resolve);
    } catch { resolve(); }
  });
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

    if (!navigator.onLine) {
      SidePanel.setError("No internet connection. Please check your network and try again.");
      return;
    }

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

// 처리 중 네트워크가 끊기면 스피너 대신 에러 표시
window.addEventListener("offline", () => {
  if (SidePanel.state === "loading" || SidePanel.state === "streaming") {
    SidePanel.setError("Connection lost. Please check your network and try again.");
  }
});

async function onDoubleCopy(text) {
  if (!_extensionEnabled) return;
  // 토큰/게스트 한도 초과 상태면 새 요청 차단 (패널이 이미 열려있으면 그대로 유지)
  if (SidePanel._quotaExceeded) return;
  Bubble.remove();
  SidePanel._resultCache = null; // 이중복사는 항상 새 결과 요청
  await SidePanel.show(text);
  SidePanel.startSpinner();
  triggerProcessing(text); // background에서 quota 초과 시 QUOTA_EXCEEDED 반환
}

// ═══════════════════════════════════════════════════════
// SidePanel
// ═══════════════════════════════════════════════════════

const SidePanel = {
  el: null,
  state: null,
  _outsideClickHandler: null,
  currentResult: "",
  originalText: "",
  _currentMode: "translate",
  _currentRewritePrompt: "",
  _resultCache: null, // { text, result, isDiff, diffHtml } — 패널 재오픈 시 복원용
  _quotaExceeded: false, // 토큰/게스트 한도 초과 시 재요청 차단

  async show(text) {
    try {
      this.remove();
      this.state = "loading";
      this._quotaExceeded = false;
      this.currentResult = "";
      this.originalText = text;

      this.el = document.createElement("div");
      this.el.id = "textboi-panel";
      this.el.innerHTML = this._buildHTML();
      document.body.appendChild(this.el);

      this._position();

      this.el.querySelector(".tb-original").value = text;
      this._updateSourceLang(text);

      const settings = await getSettings();
      // 플랜/로그인 상태 확인 (모델 셀렉터 잠금 여부 결정)
      const [token, currentPlan] = await Promise.all([
        new Promise((r) => chrome.storage.local.get("tb_access_token", ({ tb_access_token }) => r(tb_access_token || null))),
        new Promise((r) => chrome.storage.local.get("tb_current_plan", ({ tb_current_plan }) => r(tb_current_plan || null))),
      ]);
      const isGuestOrFree = !token || !currentPlan || currentPlan.plan_type === "free";
      if (isGuestOrFree) settings.model = "gpt-4o-mini";
      this._populateSelects(settings, isGuestOrFree);
      this._bindEvents(settings, isGuestOrFree);

      // 동일 텍스트 캐시 복원 (버블 클릭으로 재오픈 시 이전 결과 유지)
      const cache = this._resultCache;
      if (cache?.text === text && cache.result) {
        const resultEl = this.el.querySelector(".tb-result");
        if (resultEl) {
          if (cache.isDiff && cache.diffHtml) {
            resultEl.innerHTML = cache.diffHtml;
          } else {
            resultEl.textContent = cache.result;
          }
        }
        this.currentResult = cache.result;
        this.state = "done";
        this.el.querySelector(".tb-replace-btn")?.removeAttribute("disabled");
        this.el.querySelector(".tb-copy-btn")?.removeAttribute("disabled");
        this.el.querySelector(".tb-empty-guide")?.remove();
      }

      requestAnimationFrame(() => {
        this.el?.classList.add("tb-panel--open");
        // 패널 포커스 → Enter 키가 패널 submit으로 동작하도록
        this.el?.querySelector(".tb-original")?.focus();
      });
    } catch (e) {
      if (!e?.message?.includes("Extension context invalidated")) throw e;
    }
  },

  _position() {
    const W = 522, margin = 24;
    const vw = window.innerWidth, vh = window.innerHeight;
    const panelH = Math.min(880, vh - margin * 2);
    const left = vw - W - margin;
    const top = Math.max(margin, (vh - panelH) / 2);

    Object.assign(this.el.style, {
      top: `${top}px`,
      left: `${left}px`,
      width: `${W}px`,
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
    const sp = this.el.querySelector(".tb-spinner");
    if (sp) sp.style.setProperty("display", "none", "important");
  },

  setDone(result) {
    if (!this.el) return;
    this.state = "done";
    this.currentResult = result;
    const resultEl = this.el.querySelector(".tb-result");
    const isDiffMode = this._currentMode === "correct" && this._isDiffRewritePrompt();
    if (resultEl) {
      if (isDiffMode && this.originalText) {
        resultEl.innerHTML = generateDiffHtml(this.originalText, result);
      } else {
        resultEl.textContent = result;
      }
    }
    // 캐시 저장 — 버블 클릭으로 재오픈 시 복원
    this._resultCache = {
      text: this.originalText,
      result,
      isDiff: isDiffMode,
      diffHtml: isDiffMode ? (resultEl?.innerHTML || "") : null,
    };
    this.el.querySelector(".tb-replace-btn")?.removeAttribute("disabled");
    this.el.querySelector(".tb-copy-btn")?.removeAttribute("disabled");
    const sp = this.el.querySelector(".tb-spinner");
    if (sp) sp.style.setProperty("display", "none", "important");
    this.el.querySelector(".tb-empty-guide")?.remove();
  },

  _isDiffRewritePrompt() {
    const p = this._currentRewritePrompt || "";
    // stored as id (default) or as full prompt text (after user picks from dropdown)
    if (p === "proofread" || p === "improve") return true;
    const matched = REWRITE_TYPES.find(r => r.prompt === p);
    return matched?.id === "proofread" || matched?.id === "improve";
  },

  setError(message) {
    if (!this.el) return;
    this.state = "error";
    const resultEl = this.el.querySelector(".tb-result");
    if (resultEl) {
      resultEl.textContent = message || "An error occurred.";
      resultEl.classList.add("tb-result--error");
    }
    const sp = this.el.querySelector(".tb-spinner");
    if (sp) sp.style.setProperty("display", "none", "important");
  },

  _disableRunButtons() {
    this.el?.querySelector(".tb-submit-btn")?.setAttribute("disabled", "");
    this.el?.querySelector(".tb-retry-btn")?.setAttribute("disabled", "");
  },

  showLoginPrompt() {
    if (!this.el) return;
    this._quotaExceeded = true;
    this.state = "error"; // Cmd+Enter Replace 차단
    this._disableRunButtons();
    this.el.querySelector(".tb-spinner")?.remove();
    const resultEl = this.el.querySelector(".tb-result");
    if (!resultEl) return;
    resultEl.innerHTML = "";
    const banner = document.createElement("div");
    banner.className = "tb-login-prompt";
    banner.textContent = "Free usage limit reached. Sign in to continue.";
    resultEl.appendChild(banner);
  },

  showQuotaExceeded() {
    if (!this.el) return;
    this._quotaExceeded = true;
    this.state = "error"; // Cmd+Enter Replace 차단
    this._disableRunButtons();
    this.el.querySelector(".tb-spinner")?.remove();
    const resultEl = this.el.querySelector(".tb-result");
    if (!resultEl) return;
    resultEl.innerHTML = "";
    const banner = document.createElement("div");
    banner.className = "tb-login-prompt";
    banner.innerHTML = `Monthly token limit reached. <button class="tb-quota-upgrade-btn">Upgrade to Basic →</button>`;
    resultEl.appendChild(banner);
    banner.querySelector(".tb-quota-upgrade-btn")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "STRIPE_CHECKOUT", plan: "basic" }).catch(() => {});
    });
  },

  showGuestBanner(remaining) {
    const banner = this.el?.querySelector(".tb-guest-banner");
    if (!banner) return;
    banner.textContent = `${remaining} free use${remaining === 1 ? "" : "s"} remaining · Sign in for unlimited`;
    banner.style.display = "";
  },

  startSpinner() {
    if (!this.el) return;
    const wrap = this.el.querySelector(".tb-result-wrap");
    if (!wrap) return;
    const existing = wrap.querySelector(".tb-spinner");
    if (existing) {
      existing.style.removeProperty("display");
    } else {
      const sp = document.createElement("div");
      sp.className = "tb-spinner";
      wrap.prepend(sp);
    }
  },

  remove() {
    closeActiveDropdown();
    ExplainPopup.remove();
    if (this._cleanupDrag) { this._cleanupDrag(); this._cleanupDrag = null; }
    if (this._outsideClickHandler) {
      document.removeEventListener("mousedown", this._outsideClickHandler, true);
      this._outsideClickHandler = null;
    }
    if (this.el) {
      this.el.classList.remove("tb-panel--open");
      const el = this.el;
      setTimeout(() => {
        el.remove();
        // 패널 닫힌 후 버블을 기본 위치(우측 하단)에 복원
        if (!SidePanel.el && isContextAlive()) {
          Bubble.showDefault();
        }
      }, 220);
      this.el = null;
    }
    // 패널이 닫히면 quota 차단 상태 해제 (다음 이중복사 허용)
    this._quotaExceeded = false;
    if (!isContextAlive()) return;
    try {
      chrome.runtime.sendMessage({ type: "ABORT_STREAM" }).catch(() => {});
    } catch {}
  },

  _buildHTML() {
    const modelOptions = MODELS.map(
      (m) => `<option value="${m.id}">${m.label}</option>`
    ).join("");

    const mod = _modSymbol;

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
          <button class="tb-clear-btn" aria-label="Clear input">✕</button>
          <textarea class="tb-original" placeholder="Selected text appears here..." maxlength="10000"></textarea>
          <div class="tb-original-footer">
            <span class="tb-char-count">0 / 10,000</span>
            <div class="tb-original-actions">
              <button class="tb-submit-btn" aria-label="Run">⬇</button>
            </div>
          </div>
        </div>
      </div>
      <div class="tb-divider"></div>
      <div class="tb-section tb-section--bottom">
        <div class="tb-section-bar">
          <button class="tb-target-lang-btn tb-lang-trigger tb-translate-only">— ▾</button>
          <button class="tb-rewrite-btn tb-lang-trigger tb-correct-only tb-hidden">— ▾</button>
        </div>
        <div class="tb-text-box">
          <div class="tb-result-wrap">
            <button class="tb-copy-btn" disabled aria-label="Copy result"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
            <div class="tb-result"></div>
            <div class="tb-empty-guide">
              <div class="tb-empty-shortcut">
                <span class="tb-kbd">${mod}</span><span class="tb-kbd">C+C</span>
                <span class="tb-empty-desc">Double-copy selected text to load</span>
              </div>
              <div class="tb-empty-shortcut">
                <span class="tb-kbd">${mod}</span><span class="tb-kbd">↵</span>
                <span class="tb-empty-desc">Apply result to original text</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="tb-footer">
        <button class="tb-retry-btn" aria-label="Retry">↺</button>
        <button class="tb-replace-btn" disabled>Apply <kbd>${mod}↵</kbd></button>
      </div>
    `;
  },

  _updateSourceLang(text) {
    if (!this.el || !text || text.trim().length < 5) return;
    const btn = this.el.querySelector(".tb-source-lang-btn");
    if (!btn) return;
    const code = detectLanguage(text);
    if (!code || code === "unknown") return;
    const lang = SOURCE_LANGUAGES.find(l => l.code === code);
    if (lang) btn.textContent = lang.label + " ▾";
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

  _populateSelects(settings, isGuestOrFree = false) {
    this._currentMode = settings.mode || "translate";
    this._currentRewritePrompt = settings.rewritePrompt || "";

    const modelSel = this.el.querySelector(".tb-model-select");
    if (modelSel) {
      if (isGuestOrFree) {
        modelSel.value = "gpt-4o-mini";
        modelSel.disabled = true;
        modelSel.title = "gpt-4o-mini only (upgrade to use other models)";
      } else {
        modelSel.value = settings.model;
        modelSel.disabled = false;
        modelSel.title = "";
      }
      this._updateModelDot(isGuestOrFree ? "gpt-4o-mini" : settings.model);
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
      if (matchedByPrompt || matchedById) {
        rewriteBtn.textContent = (matchedByPrompt || matchedById).label + " ▾";
      } else if (settings.rewritePrompt) {
        rewriteBtn.textContent = "✏️ " + _truncateLabel(settings.rewritePrompt) + " ▾";
      } else {
        rewriteBtn.textContent = REWRITE_TYPES[0].label + " ▾";
      }
    }

    this.el.querySelectorAll(".tb-mode-btn").forEach((btn) => {
      btn.classList.toggle("tb-mode-btn--active", btn.dataset.mode === settings.mode);
    });

    this._switchMode(settings.mode);
  },

  _switchMode(mode) {
    const isCorrect = mode === "correct";
    this.el.querySelectorAll(".tb-translate-only").forEach(el => {
      el.classList.toggle("tb-hidden", isCorrect);
    });
    this.el.querySelectorAll(".tb-correct-only").forEach(el => {
      el.classList.toggle("tb-hidden", !isCorrect);
    });
  },

  _bindEvents(settings, isGuestOrFree = false) {
    this.el.querySelector(".tb-close-btn").addEventListener("click", () => this.remove());

    // ── 드래그 이동 ──
    const dragHandle = this.el.querySelector(".tb-model-row");
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

    dragHandle.addEventListener("mousedown", (e) => {
      // select·button 클릭은 드래그 제외
      if (e.target.closest("select, button")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.el.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      dragHandle.style.cursor = "grabbing";
      e.preventDefault();
    });

    const onMouseMove = (e) => {
      if (!dragging || !this.el) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const margin = 8;
      const vw = window.innerWidth, vh = window.innerHeight;
      // getBoundingClientRect()는 zoom 적용 후 시각적 크기를 반환
      const rect = this.el.getBoundingClientRect();
      const newLeft = Math.max(margin, Math.min(vw - rect.width - margin, startLeft + dx));
      const newTop = Math.max(margin, Math.min(vh - rect.height - margin, startTop + dy));
      this.el.style.left = `${newLeft}px`;
      this.el.style.top = `${newTop}px`;
    };

    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      dragHandle.style.cursor = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    // 패널 제거 시 전역 리스너 정리
    const origRemove = this.remove.bind(this);
    this._cleanupDrag = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    this.el.querySelectorAll(".tb-mode-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (btn.dataset.mode === settings.mode) return;
        closeActiveDropdown();
        ExplainPopup.remove();
        this.el.querySelectorAll(".tb-mode-btn").forEach((b) => b.classList.remove("tb-mode-btn--active"));
        btn.classList.add("tb-mode-btn--active");
        settings.mode = btn.dataset.mode;
        this._currentMode = settings.mode;
        this._switchMode(settings.mode);
        await saveSettings({ mode: settings.mode });
      });
    });

    // Source language dropdown — simple codes (no regional variants)
    this.el.querySelector(".tb-source-lang-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const currentCode = SOURCE_LANGUAGES.find(l => btn.textContent.startsWith(l.label))?.code || null;
      const panelEl = buildLangDropdown(SOURCE_LANGUAGES, currentCode, (code, label) => {
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
    this.el.querySelector(".tb-rewrite-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const customPrompts = await getCustomRewritePrompts();
      const panelEl = buildRewriteDropdown(REWRITE_TYPES, settings.rewritePrompt || "", customPrompts, async (id, label, prompt) => {
        settings.rewritePrompt = prompt;
        this._currentRewritePrompt = prompt;
        const btnLabel = id ? label : ("✏️ " + _truncateLabel(prompt));
        btn.textContent = btnLabel + " ▾";
        await saveSettings({ rewritePrompt: prompt });
      });
      openDropdown(btn, panelEl, 280);
    });

    this.el.querySelector(".tb-model-select").addEventListener("change", async (e) => {
      if (isGuestOrFree) { e.target.value = "gpt-4o-mini"; return; }
      settings.model = e.target.value;
      this._updateModelDot(e.target.value);
      await saveSettings({ model: e.target.value });
    });

    this.el.querySelector(".tb-replace-btn").addEventListener("click", () => {
      if (this.state === "done") handleReplace(this.currentResult);
    });

    this.el.querySelector(".tb-copy-btn").addEventListener("click", async () => {
      if (!this.currentResult) return;
      try {
        await navigator.clipboard.writeText(this.currentResult);
        const btn = this.el.querySelector(".tb-copy-btn");
        if (!btn) return;
        const prev = btn.innerHTML;
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#30D158" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        setTimeout(() => { if (btn.isConnected) btn.innerHTML = prev; }, 1500);
      } catch {
        showToast("Copy failed", "error");
      }
    });

    this.el.querySelector(".tb-retry-btn").addEventListener("click", () => this._rerun(settings));

    this.el.querySelector(".tb-submit-btn").addEventListener("click", () => this._rerun(settings));

    this.el.querySelector(".tb-clear-btn").addEventListener("click", () => {
      this._resultCache = null; // clear 시 캐시 무효화
      ExplainPopup.remove();
      // clear top textarea
      const ta = this.el.querySelector(".tb-original");
      if (ta) {
        ta.value = "";
        ta.dispatchEvent(new Event("input"));
        ta.focus();
      }
      // clear bottom result
      const resultEl = this.el.querySelector(".tb-result");
      if (resultEl) {
        resultEl.textContent = "";
        resultEl.classList.remove("tb-result--error");
      }
      // remove spinner if present
      this.el.querySelector(".tb-spinner")?.remove();
      // restore empty guide
      const wrap = this.el.querySelector(".tb-result-wrap");
      if (wrap && !wrap.querySelector(".tb-empty-guide")) {
        const mod = _modSymbol;
        const guide = document.createElement("div");
        guide.className = "tb-empty-guide";
        guide.innerHTML = `
          <div class="tb-empty-shortcut">
            <span class="tb-kbd">${mod}</span><span class="tb-kbd">C+C</span>
            <span class="tb-empty-desc">Double-copy selected text to load</span>
          </div>
          <div class="tb-empty-shortcut">
            <span class="tb-kbd">${mod}</span><span class="tb-kbd">↵</span>
            <span class="tb-empty-desc">Apply result to original text</span>
          </div>
        `;
        wrap.appendChild(guide);
      }
      // disable apply button and reset state
      this.el.querySelector(".tb-replace-btn")?.setAttribute("disabled", "");
      this.el.querySelector(".tb-copy-btn")?.setAttribute("disabled", "");
      this.state = null;
      this.currentResult = "";
      // abort any in-progress streaming
      if (isContextAlive()) chrome.runtime.sendMessage({ type: "ABORT_STREAM" }).catch(() => {});
    });

    const originalEl = this.el.querySelector(".tb-original");
    const charCountEl = this.el.querySelector(".tb-char-count");

    const updateCharCount = () => {
      const len = originalEl.value.length;
      charCountEl.textContent = `${len.toLocaleString()} / 10,000`;
      charCountEl.classList.toggle("tb-char-count--warn", len >= 9000);
    };
    updateCharCount();

    originalEl.addEventListener("input", updateCharCount);

    // Panel-level Enter handler (capture phase) — fires regardless of which child has focus.
    // Cmd/Ctrl+Enter is reserved for Replace (global handler), so skip modifier combos.
    // Skips <select> and <button> so dropdowns/buttons handle their own Enter.
    this.el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const active = document.activeElement;
        if (active?.tagName === "SELECT" || active?.tagName === "BUTTON") return;
        e.preventDefault();
        this._rerun(settings);
      }
    }, true);

    // 💡 idea icon click → ExplainPopup
    const resultEl = this.el.querySelector(".tb-result");
    if (resultEl) {
      resultEl.addEventListener("click", (e) => {
        const icon = e.target.closest(".idea-icon");
        if (!icon || !isContextAlive()) return;
        e.stopPropagation();
        const sentenceEl = icon.previousElementSibling;
        const diffHtml = sentenceEl?.innerHTML?.trim() || "";
        ExplainPopup.show(icon, diffHtml, this._currentRewritePrompt);
      });
    }

    this._outsideClickHandler = (e) => {
      if (!this.el) return;
      if (this.el.contains(e.target)) return;
      if (e.target.closest?.(".tb-dd-panel")) return;
      this.remove();
    };
    document.addEventListener("mousedown", this._outsideClickHandler, true);
  },

  _rerun(settings) {
    if (this._quotaExceeded) return;
    const text = this.el?.querySelector(".tb-original")?.value?.trim();
    if (!text || !isContextAlive()) return;
    this._resultCache = null; // 재실행 시 캐시 무효화
    this._updateSourceLang(text);
    ExplainPopup.remove();

    this.state = "loading";
    this.currentResult = "";
    const resultEl = this.el.querySelector(".tb-result");
    if (resultEl) {
      resultEl.textContent = "";
      resultEl.classList.remove("tb-result--error");
    }
    this.el.querySelector(".tb-replace-btn")?.setAttribute("disabled", "");

    const spinnerWrap = this.el.querySelector(".tb-result-wrap");
    const existingSp = spinnerWrap?.querySelector(".tb-spinner");
    if (existingSp) {
      existingSp.style.removeProperty("display");
    } else if (spinnerWrap) {
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
    if (!isContextAlive()) return;
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
      if (!isContextAlive()) {
        document.removeEventListener("mousedown", onOutside, true);
        return;
      }
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
  _text: null,       // null = 기본 위치(선택 없음), string = 선택 텍스트
  _onClickFn: null,  // Docs 등 커스텀 클릭 핸들러

  _defaultPos() {
    const size = 36, margin = 20;
    return {
      top: `${window.innerHeight - size - margin}px`,
      left: `${window.innerWidth - size - margin}px`,
    };
  },

  _createEl() {
    if (!isContextAlive()) return null;
    let iconUrl;
    try { iconUrl = chrome.runtime.getURL("icons/icon48.png"); } catch { return null; }

    const el = document.createElement("div");
    el.id = "textboi-bubble";
    const img = document.createElement("img");
    img.src = iconUrl;
    img.style.cssText = "width:100% !important; height:100% !important; object-fit:cover !important; border-radius:50% !important; display:block !important; pointer-events:none !important;";
    el.appendChild(img);

    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = this._text || "";
      const fn = this._onClickFn;
      this.remove(); // 패널 열기 전 DOM에서 제거
      if (fn) { fn(text); return; }
      if (SidePanel.el) {
        if (text) {
          const ta = SidePanel.el.querySelector(".tb-original");
          if (ta) { ta.value = text; ta.dispatchEvent(new Event("input")); SidePanel._updateSourceLang(text); }
        }
      } else {
        SidePanel.show(text);
      }
    });
    return el;
  },

  // 페이지 로드 시 우측 하단에 버블 초기화
  init() {
    if (!isContextAlive() || this.el) return;
    const el = this._createEl();
    if (!el) return;
    this.el = el;
    Object.assign(el.style, this._defaultPos());
    document.body.appendChild(el);
    this._text = null;
    this._onClickFn = null;
  },

  // 선택 해제 또는 패널 닫힐 때: 우측 하단으로 이동
  showDefault() {
    if (!isContextAlive() || !_extensionEnabled) return;
    if (!this.el) { this.init(); return; }
    Object.assign(this.el.style, this._defaultPos());
    this._text = null;
    this._onClickFn = null;
  },

  // 텍스트 선택 시: 선택 영역 근처로 이동
  show(rect, text, onClickFn) {
    if (!isContextAlive() || !_extensionEnabled) return;
    if (!this.el) this.init();
    if (!this.el) return;
    const size = 36;
    const top = rect.bottom - size / 2;
    const left = Math.min(rect.right + 4, window.innerWidth - size - 8);
    Object.assign(this.el.style, {
      top: `${Math.max(8, top)}px`,
      left: `${Math.max(8, left)}px`,
    });
    this._text = text || null;
    this._onClickFn = onClickFn || null;
  },

  // 패널 열릴 때 / 익스텐션 비활성화 시: DOM에서 완전 제거
  remove() {
    this.el?.remove();
    this.el = null;
    this._text = null;
    this._onClickFn = null;
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

  // Write to clipboard without touching focus — Docs selection stays intact.
  // (Hidden-textarea + ta.focus() approach was removed: it stole focus from the
  //  Docs iframe, causing Docs to collapse the selection to a cursor, so paste
  //  landed at the cursor position instead of replacing the selected text.)
  try { await navigator.clipboard.writeText(newText); } catch {}

  // ── Strategy 1: ClipboardEvent with DataTransfer (no focus change) ──
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

  // ── Strategy 2: execCommand paste (clipboard already written above) ──
  if (iframe) {
    try {
      const pasted = iframe.contentDocument.execCommand("paste");
      if (pasted) {
        showToast("✅ Replaced");
        return;
      }
    } catch {}
  }

  // ── Final fallback: guide manual paste ──
  showToast(`Copied! Press ${_modLabel}+V to paste.`, "error");
}

// ═══════════════════════════════════════════════════════
// 이중 복사 감지 — Web / Gmail (copy 이벤트 기반)
// ═══════════════════════════════════════════════════════

// copy 이벤트 핸들러 (document + iframe 공유)
function _handleCopyEvent() {
  if (!isContextAlive()) return;
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

// 선택 텍스트와 마지막 줄 rect를 구해 Bubble 표시 (mouseup / selectionchange 공용)
function _showBubbleForSelection() {
  if (!_extensionEnabled) return;
  // 패널이 열려있으면 버블 생성 안 함
  if (SidePanel.el) return;

  // 1. 메인 document selection
  const sel = window.getSelection();
  let text = sel?.toString().trim() ?? "";
  let rect = null;

  if (text && sel.rangeCount > 0) {
    // selection이 패널 내부에 있으면 버블 표시 안 함
    const ancestor = sel.getRangeAt(0).commonAncestorContainer;
    const anchorEl = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : ancestor;
    if (anchorEl?.closest?.("#textboi-panel")) return;

    lastSelectionRange = sel.getRangeAt(0).cloneRange();
    rect = getSelectionEndRect(sel.getRangeAt(0));
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
          const fRect = frame.getBoundingClientRect();
          rect = getSelectionEndRect(iSel.getRangeAt(0), { top: fRect.top, left: fRect.left });
          break;
        }
      } catch {}
    }
  }

  if (!text) { Bubble.showDefault(); _lastBubbleState = null; return; }
  if (rect) lastSelectionRect = rect;
  if (!lastSelectionRect) return;
  _lastBubbleState = { text, rect: lastSelectionRect }; // 버블 상태 저장
  Bubble.show(lastSelectionRect, text);
}

// mouseup 핸들러
function _handleMouseUp() {
  if (!isContextAlive()) return;
  _showBubbleForSelection();
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
      doc.addEventListener("mousedown", () => Bubble.showDefault());
      doc.addEventListener("mouseup", _handleMouseUp);
      frame._tbAttached = true;
    } catch {}
  }
}

function initCopyDetector() {
  let _isMouseDown = false;
  let _mouseDownInUI = false; // 패널/드롭다운/버블/팝업 안에서 눌렸으면 mouseup도 무시

  document.addEventListener("mousedown", (e) => {
    _isMouseDown = true;
    _mouseDownInUI = !!(
      e.target.closest?.("#textboi-panel") ||
      e.target.closest?.(".tb-dd-panel") ||
      e.target.closest?.(".tb-explain-popup") ||
      e.target.closest?.("#textboi-bubble")
    );
    if (_mouseDownInUI) return;
    Bubble.showDefault();
    _lastBubbleState = null; // 페이지 컨텐츠 클릭 = 새 선택 시작, 이전 버블 무효화
  });
  document.addEventListener("mouseup", () => {
    _isMouseDown = false;
    if (_mouseDownInUI) return; // 패널/UI 안 클릭 — 버블 갱신 안 함
    _handleMouseUp();
  });

  // 키보드 선택 감지 — 마우스 드래그 중엔 무시
  let _selTimer = null;
  document.addEventListener("selectionchange", () => {
    if (_isMouseDown) return;            // 드래그 중 → mouseup에서 처리
    clearTimeout(_selTimer);
    _selTimer = setTimeout(() => {
      if (!isContextAlive()) return;
      if (document.activeElement?.closest?.("#textboi-panel")) return;
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (text.length < 2) { Bubble.showDefault(); return; }
      _showBubbleForSelection();
    }, 250);
  });

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
  _lastMousePos: null,   // 키보드 선택 시 버블 위치 기준
  _pendingText: "",      // mouseup에서 미리 복사한 텍스트 (버블 클릭 시 재사용)
  _skipNextMouseup: false, // 버블 클릭 후 mouseup이 새 버블을 만드는 것을 방지

  // Docs 선택 영역을 클립보드에 쓰고 readText()로 읽음
  // Docs는 Cmd+C keydown(iframe)에 반응해 클립보드에 씀
  // execCommand("copy")를 부모 doc + iframe doc 양쪽에 시도 → 어느 쪽이든 Docs 핸들러가 반응하면 성공
  async _execCopyAndCapture() {
    try { document.execCommand("copy"); } catch {}
    try {
      const iframe = document.querySelector("iframe.docs-texteventtarget-iframe");
      if (iframe?.contentDocument) iframe.contentDocument.execCommand("copy");
    } catch {}
    try { return (await navigator.clipboard.readText()).trim(); } catch {}
    return "";
  },

  init() {
    let startX = 0, startY = 0;

    // 마우스 위치 추적 (키보드 선택 버블 위치 결정용)
    document.addEventListener("mousemove", (e) => {
      DocsModule._lastMousePos = { x: e.clientX, y: e.clientY };
    });

    // capture phase — 드래그 시작 기록 (버블/패널 클릭은 무시)
    document.addEventListener("mousedown", (e) => {
      if (Bubble.el?.contains(e.target)) return;
      if (
        e.target.closest?.("#textboi-panel") ||
        e.target.closest?.(".tb-dd-panel") ||
        e.target.closest?.(".tb-explain-popup")
      ) return;
      startX = e.clientX;
      startY = e.clientY;
      Bubble.showDefault();
      _lastBubbleState = null;
      DocsModule._pendingText = "";
    }, true);

    // bubble phase — Docs의 mouseup이 먼저 실행되어 selection이 확정된 뒤 copy 캡처
    document.addEventListener("mouseup", async (e) => {
      if (!isContextAlive()) return;
      if (DocsModule._skipNextMouseup) { DocsModule._skipNextMouseup = false; return; }
      if (Bubble.el?.contains(e.target)) return;
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (dist < 6) return;

      const rect = { top: e.clientY, bottom: e.clientY, left: e.clientX, right: e.clientX };
      DocsModule._pendingText = await DocsModule._execCopyAndCapture();
      DocsModule._showSelectionBubble(rect);
    }); // bubble phase: Docs의 mouseup 핸들러 이후 실행 → selection 확정 상태에서 copy

    // Docs 편집 iframe에 keydown / keyup 부착
    const tryAttach = () => {
      const iframe = document.querySelector("iframe.docs-texteventtarget-iframe");
      if (!iframe?.contentDocument) return false;

      let _selTimer = null;

      // Docs iframe keydown (contentWindow 레벨) — Cmd+Enter 인터셉트
      // contentWindow는 contentDocument보다 상위 → capture phase에서 먼저 실행됨
      // Docs의 Cmd+Enter(줄바꿈 삽입) 핸들러가 contentDocument에 등록되어 있으므로
      // contentWindow capture 핸들러에서 stopImmediatePropagation()으로 차단
      iframe.contentWindow.addEventListener("keydown", (e) => {
        if (!isContextAlive()) return;

        // Esc: 패널/버블 닫기
        if (e.key === "Escape") {
          if (_activeDropdown) { closeActiveDropdown(); e.preventDefault(); return; }
          if (SidePanel.el || Bubble._text !== null) {
            e.preventDefault();
            e.stopImmediatePropagation();
            SidePanel.remove();
            if (Bubble._text !== null) Bubble.showDefault();
          }
          return;
        }

        // Cmd/Ctrl+Enter: Replace
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          if (SidePanel.state === "done") {
            e.preventDefault();
            e.stopImmediatePropagation();
            handleReplace(SidePanel.currentResult);
          } else if (SidePanel.el) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
          return;
        }

        // Cmd+A: 전체 선택 → 버블 표시
        // contentWindow capture는 contentDocument보다 먼저 실행되어 Docs 차단 우회 가능
        if ((e.metaKey || e.ctrlKey) && e.key === "a") {
          if (SidePanel.el) return;
          DocsModule._pendingText = "";
          clearTimeout(_selTimer);
          _selTimer = setTimeout(() => {
            if (!isContextAlive() || SidePanel.el) return;
            const pos = DocsModule._lastMousePos ?? { x: window.innerWidth - 80, y: window.innerHeight / 2 };
            const rect = { top: pos.y, bottom: pos.y, left: pos.x, right: pos.x };
            DocsModule._showSelectionBubble(rect);
          }, 400);
          return;
        }
      }, true);

      // Docs iframe keydown (contentDocument 레벨) — 이중 Cmd+C 감지
      iframe.contentDocument.addEventListener("keydown", async (e) => {
        if (!isContextAlive()) return;

        // 이중 Cmd+C → 자동 처리
        if (!((e.metaKey || e.ctrlKey) && e.key === "c")) return;
        const now = Date.now();
        if ((now - lastCopyAt) < DOUBLE_COPY_THRESHOLD_MS) {
          lastCopyAt = 0;
          try {
            const text = await navigator.clipboard.readText();
            if (text?.trim()) onDoubleCopy(text.trim());
          } catch {
            const text = getSelectedTextUnified();
            if (text) onDoubleCopy(text);
          }
        } else {
          lastCopyAt = now;
        }
      }, true);

      // 키보드 선택 감지 (Shift+Arrow) → 버블 표시
      iframe.contentDocument.addEventListener("keyup", (e) => {
        if (!isContextAlive()) return;
        const selKeys = ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown"];
        const isShiftSel = e.shiftKey && selKeys.includes(e.key);
        if (!isShiftSel) return;
        DocsModule._pendingText = "";
        clearTimeout(_selTimer);
        _selTimer = setTimeout(() => {
          if (!isContextAlive()) return;
          const pos = DocsModule._lastMousePos ?? { x: window.innerWidth - 80, y: window.innerHeight / 2 };
          const rect = { top: pos.y, bottom: pos.y, left: pos.x, right: pos.x };
          DocsModule._showSelectionBubble(rect);
        }, 300);
      }, true);

      return true;
    };

    if (!tryAttach()) {
      const obs = new MutationObserver(() => {
        if (tryAttach()) obs.disconnect();
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }

  },

  // Docs canvas용 버블 표시 — 선택 영역 근처로 이동 (Bubble.show 재사용)
  _showSelectionBubble(rect) {
    if (!_extensionEnabled || !isContextAlive()) return;
    _lastBubbleState = { text: DocsModule._pendingText || "", rect };

    Bubble.show(rect, DocsModule._pendingText || "", async (capturedText) => {
      DocsModule._skipNextMouseup = true; // mouseup이 새 버블을 생성하지 않도록
      let text = capturedText;
      if (!text) text = await DocsModule._execCopyAndCapture();
      if (!text) text = getSelectedTextUnified();
      if (SidePanel.el) {
        if (text) {
          const ta = SidePanel.el.querySelector(".tb-original");
          if (ta) { ta.value = text; ta.dispatchEvent(new Event("input")); SidePanel._updateSourceLang(text); }
        }
      } else {
        SidePanel.show(text);
      }
    });
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

// Extension on/off 상태 초기화 + 버블 초기화
chrome.storage.local.get("tb_enabled", ({ tb_enabled }) => {
  _extensionEnabled = tb_enabled !== false;
  if (_extensionEnabled && isContextAlive()) Bubble.init();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !("tb_enabled" in changes)) return;
  _extensionEnabled = changes.tb_enabled.newValue !== false;
  if (!_extensionEnabled) {
    SidePanel.remove();
    Bubble.remove();
  } else {
    Bubble.init();
  }
});

// ═══════════════════════════════════════════════════════
// 전역 키보드 단축키 (bubble phase — Docs keydown과 분리)
// ═══════════════════════════════════════════════════════

// capture phase + window 레벨 — Slides/Docs document 핸들러보다 먼저 실행
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (_activeDropdown) { closeActiveDropdown(); e.stopPropagation(); return; }
    if (SidePanel.el || MiniPopover.el || Bubble._text !== null) {
      e.stopPropagation();
      SidePanel.remove();
      MiniPopover.remove();
      if (Bubble._text !== null) Bubble.showDefault();
    }
    return;
  }

  // Cmd/Ctrl+Enter: Replace 실행
  // stopImmediatePropagation으로 Slides 프레젠테이션 모드 진입 차단
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    if (SidePanel.state === "done") {
      e.preventDefault();
      e.stopImmediatePropagation();
      handleReplace(SidePanel.currentResult);
      return;
    }
    if (MiniPopover.state === "done") {
      e.preventDefault();
      e.stopImmediatePropagation();
      handleReplace(MiniPopover.currentResult);
      return;
    }
    // 패널이 열려있지만 아직 done 아닌 경우 — Slides 전체화면 차단만
    if (SidePanel.el || MiniPopover.el) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
}, true);

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

    case "QUOTA_EXCEEDED":
      SidePanel.showQuotaExceeded();
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
