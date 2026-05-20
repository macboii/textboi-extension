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
| `utils/tokenCount.js` | 토큰 수 정확 계산 (`countTokens`, `gpt-tokenizer` BPE 인코딩, cl100k_base), 모델별 비용 배수 (`getModelMultiplier`) | API 호출, chrome 사용 |

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

// 로그인 직후 팝업에서 background으로 (사용자 등록 + Free Plan 생성 위임)
{ type: 'POST_LOGIN' }
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

// 로그인 사용자 월별 토큰 한도 초과
{ type: 'QUOTA_EXCEEDED' }
```

### popup → background (Stripe 빌링)

```javascript
// Stripe Checkout 세션 생성 요청
{ type: 'STRIPE_CHECKOUT', plan: 'basic' }
// → 응답: { ok: true, url?, isUpgrade?, message? } | { ok: false, error: string }

// Stripe Customer Portal 세션 생성 요청
{ type: 'STRIPE_PORTAL' }
// → 응답: { ok: true, url } | { ok: false, error: string }

// 현재 플랜 조회
{ type: 'GET_PLAN' }
// → 응답: { plan: UserPlan | null }
```

### background → popup (Stripe 빌링 + Quota, `chrome.runtime.sendMessage`)

```javascript
// 결제 완료 후 플랜 갱신 알림 (chrome.tabs.onUpdated → textboi.ai/billing-success 감지)
{ type: 'PLAN_REFRESHED', plan: UserPlan }

// 번역/교정 완료 후 토큰 소비량 반영 알림 (saveHistory 완료 후)
// 팝업이 열려있으면 quota 바를 조용히 갱신 (토스트 없음)
{ type: 'QUOTA_REFRESHED', plan: UserPlan }
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
| `_extensionEnabled` | `boolean` | `tb_enabled` 스토리지 값. false면 트리거·버블 전부 차단. 토글 on 시 `Bubble.init()` 재호출. |
| `_lastBubbleState` | `{ text, rect } \| null` | Docs `_showSelectionBubble` 에서 상태 추적용으로만 유지. `SidePanel.remove()` 후 버블 복원은 `Bubble.showDefault()`로 대체됨. |
| `SidePanel.state` | `null \| 'loading' \| 'streaming' \| 'done' \| 'error'` | 패널 상태. Replace 버튼 활성화 및 Cmd+Enter 허용 여부 결정. |
| `SidePanel._resultCache` | `{ text, result, isDiff, diffHtml } \| null` | 마지막 처리 결과 캐시. 버블 클릭으로 패널 재오픈 시 재요청 없이 결과 복원. `onDoubleCopy()` 및 clear 시 null 초기화. |
| `SidePanel._currentMode` | `'translate' \| 'correct'` | 현재 선택된 모드. `setDone()`에서 diff 여부 결정에 사용. |
| `SidePanel._currentRewritePrompt` | `string` | 현재 rewrite 프롬프트. proofread/improve 판별로 diff 활성화 여부 결정. |
| `SidePanel._quotaExceeded` | `boolean` | 토큰/게스트 한도 초과 시 true. `onDoubleCopy()` 새 요청 차단 + `_rerun()` 진입 차단 + `state = "error"` 로 Cmd+Enter 차단 + 실행 버튼(submit/retry) disabled. `remove()` 시 false로 리셋 (다음 패널 열 때 초기화). |
| `SidePanel._outsideClickHandler` | `Function \| null` | 패널 외부 클릭 감지 핸들러. `_bindEvents()`에서 capture phase로 등록, `remove()`에서 반드시 해제. 드롭다운(`.tb-dd-panel`) 클릭은 무시. |
| `Bubble._text` | `string \| null` | 현재 버블 상태. `null` = 기본(우측 하단) 위치, `string` = 선택 텍스트(선택 영역 근처). |
| `Bubble._onClickFn` | `Function \| null` | Docs 등 커스텀 클릭 핸들러. `null`이면 기본 SidePanel 열기 동작. `remove()` / `showDefault()` 시 null 초기화. |
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
- 토큰 만료: `isTokenExpired(token)` (JWT `exp` × 1000 < `Date.now() + 60_000`) 로 proactive 체크 → `getValidToken()` 호출 → `refreshAccessToken()` → 실패 시 `STREAM_ERROR`. 모든 API 호출 함수(`handleProcessText`, `handleExplainDiff`, `handlePostLogin`, `fetchCurrentPlan`, `handleStripeCheckout`, `handleStripePortal`)는 반드시 `getValidToken()` 사용. `getAccessToken()` 직접 호출 금지.
- 장치 세션 미등록(`DEVICE_NOT_AUTHORIZED`): `ensureDeviceSessionOnce(token, deviceId)` — `chrome.storage`에 `tb_session_{deviceId}` 키로 캐시해 중복 호출 방지. 성공 시에만 캐시(`true`) 저장. `saveHistory()` / `saveDiff()` 401 시 스탈 캐시를 `chrome.storage.local.remove(key)`로 제거 후 `registerDeviceSession()` 재호출 → 성공 시 캐시 재저장 → `doSave()` 재시도. `/save-session` 호출 시 반드시 `Authorization: Bearer {token}` 헤더 포함 (Worker JWT 미들웨어 통과 필수 — device session 미들웨어만 bypass, JWT 미들웨어는 bypass 아님).
- `onMessage` 콜백 방식 응답 (`EXPLAIN_DIFF`): 반드시 `(msg, sender, sendResponse)` 세 번째 파라미터 선언 필수. 누락 시 `sendResponse`가 `undefined` → TypeError → 메시지 포트 닫힘 → content에서 `lastError` 수신 → 에러 UI 표시

