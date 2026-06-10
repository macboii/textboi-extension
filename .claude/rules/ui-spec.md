# UI 정의서 — TextBoi Chrome Extension SidePanel

데스크탑 앱(`textBoi_desktop/`) 스크린샷 기준 UI 명세.  
구현 시 이 문서를 최우선 참조한다.

---

## 1. 전체 레이아웃 (확정)

```
┌─────────────────────────────────────────────┐
│  [● Model Name ▾]                    [✕]   │  ← .tb-model-row
├─────────────────────────────────────────────┤
│  [交 번역하기]  [A 문장교정]                │  ← .tb-header
├─────────────────────────────────────────────┤
│  [English (English) ▾]                      │  ← .tb-source-lang-btn  (TRANSLATE)
│  [English-US (English-US) ▾]               │    (CORRECT도 동일 — 감지된 언어 표시)
│  ┌───────────────────────────────────────┐  │
│  │ 여기에 입력 후 Enter, 또는 아래 ...    │  │  ← .tb-original
│  │                         0 / 10,000 ⬇ │  │    (token counter + submit btn)
│  └───────────────────────────────────────┘  │
├─────────────────────────────────────────────┤
│  [Korean (한국어) ▾]          ← TRANSLATE   │  ← .tb-target-lang-btn
│  [🔧 개선 ▾]                 ← CORRECT     │    .tb-rewrite-btn
│  ┌───────────────────────────────────────┐  │
│  │ (AI 결과 or 빈 상태 가이드)            │  │  ← .tb-result
│  └───────────────────────────────────────┘  │
├─────────────────────────────────────────────┤
│                          [적용  ⌘↵]        │  ← .tb-footer
└─────────────────────────────────────────────┘
```

---

## 2. 컴포넌트별 상세 명세

### 2-1. Model Row (`.tb-model-row`)

| 요소 | 설명 |
|------|------|
| 색 점 `.tb-model-dot` | 모델 티어별 색상: ⚡️노랑 `#FFD60A` / 🟢초록 `#30D158` / 🔵파랑 `#0A84FF` / 🟣보라 `#BF5AF2` |
| 모델명 `.tb-model-select` | 현재 모델 레이블 표시. native `<select>` |
| 닫기 `.tb-close-btn` | 우측 끝. `✕` 문자. 호버 시 배경 `#3A3A3C` |

**데스크탑 앱 참고**: 모델 이름 왼쪽에 색 점, 오른쪽에 `▾`, 우측 끝에 유저 아바타+이름+플랜. 익스텐션은 아바타 대신 닫기 버튼.

---

### 2-2. Mode Row (`.tb-header`)

| 상태 | 스타일 |
|------|--------|
| 활성 (active) | 파랑 배경 `#1C3557`, 파랑 텍스트 `#82B1FF`, 파랑 테두리 `#0A84FF` 2px |
| 비활성 | 어두운 배경 `#2C2C2E`, 회색 텍스트 `#AEAEB2`, 회색 테두리 `#48484A` |

버튼: `height: 36px`, `padding: 0 16px`, `border-radius: 10px`, `font-weight: 600`

---

### 2-3. Source Language Button (`.tb-source-lang-btn`) — **미구현**

현재: `🌐 Auto-detect` 텍스트 뱃지  
목표: 클릭 가능한 드롭다운 버튼

```
[English (English) ▾]
```

- 감지된 소스 언어를 표시 (기본값: "Auto-detect")
- 클릭 시 언어 선택 드롭다운 표시
- 드롭다운 내부:
  - 🔍 검색바 ("언어 검색" placeholder)
  - 🕐 최근 사용 항목 (최대 3개)
  - 전체 언어 목록 (알파벳순)
- `iso_639_1_full_languages.json` 참고 (textBoi_desktop)

---

### 2-4. Input Textarea (`.tb-original`)

- placeholder: `"여기에 입력 후 Enter, 또는 아래 가이드를 따라 시작하세요"` (데스크탑 앱 기준)
- 현재 익스텐션: `"Selected text appears here..."`
- 하단 우측: 토큰 카운터 `0 / 10,000` + 제출 버튼 `⬇` — **미구현**
- Enter 키: 제출 (Shift+Enter: 줄바꿈)

