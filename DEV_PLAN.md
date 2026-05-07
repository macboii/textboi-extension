# TextBoi Chrome Extension — 세부 개발 계획

버전: 1.0  
작성일: 2026-05-07  
기준: SPEC.md 기능 명세 기반. 코드 구현 전 검토 및 합의 필요.

---

## 개발 단계 요약

| Phase | 이름 | 주요 산출물 | 예상 기간 |
|-------|------|------------|---------|
| 1 | 프로젝트 기반 정비 | 빌드 파이프라인, 상수 파일, storage 유틸 | 1~2일 |
| 2 | 핵심 트리거 구현 | 이중 복사 감지, Range 저장, 사이트 분기 | 1~2일 |
| 3 | UI 컴포넌트 구현 | SidePanel, MiniPopover, Bubble, 스타일 | 2~3일 |
| 4 | API 통합 (스트리밍) | background.js 스트리밍, api.js translate/correct | 2일 |
| 5 | Replace 구현 | 환경별 치환 로직, Cmd+Enter 단축키 | 1일 |
| 6 | 인증 및 설정 | Google OAuth, popup UI, 설정 저장 | 2일 |
| 7 | 텍스트 처리 유틸 | textCleanup.js, langDetect.js 포팅 | 1일 |
| 8 | 교정 모드 diff 뷰 | diffRenderer 포팅, CJK diff | 2일 |
| 9 | 게스트 모드 | device_id, 무료 횟수, 로그인 유도 | 1일 |
| 10 | 폴리싱 및 QA | 에러 처리, 엣지 케이스, 사이트별 테스트 | 2~3일 |

---

## Phase 1: 프로젝트 기반 정비

### 1-1. 빌드 파이프라인 구성

**현재 상태**: 빌드 파이프라인 없음. JS 파일 직접 수정.  
**목표**: esbuild로 번들링 (franc, diff-match-patch 등 npm 패키지 포함 가능하게).

**변경 파일**: `package.json`, `build.js` (신규)

```json
// package.json 추가
{
  "scripts": {
    "build": "node build.js",
    "dev": "node build.js --watch",
    "clean": "rm -rf dist/"
  },
  "devDependencies": {
    "esbuild": "^0.20.0"
  },
  "dependencies": {
    "franc": "^6.2.0",
    "diff-match-patch": "^1.0.5"
  }
}
```

```javascript
// build.js
const esbuild = require('esbuild');

const shared = {
  bundle: true,
  platform: 'browser',
  target: 'chrome114',
  sourcemap: process.argv.includes('--watch'),
};

// background service worker (ESM)
esbuild.build({
  ...shared,
  entryPoints: ['background/background.js'],
  outfile: 'dist/background/background.js',
  format: 'esm',
});

// content script (IIFE — content script는 모듈 아님)
esbuild.build({
  ...shared,
  entryPoints: ['content/content.js'],
  outfile: 'dist/content/content.js',
  format: 'iife',
});

// popup
esbuild.build({
  ...shared,
  entryPoints: ['popup/popup.js'],
  outfile: 'dist/popup/popup.js',
  format: 'iife',
});
```

> 빌드 결과물은 `dist/` 폴더. Chrome에서 `dist/` 폴더를 로드.  
> 개발 중에는 `npm run dev` (watch 모드) 후 Chrome에서 익스텐션 리로드.

**manifest.json 수정**:
```json
{
  "background": {
    "service_worker": "dist/background/background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["dist/content/content.js"],
      "css": ["dist/content/styles.css"]
    }
  ],
  "action": {
    "default_popup": "dist/popup/popup.html"
  }
}
```

### 1-2. 상수 파일 정리

**변경 파일**: `utils/constants.js` (기존 빈 파일 → 내용 추가)

