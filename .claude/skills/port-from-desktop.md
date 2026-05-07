# port-from-desktop

`textBoi_desktop/` 소스를 Chrome 익스텐션용 JS로 포팅할 때 사용하는 가이드.

## 포팅 규칙

### TypeScript → JavaScript 변환

```typescript
// 제거 대상: 타입 주석
function foo(text: string): string { ... }
→ function foo(text) { ... }

// 제거 대상: interface, type, import type
interface Foo { bar: string }
→ (삭제)

// 제거 대상: TS assertion
const el = document.getElementById('x') as HTMLElement;
→ const el = document.getElementById('x');

// 제거 대상: require에서 타입 단언
const franc = require('franc') as (text: string) => string;
→ import { franc } from 'franc';  // ESM으로 전환
```

### Electron 의존성 제거

| Desktop 코드 | Extension 대체 |
|-------------|---------------|
| `window.electronAPI.xxx()` (IPC) | `chrome.runtime.sendMessage` |
| `electron-store` | `chrome.storage.local` |
| `supabase.auth.getSession()` | `chrome.storage.local.get('tb_access_token')` |
| `process.env.XXX` | `utils/constants.js` 상수 |
| `ipcMain.handle(...)` | `chrome.runtime.onMessage.addListener(...)` |
| `app.getPath('userData')` | `chrome.storage.local` |

### franc 사용 방식 변경

Desktop: `require('franc')` (CommonJS)  
Extension: `import { franc } from 'franc'` (ESM, esbuild 번들)

### 텍스트 정제 함수 포팅 예시

```typescript
// desktop/src/api/textCleanup.ts
export function applyGlobalTextCleanup(text: string): string { ... }
```

```javascript
// extension/utils/textCleanup.js
export function applyTextCleanup(text) { ... } // 이름 단순화
```

함수 이름을 `applyTextCleanup`으로 줄이되, 내부 로직은 동일하게 유지.

### diffRenderer 포팅 시 주의사항

desktop/src/renderer/diffRenderer.ts의 의존성:
- `DiffMatchPatch`: npm 패키지 → esbuild 번들에 포함
- `getModel()` import → 제거 (extension에서는 settings에서 가져옴)
- `t('key')` (i18n) → 한국어 하드코딩 또는 별도 i18n 모듈로 대체
- `_isGuestMode` flag → chrome.storage에서 로그인 상태 확인으로 대체

### ISO 언어 코드 테이블 (langData.js)

desktop/src/api/openai.ts의 `ISO3_TO_ISO1` 테이블을 그대로 복사하여  
`utils/langData.js`에 별도 파일로 분리:

```javascript
// utils/langData.js
export const ISO3_TO_ISO1 = {
  aar: 'aa', abk: 'ab', // ... (desktop에서 복사)
};
```

## 포팅 후 검증 체크리스트

- [ ] TypeScript 타입 제거 완료
- [ ] `window.electronAPI` 참조 없음
- [ ] `require()` 없음 (ESM import만 사용)
- [ ] `process.env` 참조 없음
- [ ] `console.error` 유지 (디버깅용 로그는 유지)
- [ ] `console.log` 개발 전용은 제거 또는 주석 처리
- [ ] esbuild 번들 후 동작 확인