---

### 2-5. Target Language Button (`.tb-target-lang-btn`) — **미구현 (현재 native `<select>`)**

TRANSLATE 모드에서 표시. 현재 `<select>` → 목표: 커스텀 드롭다운 버튼

```
[Korean (한국어) ▾]
```

드롭다운 내부 (source lang와 동일 구조):
- 검색바 + 최근 사용 + 전체 목록

---

### 2-6. Rewrite Style Button (`.tb-rewrite-btn`) — **미구현 (현재 native `<select>`)**

CORRECT 모드에서 표시. 현재 `<select>` → 목표: 커스텀 드롭다운

```
[🔧 개선 ▾]
```

드롭다운 내부:
- 검색바 + 커스텀 프롬프트 입력: `"검색 또는 사용자 지정 프롬프트 입력 + Enter"`
- 항목마다 **아이콘 + 레이블 + 설명 한 줄**:

| ID | 아이콘 | 레이블(ko) | 설명(ko) |
|----|--------|-----------|---------|
| proofread | ⚙️ | 교정 | 문법과 맞춤법을 교정합니다. |
| improve | 🔧 | 개선 | 자연스럽게 문장을 다듬습니다. |
| elaborate | 📚 | 상세화 | 내용을 더 자세히 설명합니다. |
| clarify | 💡 | 명확화 | 의미가 더 명확하게 전달되도록 합니다. |
| paraphrase | ✏️ | 바꾸어쓰기 | 같은 의미를 다른 단어와 문장 구조로 바꿉니다. |
| summarize | 📄 | 요약 | 핵심 내용을 간단히 요약합니다. |

데이터 출처: `textBoi_desktop/public/rewriteTypes.json`

---

### 2-7. Result Area (`.tb-result`)

**빈 상태 (empty state)** — 단축키 가이드 표시:

```
[Cmd] [C+C]   텍스트를 선택한 후 두 번 연속 복사하여 불러오기
[Cmd] [↑] [C] 영역을 드래그하여 텍스트 추출 (OCR)  ← 데스크탑 전용, 익스텐션 미표시
[Cmd] [↵]     결과를 원래 앱에 바로 적용
```

현재 익스텐션 구현: Cmd+C+C, Cmd+↵ 두 가지만 표시 (OCR은 익스텐션 미지원이므로 제외)

**스트리밍 중**: 빈 상태 가이드 제거, 텍스트 실시간 표시  
**완료**: Replace 버튼 활성화, 스피너 제거

---

### 2-8. Footer (`.tb-footer`)

| 요소 | 설명 |
|------|------|
| 재시도 `.tb-retry-btn` | `↺` 버튼, 좌측 |
| Apply `.tb-replace-btn` | `"Apply ⌘↵"`, 우측. 완료 전: disabled (회색). 완료 후: 흰 배경/검정 텍스트 |

데스크탑 앱은 `"적용 ⌘+↵"` 텍스트를 우측 정렬 버튼으로 표시. 익스텐션은 동일 패턴.

---

## 3. 색상 토큰 (다크 모드 기준)

| 토큰 | 값 | 용도 |
|------|----|------|
| 패널 배경 | `#1C1C1E` | 전체 배경 |
| 서페이스 | `#2C2C2E` | 텍스트박스, 버튼 배경 |
| 서페이스 딥 | `#232325` | 텍스트박스 어두운 배경 |
| 테두리 | `rgba(255,255,255,0.09~0.10)` | 섹션 구분 |
| 구분선 | `rgba(255,255,255,0.07)` | divider |
| 텍스트 주요 | `#F2F2F7` | 결과 텍스트 |
| 텍스트 보조 | `#AEAEB2` | 원본 텍스트, 셀렉트 레이블 |
| 텍스트 흐림 | `#8E8E93` | placeholder, 뱃지 |
| 텍스트 매우흐림 | `#636366` | 빈 상태 설명 |
| 액센트 | `#0A84FF` | 활성 모드 테두리 |
| 액센트 배경 | `#1C3557` | 활성 모드 버튼 배경 |
| 액센트 텍스트 | `#82B1FF` | 활성 모드 버튼 텍스트 |
| 에러 | `#FF453A` | 에러 메시지 |