```javascript
// utils/constants.js
export const OPENAI_PROXY_URL =
  "https://azgplnfczforimmtpznx.supabase.co/functions/v1/openai-proxy";
export const SUPABASE_URL =
  "https://azgplnfczforimmtpznx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
export const SUPABASE_REST_API_URL =
  "https://supabase-rest-api.bangcoderpro.workers.dev";

export const DOUBLE_COPY_THRESHOLD_MS = 500; // 이중 복사 감지 임계값

export const DEFAULT_SETTINGS = {
  mode: 'translate',
  targetLang: 'ko',
  model: 'gpt-4o-mini',
  rewritePrompt: 'proofread',
};

export const MODELS = [
  { id: 'gpt-4o-mini', label: 'Fast' },
  { id: 'gpt-4o',      label: 'Smart' },
  { id: 'gpt-4.1',     label: 'Advanced' },
];

export const REWRITE_PROMPTS = {
  proofread: 'Fix grammar and spelling errors while preserving meaning.',
  formal:    'Rewrite in a formal, professional tone.',
  casual:    'Rewrite in a casual, friendly tone.',
  concise:   'Make it concise and to the point.',
  expand:    'Expand with more details and examples.',
};
```

### 1-3. storage.js 구현

**변경 파일**: `utils/storage.js`

```javascript
// utils/storage.js
import { DEFAULT_SETTINGS } from './constants.js';

export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('tb_settings', ({ tb_settings }) => {
      resolve({ ...DEFAULT_SETTINGS, ...tb_settings });
    });
  });
}

export async function saveSettings(partial) {
  const current = await getSettings();
  return new Promise((resolve) => {
    chrome.storage.local.set({ tb_settings: { ...current, ...partial } }, resolve);
  });
}

export async function getAccessToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get('tb_access_token', ({ tb_access_token }) => {
      resolve(tb_access_token || null);
    });
  });
}

export async function getDeviceId() {
  return new Promise((resolve) => {
    chrome.storage.local.get('tb_device_id', ({ tb_device_id }) => {
      if (tb_device_id) return resolve(tb_device_id);
      const id = crypto.randomUUID();
      chrome.storage.local.set({ tb_device_id: id }, () => resolve(id));
    });
  });
}

export async function clearAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(
      ['tb_access_token', 'tb_refresh_token'],
      resolve
    );
  });
}
```

---

## Phase 2: 핵심 트리거 구현

### 2-1. content.js 구조 재설계

**현재 문제점**:
- WebModule과 GmailModule이 거의 동일한 코드 중복
- 이중 복사 감지 없음 (bubble click 트리거만 존재)
- Range 저장이 mouseup 시에만 발생

**재설계 원칙**:
- 공통 로직을 `BaseModule`로 추출
- 이중 복사 감지를 별도 `DoubleCopyDetector` 로 분리
- 사이트 분기는 Router에서만

**파일 구조 (content.js 내부)**:

```javascript
// ── 1. 유틸 함수 ──────────────────────────────
// isGoogleDocsLike(), isGmailDomain()
// getDeepActiveSelection(), getIframeSelection()
// getSelectedTextUnified(), getSelectionRect()

// ── 2. 전역 상태 ──────────────────────────────
// lastSelectionRange, lastCopyAt, currentPanelState

// ── 3. 이중 복사 감지기 ───────────────────────
// DoubleCopyDetector — copy 이벤트 또는 keydown

// ── 4. UI 컴포넌트 ────────────────────────────
// Bubble, SidePanel, MiniPopover

// ── 5. Replace 처리 ───────────────────────────
// replaceSelectedTextInWeb(), replaceSelectedTextInGoogleDocs()

// ── 6. 메시지 처리 ────────────────────────────
// chrome.runtime.onMessage.addListener

// ── 7. Router (초기화) ────────────────────────
// 사이트별 DoubleCopyDetector 초기화
```

### 2-2. DoubleCopyDetector 구현

**신규 코드** (content.js 내부):

