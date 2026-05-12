# Content Script 패턴 가이드

이중 복사 감지, 사이트별 선택 처리, UI 컴포넌트 초기화 패턴.

## 이중 복사 감지

### 일반 웹 / Gmail — copy 이벤트

```javascript
let lastCopyAt = 0;

document.addEventListener('copy', () => {
  const now = Date.now();
  const text = getSelectedTextUnified();
  
  if ((now - lastCopyAt) < DOUBLE_COPY_THRESHOLD_MS && text) {
    lastCopyAt = 0;          // 3중 복사 방지
    saveSelectionRange();
    onDoubleCopy(text);
  } else {
    lastCopyAt = now;
    saveSelectionRange();    // 첫 복사 시 Range 저장
  }
});
```

### Google Docs / Slides — iframe keydown / keyup 직접 부착

Docs 편집 이벤트는 `iframe.docs-texteventtarget-iframe` 안에서 발생하며 부모 document로 버블링되지 않음.  
`document.addEventListener('keydown', ..., true)` 로는 감지 불가 → iframe의 contentDocument에 직접 부착.

canvas 기반이므로 DOM selection이 없어 텍스트 추출에 clipboard를 사용함.

```javascript
// DocsModule.init() 내부 tryAttach()
const tryAttach = () => {
  const iframe = document.querySelector("iframe.docs-texteventtarget-iframe");
  if (!iframe?.contentDocument) return false;

  let _selTimer = null;

  // 이중 Cmd+C → 클립보드에서 텍스트 읽어 자동 처리
  iframe.contentDocument.addEventListener("keydown", async (e) => {
    if (!isContextAlive()) return;
    if (!((e.metaKey || e.ctrlKey) && e.key === "c")) return;
    const now = Date.now();
    if ((now - lastCopyAt) < DOUBLE_COPY_THRESHOLD_MS) {
      lastCopyAt = 0;
      const text = (await navigator.clipboard.readText().catch(() => "")).trim()
                || getSelectedTextUnified();
      if (text) onDoubleCopy(text);
    } else {
      lastCopyAt = now;
    }
  }, true);

  // Shift+Arrow 키 선택 → 버블 표시 (300ms 디바운스)
  iframe.contentDocument.addEventListener("keyup", (e) => {
    if (!isContextAlive() || !e.shiftKey) return;
    const selKeys = ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown"];
    if (!selKeys.includes(e.key)) return;
    DocsModule._pendingText = "";
    clearTimeout(_selTimer);
    _selTimer = setTimeout(() => {
      if (!isContextAlive()) return;
      const pos = DocsModule._lastMousePos ?? { x: window.innerWidth - 80, y: window.innerHeight / 2 };
      DocsModule._showSelectionBubble({ top: pos.y, bottom: pos.y, left: pos.x, right: pos.x });
    }, 300);
  }, true);

  return true;
};

if (!tryAttach()) {
  const obs = new MutationObserver(() => { if (tryAttach()) obs.disconnect(); });
  obs.observe(document.body, { childList: true, subtree: true });
}
```

**마우스 드래그 버블 (DocsModule mouseup)** — bubble phase:  
Docs canvas는 DOM selection 없음. mouseup을 **bubble phase**로 등록해 Docs 자체 mouseup이 먼저 실행되어 selection이 확정된 뒤 `_execCopyAndCapture()`로 텍스트 획득.

`_skipNextMouseup` 플래그로 버블 클릭 후 mouseup이 새 버블을 재생성하는 것을 방지.

```javascript
document.addEventListener("mouseup", async (e) => {
  if (DocsModule._skipNextMouseup) { DocsModule._skipNextMouseup = false; return; }
  // ... dist check ...
  DocsModule._pendingText = await DocsModule._execCopyAndCapture();
  DocsModule._showSelectionBubble(rect);
}); // bubble phase — capture phase NOT used

// _execCopyAndCapture: 부모 doc + iframe doc 양쪽에 execCommand("copy") 시도 후 readText()
// execCommand 반환값은 항상 false (DOM selection 없음) → 무시하고 항상 readText 호출
async _execCopyAndCapture() {
  try { document.execCommand("copy"); } catch {}
  try {
    const iframe = document.querySelector("iframe.docs-texteventtarget-iframe");
    if (iframe?.contentDocument) iframe.contentDocument.execCommand("copy");
  } catch {}
  try { return (await navigator.clipboard.readText()).trim(); } catch {}
  return "";
}
```