## 보안 규칙

- background.js 메시지 수신 시 `sender.id !== chrome.runtime.id` 체크로 외부 페이지 메시지 거부
- diff 결과 등 HTML 삽입 시 생성된 HTML만 허용 (`generateDiffHtml` 반환값)
- 사용자 입력(원본 텍스트 편집)은 항상 `textContent` 사용, `innerHTML` 금지
- 토큰, API 키는 `console.log` 출력 금지
- content script에서 `eval()`, `new Function()` 사용 금지 (Chrome CSP 위반)

### 클라이언트 입력 검증 (background.js `sanitizeMsg`)

`PROCESS_TEXT` 메시지는 background.js 수신 즉시 `sanitizeMsg()`로 정제 후 처리:

| 필드 | 검증 규칙 | 위반 시 |
|------|----------|---------|
| `model` | `MODELS` 화이트리스트 (`VALID_MODEL_IDS`) | `gpt-4o-mini`로 강제 |
| `text` | 최대 10,000자 | 슬라이스 |
| `rewritePrompt` | 최대 500자 | 슬라이스 |
| `targetLang` | `/^[a-z]{2,3}(-[A-Z]{2,4})?$/` | `en-US`로 강제 |

`EXPLAIN_DIFF`의 `model` 필드도 동일 화이트리스트 검증.

**free/guest 모델 잠금 (이중 방어)**:
- background.js: `checkUserQuota()` 결과 `planType === "free"` 또는 게스트이면 → `msg.model = "gpt-4o-mini"` 강제 (서버사이드)
- content.js: `SidePanel.show()` 시 `tb_current_plan` 캐시 + `tb_access_token` 조회 → free/guest이면 모델 셀렉터 `disabled`, `gpt-4o-mini` 고정 (클라이언트 UI)

**`EXPLAIN_DIFF` 프롬프트 인젝션 리스크 없음**: `sender.id` 체크로 외부 페이지에서 메시지 전송 불가. `diffHtml`은 `generateDiffHtml()` 반환값, `rewritePrompt`는 storage 값 — 외부 입력 직접 유입 없음. 응답도 `json_schema`로 고정되어 실질 피해 없음.

### 게스트 횟수 우회 리스크 평가

device_id(`chrome.storage.local`)를 수동 삭제하면 새 UUID로 DB 카운트 리셋 가능. 단:
- Cloudflare Worker에서 게스트 요청을 `CF-Connecting-IP` 기준 분당 10회 rate limiting 적용
- 데스크탑도 동일 구조(`electron-store`)이며 동일 Worker 사용 → 양 플랫폼 동일 수준
- 공격 비용(수동 UUID 리셋 반복) > 얻는 이익(무료 번역 10회) → 실제 악용 가능성 낮음

### Supabase DB 보안

**RLS 상태**: 모든 public 테이블 RLS 활성화 확인됨 (2026-05-12).

| 테이블 그룹 | 정책 |
|-------------|------|
| `user_blocks`, `user_dictionary`, `user_diff`, `user_history`, `user_invites`, `user_logs`, `user_rewards` | `block_all` — 클라이언트 전면 차단 |
| `devices` | `deny all` — 클라이언트 전면 차단 |
| `user_plans`, `user_sessions` | `authenticated` 롤 SELECT only |
| `user_models`, `user_modes`, `user_mode_preferences` | `auth.uid() = user_id` 본인 데이터만 |
| `users` | SELECT/INSERT/UPDATE — `auth.uid() = id` + 민감 컬럼 트리거로 추가 보호 |

**`users` 테이블 민감 컬럼 보호 트리거** (`trg_guard_users_sensitive_fields`):
- `anon` / `authenticated` 롤이 아래 컬럼을 UPDATE 시도하면 예외 발생
- 차단 컬럼: `subscription_active`, `subscription_plan`, `token_quota`, `token_used`, `billing_model`, `subscription_renewal_at`, `token_input`, `token_output`
- `service_role`, `postgres`, `supabase_admin`, `supabase_auth_admin`은 트리거 통과 (Edge Function, Stripe 웹훅, DB 트리거 정상 작동)
- 데스크탑/익스텐션 모두 `authenticated` 롤 사용 → 프로필 컬럼(name, avatar_url, locale 등) 업데이트는 정상 허용