```javascript
const DoubleCopyDetector = {
  lastCopyAt: 0,
  
  // 일반 웹 / Gmail: copy 이벤트 기반
  initCopyEvent() {
    document.addEventListener('copy', () => {
      const now = Date.now();
      const text = getSelectedTextUnified();
      
      if ((now - this.lastCopyAt) < DOUBLE_COPY_THRESHOLD_MS && text) {
        this.lastCopyAt = 0;
        saveSelectionRange();
        onDoubleCopy(text);
      } else {
        this.lastCopyAt = now;
        // 첫 복사 시 Range 저장 (두 번째 복사까지 Range가 유지됨을 보장)
        saveSelectionRange();
      }
    });
  },
  
  // Google Docs / Slides: keydown Cmd+C 기반
  initKeydown() {
    document.addEventListener('keydown', (e) => {
      if (!((e.metaKey || e.ctrlKey) && e.key === 'c')) return;
      
      const now = Date.now();
      if ((now - this.lastCopyAt) < DOUBLE_COPY_THRESHOLD_MS) {
        this.lastCopyAt = 0;
        const text = getSelectedTextUnified();
        if (text) onDoubleCopy(text);
      } else {
        this.lastCopyAt = now;
      }
    }, true); // capture phase
  }
};

function onDoubleCopy(text) {
  if (isGoogleDocsLike()) {
    const pos = DocsModule.lastMousePos;
    MiniPopover.show(pos, text);
  } else {
    SidePanel.show(text);
  }
  triggerProcessing(text);
}
```

### 2-3. saveSelectionRange 구현

```javascript
function saveSelectionRange() {
  // 일반 웹 / Gmail
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && sel.toString().trim()) {
    lastSelectionRange = sel.getRangeAt(0).cloneRange();
    return;
  }
  // iframe 내부 (Gmail compose 등)
  for (const frame of document.querySelectorAll('iframe')) {
    try {
      const iSel = frame.contentWindow.getSelection();
      if (iSel && iSel.rangeCount > 0 && iSel.toString().trim()) {
        lastSelectionRange = iSel.getRangeAt(0).cloneRange();
        return;
      }
    } catch {}
  }
}
```

### 2-4. triggerProcessing 구현

```javascript
async function triggerProcessing(text) {
  const settings = await getSettings(); // chrome.storage에서
  
  chrome.runtime.sendMessage({
    type: 'PROCESS_TEXT',
    mode: settings.mode,
    text,
    targetLang: settings.targetLang,
    model: settings.model,
    rewritePrompt: settings.rewritePrompt,
  });
}
```

---

## Phase 3: UI 컴포넌트 구현

### 3-1. SidePanel

**파일**: content.js 내 `SidePanel` 객체, styles.css 스타일

**주요 구현 포인트**:

```javascript
const SidePanel = {
  el: null,
  resultEl: null,
  state: null, // 'loading' | 'streaming' | 'done' | 'error'
  currentResult: '',
  
  show(text) {
    this.remove();
    this.state = 'loading';
    this.currentResult = '';
    
    this.el = document.createElement('div');
    this.el.id = 'textboi-panel';
    this.el.innerHTML = this._template(text);
    document.body.appendChild(this.el);
    
    this._bindEvents();
    // 슬라이드인 애니메이션 (CSS transition)
    requestAnimationFrame(() => this.el.classList.add('open'));
  },
  
  appendChunk(chunk) {
    if (!this.resultEl) return;
    this.state = 'streaming';
    this.currentResult += chunk;
    this.resultEl.textContent = this.currentResult;
  },
  
  setDone(result) {
    this.state = 'done';
    this.currentResult = result;
    if (this.resultEl) this.resultEl.textContent = result;
    this._enableReplace();
  },
  
  setError(message) {
    this.state = 'error';
    if (this.resultEl) this.resultEl.textContent = `Error: ${message}`;
  },
  
  remove() {
    if (this.el) {
      this.el.classList.remove('open');
      setTimeout(() => { this.el?.remove(); this.el = null; }, 200);
    }
    lastSelectionRange = null;
    // 스트리밍 중단 요청
    chrome.runtime.sendMessage({ type: 'ABORT_STREAM' });
  },
  
  _template(text) { /* HTML 템플릿 반환 */ },
  _bindEvents() { /* 닫기, 모드 탭, Replace 버튼 이벤트 */ },
  _enableReplace() { /* Replace 버튼 활성화 */ }
};
```