**버블 클릭 시 텍스트 획득 흐름**:
1. `_pendingText` 사용 (mouseup에서 미리 획득한 경우)
2. 없으면 `_execCopyAndCapture()` 재시도 (버블 mousedown은 user-gesture)
3. 항상 `SidePanel.show(text)` 호출 — text가 빈 경우도 패널은 열림

### 두 방식을 동시에 등록하면 안 되는 이유

일반 웹에서 keydown을 등록하면, 사용자가 Cmd+C를 누를 때 copy 이벤트와 keydown이 모두 발동되어 이중 감지됨. 반드시 라우터에서 사이트별 분기:

```javascript
// Router
if (isGoogleDocsLike()) {
  DocsModule.init(); // keydown capture 등록
} else {
  // WebModule / GmailModule: copy 이벤트 등록
  initCopyDetector();
}
```

## 선택 텍스트 추출 (getSelectedTextUnified)

```javascript
function getSelectedTextUnified() {
  // 1. 표준 DOM selection
  const sel = window.getSelection();
  if (sel?.toString().trim()) return sel.toString().trim();
  
  // 2. Shadow DOM 내부 (Notion 등)
  const deepSel = getDeepActiveSelection();
  if (deepSel) return deepSel;
  
  // 3. iframe 내부 (Gmail compose 등)
  return getIframeSelection();
}

function getDeepActiveSelection() {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  
  if (!el) return '';
  
  // contentEditable
  const sel = el.ownerDocument.getSelection();
  if (sel?.toString().trim()) return sel.toString().trim();
  
  // input / textarea
  if ((el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')
      && el.selectionStart !== el.selectionEnd) {
    return el.value.substring(el.selectionStart, el.selectionEnd);
  }
  return '';
}
```

## Range 저장 패턴

**원칙**: Replace 실행 시 DOM Range가 필요하다. 이중 복사 시점에 Selection이 사라질 수 있으므로 첫 복사 시 저장.

```javascript
let lastSelectionRange = null;

function saveSelectionRange() {
  // 1. 표준 Selection
  const sel = window.getSelection();
  if (sel?.rangeCount > 0 && sel.toString().trim()) {
    lastSelectionRange = sel.getRangeAt(0).cloneRange();
    return;
  }
  // 2. iframe (Gmail compose)
  for (const frame of document.querySelectorAll('iframe')) {
    try {
      const iSel = frame.contentWindow.getSelection();
      if (iSel?.rangeCount > 0 && iSel.toString().trim()) {
        lastSelectionRange = iSel.getRangeAt(0).cloneRange();
        return;
      }
    } catch {}
  }
}
```

**`lastSelectionRange` 초기화 시점**:
- `SidePanel.remove()` / `MiniPopover.remove()` 에서는 **null 초기화 금지** — 패널을 열 때 `show()` 가 `remove()` 를 먼저 호출하므로, 여기서 null 하면 Replace 시점에 range가 사라짐
- **Replace 성공 후에만** `replaceSelectedTextInWeb()` 내부에서 null 초기화

```javascript
// ✅ replaceSelectedTextInWeb 끝에서만
showToast('✅ Replaced');
lastSelectionRange = null;

// ❌ SidePanel.remove() 안에서 null 하면 안 됨 — show() → remove() 흐름에서 range 소실
```

## UI 컴포넌트 초기화 패턴

컴포넌트를 중복 초기화하지 않도록 `el` 존재 여부로 guard.

```javascript
const SomeComponent = {
  el: null,
  
  show(text) {
    this.remove();   // 기존 인스턴스 제거 후 새로 생성
    this.el = document.createElement('div');
    // ...
    document.body.appendChild(this.el);
  },
  
  remove() {
    this.el?.remove();
    this.el = null;
  }
};
```

