# CLAUDE.md — TextBoi Chrome Extension

Chrome 익스텐션 버전의 TextBoi. 텍스트 선택 후 Cmd+C+C(Mac) / Ctrl+C+C(Win)로 AI 번역·교정 패널을 띄우고, Cmd+Enter / Ctrl+Enter 또는 Replace 버튼으로 원본 텍스트를 AI 결과로 치환한다.

OCR 기능 없음. 데스크탑 앱(`textBoi_desktop/`)의 API, 텍스트 정제, 언어 감지 로직을 재활용한다.

---

## 주요 문서

| 문서 | 내용 |
|------|------|
| [`.claude/rules/SPEC.md`](.claude/rules/SPEC.md) | 기능 상세 명세서 — ⚠️ 일부 섹션 구현과 불일치 (MiniPopover, 모델 목록, Docs Replace 전략 등) |
| [`.claude/rules/DEV_PLAN.md`](.claude/rules/DEV_PLAN.md) | 세부 개발 계획 — Phase 1~9 완료. Phase 10 QA 체크리스트 참고용 |
| [`.claude/rules/ui-spec.md`](.claude/rules/ui-spec.md) | **UI 정의서** — 데스크탑 앱 스크린샷 기준 컴포넌트 명세, 구현 상태 체크리스트 |
| [`.claude/rules/architecture.md`](.claude/rules/architecture.md) | 파일 역할 경계, 메시지 타입, 전역 상태 |
| [`.claude/rules/content-script-patterns.md`](.claude/rules/content-script-patterns.md) | 이중 복사 감지, 사이트별 선택 처리, Bubble 패턴 |
| [`.claude/rules/replace-strategy.md`](.claude/rules/replace-strategy.md) | 환경별(Web/Gmail/Docs) 텍스트 치환 패턴 |
| [`.claude/rules/ui-redesign-plan.md`](.claude/rules/ui-redesign-plan.md) | SidePanel 리디자인 이력 및 _position() 전략 |
| [`.claude/rules/app-flow.md`](.claude/rules/app-flow.md) | **앱 작동 플로우** — 이중 복사 트리거→스트리밍→Replace 전체 흐름, 데스크탑 대비 비교 |
| [`.claude/rules/billing-plan.md`](.claude/rules/billing-plan.md) | **빌링·플랜·토큰 차감** — Free Plan 생성, user_history 저장, DB 트리거 차감 구조, Quota 체크, 개발 계획 Phase A~F |
| [`.claude/rules/stripe-billing.md`](.claude/rules/stripe-billing.md) | **Stripe 구독 결제** — Basic 플랜 Checkout·Portal·갱신·해지·Quota 표시, 개발 계획 Phase 1~4 |
| [`.claude/skills/ref-desktop-backend.md`](.claude/skills/ref-desktop-backend.md) | **스킬** `/ref-desktop-backend` — 백엔드 디렉토리 맵, API 엔드포인트 스펙, 데이터 파일 경로 |
| [`.claude/skills/port-from-desktop.md`](.claude/skills/port-from-desktop.md) | **스킬** `/port-from-desktop` — desktop → extension TS→JS 포팅 규칙 |

---

## 파일 구조

```
textBoi_extension/
├── manifest.json              MV3 선언 (권한, commands, content_scripts)
├── background/
│   └── background.js          Service Worker: API 호출, 스트리밍 청크 릴레이
├── content/
│   ├── content.js             트리거 감지, UI(Panel/Popover/Bubble), Replace
│   └── styles.css             패널·팝오버·버블 스타일
├── popup/
│   ├── popup.html             설정 팝업 UI
│   ├── popup.js               모드·언어·모델 설정, 로그인/로그아웃
│   └── popup.css
├── dist/                      esbuild 번들 출력 (gitignore)
│   ├── background/background.js
│   └── content/content.js
└── utils/
    ├── api.js                 번역/교정 메시지 빌더 (buildTranslateMessages, buildCorrectMessages)
    ├── auth.js                Google OAuth (chrome.identity), 세션 관리
    ├── storage.js             chrome.storage.local 래퍼 (settings, token)
    ├── constants.js           API URL, 앱 설정값
    ├── textCleanup.js         GPT 결과 후처리 (desktop에서 포팅)
    └── langDetect.js          언어 감지 (franc → CDN 버전, desktop에서 포팅)
```

