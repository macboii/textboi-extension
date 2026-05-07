# SidePanel UI 리디자인 계획

데스크탑 앱(`textBoi_desktop/`) 디자인을 기준으로 Chrome 익스텐션 SidePanel을 재설계한다.  
구현 전 이 문서를 읽고 모든 섹션을 완전히 이해할 것.

---

## 1. 목표 레이아웃 (데스크탑 대응 구조)

```
┌─────────────────────────────────────┐
│  [交 Translate] [A Correct]    [✕]  │  ← tb-header (모드 토글 + 닫기)
│  [Model: GPT-4o mini ▾]             │  ← tb-model-row (모델 셀렉터 full-width)
├─────────────────────────────────────┤
│  🌐 Auto-detect                     │  ← tb-section--top (소스 lang 뱃지)
│  ┌─────────────────────────────┐    │
│  │ selected text appears here  │    │  ← tb-original textarea
│  └─────────────────────────────┘    │
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤
│  [🇺🇸 English ▾]   ← TRANSLATE 모드  │  ← tb-section--bottom
│  [🔍 Proofread ▾]  ← CORRECT 모드   │    (target-lang 또는 rewrite-style 셀렉트)
│  ┌─────────────────────────────┐    │
│  │ AI result streams here...   │    │  ← tb-result (+ tb-spinner)
│  └─────────────────────────────┘    │
│  [Custom prompt... (optional)]      │  ← CORRECT 모드 한정 (tb-custom-prompt)
├─────────────────────────────────────┤
│  [↺]              [Apply ⌘↵]       │  ← tb-footer
└─────────────────────────────────────┘
```

---

## 2. 데스크탑 디자인 토큰 → 익스텐션 CSS 변수 매핑

`content/styles.css` 상단에 CSS 변수 블록 추가. 다크 모드는 `@media (prefers-color-scheme: dark)`로 분기.

```css
/* === TextBoi Design Tokens (ported from textBoi_desktop/src/renderer/styles.css) === */
#textboi-panel {
  /* Light */
  --tb-bg: #F9F9F9;
  --tb-surface: #ffffff;
  --tb-border: #ddd;
  --tb-border-input: #ccc;
  --tb-text-primary: #000000;
  --tb-text-muted: #555555;
  --tb-text-faint: #888888;
  --tb-text-placeholder: rgba(0,0,0,0.35);
  --tb-accent: #1e90ff;
  --tb-accent-bg: #E3EDF8;
  --tb-accent-text: #194F94;
  --tb-mode-active-bg: #E3EDF8;
  --tb-mode-active-text: #194F94;
  --tb-mode-active-border: #1e90ff;
  --tb-btn-action-bg: #000000;
  --tb-btn-action-fg: #ffffff;
  --tb-btn-hover-bg: #E7E7E7;
  --tb-shadow: 0 8px 40px rgba(0,0,0,0.18);
}

@media (prefers-color-scheme: dark) {
  #textboi-panel {
    --tb-bg: #1C1C1E;
    --tb-surface: #2C2C2E;
    --tb-border: #38383A;
    --tb-border-input: #48484A;
    --tb-text-primary: #F2F2F7;
    --tb-text-muted: #AEAEB2;
    --tb-text-faint: #8E8E93;
    --tb-text-placeholder: rgba(255,255,255,0.3);
    --tb-accent: #0A84FF;
    --tb-accent-bg: #1C3557;
    --tb-accent-text: #82B1FF;
    --tb-mode-active-bg: #1C3557;
    --tb-mode-active-text: #82B1FF;
    --tb-mode-active-border: #0A84FF;
    --tb-btn-action-bg: #F2F2F7;
    --tb-btn-action-fg: #1C1C1E;
    --tb-btn-hover-bg: #3A3A3C;
    --tb-shadow: 0 8px 40px rgba(0,0,0,0.55);
  }
}
```

---

## 3. HTML 구조 변경 (`_buildHTML()` 내부)

### 3-1. 현재 구조 vs 목표 구조