## 키보드 단축키 등록 원칙

content.js 전역에 keydown 리스너 하나만 등록. 내부에서 분기.

```javascript
document.addEventListener('keydown', (e) => {
  // Esc
  if (e.key === 'Escape') {
    SidePanel.remove(); MiniPopover.remove(); Bubble.remove();
    return;
  }
  
  // Cmd/Ctrl+Enter — Replace
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    const readyPanel = SidePanel.state === 'done';
    const readyPopover = MiniPopover.state === 'done';
    if (readyPanel || readyPopover) {
      e.preventDefault();
      handleReplace(readyPanel ? SidePanel.currentResult : MiniPopover.currentResult);
    }
  }
  
  // Docs keydown Cmd+C (isGoogleDocsLike()인 경우)
  // ← DocsModule.init() 안에서 별도 capture listener로 처리
}, false); // bubble phase (Docs 단축키와 분리)
```

## 스트리밍 수신 패턴 (content.js)

모든 환경(Web/Gmail/Docs/Slides/Sheets)에서 SidePanel만 사용. MiniPopover 분기 없음.

```javascript
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'STREAM_CHUNK':
      SidePanel.appendChunk(msg.chunk);
      break;
    case 'STREAM_DONE':
      SidePanel.setDone(msg.result);
      break;
    case 'STREAM_ERROR':
      SidePanel.setError(msg.message);
      break;
    case 'GUEST_LIMIT_REACHED':
      SidePanel.showLoginPrompt(); // 로그인 유도 배너
      break;
    case 'AUTH_CHANGED':
      // 필요 시 UI 상태 업데이트
      break;
  }
});
```

## isContextAlive() 가드

extension context가 무효화(SW 재시작 등)된 후 content script가 chrome API를 호출하면 오류 발생.  
`chrome.runtime.sendMessage`, `chrome.runtime.getURL` 등 호출 전에 반드시 체크.

```javascript
function isContextAlive() {
  try { return !!chrome.runtime?.id; } catch { return false; }
}
```

사용 위치: `SidePanel.remove()`, `MiniPopover.remove()`, `Bubble.show()`, `_handleCopyEvent()`, `_handleMouseUp()`, DocsModule mouseup/keydown/keyup 핸들러 최상단.

## getSelectionEndRect() — 선택 끝 위치 계산

드래그 방향에 무관하게 항상 selection **끝점** 기준 rect를 반환. Bubble 위치 결정에 사용.

```javascript
function getSelectionEndRect(range, frameOffset) {
  // 1. range를 end로 collapse → 커서 위치 rect (정확)
  let endRect = null;
  try {
    const collapsed = range.cloneRange();
    collapsed.collapse(false); // false = end
    endRect = collapsed.getBoundingClientRect();
  } catch {}

  // 2. 폴백: getClientRects()의 마지막 줄 (맞춤법 검사 span 등 collapse 실패 케이스)
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
    return { top: endRect.top + frameOffset.top, bottom: endRect.bottom + frameOffset.top,
             left: endRect.left + frameOffset.left, right: endRect.right + frameOffset.left,
             width: endRect.width, height: endRect.height };
  }
  return endRect;
}
```

`frameOffset`은 `frame.getBoundingClientRect()`에서 얻은 `{ top, left }`. Gmail iframe 선택 시 필수.

## _showBubbleForSelection() + _isMouseDown 플래그

mouseup과 selectionchange(키보드 선택) 양쪽에서 Bubble을 표시하는 통합 함수.  
`_isMouseDown` 플래그로 드래그 중 selectionchange 발화를 차단.

```javascript
// initCopyDetector() 안에서
let _isMouseDown = false;
document.addEventListener("mousedown", () => { _isMouseDown = true; Bubble.remove(); });
document.addEventListener("mouseup", () => { _isMouseDown = false; _handleMouseUp(); });

document.addEventListener("selectionchange", () => {
  if (_isMouseDown) return;   // 드래그 중 → mouseup에서 처리
  clearTimeout(_selTimer);
  _selTimer = setTimeout(() => {
    if (!isContextAlive()) return;
    if (document.activeElement?.closest?.("#textboi-panel")) return;
    const text = window.getSelection()?.toString().trim() ?? "";
    if (text.length < 2) { Bubble.remove(); return; }
    _showBubbleForSelection();
  }, 250);
});
```

