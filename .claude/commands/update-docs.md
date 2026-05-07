---
name: update-docs
description: 작업 세션에서 변경된 내용을 분석하고 CLAUDE.md와 .claude 문서를 업데이트합니다
allowed-tools: Bash(git *), Read, Edit, Write, Glob, Grep
---

# update-docs

작업 세션의 변경 내용을 분석하고 `.claude/` 문서를 최신 상태로 유지합니다.

> **중요**: 전체 파일을 다시 쓰지 않는다. 변경된 부분만 정확히 수정한다.

## 실행 순서

### 1. 변경 파일 파악

```bash
git diff HEAD~1 --name-only
git diff HEAD~1 --stat
git log -3 --oneline
```

현재 스테이징되지 않은 변경도 확인:
```bash
git status
git diff
```

### 2. 변경 유형 분류

아래 기준으로 각 변경 파일을 분류한다:

| 변경 유형 | 업데이트 대상 |
|-----------|--------------|
| 메시지 타입 추가/변경 (`PROCESS_TEXT`, `STREAM_CHUNK` 등) | `.claude/rules/architecture.md` 메시지 타입 테이블 |
| 전역 상태 변수 추가/변경 (`lastSelectionRange`, `currentPanelState` 등) | `.claude/rules/architecture.md` 전역 상태 테이블 |
| 파일 역할 변경 (background.js / content.js / popup.js) | `.claude/rules/architecture.md` 파일 역할 경계 테이블 |
| 이중 복사 감지 방식 변경 | `.claude/rules/content-script-patterns.md` |
| 사이트 감지 유틸 추가/변경 (`isGoogleDocsLike`, `isGmailDomain` 등) | `.claude/rules/content-script-patterns.md` |
| 선택 텍스트 추출/Range 저장 패턴 변경 | `.claude/rules/content-script-patterns.md` |
| UI 컴포넌트 초기화 패턴 변경 (SidePanel, MiniPopover, Bubble) | `.claude/rules/content-script-patterns.md` |
| Replace 전략 변경 (Range-based / clipboard+paste) | `.claude/rules/replace-strategy.md` |
| 새 사이트 지원 추가 | `.claude/rules/replace-strategy.md` + `CLAUDE.md` 사이트별 동작 테이블 |
| 새 npm 스크립트/빌드 커맨드 추가 | `CLAUDE.md` 개발 커맨드 섹션 |
| 환경 변수 또는 `utils/constants.js` 변경 | `CLAUDE.md` 환경 설정 섹션 |
| 새 재사용 패턴 발견 (5개 이상의 규칙) | `.claude/rules/` 새 파일 생성 |
| URL/키 변경 (OPENAI_PROXY_URL 등) | `CLAUDE.md` 환경 설정 섹션 |
| 에러 처리 규칙 변경 | `.claude/rules/architecture.md` 에러 처리 규칙 |
| 보안 규칙 변경 (innerHTML 금지, eval 금지 등) | `.claude/rules/architecture.md` 보안 규칙 |

### 3. 문서 업데이트 규칙

**하지 말 것:**
- 전체 파일 재작성
- 코드 패턴/파일 구조 설명 (코드 자체에서 읽을 수 있음)
- `CLAUDE.md`에 상세 규칙 직접 작성 (→ rules 파일에 넣고 링크만 유지)
- 이미 있는 내용 중복 추가
- 임시 작업 상태나 현재 대화 맥락 저장

**해야 할 것:**
- 기존 섹션에 새 항목만 추가하거나 수정된 항목 업데이트
- 메시지 타입 테이블에 새 타입 추가 (`architecture.md`)
- 전역 상태 변수 테이블 최신화 (`architecture.md`)
- 사이트별 동작 테이블에 새 사이트 추가 (`CLAUDE.md`)
- 새 사이트 Replace 전략 추가 (`replace-strategy.md`)
- 새 빌드 커맨드는 `CLAUDE.md` 개발 커맨드 섹션에 추가

### 4. 업데이트 수행

각 대상 파일을 Read로 읽은 뒤 Edit으로 필요한 부분만 수정한다.

**새 rules 파일 생성 기준:** 동일 주제의 규칙이 5개 이상 생겼을 때만 생성.
새 파일 생성 시 `CLAUDE.md`에 링크 항목 추가:
```markdown
| [`새파일`](.claude/rules/new-topic.md) | 설명 |
```

### 5. 결과 출력

업데이트한 파일 목록과 각 변경 요약을 간결하게 출력한다:

```
업데이트된 파일:
- .claude/rules/architecture.md: 메시지 타입 2개 추가 (ABORT_STREAM, AUTH_CHANGED), 전역 상태 변수 1개 추가
- .claude/rules/content-script-patterns.md: Gmail iframe 선택 패턴 업데이트
- CLAUDE.md: 사이트별 동작 테이블에 Notion 추가

변경 없음 (해당 없음):
- .claude/rules/replace-strategy.md
```

변경 사항이 없으면:
```
문서 업데이트 불필요 — 변경된 내용이 기존 문서에 이미 반영되어 있거나 문서화 대상이 아닙니다.
```
