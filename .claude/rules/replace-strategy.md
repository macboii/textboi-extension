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

## 전략 2: Sync execCommand + ClipboardEvent 3단 폴백 (Google Docs)

Google Docs는 canvas 기반 렌더링 → DOM Range 직접 조작 불가.  
`navigator.clipboard.writeText()`는 async이므로 await 이후 user-gesture context가 소멸 → `execCommand('paste')` 실패.  
반드시 **동기 execCommand('copy')** 로 클립보드를 채운 뒤 iframe에 paste를 실행해야 user-gesture context가 유지된다.

### 3단 폴백 전략

```
1. [동기] hidden textarea → execCommand('copy') → iframe.contentDocument.execCommand('paste')
   ← user-gesture context 유지, Docs가 isTrusted paste로 수락
2. [async] navigator.clipboard.writeText → ClipboardEvent('paste') dispatch on iframe
   ← execCommand 실패 시 시도, Docs가 수락하면 성공
3. "Copied! Press Cmd+V to paste." toast 표시
```

```javascript
async function replaceSelectedTextInGoogleDocs(newText) {
  const iframe =
    document.querySelector('iframe.docs-texteventtarget-iframe') ||
    document.querySelector('iframe[tabindex="1"]');

  // 전략 1: 동기 execCommand copy → paste (user-gesture context 유지)
  let syncCopyOk = false;
  try {
    const ta = document.createElement('textarea');
    Object.assign(ta.style, { position: 'fixed', top: '-9999px', left: '-9999px', opacity: '0' });
    ta.value = newText;
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    syncCopyOk = document.execCommand('copy');
    ta.remove();
  } catch {}

  if (iframe && syncCopyOk) {
    try {
      iframe.focus();
      iframe.contentDocument.body.focus();
      const pasted = iframe.contentDocument.execCommand('paste');
      if (pasted) { showToast('✅ Replaced'); return; }
    } catch {}
  }

  // 전략 2: async clipboard.writeText + ClipboardEvent dispatch
  try { await navigator.clipboard.writeText(newText); } catch {}
  if (iframe) {
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', newText);
      dt.setData('text/html', newText);
      const notHandled = iframe.contentDocument.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      );
      if (!notHandled) { showToast('✅ Replaced'); return; }
    } catch {}
  }

  // 전략 3: 수동 붙여넣기 안내
  showToast('Copied! Press Cmd+V to paste.', 'error');
}
```

**핵심 원칙**: `navigator.clipboard.writeText()`의 `await` 이후에는 user-gesture context 소멸.  
`document.execCommand('copy')`는 동기 → user-gesture context 유지 → `execCommand('paste')`가 trusted event로 동작.  
**KeyboardEvent('keydown') dispatch는 효과 없음** — Docs가 isTrusted 아닌 합성 키 이벤트를 무시함.

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