## Bubble 컴포넌트

mouseup / selectionchange(키보드) 후 선택 텍스트가 있으면 표시되는 원형 아이콘 버튼.

```javascript
// 위치: 선택 영역 우측 끝에 수직 중앙으로 붙임 (getSelectionEndRect 사용)
const size = 36;
const top = rect.bottom - size / 2;
const left = Math.min(rect.right + 4, window.innerWidth - size - 8);

// 아이콘: chrome.runtime.getURL('icons/icon48.png') — manifest.json에 web_accessible_resources 필수
// 클릭 동작:
//   - SidePanel이 이미 열려있으면 .tb-original textarea만 업데이트 (SidePanel._updateSourceLang 포함)
//   - 패널이 없으면 SidePanel.show(text) 호출
```

**주의**: `document.addEventListener('mousedown', () => Bubble.remove())` 로 외부 클릭 시 제거되므로,
버블 자체 mousedown에서 반드시 `e.stopPropagation()` 호출해야 버블 클릭이 작동한다.

## 사이트 감지 유틸

```javascript
function isGoogleDocsLike() {
  // Google Sheets(/spreadsheets/)는 DOM 기반 → 일반 웹처럼 처리
  // Docs(/document/)와 Slides(/presentation/)만 canvas 기반 → clipboard paste 방식
  const path = location.pathname;
  if (location.hostname.includes('docs.google.com')) {
    return path.includes('/document/') || path.includes('/presentation/');
  }
  return location.hostname.includes('slides.google.com');
}

function isGmailDomain() {
  return location.hostname.includes('mail.google.com')
      || location.hostname.includes('inbox.google.com');
}
```

**Gmail 편집 가능 여부 확인** (Replace 버튼 표시 결정):
```javascript
function isGmailEditable() {
  // compose 창이 열려있는지 확인
  return !!document.querySelector('div[aria-label*="Message Body"]')
      || !!document.querySelector('div.Am.Al');
}
```

## 알려진 엣지 케이스

새 사이트 지원 또는 트리거 버그 수정 시 참고:

| 사이트/케이스 | 문제 | 해결책 |
|--------------|------|--------|
| Notion | Shadow DOM 중첩 복잡 | `getDeepActiveSelection()` 재귀 탐색 |
| Twitter / X | React synthetic event 이중 발화 | `copy` 이벤트로 우회 (keydown 미사용) |
| Google Docs | `copy` 이벤트 버블링 차단 | iframe keydown capture phase 직접 부착 |
| Google Docs/Slides 키보드 선택 | canvas 기반 — DOM selection/selectionchange 없음 | iframe keyup Shift+Arrow 감지 → `_lastMousePos` 기준 버블. 버블 클릭 시 `execCommand("copy")` + `readText()` |
| Google Docs/Slides 버블 클릭 시 텍스트 소실 | canvas 기반 — DOM selection 없음. `execCommand` 반환값이 항상 false → `readText()` 미실행 | `execCommand` 반환값 무시, 항상 `readText()` 호출. iframe doc에도 `execCommand` 병행 |
| Google Docs/Slides 버블 클릭 후 버블 위치 이동 | 버블 mousedown 후 이어지는 bubble-phase mouseup이 새 버블을 생성 | `_skipNextMouseup` 플래그로 버블 클릭 직후 mouseup 차단 |
| Gmail 읽기 영역 | contentEditable 아님 | `isGmailEditable()` 체크 → Replace 버튼 숨김 |
| PDF 뷰어 | 선택 불가 또는 제한적 | Bubble 미표시, 트리거 무시 |
| `<input>` / `<textarea>` | `window.getSelection()` 미동작 | `selectionStart` / `selectionEnd` 기반 추출 |
| iframe 내부 (CMS 등) | 부모 document selection 없음 | `getIframeSelection()` 폴백 |
