# 변경 로그

프로젝트의 주요 변경 사항 및 개선 사항을 기록합니다.

## 2026년 4월

### 주간 문서 현행화 기준 변경점 반영
**날짜:** 2026-04-27

**문서 반영 대상 변경:**
- 벌크 번역 요청에서 동일 텍스트 중복 전송 제거: 동일 캐시 키를 가진 항목은 하나의 AI 요청으로 병합되어 불필요한 API 호출을 줄이고 번역 결과를 모든 중복 인덱스에 동시 적용
- upstream 소스 언어가 `korean`인 경우 파일명의 기존 `___` 접두사를 제거하고 새 `___` 접두사를 붙여 이중 접두사 문제(`______`)를 방지하는 `buildKoreanTargetFileName` 유틸리티 도입
- 모드 positional 인자(`pnpm <game> <mod>`)로 번역 실행 시 upstream 업데이트 범위를 해당 모드로만 제한하여 불필요한 전체 upstream 갱신을 방지

**관련 파일:**
- `scripts/utils/translate.ts`
- `scripts/utils/localization-file-name.ts` (신규)
- `scripts/factory/translate.ts`
- `scripts/utils/dictionary-invalidator.ts`
- `scripts/utils/retranslation-invalidator.ts`
- `scripts/utils/upstream.ts`
- `scripts/utils/mod-filter.ts`
- `scripts/ck3.ts`
- `scripts/vic3.ts`
- `scripts/stellaris.ts`

---

### 주간 문서 현행화 기준 변경점 반영
**날짜:** 2026-04-20

**문서 반영 대상 변경:**
- YAML 파서와 번역 sanitize가 U+200E(Left-to-Right Mark) 문자를 제거해 localization 키/값 오염을 방지
- 번역 sanitize가 닫는 변수 마커 뒤의 `$[` 패턴에 공백을 보정해 잘못된 변수 구문 출력을 줄임
- `meta.toml`의 `upstream.transliteration_files`로 파일명/와일드카드 기반 수동 음역 모드 지정 지원
- `transliteration_files` 변경 시 영향받는 한국어 파일 해시만 무효화하는 워크플로우와 CLI 명령(`*:retransliteration`) 추가

**관련 파일:**
- `scripts/parser/yaml.ts`
- `scripts/utils/translate.ts`
- `scripts/utils/prompts.ts`
- `scripts/utils/transliteration-files-changes.ts`
- `scripts/utils/transliteration-files-invalidator.ts`
- `.github/workflows/invalidate-on-transliteration-files-change.yml`
- `scripts/ck3.ts`
- `scripts/vic3.ts`
- `scripts/stellaris.ts`
- `package.json`

---

### 주간 문서 현행화 기준 변경점 반영
**날짜:** 2026-04-13

**문서 반영 대상 변경:**
- 번역 워크플로우가 `GITHUB_TOKEN`으로 GitHub API 인증을 사용하도록 조정되어 레이트 리밋 영향을 완화
- `github` 버전 전략이 최신 공개 릴리스만 추적하고 프리릴리즈/드래프트는 제외
- 업스트림 대시보드의 `default` 전략이 기본 브랜치 전체 대신 `upstream.localization` 경로 기반 최신 커밋을 비교
- 업스트림 대시보드 완료 후 이슈 자동 갱신 흐름과 annotated 태그 비교 안정성 보강
- GitHub Actions composite action 런타임을 Node.js 24로 올리고 로컬 shared 패키지 해석을 위해 `NODE_OPTIONS=--preserve-symlinks` 적용

**관련 파일:**
- `.github/workflows/translate-ck3.yml`
- `.github/workflows/translate-vic3.yml`
- `.github/workflows/translate-stellaris.yml`
- `.github/actions/create-untranslated-issues/action.yml`
- `.github/actions/close-translation-issues/action.yml`
- `scripts/upstream-dashboard.ts`
- `scripts/utils/upstream.ts`

---

## 2026년 1월

### GitHub Actions 공유 패키지 생성
**날짜:** 2026-01-02

**추가:**
- `@pat-actions/shared` npm 패키지 생성으로 GitHub Actions 코드 중복 제거
- 로컬 npm 패키지로 구현 (`file:` 프로토콜 사용)
- 공유 패키지 구조:
  - `github-retry.cjs`: GitHub API 재시도 로직 (기존 코드 통합)
  - `index.js`: 패키지 엔트리 포인트
  - `package.json`: 패키지 메타데이터
  - `README.md`: 사용 문서