| 현재 | 목표 |
|------|------|
| 모드 토글 + 언어 select 같은 줄 | 모드 토글 row / 모델 row 분리 |
| `tb-lang-select` (target lang) → 상단 | 하단 (`tb-section--bottom`)으로 이동 |
| `tb-model-select` → 하단 | 상단 전체 너비 `tb-model-row`로 이동 |
| Correct 모드 구분 없음 | Correct 모드 시 rewrite-style 셀렉트 표시 |
| 커스텀 프롬프트 입력 없음 | Correct 모드 하단에 `tb-custom-prompt` textarea 추가 |

### 3-2. 새 `_buildHTML()` 반환값

```javascript
_buildHTML() {
  const modelOptions = MODELS.map(
    (m) => `<option value="${m.id}">${m.label}</option>`
  ).join('');
  const langOptions = LANGUAGES.map(
    (l) => `<option value="${l.code}">${l.label}</option>`
  ).join('');
  // rewriteTypes는 utils/constants.js에서 import한 REWRITE_TYPES 배열 사용
  const rewriteOptions = REWRITE_TYPES.map(
    (r) => `<option value="${r.id}">${r.label}</option>`
  ).join('');

  return `
    <div class="tb-header">
      <div class="tb-mode-btns">
        <button class="tb-mode-btn tb-mode-btn--active" data-mode="translate">
          <span class="tb-mode-icon">交</span> Translate
        </button>
        <button class="tb-mode-btn" data-mode="correct">
          <span class="tb-mode-icon">A✓</span> Correct
        </button>
      </div>
      <button class="tb-close-btn" aria-label="Close">✕</button>
    </div>

    <div class="tb-model-row">
      <select class="tb-model-select">${modelOptions}</select>
    </div>

    <div class="tb-guest-banner" style="display:none"></div>

    <div class="tb-section tb-section--top">
      <div class="tb-section-bar">
        <span class="tb-lang-badge">🌐 Auto-detect</span>
      </div>
      <div class="tb-text-box">
        <textarea class="tb-original" placeholder="Selected text appears here..." rows="4"></textarea>
      </div>
    </div>

    <div class="tb-divider"></div>

    <div class="tb-section tb-section--bottom">
      <div class="tb-section-bar">
        <!-- TRANSLATE 모드: target lang select -->
        <select class="tb-target-lang-select tb-translate-only">${langOptions}</select>
        <!-- CORRECT 모드: rewrite style select -->
        <select class="tb-rewrite-select tb-correct-only" style="display:none">${rewriteOptions}</select>
      </div>
      <div class="tb-text-box">
        <div class="tb-result-wrap">
          <div class="tb-spinner"></div>
          <div class="tb-result"></div>
        </div>
      </div>
      <!-- CORRECT 모드 한정: 커스텀 프롬프트 입력 -->
      <div class="tb-custom-prompt-wrap tb-correct-only" style="display:none">
        <textarea class="tb-custom-prompt" placeholder="Custom instruction (optional)..." rows="2"></textarea>
      </div>
    </div>

    <div class="tb-footer">
      <button class="tb-retry-btn" aria-label="Retry">↺</button>
      <button class="tb-replace-btn" disabled>Apply <kbd>⌘↵</kbd></button>
    </div>
  `;
}
```

---

## 4. 모드 전환 로직 변경

모드가 바뀔 때 `translate-only` / `correct-only` 요소를 토글한다.

```javascript
_switchMode(mode) {
  const isCorrect = mode === 'correct';
  this.el.querySelectorAll('.tb-translate-only').forEach(el => {
    el.style.display = isCorrect ? 'none' : '';
  });
  this.el.querySelectorAll('.tb-correct-only').forEach(el => {
    el.style.display = isCorrect ? '' : 'none';
  });
}
```

`_bindEvents` 내 모드 버튼 클릭 핸들러에서 `this._switchMode(btn.dataset.mode)` 호출.  
`_populateSelects` 에서도 초기 모드에 맞게 `this._switchMode(settings.mode)` 호출.

---

## 5. REWRITE_TYPES 데이터 구조 (utils/constants.js에 추가)

`textBoi_desktop/public/rewriteTypes.json`을 기반으로, 익스텐션에서 사용할 데이터를 constants.js에 추가.  
로케일은 `chrome.i18n.getUILanguage()` 또는 `navigator.language` 로 결정.