---

## 4. 구현 상태 체크리스트

### 완료 ✅
- [x] Model row: 색 점 + 모델 select + 닫기 버튼
- [x] Mode row: Translate / Correct 버튼 (활성/비활성 스타일)
- [x] 빈 상태 단축키 가이드 (C+C, ⌘↵)
- [x] Source lang: 커스텀 드롭다운 버튼 `.tb-source-lang-btn` (검색 + 전체 목록)
- [x] Target lang: 커스텀 드롭다운 버튼 `.tb-target-lang-btn` (검색 + 전체 목록)
- [x] Rewrite style: 커스텀 드롭다운 버튼 `.tb-rewrite-btn` (검색 + 설명 + 커스텀 프롬프트 + Enter)
- [x] Result 스트리밍 + 스피너 + Apply 버튼 활성화
- [x] 버블: 선택 끝에 아이콘 표시, 클릭 시 패널 열기 (AI 자동 실행 없음)
- [x] 이중복사(C+C): 패널 열기 + AI 자동 실행
- [x] 모든 환경(Web/Gmail/Docs/Sheets) SidePanel 통일

### 완료 ✅ (추가)
- [x] 토큰 카운터 (`.tb-char-count`) — `0 / 10,000` 형식, 9,000자 초과 시 주황색 경고
- [x] 제출 버튼 (`.tb-submit-btn`, `⬇`) — 텍스트박스 하단 우측, 클릭 시 `_rerun()` 호출
- [x] Clear 버튼 (`.tb-clear-btn`, `✕`) — 상단 textarea + 하단 result 동시 초기화

### 완료 ✅ (추가2)
- [x] Correct (proofread/improve) 결과: diff 하이라이트 + 💡 설명 팝업
  - `generateDiffHtml(original, corrected)` — diff-match-patch, 단어/문자 단위, 문장별 그룹
  - `.diff-removed` (취소선 빨강), `.diff-added` (초록), `.idea-icon` (💡) 아이콘
  - 💡 클릭 → `ExplainPopup` — `EXPLAIN_DIFF` 메시지 → background json_schema 응답 (비로그인 시 "Sign in required" 표시)
  - `_resultCache` 패턴 — 버블 재클릭 시 결과 재요청 없이 복원
  - 커스텀 rewrite 프롬프트 — 드롭다운에 입력+Enter → `tb_custom_rewrites` 저장 (최대 5개) → 다음 열 때 "Custom" 섹션 표시. 각 항목 호버 시 `✕` 삭제 버튼 노출 → 클릭 시 즉시 제거 + 드롭다운 목록 갱신 (닫히지 않음). 현재 선택 항목 삭제 시 기본값(`proofread`)으로 자동 복원.
  - 버블 지속 — 패널 닫혀도 동일 텍스트 선택 유지 시 버블 복원 (`_lastBubbleState`)

### 미구현 / 개선 여지 🟡
(없음 — 이전 항목 모두 구현 완료)

### 데스크탑 전용 (익스텐션 제외) ⚪
- OCR 캡처 (Cmd+Shift+C) — 스크린샷 접근 권한 없음
- 유저 아바타/플랜 표시 — 팝업에서 처리

---

## 5. 커스텀 드롭다운 구현 가이드

언어/교정 스타일 드롭다운은 native `<select>` 대신 커스텀 레이어로 구현:

```
[Button: "English (English) ▾"]  ← .tb-lang-trigger
  ↓ click
[Overlay .tb-dropdown-panel]
  [Search input]
  [Recent section: 🕐 항목들]
  [All languages list: 스크롤 가능]
```

**주의사항**:
- 패널 외부 클릭 시 닫힘 (document mousedown capture)
- Esc 키로 닫힘
- 드롭다운은 패널 내부에 `position: absolute`로 표시 (패널 밖으로 overflow 안 됨)
- 최근 항목은 `chrome.storage.local`에 최대 3개 저장

언어 데이터: `textBoi_desktop/public/iso_639_1_full_languages.json` 참고