**개선:**
- Node.js 모듈 해석 문제 해결
- GitHub Actions에서 안정적인 모듈 import
- 코드 유지보수성 향상
- 재사용 가능한 유틸리티 구조

**영향:**
- `create-untranslated-issues` 액션: 공유 패키지 사용으로 전환
- `close-translation-issues` 액션: 공유 패키지 사용으로 전환

**관련 파일:**
- `.github/actions/shared/` (신규 디렉토리)
- `.github/actions/shared/github-retry.cjs` (이동)
- `.github/actions/shared/package.json` (신규)
- `.github/actions/shared/README.md` (신규)
- `.github/actions/create-untranslated-issues/package.json` (수정)
- `.github/actions/close-translation-issues/package.json` (수정)

**기술적 세부사항:**
- 로컬 npm 패키지는 `npm ci` 실행 시 자동으로 설치됨
- 공유 패키지 변경 시 모든 의존 액션에 자동 반영
- 버전 관리 불필요 (로컬 파일 참조)

---

## 2025년 12월

### GitHub Actions 재시도 로직 추가
**날짜:** 2025-12-21

**추가:**
- GitHub API 호출 실패 시 자동 재시도 로직 구현
- 403 (Forbidden), 429 (Rate Limit), 5xx 서버 오류 자동 재시도
- 점진적 백오프 전략: [1초, 2초, 8초, 10초, 60초]
- `Retry-After` 헤더 존중

**적용 범위:**
- `create-untranslated-issues` 액션의 3개 API 호출
- `close-translation-issues` 액션의 2개 API 호출

**효과:**
- GitHub API rate limit 시 워크플로우 실패 방지
- 번역 거부 이슈 등록 안정성 향상
- 임시 네트워크 오류 자동 복구

**관련 파일:**
- `.github/actions/github-retry.cjs` (신규)
- `.github/actions/create-untranslated-issues/index.js`
- `.github/actions/close-translation-issues/index.js`

---

### YAML 파서 최적화 및 버그 수정
**날짜:** 2025-12-18

**수정:**
- 불필요한 재번역을 유발하는 YAML 파서 버그 수정
- Paradox 형식 후행 텍스트(trailing text) 처리 개선
- 대문자 포맷팅 태그(`#!`) 지원 추가

**영향:**
- 변경되지 않은 항목의 재번역 방지
- 번역 속도 향상
- 게임 형식 지원 강화

**관련 파일:**
- `scripts/parser/yaml.ts`
- `prompts/ck3-translation.md`
- `prompts/vic3-translation.md`
- `prompts/stellaris-translation.md`

---

### 번역 거부 처리 개선
**날짜:** 2025-12-18

**개선:**
- Stale `untranslated-items.json` 파일로 인한 이슈 닫기 실패 방지
- 번역 거부 항목 중복 제거 로직 추가
- 이슈 자동 닫기 정확도 향상

**효과:**
- 번역이 완료된 항목의 이슈가 정확히 닫힘
- 중복 이슈 생성 방지
- 이슈 관리 효율성 향상

**관련 파일:**
- `scripts/factory/translate.ts`
- `scripts/factory/translate.test.ts`

---

### GitHub MCP 서버 도구 우선순위 가이드라인 추가
**날짜:** 2025-12-17

**추가:**
- AGENTS.md에 GitHub MCP 서버 도구 사용 가이드라인 추가
- Git 명령어 대신 GitHub MCP 서버 도구 우선 사용 지침
- 도구 사용 예제 및 패턴 추가

**배경:**
- AI 에이전트가 GitHub 작업 시 MCP 서버 도구를 우선 사용하도록 유도
- 구조화된 출력과 에러 처리를 통한 안정성 향상

**관련 파일:**
- `AGENTS.md`

---

### 버전 전략 기능 추가
**날짜:** 2025-12-21

**추가:**
- meta.toml 파일에서 `version_strategy` 필드 지원
- 세 가지 버전 선택 전략 구현:
  - `semantic`: GitHub API + semver 정렬 (v1.2.3 형식)
  - `natural`: git ls-remote + 자연 정렬 (1.10.0 > 1.2.0)
  - `default`: 기존 방식 (기본 브랜치 사용)