---

## 개발 커맨드

```bash
# 패키지 설치
npm install

# esbuild 번들 빌드 → dist/ 출력
npm run build

# 감시 모드 (파일 변경 시 자동 리빌드)
npm run dev

# dist/ 삭제
npm run clean
```

> 빌드 후 `chrome://extensions` → "새로고침"으로 익스텐션 리로드. 매니페스트가 `dist/` 경로를 가리킴.

---

## 아키텍처 요약

```
[브라우저 페이지]
  content.js
  ├── copy 이벤트 감지 (500ms 내 2회 → 이중 복사 트리거)
  ├── 선택 텍스트 + Range 저장
  ├── Panel / Popover / Bubble UI 렌더링
  └── Cmd+Enter → Replace (Range-based / clipboard+paste)
        ↕ chrome.runtime.sendMessage
[Service Worker]
  background.js
  ├── PROCESS_TEXT 메시지 수신 → API 스트리밍 호출
  ├── 청크마다 STREAM_CHUNK → chrome.tabs.sendMessage
  └── 완료 시 STREAM_DONE 전송
        ↕ fetch
[Cloudflare Worker / Supabase Edge Function]
  utils/api.js가 호출하는 엔드포인트
  → https://azgplnfczforimmtpznx.supabase.co/functions/v1/openai-proxy
```

### 메시지 타입 (content ↔ background)

| 방향 | type | 설명 |
|------|------|------|
| content → bg | `PROCESS_TEXT` | `{ mode, text, targetLang, model, rewritePrompt }` — tabId는 sender.tab.id로 자동 획득 |
| content → bg | `ABORT_STREAM` | 스트리밍 중단 요청 |
| bg → content | `STREAM_CHUNK` | `{ chunk: string }` |
| bg → content | `STREAM_DONE` | `{ result: string }` |
| bg → content | `STREAM_ERROR` | `{ message: string }` |
| bg → content | `GUEST_LIMIT_REACHED` | 게스트 사용 한도 초과 |
| bg → content | `AUTH_CHANGED` | `{ loggedIn: boolean }` — 로그인/로그아웃 시 브로드캐스트 |
| bg → content | `COMMAND` | `{ mode: string }` — chrome.commands 단축키 중계 |

---

## 환경 설정

```javascript
// utils/constants.js
export const OPENAI_PROXY_URL =
  "https://azgplnfczforimmtpznx.supabase.co/functions/v1/openai-proxy";
export const SUPABASE_URL =
  "https://azgplnfczforimmtpznx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbG..."; // appConfig.ts와 동일
export const SUPABASE_REST_API_URL =
  "https://supabase-rest-api.bangcoderpro.workers.dev";
```

URL·키 하드코딩 금지. 반드시 `utils/constants.js`에서 import.

**모델 목록** (`utils/constants.js` `MODELS` 배열) — `textBoi_desktop/public/aiModels.json`과 동기화 유지:
- `gpt-4o-mini` / `gpt-4.1-mini` / `gpt-4.1` / `gpt-5-chat-latest`

**언어 목록 — 두 가지 배열 사용** (`utils/constants.js`):

| 상수 | 원본 파일 | 코드 형식 | 용도 |
|------|----------|----------|------|
| `SOURCE_LANGUAGES` | `iso_639_1_full_languages.json` (184개) | 단순 코드 (`en`, `zh`, `fr`, `pt`) | 소스 언어 드롭다운. franc 감지 출력과 직접 매칭 |
| `LANGUAGES` | `iso_639_1_full_languages_rev.json` (188개) | 지역 코드 (`en-US`, `zh-CN`, `fr-FR`) | 타겟 언어 드롭다운 |

