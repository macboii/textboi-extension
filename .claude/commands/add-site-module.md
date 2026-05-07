# /add-site-module

새 사이트 지원을 추가할 때 사용. 예: Notion, Slack, Linear 등.

## 사용법

```
/add-site-module <SiteName> <hostname-pattern>
```

예: `/add-site-module Notion notion.so`

## 추가 체크리스트

### 1. utils/constants.js — 호스트명 패턴 추가

```javascript
// 사이트별 감지 패턴 (필요 시 배열로 여러 도메인)
export const NOTION_HOSTS = ['notion.so', 'notion.site'];
```

### 2. content.js — 사이트 감지 함수 추가

```javascript
function isNotionSite() {
  return location.hostname.includes('notion.so')
      || location.hostname.includes('notion.site');
}
```

### 3. content.js — 사이트별 모듈 작성

```javascript
const NotionModule = {
  lastMousePos: { x: 0, y: 0 },
  
  init() {
    // Notion은 Shadow DOM 기반 — copy 이벤트 + deep selection 사용
    document.addEventListener('copy', () => {
      const text = getDeepActiveSelection() || getSelectedTextUnified();
      // 이중 복사 감지 (DoubleCopyDetector 패턴 동일)
    });
    
    document.addEventListener('mouseup', (e) => {
      this.lastMousePos = { x: e.clientX, y: e.clientY };
      // Bubble 표시
    });
  }
};
```

### 4. Replace 전략 결정 (.claude/rules/replace-strategy.md 참고)

| 사이트 유형 | 전략 |
|------------|------|
| 일반 contentEditable | `replaceSelectedTextInWeb` 재사용 |
| React/Vue 기반 | `replaceSelectedTextInWeb` + input/change 이벤트 dispatch |
| Canvas 렌더링 (Figma 등) | clipboard 방식 구현 또는 지원 불가 처리 |

### 5. Router에 분기 추가 (content.js 하단)

```javascript
if (isGoogleDocsLike()) {
  DocsModule.init();
} else if (isGmailDomain()) {
  GmailModule.init();
} else if (isNotionSite()) {        // ← 추가
  NotionModule.init();
} else {
  WebModule.init();
}
```

### 6. manifest.json host_permissions 확인

외부 API 없이 content script만 필요한 경우 `<all_urls>` 매칭이면 추가 불필요.  
사이트 전용 API 호출 필요 시 `host_permissions`에 추가.

### 7. SPEC.md 섹션 5 업데이트

"5. 사이트별 동작 명세"에 새 사이트 행 추가.

## 테스트 체크리스트

- [ ] 텍스트 선택 → 이중 복사 → UI 표시
- [ ] 번역/교정 실행 → 스트리밍 표시
- [ ] Replace → 텍스트 치환 성공
- [ ] Esc → UI 닫기
- [ ] Cmd+Enter → Replace 동작
