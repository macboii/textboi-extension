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

### Google Docs / Slides — iframe keydown 직접 부착

Docs 편집 이벤트는 `iframe.docs-texteventtarget-iframe` 안에서 발생하며 부모 document로 버블링되지 않음.  
`document.addEventListener('keydown', ..., true)` 로는 감지 불가 → iframe의 contentDocument에 직접 부착.

```javascript
DocsModule._attachKeydown = function() {
  const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
  if (!iframe?.contentDocument) return false;

  iframe.contentDocument.addEventListener('keydown', (e) => {
    if (!((e.metaKey || e.ctrlKey) && e.key === 'c')) return;
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
};

// init() 안에서: iframe이 없으면 MutationObserver로 대기
if (!this._attachKeydown()) {
  const observer = new MutationObserver(() => {
    if (DocsModule._attachKeydown()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
```

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

## Bubble 컴포넌트

mouseup 후 선택 텍스트가 있으면 표시되는 원형 아이콘 버튼. 클릭 시 SidePanel을 열고 AI 처리를 시작한다.

```javascript
// 위치: 선택 영역 우측 끝에 수직 중앙으로 붙임
const size = 36;
const top = rect.bottom - size / 2;
const left = Math.min(rect.right + 4, window.innerWidth - size - 8);

// 아이콘: chrome.runtime.getURL('icons/icon48.png') — manifest.json에 web_accessible_resources 필수
// 클릭: mousedown에서 e.preventDefault() + e.stopPropagation() 후 onDoubleCopy(text) 호출
//       → SidePanel.show(text) + triggerProcessing(text)
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