**CSS 핵심 (styles.css)**:

```css
#textboi-panel {
  position: fixed;
  top: 0;
  right: -420px;  /* 초기: 숨김 */
  width: 420px;
  height: 100vh;
  background: #fff;
  z-index: 2147483647;
  box-shadow: -4px 0 24px rgba(0,0,0,0.15);
  transition: right 0.2s ease;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}

#textboi-panel.open {
  right: 0;  /* 슬라이드인 */
}
```

### 3-2. MiniPopover

**파일**: content.js 내 `MiniPopover` 객체  
기존 코드 개선: 스트리밍 지원, Cmd+Enter 바인딩, 외부 클릭 닫기

```javascript
const MiniPopover = {
  el: null,
  resultEl: null,
  state: null,
  currentResult: '',
  
  show(pos, text) {
    this.remove();
    this.state = 'loading';
    this.currentResult = '';
    
    this.el = document.createElement('div');
    this.el.id = 'textboi-popover';
    this.el.innerHTML = this._template(text);
    
    // 위치: 마우스 좌표 + scroll offset
    Object.assign(this.el.style, {
      position: 'absolute',
      top: `${pos.y + window.scrollY + 8}px`,
      left: `${pos.x + window.scrollX}px`,
    });
    
    document.body.appendChild(this.el);
    this._bindEvents();
    this._bindOutsideClick();
  },
  
  // SidePanel과 동일한 appendChunk, setDone, setError, remove
  ...
};
```

### 3-3. Bubble

기존 코드 유지, mouseup 이벤트에서만 노출. Bubble 클릭 시 `onDoubleCopy(text)` 호출로 통합.

### 3-4. styles.css 설계

```css
/* 리셋: 외부 사이트 스타일 오염 방지 */
#textboi-panel,
#textboi-panel * {
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  line-height: 1.5;
}

/* 패널 레이아웃, 탭, textarea, 결과 영역, 버튼 */
/* 팝오버 레이아웃 */
/* 버블 스타일 */
/* 로딩 스피너 (CSS keyframe) */
/* diff 스타일 (del: 빨강, ins: 초록) */
/* 다크모드 대응 (@media prefers-color-scheme: dark) */
```

> 스타일은 `#textboi-` 접두사 ID/클래스를 사용해 외부 사이트 CSS와 충돌 방지.

### 3-5. Cmd+Enter 키보드 단축키

content.js 전역에 단일 keydown 리스너 (패널/팝오버 상태에 따라 분기):

```javascript
document.addEventListener('keydown', (e) => {
  // Esc: 모든 UI 닫기
  if (e.key === 'Escape') {
    SidePanel.remove();
    MiniPopover.remove();
    Bubble.remove();
    return;
  }
  
  // Cmd/Ctrl+Enter: Replace 실행
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    if (SidePanel.state === 'done') {
      e.preventDefault();
      handleReplace(SidePanel.currentResult);
    } else if (MiniPopover.state === 'done') {
      e.preventDefault();
      handleReplace(MiniPopover.currentResult);
    }
  }
});
```

---

## Phase 4: API 통합 (스트리밍)

### 4-1. background.js 리팩터

**현재 문제점**: 
- `callTextBoiAPI` 가 스트리밍 없이 한 번에 응답 반환
- 사이트에 결과를 한 번에 보냄

**목표**: 스트리밍 + tabId 기반 청크 릴레이