`resolveLocale(locale)` 헬퍼: `navigator.language` 또는 franc 코드 → `LANGUAGES` 코드로 변환 (타겟 언어 기본값 결정에 사용):
- `"ko-KR"` → `"ko"` / `"en"` or `"en-US"` → `"en-US"` / `"zh"` → `"zh-CN"` / `"fr"` → `"fr-FR"` / `"pt"` → `"pt-BR"`

**content script에서 아이콘 접근** — `manifest.json`의 `web_accessible_resources`에 `"icons/*.png"` 등록 필수. `chrome.runtime.getURL("icons/icon48.png")` 방식으로 사용.

---

## 사이트별 동작 분기

| 사이트 | 트리거 | UI | Replace 방식 |
|--------|--------|-----|-------------|
| 일반 웹 | `copy` 이벤트 × 2 | Side Panel (우측 고정) | Range.deleteContents + insertNode |
| Gmail | iframe copy 이벤트 × 2 (MutationObserver로 iframe 감지) | Side Panel | Range.deleteContents + insertNode |
| Google Docs/Slides | iframe keydown Cmd+C × 2 + `navigator.clipboard.readText()` | Side Panel (모든 환경 통일) | sync execCommand('copy') → execCommand('paste') → ClipboardEvent fallback |
| Google Sheets | `copy` 이벤트 × 2 (DOM 기반, 일반 웹과 동일) | Side Panel | Range.deleteContents + insertNode |

---

## 재활용 소스 (textBoi_desktop/)

| 익스텐션 파일 | 원본 (desktop) | 변경 사항 |
|--------------|----------------|-----------|
| `utils/textCleanup.js` | `src/api/textCleanup.ts` | TS→JS, `applyGlobalTextCleanup` → `applyTextCleanup` |
| `utils/langDetect.js` | `src/api/openai.ts` detectLanguage() | franc npm 패키지 번들 (CDN 아님), cache Map 유지 |
| `utils/api.js` buildTranslateMessages | `src/api/openai.ts` translateText() | 메시지 빌더만 추출, fetch 없음 |
| `utils/api.js` buildCorrectMessages | `src/api/openai.ts` correctText() | langDetect로 언어 힌트 삽입 |
| `content/content.js` diffRenderer | `src/renderer/diffRenderer.ts` | CJK diff, 문장별 그룹 |

---

## 코드 규칙 (요약)

- URL/키는 `utils/constants.js`에서만 관리
- background.js에서만 `fetch` (API 호출). content.js는 UI·Replace만
- 사이트 분기는 `isGoogleDocsLike()`, `isGmailDomain()` 유틸 함수 사용
- content.js 내 `lastSelectionRange` (Range 객체) 항상 갱신 후 Replace에 사용
- 스트리밍 오류 시 `STREAM_ERROR` 메시지로 content에 전달, UI에 표시
- 새 메시지 타입 추가 시 `/new-message-type` 커맨드 사용

---

## 작업 원칙

### Think Before Coding
- 요청이 모호하면 가정하고 진행하지 말고 먼저 질문한다
- 해석이 여러 가지라면 조용히 하나를 택하지 말고 트레이드오프를 제시한다
- 더 단순한 방법이 있으면 구현 전에 말한다
- 막히거나 불확실하면 명확히 한다

### Goal-Driven Execution
- 복잡한 작업은 실행 전에 간단한 계획을 제시한다: `1. [단계] → 검증: [확인 방법]`
- 성공 기준을 명확히 정의한다 ("작동하게 해줘" 대신 "X를 하면 Y가 되어야 한다")
- `npm run build` 성공 + 실제 동작 확인까지가 완료 기준이다