- VersionStrategyError 클래스 및 GitHub Issues 자동 보고 기능
- @octokit/rest, semver, natsort 의존성 추가

**기능:**
- 모드별 버전 선택 방식 제어
- 잘못된 설정 시 자동 GitHub Issues 생성
- dungsil에게 자동 할당 및 configuration-error 레이블

**설정 예:**
```toml
[upstream]
url = "https://github.com/modder/Mod.git"
localization = ["Mod/localization/english"]
language = "english"
version_strategy = "semantic"  # 새 필드
```

**적용된 모드:**
- CK3: semantic (RICE, VIET, CFP, ETC)
- VIC3: natural (Better Politics, Community Mod Framework, Tech & Res 등)
- Stellaris: semantic (Pouchkinn's Gigastructures)

**관련 파일:**
- `scripts/utils/upstream.ts` - 핵심 로직 재구현
- `scripts/utils/version-strategy-reporter.ts` - 오류 보고 (신규)
- `package.json` - 의존성 추가
- 모든 `meta.toml` 파일 - version_strategy 필드 추가
- `docs/configuration.md` - 설정 설명
- `docs/architecture.md` - 아키텍처 설명
- `docs/usage.md` - 사용법 설명
- `docs/requirements.md` - 요구사항 추가

**테스트:**
- version-strategy.test.ts 추가 (여러 테스트 케이스)

---

### 번역 캐시 시스템 개선
**날짜:** 2025-12-08

**변경:**
- 번역 캐시 키에서 `github.run_id` 제거
- 워크플로우 실행마다 캐시가 무효화되는 문제 해결
- 동일한 캐시를 여러 실행 간 공유하여 번역 효율성 향상

**영향:**
- 번역 속도 개선
- API 호출 횟수 감소
- 캐시 재사용성 증가

**관련 파일:**
- `.github/workflows/translate-ck3.yml`
- `.github/workflows/translate-vic3.yml`
- `.github/workflows/translate-stellaris.yml`

---

### Git Corruption 문제 수정
**날짜:** 2025-12-07

**문제:**
- Self-hosted runner에서 `git fetch --unshallow` 실행 시 Git corruption 발생
- 불완전한 객체로 인한 워크플로우 실패

**해결:**
- `fetch-depth: 0`으로 전체 히스토리를 처음부터 가져오도록 변경
- `unshallow` 작업 제거로 corruption 위험 제거
- `clean: true` 옵션으로 깨끗한 체크아웃 보장

**관련 파일:**
- `.github/workflows/translate-ck3.yml`
- `.github/workflows/translate-vic3.yml`
- `.github/workflows/translate-stellaris.yml`
- `.github/workflows/invalidate-on-dictionary-update.yml`

---

### 단어사전 업데이트 시 번역 무효화 로직 재구현
**날짜:** 2025-12-05

**개선:**
- 단어사전 커밋 기반 필터링 로직 전면 재작성
- `--since-commit` 옵션이 해당 커밋의 변경사항만 정확히 추출하도록 수정
- Git log 파싱 로직 개선으로 정확도 향상

**변경사항:**
- 커밋 범위 계산 방식 개선
- 단어사전 섹션 감지 로직 강화
- 추출된 키의 정확성 향상

**관련 파일:**
- `scripts/utils/dictionary-changes.ts`
- `scripts/utils/dictionary-invalidator.ts`

---

### 번역 거부 추적 버그 수정
**날짜:** 2025-12-04

**문제:**
- 여러 모드 처리 시 `processes` 배열 스코프 문제로 번역 거부 추적 실패
- 모드별로 독립적인 프로세스 배열이 필요했으나 공유되는 문제

**해결:**
- 각 모드별로 독립적인 `processes` 배열 생성
- 번역 거부 항목이 올바르게 수집되도록 수정

**관련 파일:**
- `scripts/factory/translate.ts`

---

### 번역 거부 항목 추적 개선
**날짜:** 2025-12-04

**개선:**
- `untranslatedItems`에 번역 거부 항목 추적 기능 추가
- 번역 거부 발생 시 해당 항목이 올바르게 기록되도록 수정

**관련 파일:**
- `scripts/factory/translate.ts`

---

### 번역 거부 항목 자동 GitHub Issues 등록
**날짜:** 2025-12-03

**추가:**
- AI가 번역을 거부한 항목을 자동으로 GitHub Issues로 생성
- 모드별로 그룹화하여 이슈 생성
- `translation-refused` 및 게임별 레이블 자동 태깅
- 기존 열린 이슈가 있으면 코멘트로 추가
- 긴 메시지는 접을 수 있는 details 섹션으로 표시

**기능:**
- 번역 거부 항목 자동 감지
- JSON 형식으로 `{game}-untranslated-items.json`에 저장
- GitHub Issues 자동 생성 및 업데이트

**관련 파일:**
- `.github/workflows/translate-ck3.yml`
- `.github/workflows/translate-vic3.yml`
- `.github/workflows/translate-stellaris.yml`

---

### `--since-commit` 옵션 수정
**날짜:** 2025-12-02

**변경:**
- `--since-commit` 옵션이 해당 커밋만 확인하도록 수정
- 이전에는 커밋 이후의 모든 변경사항을 포함했으나, 특정 커밋만 확인하도록 개선

**관련 파일:**
- `scripts/utils/dictionary-changes.ts`

---

### 번역 거부 시 중간 저장 및 Graceful Exit
**날짜:** 2025-12-01

**추가:**
- AI가 번역을 거부할 때 처리된 항목까지 저장
- Graceful exit 처리로 부분 완료 상태 보존
- `TranslationRefusalStopError` 에러 클래스 추가

**기능:**
- 번역 거부 발생 시 이미 처리된 번역 결과 저장
- 에러 발생 지점과 사유 기록
- 다음 실행 시 중단된 지점부터 재개 가능

**관련 파일:**
- `scripts/factory/translate.ts`
- `scripts/utils/translate.ts`

---

### 검증 시스템 False Positive 수정
**날짜:** 2025-12-01 ~ 2025-12-02

**문제:**
- 완전한 변수에 인접한 리터럴 텍스트를 잘못 감지
- 변수 구분자 형식(괄호 타입) 변환을 false positive로 감지

**해결:**
- 리터럴 텍스트 감지 로직 개선
- 프롬프트에 변수 구분자 형식 변환 방지 규칙 추가

**관련 파일:**
- `scripts/utils/translation-validator.ts`
- `scripts/utils/prompts.ts`

---

### 단어사전 업데이트 워크플로우 개선
**날짜:** 2025-12-01

**개선:**
- `invalidate-on-dictionary-update` 워크플로우가 변경된 단어만 무효화
- `--since-commit ${{ github.sha }}` 옵션 사용으로 정확한 필터링
- 불필요한 재번역 최소화

**관련 파일:**
- `.github/workflows/invalidate-on-dictionary-update.yml`

---

### 주간 문서 자동화 워크플로우
**날짜:** 2025-12-01

**추가:**
- 매주 월요일 문서 현행화 요청 이슈 자동 생성
- 지난 7일간 변경사항 자동 수집
- `[skip ci]` 커밋 자동 제외
- 커밋 메시지의 특수문자로 인한 구문 오류 수정

**워크플로우:**
- `.github/workflows/weekly-docs-update.yml`

---

### "요청하신 대로" 검증 False Positive 수정
**날짜:** 2025-12-01

**문제:**
- "As requested" 번역인 "요청하신 대로"를 LLM 응답으로 오인

**해결:**
- 검증 패턴에서 "요청하신 대로" 제외

**관련 파일:**
- `scripts/utils/translation-validator.ts`

---

### 단어사전 업데이트
**날짜:** 2025-12-02 ~ 2025-12-07

**추가된 항목:**
- `hmu` (Hausa) 번역 추가
- `hkwi` (Hehe) 번역 추가
- `ult` (Ultimate) 번역 추가
- `yatim` 번역 추가
- 소문자 변형 항목 추가

**관련 파일:**
- `scripts/utils/dictionary.ts`

---

### 검증 시스템 대폭 개선
**날짜:** 2025-11-25 ~ 2025-12-01

**문제:**
- 복잡한 게임 변수 패턴 감지 부족
- 섹션 기호(§) 색상 코드 + 변수 조합 미지원
- 변수만으로 구성된 텍스트 잘못된 수정

**해결:**
- `§X$variable$§!` 패턴 지원
- 섹션 기호 색상 코드 + 파운드 변수 조합 지원: `§H£energy£`, `§BA£variable£`
- 변수만으로 구성된 텍스트 감지 개선으로 AI 수정 방지

**관련 파일:**
- `scripts/utils/translation-validator.ts`

---

### Upstream 업데이트 도구 필터링 기능
**날짜:** 2025-11-24

**추가:**
- 게임별 필터링: `pnpm upstream ck3`
- 모드별 필터링: `pnpm upstream ck3 RICE`
- 도움말 옵션: `pnpm upstream --help`

**사용 예:**
```bash
pnpm upstream ck3              # CK3 게임만
pnpm upstream ck3 RICE         # CK3의 RICE 모드만
pnpm upstream vic3 "Better Politics Mod"  # VIC3의 특정 모드만 (공백이 있으면 따옴표 사용)
```

**관련 파일:**
- `scripts/utils/upstream.ts`
- `scripts/upstream.ts`

---

### 단어사전 커밋 기반 필터링
**날짜:** 2025-11-24

**추가:**
- `--since-commit` 옵션: 특정 커밋 이후 변경된 키만 무효화
- `--commit-range` 옵션: 커밋 범위 내 변경된 키만 무효화
- `--since-date` 옵션: 특정 날짜 이후 변경된 키만 무효화

**사용 예:**
```bash
pnpm ck3:update-dict -- --since-commit HEAD~3
pnpm ck3:update-dict -- --commit-range abc123..def456
pnpm ck3:update-dict -- --since-date "2024-01-01"
```

**관련 파일:**
- `scripts/utils/dictionary-changes.ts` (새 파일)
- `scripts/utils/cli-args.ts` (새 파일)
- `scripts/utils/dictionary-invalidator.ts`

**문서 업데이트:**
- [사전 관리](dictionary.md)
- AGENTS.md

---

### CK3 단어사전 구조 개선
**날짜:** 2025-11-23

**변경:**
- 단어사전을 용어집(glossary)과 고유명사(proper nouns)로 분리
- 번역 메모리에는 용어집만 포함 (LLM 컨텍스트 최적화)
- 고유명사는 직접 매칭에만 사용

**구조:**
```typescript
const ck3Glossary = { ... }      // 번역 메모리에 포함
const ck3ProperNouns = { ... }   // 직접 매칭에만 사용
```

**관련 파일:**
- `scripts/utils/dictionary.ts`

---

### 대괄호 불균형 검증
**날짜:** 2025-11-22

**문제:**
- AI가 게임 변수의 닫는 `]`를 제거하는 오류 미감지
- 예: `[variable]` → `[variable`

**해결:**
- 번역 결과의 `[` 와 `]` 개수 비교 검증 추가
- 불균형 감지 시 재번역 트리거

**관련 파일:**
- `scripts/utils/translation-validator.ts`

---

### SQLite 안정성 개선
**날짜:** 2025-11-20 ~ 2025-11-22

**문제:**
- `SQLITE_IOERR_FSYNC` 오류 발생
- CI 환경에서 간헐적 I/O 오류

**해결:**
- `PRAGMA synchronous=NORMAL` 설정
- 지수 백오프를 사용한 재시도 로직 추가
- I/O 오류 시 디스크 사용률 표시

**관련 파일:**
- `scripts/utils/cache.ts`
- `scripts/utils/disk-usage.ts` (새 파일)

---

### Git 태그 정렬 개선
**날짜:** 2025-11-19 ~ 2025-11-21

**문제:**
- 알파벳 순 정렬로 잘못된 태그 선택 (예: v1.9 > v1.10)
- Sparse checkout에서 버전 태그 미적용

**해결:**
- GitHub Releases API 사용 및 git ls-remote 폴백으로 최신 태그 감지
- GitHub Releases API를 통한 시맨틱 버전 감지
- Shallow clone에서 버전 태그 존중

**관련 파일:**
- `scripts/utils/upstream.ts`

---

## 2025년 11월

### Upstream 관리 최적화
**날짜:** 2025-11-19

**문제:**
- 대용량 upstream 리포지토리 클론 시 디스크 공간 부족 문제 발생
- CI/CD 환경에서 빌드 실패

**해결:**
- `git clone`에 `--depth=1` 옵션 추가
- Shallow clone으로 전체 히스토리 다운로드 방지
- 기존 shallow clone 업데이트 시 자동 `--unshallow` 처리

**영향:**
- 디스크 사용량 최대 90% 감소
- CI/CD 빌드 시간 단축
- 더 안정적인 upstream 동기화

**관련 파일:**
- `scripts/utils/upstream.ts`
- `scripts/utils/upstream.test.ts` (새 파일)

**문서 업데이트:**
- [아키텍처](architecture.md) - Upstream Management 섹션

---

### 번역되지 않은 항목 추적
**날짜:** 2025-11-10

**문제:**
- AI가 일부 항목을 번역하지 않고 원문 그대로 반환하는 경우 감지 어려움
- 번역 품질 모니터링 필요

**해결:**
- `processLanguageFile()` 함수가 `UntranslatedItem[]` 반환하도록 변경
- 번역 스크립트 완료 시 번역되지 않은 항목 자동 로깅
- 파일명, 키, 원문 메시지 출력

**영향:**
- 번역 품질 모니터링 개선
- 디버깅 용이성 향상
- 공유 가변 상태 제거로 동시성 문제 방지

**관련 파일:**
- `scripts/factory/translate.ts`
- `scripts/factory/translate.test.ts`

**문서 업데이트:**
- [아키텍처](architecture.md) - Translation Factory 섹션

---

### 검증 시스템 개선
**날짜:** 2025-11-09

**문제:**
- 게임 변수 내 문자열 리터럴에 포함된 달러 변수를 잘못 감지
- `[Concatenate('$gold$', other)]` 같은 유효한 패턴이 False Positive로 감지됨
- Concept 변수 사용 시 불필요한 재번역 발생

**해결:**
- 문자열 리터럴 감지 헬퍼 함수 추가 (`isInsideStringLiteral`)
- 잘못된 변수 패턴 감지 시 문자열 리터럴 내부 제외
- 11개 포괄적 테스트 케이스 추가 (총 208개 테스트)

**영향:**
- False Positive 대폭 감소
- Concept 변수 정확도 향상
- 더 정확한 번역 품질 검증

**관련 파일:**
- `scripts/utils/translation-validator.ts`
- `scripts/utils/translation-validator.test.ts`

**문서 업데이트:**
- [검증 시스템](validation.md) - 잘못된 변수 구문 감지 섹션

---

## 2025년 10월

### 문서 체계 구축
**날짜:** 2025-10-13

**추가된 문서:**
- 총 22개의 종합 문서 파일 (9,500+ 줄)
- 핵심 문서: 개요, 아키텍처, 사용 가이드, 설정 가이드
- 기술 문서: 번역 파이프라인, API 레퍼런스, 캐싱, 검증, 사전
- 고급 문서: 개발 가이드, 요구사항, 재구현 가이드
- 이슈 해결: 크래시 분석, 검증 오탐 수정, 검증 결과

**특징:**
- 한국어 문서
- 4가지 학습 경로 제공
- 180+ 코드 예제
- 15+ 다이어그램

---

### 검증 오탐 수정 (2025-10 이전)
**문제:**
- 완전한 변수 뒤에 텍스트가 바로 붙는 경우 오류로 잘못 감지
- 예: `$gold$12 세기`를 `$12`를 잘못된 변수로 감지

**해결:**
- 변수 검증 로직 개선
- 완전한 변수와 후속 텍스트 구분

**관련 문서:**
- [검증 오탐 상세](fix-validation-false-positive.md)
- [수정 요약](summary-fix.md)

---

### CK3 RICE 모드 크래시 수정 (2025-10 이전)
**문제:**
- 214개의 잘못된 변수 패턴 (`$[`) 발견
- 게임 크래시 발생

**해결:**
- 잘못된 패턴 자동 감지 및 수정
- 검증 시스템 강화

**관련 문서:**
- [크래시 분석](crash-analysis.md)
- [크래시 수정](crash-fix-readme.md)
- [검증 결과](verification-results.md)

---

## 문서 규칙

이 변경 로그는 다음 형식을 따릅니다:

```markdown
### 기능/수정 제목 (PR 번호)
**날짜:** YYYY-MM-DD

**문제:**
- 발생한 문제 설명

**해결:**
- 적용한 해결 방법

**영향:**
- 변경으로 인한 영향

**관련 파일:**
- 변경된 파일 목록

**문서 업데이트:**
- 업데이트된 문서 링크
```

---

## 추가 정보

변경 사항에 대한 자세한 내용은 각 문서를 참조하세요.