```javascript
// background.js
import { getAccessToken, getDeviceId } from '../utils/auth.js';
import { OPENAI_PROXY_URL, SUPABASE_REST_API_URL } from '../utils/constants.js';
import { applyTextCleanup } from '../utils/textCleanup.js';
import { buildTranslateMessages, buildCorrectMessages } from '../utils/api.js';

const abortControllers = new Map(); // tabId → AbortController

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'PROCESS_TEXT') {
    const tabId = sender.tab.id;
    
    // 이전 요청 중단
    abortControllers.get(tabId)?.abort();
    const controller = new AbortController();
    abortControllers.set(tabId, controller);
    
    handleProcessText(msg, tabId, controller.signal).catch(console.error);
    return true;
  }
  
  if (msg.type === 'ABORT_STREAM') {
    const tabId = sender.tab.id;
    abortControllers.get(tabId)?.abort();
    abortControllers.delete(tabId);
  }
});

async function handleProcessText(msg, tabId, signal) {
  const token = await getAccessToken();
  const deviceId = token ? null : await getDeviceId();
  
  const endpoint = token
    ? `${OPENAI_PROXY_URL}/v1/chat/completions`
    : `${SUPABASE_REST_API_URL}/guest/chat`;
  
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : { 'x-device-id': deviceId }),
  };
  
  const messages = msg.mode === 'translate'
    ? buildTranslateMessages(msg.text, msg.targetLang)
    : buildCorrectMessages(msg.text, msg.rewritePrompt);
  
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: msg.model, stream: true, messages }),
    signal,
  });
  
  if (!res.ok) {
    const err = await res.text();
    chrome.tabs.sendMessage(tabId, { type: 'STREAM_ERROR', message: err });
    return;
  }
  
  let fullResult = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (!line.startsWith('data:')) continue;
        const json = line.slice(5).trim();
        if (json === '[DONE]') { reader.cancel(); break; }
        
        try {
          const parsed = JSON.parse(json);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullResult += delta;
            chrome.tabs.sendMessage(tabId, { type: 'STREAM_CHUNK', chunk: delta });
          }
        } catch {}
      }
      buffer = lines.at(-1) || '';
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
    return; // 사용자가 취소한 경우
  }
  
  const result = applyTextCleanup(fullResult.trim());
  chrome.tabs.sendMessage(tabId, { type: 'STREAM_DONE', result });
}
```

### 4-2. api.js — 메시지 빌더 분리

```javascript
// utils/api.js
import { REWRITE_PROMPTS } from './constants.js';

export function buildTranslateMessages(text, targetLang) {
  return [
    {
      role: 'system',
      content: `You are a professional translator.
Translate the input text into: ${targetLang}
Return only the translated text.`
    },
    { role: 'user', content: text }
  ];
}

export function buildCorrectMessages(text, rewritePromptKey) {
  const promptText = REWRITE_PROMPTS[rewritePromptKey] || rewritePromptKey;
  return [
    {
      role: 'system',
      content: `You are a multilingual writing assistant.
Detect the language automatically. Do not translate.
Task: ${promptText}
Return only the final result.`
    },
    { role: 'user', content: text }
  ];
}
```

---

## Phase 5: Replace 구현

### 5-1. handleReplace 통합 함수 (content.js)

```javascript
async function handleReplace(newText) {
  if (!newText) return;
  
  if (isGoogleDocsLike()) {
    await replaceSelectedTextInGoogleDocs(newText);
  } else {
    replaceSelectedTextInWeb(newText);
  }
  
  // UI 닫기
  SidePanel.remove();
  MiniPopover.remove();
  
  // 성공 toast
  showToast('✅ Replaced');
}
```

### 5-2. replaceSelectedTextInWeb (기존 코드 개선)

기존 `replaceSelectedTextInWebandGmail` 을 `replaceSelectedTextInWeb`로 이름 변경.  
변경 사항 없음 — 로직은 동일 (Range.deleteContents + insertNode).

추가: 실패 시 에러 toast:
```javascript
if (!lastSelectionRange) {
  showToast('❌ 선택 범위가 사라졌습니다. 다시 선택해주세요.', 'error');
  return;
}
```

### 5-3. replaceSelectedTextInGoogleDocs (기존 코드 개선)

변경 사항:
- `alert()` → `showToast()` 교체 (alert는 UX 방해)
- iframe 찾기 로직 개선 (더 안정적인 셀렉터)

### 5-4. showToast 유틸 (신규)

