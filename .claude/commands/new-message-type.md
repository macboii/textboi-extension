# /new-message-type

content.js ↔ background.js 간 새 메시지 타입을 추가할 때 사용.

## 사용법

```
/new-message-type <TYPE_NAME>
```

예: `/new-message-type SAVE_HISTORY`

## 추가해야 할 파일 (순서대로)

### 1. CLAUDE.md — 메시지 타입 테이블에 추가

CLAUDE.md의 "메시지 타입" 섹션에 새 타입 행 추가.

### 2. 발신 측 (content → bg 또는 bg → content)

**content → background**:
```javascript
// content.js
chrome.runtime.sendMessage({
  type: 'NEW_TYPE',
  // payload 필드들
});
```

**background → content** (탭 지정):
```javascript
// background.js
chrome.tabs.sendMessage(tabId, {
  type: 'NEW_TYPE',
  // payload 필드들
});
```

### 3. 수신 측 핸들러

**background.js에서 수신**:
```javascript
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'NEW_TYPE') {
    const tabId = sender.tab.id;
    // 처리 로직
    return true; // 비동기 응답 시 필수
  }
});
```

**content.js에서 수신**:
```javascript
// 기존 switch 문에 case 추가
case 'NEW_TYPE':
  handleNewType(msg.payload);
  break;
```

## 규칙 요약

- 타입명: `UPPER_SNAKE_CASE`
- content → bg: `chrome.runtime.sendMessage`
- bg → content: `chrome.tabs.sendMessage(tabId, ...)`
- 비동기 응답이 필요한 핸들러에서 `return true` 필수 (MV3 service worker)
- 새 타입이 API 호출을 유발하면 `handleProcessText` 패턴 참고 (background.js)
