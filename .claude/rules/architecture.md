# 아키텍처 규칙

TextBoi Chrome Extension의 파일 역할 경계, 메시지 타입, 전역 상태 규칙.

## 파일 역할 경계

| 파일 | 역할 | 하면 안 되는 것 |
|------|------|----------------|
| `background/background.js` | API fetch, 스트리밍 릴레이, 인증 헤더, STREAM_DONE 시 applyTextCleanup 후처리 | DOM 조작, UI 표시 |
| `content/content.js` | 트리거 감지, UI 렌더링, Replace 실행 | 직접 fetch (API 호출) |
| `popup/popup.js` | 설정 표시/저장, 로그인/로그아웃 | 탭 콘텐츠 직접 조작 |
| `utils/api.js` | 번역/교정 메시지 빌더, langDetect로 교정 언어 힌트 추가 | fetch, DOM, chrome.tabs |
| `utils/auth.js` | OAuth 로그인, 토큰 관리 | UI 렌더링 |
| `utils/storage.js` | chrome.storage.local 래퍼 | 비즈니스 로직 |
| `utils/constants.js` | URL, 기본값, 모델 목록 | 로직 없음, 상수만 |
| `utils/textCleanup.js` | GPT 결과 후처리 | API 호출, chrome 사용 |
| `utils/langDetect.js` | 언어 감지 (franc + Unicode) | API 호출, chrome 사용 |

**절대 규칙**: content.js에서 직접 `fetch` 금지. 모든 API 호출은 `chrome.runtime.sendMessage`를 통해 background.js로 위임.

## 메시지 타입 (content ↔ background)

### content → background

```javascript
// API 처리 요청
{ type: 'PROCESS_TEXT', mode, text, targetLang, model, rewritePrompt }

// 스트리밍 중단 요청
{ type: 'ABORT_STREAM' }

// diff 설명 조회 (callback 방식 — sendMessage + 콜백 응답)
{ type: 'EXPLAIN_DIFF', diffHtml, rewritePrompt, locale, model }
// → 응답: { type: 'success', changes: [{ original, corrected, explanation }] }
//         | { type: 'error', message: string }
```

### background → content (chrome.tabs.sendMessage)

```javascript
// 스트리밍 청크 (실시간)
{ type: 'STREAM_CHUNK', chunk: string }

// 스트리밍 완료
{ type: 'STREAM_DONE', result: string }

// 스트리밍 에러
{ type: 'STREAM_ERROR', message: string }

// 게스트 사용 한도 초과
{ type: 'GUEST_LIMIT_REACHED' }
```

### background → content (브로드캐스트, AUTH_CHANGED)

```javascript
// 로그인/로그아웃 상태 변경
{ type: 'AUTH_CHANGED', loggedIn: boolean }
```

**새 메시지 타입 추가 시**: background.js와 content.js 양쪽에 핸들러 추가. `/new-message-type` 커맨드 사용.

## 전역 상태 (content.js)

| 변수 | 타입 | 설명 |
|------|------|------|
| `lastSelectionRange` | `Range \| null` | Replace에 재사용되는 DOM Range. Replace 후 반드시 null 초기화. |
| `lastSelectionRect` | `DOMRect \| null` | Bubble 표시 위치 기준. `_showBubbleForSelection()` / mouseup에서 갱신. |
| `lastCopyAt` | `number` | 이중 복사 감지용 timestamp. 트리거 성공 시 0으로 리셋. |
| `_activeDropdown` | `{ el, outside, keydown } \| null` | 현재 열려있는 커스텀 드롭다운. 새 드롭다운 열 때 기존 것을 `closeActiveDropdown()`으로 먼저 닫음. |
| `_lastBubbleState` | `{ text, rect } \| null` | 패널이 닫힐 때 버블을 복원하기 위한 상태. `SidePanel.remove()`에서 220ms 후 버블 복원에 사용. `onDoubleCopy()` 시 null. |
| `SidePanel.state` | `null \| 'loading' \| 'streaming' \| 'done' \| 'error'` | 패널 상태. Replace 버튼 활성화 및 Cmd+Enter 허용 여부 결정. |
| `SidePanel._resultCache` | `{ text, result, isDiff, diffHtml } \| null` | 마지막 처리 결과 캐시. 버블 클릭으로 패널 재오픈 시 재요청 없이 결과 복원. `onDoubleCopy()` 및 clear 시 null 초기화. |
| `SidePanel._currentMode` | `'translate' \| 'correct'` | 현재 선택된 모드. `setDone()`에서 diff 여부 결정에 사용. |
| `SidePanel._currentRewritePrompt` | `string` | 현재 rewrite 프롬프트. proofread/improve 판별로 diff 활성화 여부 결정. |
| `SidePanel._outsideClickHandler` | `Function \| null` | 패널 외부 클릭 감지 핸들러. `_bindEvents()`에서 capture phase로 등록, `remove()`에서 반드시 해제. 드롭다운(`.tb-dd-panel`) 클릭은 무시. |
| `DocsModule._lastMousePos` | `{x,y} \| null` | Docs/Slides 키보드 선택 시 버블 위치 기준. `mousemove`로 갱신. |
| `DocsModule._pendingText` | `string` | Docs mouseup 시 미리 복사한 텍스트. 버블 클릭 시 재사용, mousedown 시 초기화. |
| `DocsModule._skipNextMouseup` | `boolean` | 버블 클릭 직후 bubble-phase mouseup이 새 버블을 생성하지 않도록 차단. 버블 mousedown에서 true, mouseup에서 소비. |

## URL/키 관리

모든 API URL, Supabase 키는 `utils/constants.js`에서만 정의.  
background.js, api.js 등에서 반드시 import해서 사용. 하드코딩 금지.

```javascript
// ✅ 올바른 방법
import { OPENAI_PROXY_URL } from '../utils/constants.js';

// ❌ 잘못된 방법
const url = 'https://azgplnfczforimmtpznx.supabase.co/...';
```

## 에러 처리 규칙

- background.js: API 오류 시 `STREAM_ERROR` 메시지로 content에 전달
- content.js: UI에 에러 메시지 표시, `alert()` 사용 금지 → `showToast()` 사용
- `AbortError`: 사용자가 닫은 것 → 조용히 무시 (UI 에러 표시 불필요)
- 토큰 만료: background.js에서 refresh 시도 → 실패 시 `STREAM_ERROR` + 팝업 재로그인 안내
- `onMessage` 콜백 방식 응답 (`EXPLAIN_DIFF`): 반드시 `(msg, sender, sendResponse)` 세 번째 파라미터 선언 필수. 누락 시 `sendResponse`가 `undefined` → TypeError → 메시지 포트 닫힘 → content에서 `lastError` 수신 → 에러 UI 표시

## 보안 규칙

- background.js 메시지 수신 시 `sender.id !== chrome.runtime.id` 체크로 외부 페이지 메시지 거부
- diff 결과 등 HTML 삽입 시 생성된 HTML만 허용 (`generateDiffHtml` 반환값)
- 사용자 입력(원본 텍스트 편집)은 항상 `textContent` 사용, `innerHTML` 금지
- 토큰, API 키는 `console.log` 출력 금지
- content script에서 `eval()`, `new Function()` 사용 금지 (Chrome CSP 위반)