```javascript
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.id = 'textboi-toast';
  toast.textContent = message;
  // 스타일: 화면 하단 중앙, 2초 후 자동 제거
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}
```

---

## Phase 6: 인증 및 설정

### 6-1. auth.js — Google OAuth 완성

기존 코드에서 `YOUR-SUPABASE-URL` 플레이스홀더 교체 및 개선:

```javascript
// utils/auth.js
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './constants.js';

export async function loginWithGoogle() {
  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl = `${SUPABASE_URL}/auth/v1/authorize?` +
    `provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;
  
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirected) => {
      if (chrome.runtime.lastError || !redirected) {
        return reject(new Error(chrome.runtime.lastError?.message || 'Login cancelled'));
      }
      
      const url = new URL(redirected);
      const params = new URLSearchParams(
        url.hash ? url.hash.slice(1) : url.search.slice(1)
      );
      
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      
      if (!accessToken) return reject(new Error('No access token'));
      
      chrome.storage.local.set({
        tb_access_token: accessToken,
        tb_refresh_token: refreshToken,
      }, () => {
        // 모든 탭에 로그인 상태 변경 브로드캐스트
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'AUTH_CHANGED', loggedIn: true })
              .catch(() => {}); // 일부 탭 무응답 무시
          });
        });
        resolve();
      });
    });
  });
}

export async function logout() {
  await new Promise((resolve) => {
    chrome.storage.local.remove(['tb_access_token', 'tb_refresh_token'], resolve);
  });
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: 'AUTH_CHANGED', loggedIn: false })
        .catch(() => {});
    });
  });
}
```

### 6-2. popup.html / popup.js 개선

**popup.html** 구조:
```html
<div id="app">
  <header>
    <img src="../assets/AppLogo_textBoi.png" />
    <span>TextBoi</span>
  </header>
  
  <section id="auth-section">
    <!-- 로그인 상태: 사용자 정보 표시 -->
    <div id="user-info" class="hidden">
      <span id="user-email"></span>
      <button id="logout-btn">로그아웃</button>
    </div>
    <!-- 비로그인 상태 -->
    <button id="login-btn">Google로 로그인</button>
  </section>
  
  <section id="settings-section">
    <label>Mode
      <select id="mode-select">
        <option value="translate">번역</option>
        <option value="correct">교정</option>
      </select>
    </label>
    <label>Target Language
      <select id="lang-select">
        <option value="ko">한국어</option>
        <option value="en">English</option>
        <option value="ja">日本語</option>
        <!-- ... -->
      </select>
    </label>
    <label>AI Model
      <select id="model-select">
        <option value="gpt-4o-mini">Fast</option>
        <option value="gpt-4o">Smart</option>
        <option value="gpt-4.1">Advanced</option>
      </select>
    </label>
  </section>
</div>
```

**popup.js** 핵심 로직:
```javascript
// 설정 로드 및 UI 반영
const settings = await getSettings();
modeSelect.value = settings.mode;
langSelect.value = settings.targetLang;
modelSelect.value = settings.model;

// 설정 변경 → 즉시 저장
modeSelect.addEventListener('change', () => saveSettings({ mode: modeSelect.value }));
// ...

// 로그인/로그아웃 버튼
loginBtn.addEventListener('click', () => loginWithGoogle());
logoutBtn.addEventListener('click', () => logout());

// 로그인 상태 확인
const token = await getAccessToken();
if (token) showUserInfo(token);
```

---

## Phase 7: 텍스트 처리 유틸 포팅

### 7-1. textCleanup.js

**원본**: `textBoi_desktop/src/api/textCleanup.ts`  
**변환**: TypeScript → JavaScript, `export`만 변경

```javascript
// utils/textCleanup.js
// desktop/src/api/textCleanup.ts 포팅
// TS 문법 제거, 로직 동일

