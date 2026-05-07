# TextBoi Chrome Extension — 기능 상세 명세서

버전: 1.0  
작성일: 2026-05-07  
범위: OCR 제외. 브라우저 내 텍스트 선택 → AI 처리 → 치환.

---

## 목차

1. [핵심 트리거: 이중 복사 (Cmd+C+C / Ctrl+C+C)](#1-핵심-트리거)
2. [UI 구성요소](#2-ui-구성요소)
3. [AI 처리 모드](#3-ai-처리-모드)
4. [텍스트 치환 (Replace)](#4-텍스트-치환)
5. [사이트별 동작 명세](#5-사이트별-동작-명세)
6. [키보드 단축키 전체 목록](#6-키보드-단축키)
7. [인증 및 게스트 모드](#7-인증-및-게스트-모드)
8. [설정 (Popup)](#8-설정-popup)
9. [스트리밍 아키텍처](#9-스트리밍-아키텍처)
10. [언어 감지](#10-언어-감지)
11. [권한 요구사항](#11-권한-요구사항)
12. [에러 처리 명세](#12-에러-처리-명세)

---

## 1. 핵심 트리거

### 1-1. 이중 복사 감지 메커니즘

**목표**: 사용자가 텍스트를 선택하고 Cmd+C (Mac) 또는 Ctrl+C (Win)를 500ms 이내에 2번 누르면 TextBoi UI를 활성화한다.

**제약**: Chrome 익스텐션은 `chrome.commands`로 Cmd+C / Ctrl+C를 인터셉트할 수 없다 (브라우저 예약 단축키). 대신 content script에서 `copy` 이벤트 또는 `keydown` 이벤트를 활용한다.

#### 일반 웹 / Gmail — `copy` 이벤트 기반

```
document.addEventListener('copy', () => {
  const now = Date.now();
  const text = getSelectedTextUnified();   // 선택 텍스트 추출
  
  if ((now - lastCopyAt) < 500 && text.length > 0) {
    // ✅ 이중 복사 감지 — TextBoi 활성화
    lastCopyAt = 0;                        // 리셋 (3중 복사 방지)
    triggerTextBoi(text);
  } else {
    lastCopyAt = now;
    lastCopyText = text;
    saveSelectionRange();                  // 첫 복사 시 Range 저장
  }
});
```

- `copy` 이벤트는 실제 클립보드 쓰기를 막지 않음 → 사용자가 텍스트를 클립보드에 복사하는 동시에 UI 활성화
- 500ms 임계값은 설정에서 조정 가능하도록 설계 (향후)

#### Google Docs / Slides — `keydown` Cmd+C 기반

Google Docs는 canvas/shadow DOM 기반이라 `copy` 이벤트가 `document`까지 버블링되지 않을 수 있음. `keydown` capture phase 사용:

```
document.addEventListener('keydown', (e) => {
  if (!((e.metaKey || e.ctrlKey) && e.key === 'c')) return;
  
  const now = Date.now();
  if ((now - lastCopyAt) < 500) {
    lastCopyAt = 0;
    const text = getSelectedTextUnified();
    if (text) triggerTextBoi(text);
  } else {
    lastCopyAt = now;
    saveSelectionRange();
  }
}, true); // capture phase — Docs의 자체 이벤트 핸들러보다 먼저 실행
```

### 1-2. 선택 텍스트 추출 전략 (getSelectedTextUnified)

우선순위 순:
1. `window.getSelection().toString().trim()` — 표준 DOM
2. Shadow DOM 내부 activeElement의 selection (contentEditable, textarea, input)
3. iframe 내부 `contentWindow.getSelection()` — Gmail compose 등

반환: 공백 제거 후 1자 이상인 텍스트. 없으면 빈 문자열.

### 1-3. Range 저장 (saveSelectionRange)

첫 번째 복사 시점 또는 mouseup 시점에 `lastSelectionRange = sel.getRangeAt(0).cloneRange()` 저장.  
이 Range는 Replace 시 재사용된다. Panel 닫힘 시 `null`로 초기화.

### 1-4. 트리거 후 동작

```
triggerTextBoi(text)
  │
  ├── isGoogleDocsLike()  → MiniPopover.show(mousePos, text)
  │                          background에 PROCESS_TEXT 메시지 전송
  │
  └── 일반 / Gmail        → SidePanel.show(text)
                             background에 PROCESS_TEXT 메시지 전송
```

PROCESS_TEXT 메시지 구조:
```javascript
{
  type: "PROCESS_TEXT",
  mode: "translate" | "correct",  // 현재 설정값
  text: selectedText,
  targetLang: "ko",               // 번역 대상 언어 (설정값)
  model: "gpt-4o-mini",          // AI 모델 (설정값)
  tabId: chrome.devtools?.inspectedWindow?.tabId  // 스트리밍 릴레이용 (bg에서 설정)
}
```

---

## 2. UI 구성요소

### 2-1. Side Panel (일반 웹 / Gmail)

위치: 화면 우측에서 슬라이드인, fixed 포지션, 420px 너비, 전체 높이.  
배경: 흰색(#FFFFFF), 좌측 그림자, 최고 z-index(2147483647).  
트리거: 이중 복사 또는 Bubble 클릭.

#### 패널 레이아웃 (상→하)

```
┌─────────────────────────────────┐
│  [×]         TextBoi  [설정⚙️] │  ← 헤더 (32px)
├─────────────────────────────────┤
│  [번역]  [교정]                 │  ← 모드 탭 (40px)
├─────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │ 원본 텍스트 (편집 가능)     │ │  ← textarea, 120px
│  │                             │ │
│  └─────────────────────────────┘ │
│  [언어 선택 ▼]  [모델 선택 ▼]  │  ← 드롭다운 (32px)
├─────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │ AI 결과 (스트리밍 표시)     │ │  ← 결과 영역, flex-grow
│  │ ...실시간 텍스트...         │ │
│  └─────────────────────────────┘ │
│  교정 모드: diff 뷰 표시        │  ← 교정 모드 전용
├─────────────────────────────────┤
│  [Replace  ⌘↵]   [재실행 ↺]   │  ← 액션 버튼 (48px)
└─────────────────────────────────┘
```

#### 패널 상태

| 상태 | 설명 |
|------|------|
| `loading` | 원본 텍스트 표시, 결과 영역 "AI 처리 중..." 스피너 |
| `streaming` | 결과 영역에 청크 실시간 추가 |
| `done` | 결과 완전 표시, Replace 버튼 활성화 |
| `error` | 에러 메시지 표시, 재시도 버튼 |

#### 인터랙션

- `×` 버튼 / `Esc` 키: 패널 닫기, `lastSelectionRange` 초기화
- 모드 탭 클릭: 현재 텍스트로 해당 모드 즉시 재실행
- 원본 텍스트 편집 후 Enter: 재실행 (Shift+Enter는 줄바꿈)
- 재실행 `↺` 버튼: 동일 텍스트로 API 재호출
- Replace 버튼 / `Cmd+Enter` / `Ctrl+Enter`: 치환 실행

### 2-2. Mini Popover (Google Docs / Slides)

위치: 선택 영역 마우스 좌표 기준 바로 아래, absolute 포지션.  
크기: 280px 너비, 자동 높이.  
트리거: 이중 복사 (Docs keydown 감지).

#### 팝오버 레이아웃

```
┌──────────────────────────┐
│ 원본 텍스트 (truncated)  │  ← 60px max-height, 스크롤
│                          │
├──────────────────────────┤
│ AI 결과 (스트리밍)       │  ← 100px max-height, 스크롤
│ ...                      │
├──────────────────────────┤
│ [✅ Replace  ⌘↵]        │  ← Replace 버튼
└──────────────────────────┘
```

- 팝오버 외부 클릭: 닫기
- `Esc` 키: 닫기

### 2-3. Bubble (단일 복사 보조 트리거, 선택 유지 중)

위치: 선택 텍스트 바로 아래, fixed.  
크기: 90px 너비, pill 형태.  
내용: "✨ TextBoi"  
노출 조건: `mouseup` 시 텍스트 선택이 존재할 때 (이중 복사와 무관한 보조 트리거).  
클릭 시: `triggerTextBoi(selectedText)` 호출.  
소멸 조건: `mousedown` (새 선택 시작), 패널/팝오버 표시 시, Esc.

---

## 3. AI 처리 모드

### 3-1. 번역 모드 (translate)

- 입력 텍스트를 지정된 targetLang으로 번역
- 언어 자동 감지 (langDetect.js, franc 기반)
- 프롬프트 (desktop `translateText()` 동일):
  ```
  You are a professional translator.
  Translate the input text into: {targetLang}
  Return only the translated text.
  ```
- 기본 targetLang: 사용자 설정 (기본 "ko")

### 3-2. 교정 모드 (correct)

- 입력 텍스트를 같은 언어로 문법·스타일 교정
- rewritePrompt 적용 (설정에서 선택)
- 결과 표시: diff 뷰 (원본 vs 교정본)
  - CJK 텍스트: 문자 단위 diff
  - 서양어: 단어 단위 diff
  - diff-match-patch 라이브러리 (CDN 또는 번들)
- 프롬프트 (desktop `correctText()` 동일):
  ```
  You are a multilingual writing assistant.
  Detect the language automatically.
  Task: {rewritePrompt}
  Return only the final result.
  ```

### 3-3. rewritePrompt 옵션 (교정 모드)

| 키 | 내용 |
|----|------|
| `proofread` | 맞춤법·문법 교정 |
| `formal` | 격식체로 변환 |
| `casual` | 구어체로 변환 |
| `concise` | 간결하게 요약 |
| `expand` | 내용 풍부하게 확장 |

### 3-4. AI 모델 선택

| 모델 ID | 표시명 | 특징 |
|---------|--------|------|
| `gpt-4o-mini` | Fast | 빠름, 기본값 |
| `gpt-4o` | Smart | 정확도 높음 |
| `gpt-4.1` | Advanced | 최고 품질 |

게스트 모드에서는 `gpt-4o-mini` 고정.

---

## 4. 텍스트 치환 (Replace)

### 4-1. 트리거 방법

| 방법 | 조건 |
|------|------|
| Replace 버튼 클릭 | 패널/팝오버 `done` 상태 |
| `Cmd+Enter` (Mac) | 패널/팝오버가 열려있고 `done` 상태 |
| `Ctrl+Enter` (Win/Linux) | 동일 |

`loading` / `streaming` 상태에서는 Replace 버튼 비활성화. 단축키도 무시.

### 4-2. 일반 웹 — Range-based Replace

```
replaceSelectedTextInWeb(newText)
  ↓
lastSelectionRange 존재 여부 확인 (없으면 에러 toast)
  ↓
window.getSelection().removeAllRanges()
window.getSelection().addRange(lastSelectionRange)
  ↓
range = selection.getRangeAt(0)
range.deleteContents()
range.insertNode(document.createTextNode(newText))
  ↓
커서를 삽입 텍스트 뒤로 이동 (setStartAfter)
  ↓
SidePanel.close()
lastSelectionRange = null
```

### 4-3. Gmail — Range-based Replace

Gmail은 내부적으로 contentEditable div를 사용하며, 동일한 Range-based 방식이 동작한다.  
동일하게 `replaceSelectedTextInWeb(newText)` 호출.

### 4-4. Google Docs / Slides — Clipboard + Paste

Google Docs는 자체 렌더링 엔진(canvas/SVG) 사용으로 DOM 직접 조작 불가.

```
replaceSelectedTextInGoogleDocs(newText)
  ↓
navigator.clipboard.writeText(newText)
  ↓
Google Docs 편집 iframe 찾기:
  document.querySelector('iframe[tabindex="1"]') ||
  document.querySelector('iframe.docs-texteventtarget-iframe')
  ↓
iframe.contentWindow.document.body.focus()
  ↓
KeyboardEvent("keydown", { key: "v", metaKey: isMac, ctrlKey: !isMac, bubbles: true }) dispatch
  ↓
MiniPopover.close()
```

> **주의**: Docs iframe에 `document.execCommand("paste")` 사용 시 일부 환경에서 동작 안 함.  
> `navigator.clipboard.writeText` + 키보드 이벤트 dispatch가 현재 가장 신뢰할 수 있는 방식.

### 4-5. Replace 후 처리

- `lastSelectionRange = null`
- 패널/팝오버 닫기
- 성공 시 짧은 toast 표시 ("✅ Replaced")
- 실패 시 에러 toast ("❌ Replace failed — 수동으로 붙여넣기 해주세요")

---

## 5. 사이트별 동작 명세

### 5-1. 일반 웹페이지

**감지**: `copy` 이벤트 × 2 (500ms 이내)  
**선택 추출**: `window.getSelection()`  
**Range 저장**: `mouseup` 시 + 첫 번째 `copy` 이벤트 시  
**UI**: SidePanel  
**Replace**: Range.deleteContents + insertNode

**엣지 케이스**:
- Shadow DOM 내부 선택: `getDeepActiveSelection()` 폴백
- `<input>`, `<textarea>`: `selectionStart`/`selectionEnd` 기반 추출
- iframe 내부 텍스트: `getIframeSelection()` 폴백

### 5-2. Gmail (mail.google.com)

**감지**: `copy` 이벤트 × 2 — 일반 웹과 동일  
**선택 추출**: `window.getSelection()` (Gmail의 compose창은 표준 contentEditable)  
**Range 저장**: mouseup 시  
**UI**: SidePanel  
**Replace**: Range.deleteContents + insertNode (일반 웹과 동일)

**특이사항**:
- Gmail 읽기 영역 선택 → 번역 only (편집 불가 → Replace 버튼 숨김)
- Gmail compose(작성창) 선택 → 번역·교정 모두 + Replace 활성

### 5-3. Google Docs (docs.google.com)

**감지**: `keydown` Cmd+C × 2 (capture phase)  
**선택 추출**: `getSelectedTextUnified()` — iframe + Shadow DOM 폴백  
**Range 저장**: 불필요 (Replace는 clipboard 방식)  
**UI**: MiniPopover (마우스 좌표 기준)  
**Replace**: clipboard.writeText + Cmd/Ctrl+V 시뮬레이션

**특이사항**:
- Docs에서는 `copy` 이벤트 대신 `keydown` 사용하는 이유:
  Docs의 내부 canvas 렌더링이 `copy` 이벤트 버블링을 차단할 수 있음
- Popover 위치는 `DocsModule.lastMousePos` (mouseup 시 좌표)

### 5-4. Google Slides (slides.google.com)

Docs와 동일한 방식. `isGoogleDocsLike()` 함수에서 `slides.google.com`도 포함.

---

## 6. 키보드 단축키

| 단축키 | 동작 | 조건 |
|--------|------|------|
| `Cmd+C` × 2 (Mac) | TextBoi 활성화 | 텍스트 선택 중 |
| `Ctrl+C` × 2 (Win) | TextBoi 활성화 | 텍스트 선택 중 |
| `Cmd+Enter` (Mac) | Replace 실행 | 패널/팝오버 열림 + done 상태 |
| `Ctrl+Enter` (Win) | Replace 실행 | 동일 |
| `Esc` | 패널/팝오버/Bubble 닫기 | 열려있을 때 |
| `Shift+Enter` | 원본 텍스트에서 줄바꿈 | 패널 원본 textarea 포커스 |

> Chrome 단축키 API(`chrome.commands`)로 선언 가능한 단축키는 추가로 등록 (Alt+Shift+T 번역, Alt+Shift+E 교정 — 현재 manifest에 존재).

---

## 7. 인증 및 게스트 모드

### 7-1. 로그인 (Google OAuth)

`chrome.identity.launchWebAuthFlow`를 사용해 Supabase Google OAuth 진행:

```
chrome.identity.launchWebAuthFlow({
  url: `${SUPABASE_URL}/auth/v1/authorize?provider=google
        &redirect_to=${chrome.identity.getRedirectURL()}`,
  interactive: true
})
→ redirectUrl에서 access_token, refresh_token 추출
→ chrome.storage.local.set({ tb_access_token, tb_refresh_token })
```

### 7-2. 세션 복구

익스텐션 시작(service worker 활성화) 시 `chrome.storage.local.get`으로 저장된 토큰 확인.  
만료 여부 확인 후 `refresh_token`으로 갱신 시도 (Supabase REST API).

### 7-3. 게스트 모드

- 로그인 없이 5회 무료 사용
- 횟수 관리: `chrome.storage.local` + Worker `/device/check-free` (device_id 헤더)
- `device_id`: `chrome.storage.local.get('tb_device_id')` — 없으면 UUID 생성 후 저장
- 게스트 모드 API 경로: `SUPABASE_REST_API_URL + '/guest/chat'` (x-device-id 헤더)
- 무료 소진 시: 패널 내 로그인 안내 배너 표시

### 7-4. 인증 헤더 결정

```
isLoggedIn?
  ├─ YES → Authorization: Bearer {access_token}
  └─ NO  → x-device-id: {device_id}
             endpoint: SUPABASE_REST_API_URL + '/guest/chat'
```

---

## 8. 설정 (Popup)

익스텐션 아이콘 클릭 시 표시되는 팝업 UI.

### 8-1. 설정 항목

| 설정 | 타입 | 기본값 | 저장 위치 |
|------|------|--------|----------|
| 모드 | `translate` \| `correct` | `translate` | chrome.storage.local |
| 번역 대상 언어 | 언어 코드 | `ko` | chrome.storage.local |
| AI 모델 | 모델 ID | `gpt-4o-mini` | chrome.storage.local |
| 교정 스타일 | rewritePrompt 키 | `proofread` | chrome.storage.local |
| 트리거 간격 | ms | `500` | chrome.storage.local |

### 8-2. 팝업 UI 구성

```
┌──────────────────┐
│  🤖 TextBoi      │
├──────────────────┤
│  [사용자 정보]   │  ← 로그인 시 이름+이메일
│  or [Google로 로그인] │
├──────────────────┤
│  Mode: [▼]       │
│  Language: [▼]   │
│  Model: [▼]      │
│  Style: [▼]      │
├──────────────────┤
│  Usage: N/10     │  ← 로그인 시 플랜 사용량
│  [로그아웃]      │
└──────────────────┘
```

### 8-3. 로그인 상태 변화

- 로그인 성공 → `chrome.storage.local.set({ tb_access_token })` → 모든 탭 content script에 `{ type: 'AUTH_CHANGED', loggedIn: true }` 브로드캐스트
- 로그아웃 → 토큰 삭제 → 브로드캐스트

---

## 9. 스트리밍 아키텍처

### 9-1. 흐름

```
content.js                    background.js
    │                               │
    │── PROCESS_TEXT ──────────────▶│
    │                               │ fetch POST (stream: true)
    │                               │ ReadableStream reader
    │◀─ STREAM_CHUNK(chunk) ────────│  (각 delta 청크마다)
    │◀─ STREAM_CHUNK(chunk) ────────│
    │      ...                      │
    │◀─ STREAM_DONE(result) ────────│  (스트림 완료)
    │                               │
    │  (에러 발생 시)               │
    │◀─ STREAM_ERROR(message) ──────│
```

### 9-2. background.js 스트리밍 구현 방식

Service Worker는 SSE 클라이언트를 유지할 수 없으므로 `fetch` + `ReadableStream` 사용:

```javascript
const res = await fetch(endpoint, { method: 'POST', body: ..., signal });
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  
  for (const line of lines.slice(0, -1)) {
    if (!line.startsWith('data:')) continue;
    const json = line.replace('data: ', '');
    if (json === '[DONE]') { reader.cancel(); break; }
    const chunk = JSON.parse(json).choices?.[0]?.delta?.content;
    if (chunk) chrome.tabs.sendMessage(tabId, { type: 'STREAM_CHUNK', chunk });
  }
  buffer = lines.at(-1) || '';
}

const finalResult = applyTextCleanup(fullResult.trim());
chrome.tabs.sendMessage(tabId, { type: 'STREAM_DONE', result: finalResult });
```

### 9-3. content.js 스트리밍 수신

```javascript
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'STREAM_CHUNK':
      Panel.appendChunk(msg.chunk);
      break;
    case 'STREAM_DONE':
      Panel.setDone(msg.result);
      break;
    case 'STREAM_ERROR':
      Panel.setError(msg.message);
      break;
  }
});
```

### 9-4. 스트리밍 중단

사용자가 패널 닫기 시 진행 중인 스트리밍 중단:
```javascript
// background.js
const controllers = new Map(); // tabId → AbortController
// 중단 메시지 수신 시:
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ABORT_STREAM') {
    controllers.get(msg.tabId)?.abort();
    controllers.delete(msg.tabId);
  }
});
```

---

## 10. 언어 감지

`utils/langDetect.js` — desktop의 `detectLanguage()` 함수 포팅.

### 감지 우선순위

1. **Unicode 범위 즉시 판별** (API 호출 없음):
   - 한글(`가-힯`) 비율 > 40% → `ko`
   - 히라가나/가타카나(`぀-ヿ`) 비율 > 40% → `ja`
   - CJK 통합 한자(`一-鿿`) 비율 > 40% → `zh`

2. **franc 라이브러리** (오프라인 트라이그램 분석):
   - ISO 639-3 → ISO 639-1 매핑 (desktop의 `ISO3_TO_ISO1` 테이블 재사용)
   - 최소 텍스트 길이: 20자 이상

3. **캐시**: `Map<text, langCode>` — 동일 텍스트 재탐지 방지

> franc은 npm 패키지이므로 번들 시 포함하거나 CDN (`esm.sh/franc`) 사용.

---

## 11. 권한 요구사항

`manifest.json permissions`:

| 권한 | 이유 |
|------|------|
| `activeTab` | 현재 탭 정보 접근 |
| `storage` | 설정·토큰·device_id 저장 |
| `scripting` | programmatic content script 주입 (필요 시) |
| `identity` | Google OAuth 로그인 |
| `contextMenus` | 우클릭 메뉴 |
| `clipboardWrite` | Replace 시 clipboard.writeText (Docs용) |
| `clipboardRead` | 향후 필요 시 (현재 불필요) |

`host_permissions`:

| 패턴 | 이유 |
|------|------|
| `https://worker.textboi.ai/*` | API 호출 |
| `https://*.supabase.co/*` | Auth, API 프록시 |
| `https://supabase-rest-api.bangcoderpro.workers.dev/*` | 게스트 API |

---

## 12. 에러 처리 명세

| 에러 상황 | 처리 방식 |
|-----------|----------|
| 선택 텍스트 없음 | 트리거 무시 (UI 표시 안 함) |
| API 응답 오류 (4xx/5xx) | `STREAM_ERROR` → 패널에 에러 메시지 + 재시도 버튼 |
| 네트워크 오류 | 동일. "네트워크를 확인해주세요" 메시지 |
| AbortError (스트리밍 중단) | 조용히 무시 (사용자가 직접 닫은 것) |
| Range 없음 (Replace 실패) | Toast "선택 범위를 다시 선택해 주세요" |
| Google Docs paste 실패 | Toast "자동 붙여넣기 실패. Cmd+V로 직접 붙여넣기 해주세요" |
| 게스트 횟수 초과 | 패널 내 로그인 유도 배너 + 처리 중단 |
| 토큰 만료 | refresh 시도 → 실패 시 팝업에서 재로그인 안내 |
