# 텍스트 치환 전략

환경별 Replace 구현 패턴. 새 사이트 지원 추가 시 반드시 이 규칙을 먼저 읽을 것.

## 환경별 전략 결정 트리

```
handleReplace(newText)
  │
  ├── isGoogleDocsLike()
  │     └── replaceSelectedTextInGoogleDocs(newText)
  │           → clipboard.writeText + Cmd/Ctrl+V 시뮬레이션
  │
  └── else (일반 웹 + Gmail)
        └── replaceSelectedTextInWeb(newText)
              → Range.deleteContents + insertNode
```

## 전략 1: Range-based Replace (일반 웹 / Gmail)

가장 정확한 방법. DOM Range를 직접 조작하여 텍스트 치환.

```javascript
function replaceSelectedTextInWeb(newText) {
  if (!lastSelectionRange) {
    showToast('❌ 선택 범위가 사라졌습니다. 다시 선택해주세요.', 'error');
    return;
  }
  
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(lastSelectionRange);
  
  const range = sel.getRangeAt(0);
  range.deleteContents();
  
  const textNode = document.createTextNode(newText);
  range.insertNode(textNode);
  
  // 커서를 삽입된 텍스트 뒤로 이동
  sel.removeAllRanges();
  const newRange = document.createRange();
  newRange.setStartAfter(textNode);
  newRange.collapse(true);
  sel.addRange(newRange);
  
  // input / change 이벤트 dispatch (React/Vue 등 프레임워크 대응)
  const container = textNode.parentElement;
  if (container) {
    container.dispatchEvent(new Event('input', { bubbles: true }));
    container.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
```

**React/Vue 입력 필드 주의**: 프레임워크는 DOM을 직접 조작하면 state가 불일치함.  
`input` / `change` 이벤트를 dispatch해야 프레임워크가 변경을 인식함.

## 전략 2: Clipboard + Paste (Google Docs)

Google Docs는 canvas 기반 렌더링 → DOM Range 직접 조작 불가.  
클립보드에 쓰고 Docs 편집 iframe에 붙여넣기 이벤트를 dispatch.

```javascript
async function replaceSelectedTextInGoogleDocs(newText) {
  try {
    await navigator.clipboard.writeText(newText);
    
    const iframe =
      document.querySelector('iframe[tabindex="1"]') ||
      document.querySelector('iframe.docs-texteventtarget-iframe');
    
    if (!iframe) {
      showToast('❌ Google Docs 편집 영역을 찾을 수 없습니다.', 'error');
      return;
    }
    
    const win = iframe.contentWindow;
    iframe.focus();
    win.document.body.focus();
    
    const isMac = navigator.platform.includes('Mac');
    win.document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'v',
      code: 'KeyV',
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true,
    }));
  } catch (e) {
    showToast('❌ 붙여넣기 실패. Cmd+V로 직접 붙여넣기 해주세요.', 'error');
    console.error('Docs replace failed:', e);
  }
}
```

**주의**: `document.execCommand('paste')` 는 Chrome 109 이후 보안 정책으로 대부분의 사이트에서 동작하지 않음. 위 방식 (KeyboardEvent dispatch)을 사용할 것.

## 새 사이트 추가 시 체크리스트

1. `isXxxSite()` 유틸 함수 추가 (constants 값으로 hostname 비교)
2. Router에서 분기 추가
3. Replace 전략 결정:
   - DOM Range 조작 가능 → `replaceSelectedTextInWeb` 재사용
   - Canvas/자체 렌더링 → clipboard 방식 구현
4. `isGmailEditable()` 패턴으로 편집 가능 여부 확인 (Replace 버튼 노출 조건)
5. SPEC.md의 "5. 사이트별 동작 명세" 섹션에 추가

## Replace 실패 처리

| 실패 이유 | 대처 |
|-----------|------|
| `lastSelectionRange === null` | "다시 선택" toast + return |
| Docs iframe 찾기 실패 | 에러 toast, `console.error` |
| `clipboard.writeText` 실패 (권한) | 에러 toast + 수동 붙여넣기 안내 |
| React state 불일치 | `input` + `change` 이벤트 dispatch로 해결 |

`alert()` 사용 절대 금지 — `showToast(message, 'error')` 사용.

## clipboardWrite 권한

`manifest.json`에 `clipboardWrite` 권한이 있어야 `navigator.clipboard.writeText`가 동작.  
현재 manifest에 포함되어 있는지 확인 후 없으면 추가:

```json
{
  "permissions": ["...", "clipboardWrite"]
}
```