export function applyTextCleanup(text) {
  let cleaned = text.trim();
  // 1. 문장부호 중복 제거
  cleaned = cleaned.replace(/([.!?])\1+/g, '$1');
  // 2. 과도한 공백 → 1칸
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  // 3. 마지막 단어 반복 제거 (한글 포함)
  cleaned = cleaned.replace(
    /([\w가-힣ぁ-んァ-ン一-龥]+)\s+\1(?![가-힣\wぁ-んァ-ン一-龥])/g, '$1'
  );
  // 4~8: desktop 코드와 동일한 나머지 규칙들...
  return cleaned;
}
```

> `applyGlobalTextCleanup` → `applyTextCleanup`으로 이름 단순화.

### 7-2. langDetect.js

**원본**: `textBoi_desktop/src/api/openai.ts`의 `detectLanguage()` 함수  
**변환**: franc npm 패키지 사용 (esbuild 번들 포함)

```javascript
// utils/langDetect.js
import { franc } from 'franc'; // esbuild 번들 시 포함
import { ISO3_TO_ISO1 } from './langData.js'; // ISO 코드 매핑 테이블

const langCache = new Map();

export function detectLanguage(text) {
  if (!text || text.length < 5) return 'unknown';
  if (langCache.has(text)) return langCache.get(text);
  
  // Unicode 즉시 판별
  const koRatio = (text.match(/[가-힣]/g) || []).length / text.length;
  if (koRatio > 0.4) return cache(text, 'ko');
  
  const jaRatio = (text.match(/[ぁ-ヿ]/g) || []).length / text.length;
  if (jaRatio > 0.4) return cache(text, 'ja');
  
  const zhRatio = (text.match(/[一-鿿]/g) || []).length / text.length;
  if (zhRatio > 0.4) return cache(text, 'zh');
  
  // franc 트라이그램 분석
  const iso3 = franc(text, { minLength: 20 });
  const iso1 = ISO3_TO_ISO1[iso3] || 'unknown';
  return cache(text, iso1);
}

function cache(text, lang) {
  langCache.set(text, lang);
  return lang;
}
```

`utils/langData.js`에 desktop의 `ISO3_TO_ISO1` 테이블 그대로 복사.

---

## Phase 8: 교정 모드 diff 뷰

### 8-1. diffRenderer.js 포팅

**원본**: `textBoi_desktop/src/renderer/diffRenderer.ts`  
**변환**: TypeScript → JavaScript, Electron/IPC 의존성 제거

```javascript
// content/diffRenderer.js (또는 content.js 내부 포함)
import DiffMatchPatch from 'diff-match-patch'; // esbuild 번들에 포함