```javascript
// utils/constants.js에 추가
export const REWRITE_TYPES = [
  {
    id: 'proofread',
    label: '🔍 Proofread',
    labelKo: '🔍 교정',
    prompt: 'Please proofread the following text. Correct grammar, spelling, and punctuation errors.',
  },
  {
    id: 'improve',
    label: '🛠️ Improve',
    labelKo: '🛠️ 개선',
    prompt: 'Improve the fluency and clarity of the following sentence. Make it sound more natural while preserving its meaning.',
  },
  {
    id: 'elaborate',
    label: '📚 Elaborate',
    labelKo: '📚 상세화',
    prompt: 'Elaborate on the following sentence by adding relevant details or context. Expand the content without deviating from the original intent.',
  },
  {
    id: 'clarify',
    label: '💡 Clarify',
    labelKo: '💡 명확화',
    prompt: 'Clarify the following sentence. Rewrite it to remove ambiguity and ensure the meaning is easy to understand.',
  },
  {
    id: 'paraphrase',
    label: '✏️ Paraphrase',
    labelKo: '✏️ 바꾸어쓰기',
    prompt: 'Paraphrase the following sentence. Express the same meaning using different wording and structure.',
  },
  {
    id: 'summarize',
    label: '📄 Summarize',
    labelKo: '📄 요약',
    prompt: 'Summarize the following text by extracting and presenting only its main idea in a brief form.',
  },
];
```

**rewritePrompt 결정 로직**: `_bindEvents`에서 `.tb-rewrite-select` change 시:
1. 선택된 REWRITE_TYPE의 `prompt` 사용
2. `.tb-custom-prompt` 에 값이 있으면 custom prompt 우선 (`settings.rewritePrompt = customVal`)
3. `saveSettings({ rewritePrompt: prompt })` 호출

---

## 6. CSS 스타일 변경 요약 (content/styles.css)

### 추가/변경할 규칙

```css
/* ── Model row ── */
.tb-model-row {
  padding: 6px 12px;
  border-bottom: 1px solid var(--tb-border);
  background: var(--tb-bg);
}
.tb-model-select {
  width: 100%;
  background: var(--tb-surface);
  border: 1px solid var(--tb-border-input);
  color: var(--tb-text-primary);
  border-radius: 8px;
  padding: 5px 8px;
  font-size: 12px;
  cursor: pointer;
}

/* ── Source lang badge ── */
.tb-lang-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--tb-text-muted);
  background: var(--tb-surface);
  border: 1px solid var(--tb-border);
  border-radius: 6px;
  padding: 2px 8px;
}

/* ── Target lang select (translate mode) ── */
.tb-target-lang-select {
  background: var(--tb-surface);
  border: 1px solid var(--tb-border-input);
  color: var(--tb-text-primary);
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  max-width: 160px;
}

/* ── Rewrite style select (correct mode) ── */
.tb-rewrite-select {
  background: var(--tb-surface);
  border: 1px solid var(--tb-border-input);
  color: var(--tb-text-primary);
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  max-width: 200px;
}

/* ── Custom prompt ── */
.tb-custom-prompt-wrap {
  padding: 6px 12px 0;
}
.tb-custom-prompt {
  width: 100%;
  box-sizing: border-box;
  background: var(--tb-surface);
  border: 1px solid var(--tb-border-input);
  border-radius: 8px;
  color: var(--tb-text-primary);
  font-size: 12px;
  padding: 6px 8px;
  resize: none;
}
.tb-custom-prompt::placeholder { color: var(--tb-text-placeholder); }

/* ── Mode buttons ── */
.tb-mode-btn {
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--tb-border);
  background: var(--tb-surface);
  color: var(--tb-text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 0 10px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.tb-mode-btn--active {
  background: var(--tb-mode-active-bg);
  color: var(--tb-mode-active-text);
  border-color: var(--tb-mode-active-border);
}

/* ── Apply button ── */
.tb-replace-btn {
  background: var(--tb-btn-action-bg);
  color: var(--tb-btn-action-fg);
  border: none;
  border-radius: 8px;
  padding: 0 16px;
  height: 34px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.tb-replace-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.tb-replace-btn:not(:disabled):hover { opacity: 0.8; }
```

### 제거할 규칙