export function generateDiffHtml(original, corrected) {
  // desktop diffRenderer.ts 로직 동일하게 포팅
  // isCJK(), wordLevelDiff(), charLevelDiff(), 문장 그룹화
}
```

### 8-2. SidePanel에서 diff 뷰 통합

교정 모드에서 `STREAM_DONE` 수신 시:
```javascript
// SidePanel.setDone 내부
if (currentMode === 'correct') {
  const diffHtml = generateDiffHtml(originalText, result);
  this.resultEl.innerHTML = diffHtml;
  this._enableReplace();
}
```

diff 스타일 (styles.css에 추가):
```css
.textboi-diff-del { color: #e53935; text-decoration: line-through; }
.textboi-diff-ins { color: #2e7d32; text-decoration: underline; }
```

---

## Phase 9: 게스트 모드

### 9-1. background.js 게스트 횟수 체크

`handleProcessText` 시작 시:
```javascript
const token = await getAccessToken();
if (!token) {
  const deviceId = await getDeviceId();
  const check = await checkGuestQuota(deviceId);
  if (!check.ok) {
    chrome.tabs.sendMessage(tabId, { type: 'GUEST_LIMIT_REACHED' });
    return;
  }
}
```

```javascript
async function checkGuestQuota(deviceId) {
  try {
    const res = await fetch(`${SUPABASE_REST_API_URL}/device/check-free`, {
      method: 'POST',
      headers: { 'x-device-id': deviceId },
    });
    return await res.json(); // { ok: true/false, remaining: N }
  } catch {
    // 네트워크 오류 시 로컬 카운터로 폴백
    return localQuotaCheck(deviceId);
  }
}
```

### 9-2. content.js 게스트 한도 초과 처리

```javascript
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'GUEST_LIMIT_REACHED') {
    SidePanel.showLoginPrompt(); // 패널 내 로그인 유도 배너
  }
});
```

---

## Phase 10: 폴리싱 및 QA

### 10-1. 테스트 체크리스트

**이중 복사 감지**:
- [ ] 일반 웹 (Medium, Naver 등) — `copy` 이벤트 기반
- [ ] Gmail 읽기 영역
- [ ] Gmail 작성(compose) 영역
- [ ] Google Docs 본문
- [ ] Google Slides 텍스트박스
- [ ] Shadow DOM 내부 textarea (예: Notion)
- [ ] iframe 내부 contentEditable (예: 일부 CMS)

**Replace**:
- [ ] 일반 웹 textarea
- [ ] 일반 웹 contentEditable
- [ ] Gmail compose 영역
- [ ] Google Docs (clipboard + Cmd+V)

**스트리밍**:
- [ ] 청크 실시간 표시
- [ ] 패널 닫기 시 스트리밍 중단 (AbortController)
- [ ] 네트워크 오류 시 에러 표시

**키보드 단축키**:
- [ ] Esc 닫기
- [ ] Cmd+Enter / Ctrl+Enter Replace

**사이트별**:
- [ ] 한국어 입력 → 번역 (ko → en)
- [ ] 영어 교정 (proofread)
- [ ] CJK diff (한글 교정 결과 diff 뷰)

### 10-2. 알려진 엣지 케이스 및 해결책

| 케이스 | 문제 | 해결책 |
|--------|------|--------|
| Notion | Shadow DOM 복잡 | `getDeepActiveSelection()` 재귀 탐색 |
| Twitter/X | react synthetic events | `copy` 이벤트로 우회 |
| Google Docs | `copy` 이벤트 미버블링 | keydown capture phase 사용 |
| Gmail 읽기 | contentEditable 아님 | Replace 버튼 숨김 처리 |
| PDF 뷰어 | 선택 불가 또는 제한적 | Bubble 미표시, graceful 무시 |

### 10-3. 보안 고려사항

- `innerHTML` 사용 시 XSS 방지: diff 결과 삽입 시 생성된 HTML만 허용, 사용자 입력값은 `textContent` 사용
- `navigator.clipboard.writeText` 실패 시 `showToast` 에러 (alert 금지)
- API 키/토큰은 절대 `console.log`에 출력하지 않음
- content script에서 `eval()` / `Function()` 사용 금지 (CSP 위반)

---

## 파일 변경 요약 (Phase별)

| 파일 | Phase | 변경 유형 |
|------|-------|----------|
| `package.json` | 1 | 수정 (빌드 스크립트 추가) |
| `build.js` | 1 | 신규 생성 |
| `manifest.json` | 1 | 수정 (dist/ 경로 변경) |
| `utils/constants.js` | 1 | 수정 (내용 채우기) |
| `utils/storage.js` | 1 | 수정 (chrome.storage 래퍼) |
| `content/content.js` | 2,3,5,8,9 | 전면 리팩터 |
| `content/styles.css` | 3 | 전면 재작성 |
| `background/background.js` | 4,9 | 스트리밍 리팩터 |
| `utils/api.js` | 4 | 메시지 빌더 분리 |
| `utils/auth.js` | 6 | OAuth 완성 |
| `popup/popup.html` | 6 | 재설계 |
| `popup/popup.js` | 6 | 재작성 |
| `popup/popup.css` | 6 | 재작성 |
| `utils/textCleanup.js` | 7 | 신규 생성 (desktop 포팅) |
| `utils/langDetect.js` | 7 | 신규 생성 (desktop 포팅) |
| `utils/langData.js` | 7 | 신규 생성 (ISO 코드 테이블) |
| `content/diffRenderer.js` | 8 | 신규 생성 (desktop 포팅) |