- `.tb-lang-select` (기존 상단 target lang select — 하단으로 이동 후 삭제)
- `.tb-model-select` 기존 위치의 하단 배치 스타일

---

## 7. `_populateSelects` 변경

```javascript
_populateSelects(settings) {
  const targetLangSel = this.el.querySelector('.tb-target-lang-select');
  const modelSel = this.el.querySelector('.tb-model-select');
  const rewriteSel = this.el.querySelector('.tb-rewrite-select');
  const customPrompt = this.el.querySelector('.tb-custom-prompt');

  if (targetLangSel) targetLangSel.value = settings.targetLang;
  if (modelSel) modelSel.value = settings.model;
  if (rewriteSel) {
    // settings.rewritePrompt에 해당하는 REWRITE_TYPES 찾기
    const matched = REWRITE_TYPES.find(r => r.prompt === settings.rewritePrompt);
    rewriteSel.value = matched?.id || 'proofread';
  }

  // 모드 버튼 active 상태
  this.el.querySelectorAll('.tb-mode-btn').forEach((btn) => {
    btn.classList.toggle('tb-mode-btn--active', btn.dataset.mode === settings.mode);
  });

  // 모드에 따른 translate-only / correct-only 표시
  this._switchMode(settings.mode);
}
```

---

## 8. 기본 target language 결정 (사용자 로케일)

`getSettings()` 에서 `targetLang`이 없으면 `navigator.language`를 기반으로 기본값 설정.  
`utils/storage.js`의 `getSettings()`에 다음 로직 추가:

```javascript
// storage.js getSettings() 내부
if (!settings.targetLang) {
  // navigator.language → LANGUAGES 배열에서 가장 근접한 코드 찾기
  const locale = navigator.language || 'en-US';
  const match = LANGUAGES.find(l => l.code === locale)
    || LANGUAGES.find(l => l.code.startsWith(locale.split('-')[0]))
    || LANGUAGES.find(l => l.code === 'en-US');
  settings.targetLang = match.code;
}
```

---

## 9. 구현 순서 (체크리스트)

- [ ] `utils/constants.js` — `REWRITE_TYPES` 배열 추가
- [ ] `utils/storage.js` — `getSettings()` 기본 targetLang 로케일 기반 결정
- [ ] `content/content.js` — `SidePanel._buildHTML()` 새 구조로 교체
- [ ] `content/content.js` — `SidePanel._switchMode()` 메서드 추가
- [ ] `content/content.js` — `SidePanel._populateSelects()` 업데이트
- [ ] `content/content.js` — `SidePanel._bindEvents()` 업데이트
  - 모드 버튼: `_switchMode` 호출 추가
  - `.tb-model-select` change 핸들러 (기존 모델 select 로직 유지)
  - `.tb-target-lang-select` change 핸들러 (기존 lang select 로직 유지, selector명 변경)
  - `.tb-rewrite-select` change 핸들러 (REWRITE_TYPES에서 prompt 찾아 saveSettings)
  - `.tb-custom-prompt` input 핸들러 (값이 있으면 custom prompt 우선 적용)
- [ ] `content/styles.css` — 디자인 토큰 CSS 변수 블록 추가
- [ ] `content/styles.css` — 새 컴포넌트 스타일 추가, 기존 구식 스타일 정리
- [ ] `npm run build` 후 익스텐션 리로드하여 동작 확인
  - [ ] Translate 모드: target lang select 표시, rewrite select 숨김
  - [ ] Correct 모드: rewrite select 표시, custom prompt 표시, target lang 숨김
  - [ ] 모드 전환 시 UI 즉시 교체 + 재실행
  - [ ] 다크 모드 (OS 설정) 색상 정상 적용

---

## 10. 주의사항

- `tb-lang-select` → `tb-target-lang-select`로 rename할 때 `_bindEvents`의 querySelector도 함께 변경
- Correct 모드에서 rewrite prompt는 `REWRITE_TYPES[선택].prompt`를 기본으로 사용하고, `tb-custom-prompt`가 비어있지 않으면 그 값을 override
- `_rerun()` 에서도 `.tb-custom-prompt?.value` 를 읽어 `rewritePrompt` 필드에 반영해야 함
- MiniPopover (Docs용) 는 이번 리디자인 범위에서 제외 — 현재 구조 유지
