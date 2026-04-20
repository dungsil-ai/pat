# 사용 가이드

## 설치

### 필수 요구사항

- **Node.js**: v24 권장 (`.node-version` 기준 24.11.1, 최소 v18)
- **pnpm**: 10.24.0 이상 (권장)
- **Git**: 최신 버전
- **Google AI API 키**: Gemini API 액세스

### 1. 저장소 클론

```bash
git clone https://github.com/dungsil/paradox-auto-translate.git
cd paradox-auto-translate
```

### 2. 의존성 설치

```bash
pnpm install
```

### 3. 환경 변수 설정

`.env` 파일을 생성하고 API 키와 실행 옵션을 설정합니다:

```bash
cp .env.sample .env
```

`.env` 파일 편집:

```env
GOOGLE_AI_STUDIO_TOKEN=your_api_key_here
# (선택) 구 Gemini 키 폴백
GOOGLE_GENERATIVE_AI_API_KEY=legacy_key
# (선택) GitHub API 인증/레이트 리밋 완화
GITHUB_TOKEN=github_pat_xxx

# 실행 옵션
LOG_LEVEL=info
TRANSLATE_BATCH_SIZE=10
TRANSLATION_TIMEOUT_MINUTES=15
TRANSLATE_MOD_CONCURRENCY=4
GEMINI_MODEL=gemini-flash-lite-latest
```

**API 키 발급:**
1. [Google AI Studio](https://aistudio.google.com/app/apikey) 방문
2. "Create API Key" 클릭
3. 생성된 키를 복사하여 `.env`에 붙여넣기

**환경 변수 설명:**
- `GOOGLE_AI_STUDIO_TOKEN`: ai-sdk.dev가 사용하는 기본 Gemini API 키 (필수)
- `GOOGLE_GENERATIVE_AI_API_KEY`: (선택) 기존 Gemini SDK 키, 존재하면 폴백 경로에서 사용
- `GITHUB_TOKEN`: (선택) GitHub API 인증용 토큰. 업스트림 대시보드 및 GitHub 기반 버전 조회의 레이트 리밋 완화에 유용
- `TRANSLATE_BATCH_SIZE`: 벌크 번역 시 한 번에 요청할 항목 수 (기본 20)
- `TRANSLATION_TIMEOUT_MINUTES`: 번역 타임아웃(분). `false` 또는 `0`이면 비활성화
- `TRANSLATE_MOD_CONCURRENCY`: 모드 단위 병렬 처리 동시성. 미설정 시 모드 개수만큼 자동 설정
- `GEMINI_MODEL`: 사용할 Gemini 모델 ID. 미설정 시 코드 기본값(`gemini-flash-lite-latest`) 사용
- `LOG_LEVEL`: 로그 레벨 (`info`, `debug` 등)

## 기본 사용법

### Crusader Kings III 번역

```bash
# 전체 번역 실행
pnpm ck3

# 해시만 업데이트 (번역 없이)
pnpm ck3:update-hash

# 사전 기반 번역 무효화
pnpm ck3:update-dict

# 잘못된 번역 재번역
pnpm ck3:retranslate

# transliteration_files 변경에 따른 음역 대상 파일 재무효화
pnpm ck3:retransliteration -- --since-commit=HEAD
```

### Victoria 3 번역

```bash
# 전체 번역 실행
pnpm vic3

# 해시만 업데이트
pnpm vic3:update-hash

# 사전 기반 번역 무효화
pnpm vic3:update-dict

# 잘못된 번역 재번역
pnpm vic3:retranslate

# transliteration_files 변경에 따른 음역 대상 파일 재무효화
pnpm vic3:retransliteration -- --since-commit=HEAD
```

### Stellaris 번역

```bash
# 전체 번역 실행
pnpm stellaris

# 해시만 업데이트
pnpm stellaris:update-hash

# 사전 기반 번역 무효화
pnpm stellaris:update-dict

# 잘못된 번역 재번역
pnpm stellaris:retranslate

# transliteration_files 변경에 따른 음역 대상 파일 재무효화
pnpm stellaris:retransliteration -- --since-commit=HEAD
```

### Upstream 업데이트

모든 게임의 upstream 저장소를 업데이트합니다:

```bash
pnpm upstream
```

### 버전 전략 설정

`meta.toml` 파일에서 `version_strategy` 필드를 사용하여 각 모드의 버전 선택 방식을 제어할 수 있습니다.

#### 사용 가능한 버전 전략

**1. semantic (시멘틱 버전)**
- GitHub API를 사용하여 시멘틱 버전 태그를 정렬
- `v1.2.3`, `v2.0.0` 같은 버전 형식에 적합
- CK3 모드에 권장

**2. natural (자연 정렬)**
- Git ls-remote를 사용하여 자연 정렬로 브랜치/태그 정렬
- `1.10.0 > 1.2.0`처럼 숫자 크기에 따라 정렬
- VIC3 모드에 권장

**3. github (GitHub 릴리스)**
- GitHub Releases API에서 최신 릴리스 태그를 그대로 사용
- 릴리스 기준으로 배포되는 모드에 적합
- 태그 형식이 제각각이어도 최신 릴리스만 필요할 때 유용

**4. default (기본)**
- 기존 방식대로 기본 브랜치 사용
- 가장 간단하고 안정적인 방식

#### 설정 예제

```toml
[upstream]
url = "https://github.com/modder/NewMod.git"
localization = ["NewMod/localization/english"]
language = "english"
version_strategy = "semantic"  # 버전 전략 지정
```

#### 권장 설정

| 게임 | 권장 버전 전략 | 이유 |
|------|----------------|------|
| CK3 | `semantic` | 대부분의 모드가 시멘틱 버전 태그 사용 |
| VIC3 | `natural` | 복잡한 버전 번호 체계에 더 유연하게 대응 |
| Stellaris | `semantic` | 주요 모드들이 표준 버전 태그 사용 |
| GitHub 릴리스 배포 모드 | `github` | 릴리스 기준 배포 시 최신 릴리스만 받으면 충분 |

#### 버전 전략별 특징

**semantic:**
- ✅ 정확한 버전 순서 보장
- ✅ GitHub API 사용으로 안정적
- ❌ GitHub 저장소만 지원
- ❌ API 레이트 리밋 가능성

**natural:**
- ✅ 모든 Git 저장소 지원
- ✅ 복잡한 버전 번호 처리
- ❌ ls-remote 신뢰성 문제 가능성
- ❌ 정렬 방식에 따라 다른 결과

**github:**
- ✅ 릴리스 페이지의 최신 태그를 그대로 사용
- ✅ 프리릴리즈/드래프트를 자동 제외해 안정적인 공개 릴리스 기준 추적
- ✅ 태그 규칙이 들쭉날쭉해도 최신 릴리스만 필요할 때 단순함
- ❌ GitHub 저장소만 지원
- ❌ 릴리스가 없는 저장소는 실패

**default:**
- ✅ 가장 간단하고 신뢰성 높음
- ✅ 모든 저장소 타입 지원
- ✅ 업스트림 대시보드에서는 `upstream.localization` 경로에 영향을 준 최신 커밋만 비교
- ❌ 항상 최신 버전을 선택하지는 않음

#### 오류 처리

잘못된 `version_strategy` 값이 설정된 경우:
- GitHub Issues에 자동으로 오류 보고
- `dungsil`에게 할당
- `configuration-error` 레이블 추가

오류 수정 후 다음 실행 시 정상 작동합니다.

## 자동화 워크플로우

### 단어사전 자동 무효화

**트리거 조건:**
- `scripts/utils/dictionary.ts` 파일이 `main` 브랜치에 push될 때

**자동 실행 작업:**
1. CK3 번역 무효화 및 재번역
2. Stellaris 번역 무효화 및 재번역
3. VIC3 번역 무효화 및 재번역
4. 변경사항 자동 커밋

**워크플로우 파일:**
```
.github/workflows/invalidate-on-dictionary-update.yml
```

**사용 예:**
```bash
# 1. dictionary.ts 수정
vim scripts/utils/dictionary.ts

# 2. 커밋 및 푸시
git add scripts/utils/dictionary.ts
git commit -m "feat: Add new terms to dictionary"
git push origin main

# 3. GitHub Actions가 자동으로:
#    - 모든 게임의 번역 무효화
#    - 재번역 실행
#    - 결과 커밋 및 푸시
```

**동시 실행 방지:**
- 모든 번역 워크플로우는 `translation` concurrency group 사용
- 사전 무효화 워크플로우와 일반 번역 워크플로우가 동시에 실행되지 않음
- 순차적 실행으로 데이터베이스 및 파일 충돌 방지

### 업스트림 번역 미반영 대시보드

업스트림 저장소 변경분이 번역에 반영되지 않은 모드를 자동으로 모니터링합니다.

- 워크플로우: `.github/workflows/upstream-translation-dashboard.yml`
  - 12시간마다 스케줄 실행 + 수동 `workflow_dispatch` 지원
  - `pnpm exec jiti scripts/upstream-dashboard.ts > upstream-dashboard.md` 로 대시보드 본문 생성 (`GITHUB_TOKEN`이 있으면 GitHub API/GraphQL 인증에 사용)
- 결과: 제목 `[대시보드] 업스트림 변경 대비 번역 미반영 현황`, 라벨 `upstream-dashboard` 인 오픈 이슈를 생성/업데이트
- 표 컬럼: 게임/모드, 추적 기준(`version_strategy`), tag/commit 추적 방식, 번역 기준 버전, 최신 버전, 상태(미반영/최신/번역 이력 없음/조회 실패) — compare 링크는 `번역 기준 버전`/`최신 버전` 텍스트에 포함
- annotated 태그도 커밋까지 추적하여 최신 태그 비교 정확도를 높임
- `github` 전략은 공개 릴리스만 비교하며 프리릴리즈/드래프트는 제외
- `default` 전략은 기본 브랜치 HEAD 전체가 아니라 `upstream.localization` 경로들에 영향을 준 최신 커밋으로 비교합니다. 경로가 `["."]`이면 저장소 전체 커밋을 사용합니다.

### 음역 대상 파일 변경 자동 무효화

`meta.toml`의 `upstream.transliteration_files`가 바뀌면 영향을 받는 번역 파일만 골라 해시를 비워 다음 번역 때 다시 처리되도록 합니다.

- 워크플로우: `.github/workflows/invalidate-on-transliteration-files-change.yml`
- 트리거: `main` 브랜치에 `**/meta.toml` 변경 push 또는 수동 `workflow_dispatch`
- 실행 순서:
  1. `pnpm upstream`
  2. `pnpm {game}:retransliteration -- --since-commit=<sha>`
  3. 변경된 한국어 파일 자동 커밋
- 각 게임 명령은 추가/제거된 `transliteration_files` 패턴과 매칭되는 `___*_l_korean.yml` 파일의 해시만 `null`로 바꿉니다.

## 명령어 설명

### 번역 명령 (`pnpm ck3`, `pnpm vic3`, `pnpm stellaris`)

**동작:**
1. Upstream 저장소를 최신 버전으로 업데이트
2. 각 모드의 `meta.toml` 파일을 읽어 설정 로드
3. 영어 localization 파일 파싱
4. 변경된 항목만 번역 (해시 비교)
5. 한국어 파일 생성 (`___*_l_korean.yml`)

**출력 위치:**
```
게임디렉토리/모드명/mod/localization/korean/
```

**진행 상황:**
- 실시간 로그 출력
- 번역된 항목 수 표시
- 캐시 히트율 표시

### 해시 업데이트 (`pnpm ck3:update-hash`)

**용도:**
- 소스 파일 변경 사항을 추적하되 번역은 수행하지 않음
- 대량 업데이트 전 변경 사항 확인

**동작:**
1. 소스 파일의 새 해시 계산
2. 타겟 파일의 해시만 업데이트
3. 번역 텍스트는 그대로 유지

**사용 예:**
```bash
# 변경 사항 확인
pnpm ck3:update-hash

# 출력 예시
[RICE/events.yml:event_1] 해시 업데이트: old_hash -> new_hash
[RICE/events.yml:event_2] 해시 일치 (변경 없음)
```

### 사전 무효화 (`pnpm ck3:update-dict`)

**용도:**
- `scripts/utils/dictionary.ts`의 사전이 업데이트된 경우
- 사전에 있는 단어가 포함된 모든 번역을 재번역

**동작:**
1. 사전의 모든 키 추출
2. 번역 파일에서 해당 키를 포함한 항목 검색
3. 발견된 항목의 캐시 무효화
4. 해시를 `null`로 설정하여 재번역 트리거

**사용 시나리오:**
```typescript
// dictionary.ts 업데이트 전
'duke': '공작'

// 번역 결과: "The duke arrives" -> "공작이 도착합니다"

// dictionary.ts 업데이트 후
'duke': '대공'

// pnpm ck3:update-dict 실행
// 다음 번역 시: "The duke arrives" -> "대공이 도착합니다"
```

### 재번역 (`pnpm ck3:retranslate`)

**용도:**
- 잘못 번역된 항목 자동 감지 및 재번역
- 번역 품질 개선

**검증 규칙:**
- 게임 변수 누락/손상
- 변수 내부 한글 포함
- 기술 식별자 번역
- 불필요한 LLM 응답
- 잘못된 변수 구문

**동작:**
1. 모든 번역 파일 스캔
2. 각 항목에 대해 검증 수행
3. 잘못된 번역의 캐시 무효화
4. 해시를 `null`로 설정

**출력 예:**
```
[RICE/events.yml:event_1] 검증 실패: 누락된 게임 변수: [GetTitle]
[RICE/events.yml:event_2] 검증 실패: 변수 내부 한글 포함: [Get제목]
총 2개 항목 무효화됨
```

### 음역 대상 파일 재무효화 (`pnpm ck3:retransliteration`)

**용도:**
- `meta.toml`의 `transliteration_files` 목록이 바뀐 경우
- 음역/번역 모드가 바뀐 파일만 선택적으로 다시 처리하고 싶은 경우

**동작:**
1. 지정한 커밋의 `meta.toml` diff에서 `transliteration_files` 추가/제거 항목 추출
2. 영향받는 한국어 localization 파일 탐색
3. 기존 번역 항목의 해시를 `null`로 설정
4. 다음 `pnpm ck3` 실행 시 해당 파일만 재번역/재음역

**사용 예:**
```bash
pnpm ck3:retransliteration -- --since-commit=HEAD
pnpm ck3
```

## 워크플로우 예제

### 새 모드 추가 및 번역

```bash
# 1. 모드 디렉토리 생성
mkdir -p ck3/NewMod

# 2. meta.toml 작성
cat > ck3/NewMod/meta.toml << EOF
[upstream]
url = "https://github.com/modder/NewMod.git"
localization = ["NewMod/localization/english"]
language = "english"
version_strategy = "semantic"
EOF

# 3. 번역 실행
pnpm ck3

# 4. 결과 확인
ls ck3/NewMod/mod/localization/korean/
```

### 모드 업데이트 후 번역 갱신

```bash
# 1. Upstream 업데이트 (자동으로 수행되지만 수동 실행 가능)
pnpm upstream

# 2. 변경된 항목만 재번역
pnpm ck3

# 변경되지 않은 항목은 캐시에서 자동으로 로드됨
```

### 사전 추가 및 적용

### 자동 적용 (권장)

```bash
# 1. dictionary.ts 편집
code scripts/utils/dictionary.ts

# 예: 'baron': '남작' 추가

# 2. 변경사항 커밋 및 푸시
git add scripts/utils/dictionary.ts
git commit -m "feat: Add baron translation"
git push origin main
```

**자동화 프로세스:**
- GitHub Actions가 자동으로 실행됨
- 사전 기반 번역 무효화 (`update-dict`)
- 재번역 실행 (`retranslate`)
- 결과 커밋 및 푸시

**워크플로우 파일:**
- `.github/workflows/invalidate-on-dictionary-update.yml`
- `dictionary.ts` 변경 감지 시 자동 실행
- 모든 게임(CK3, Stellaris, VIC3) 자동 처리

### 수동 적용 (로컬 테스트)

```bash
# 1. dictionary.ts 편집
code scripts/utils/dictionary.ts

# 2. 수동으로 무효화 및 재번역
pnpm ck3:update-dict
pnpm ck3

# 'baron'이 포함된 모든 항목이 새로운 번역으로 갱신됨
```

### 번역 품질 개선

```bash
# 1. 잘못된 번역 감지
pnpm ck3:retranslate

# 출력에서 무효화된 항목 확인

# 2. 재번역 실행
pnpm ck3

# 무효화된 항목만 재번역됨
```

### 대량 업데이트 처리

```bash
# 1. 모든 upstream 업데이트
pnpm upstream

# 2. 해시만 업데이트하여 변경 사항 확인
pnpm ck3:update-hash
pnpm vic3:update-hash
pnpm stellaris:update-hash

# 로그에서 "해시 업데이트" 메시지 확인

# 3. 실제 번역 수행
pnpm ck3
pnpm vic3
pnpm stellaris
```

## 출력 파일 형식

### 파일명 규칙

원본 파일명에 `___` 접두사가 붙습니다:

```
원본: RICE/localization/english/event_l_english.yml
번역: RICE/localization/korean/___event_l_korean.yml
```

**접두사 이유:**
- 게임이 파일을 알파벳 순으로 로드하므로 `___`로 시작하면 가장 나중에 로드됨
- 나중에 로드된 파일이 이전 파일의 번역을 덮어쓰므로 최종 번역이 적용됨

### 파일 내용 형식

```yaml
l_korean:
  event_key_1: "번역된 텍스트" # abc123hash
  event_key_2: "또 다른 번역" # def456hash
```

**구조:**
- BOM (UTF-8): `\uFEFF`
- 언어 키: `l_korean:`
- 들여쓰기: 2칸
- 주석: 해시 값 (변경 감지용)

## 디렉토리 구조

### 게임 디렉토리 구조

```
ck3/
├── RICE/
│   ├── meta.toml                    # 모드 설정
│   ├── upstream/                    # 원본 영어 파일 (자동 다운로드)
│   │   └── RICE/localization/english/
│   │       └── *_l_english.yml
│   └── mod/                         # 생성된 한국어 파일
│       └── localization/korean/
│           └── ___*_l_korean.yml
├── VIET/
│   ├── meta.toml
│   ├── upstream/
│   └── mod/
└── ...
```

**주의:**
- `upstream/` 디렉토리는 Git에 커밋되지 않음 (`.gitignore`)
- `mod/` 디렉토리는 Git에 커밋됨 (번역 결과)

### 캐시 파일

```
translate-cache.db          # SQLite 데이터베이스
translate-cache.db-shm      # 공유 메모리 파일
translate-cache.db-wal      # Write-Ahead Log
```

**관리:**
- 자동 생성됨
- 삭제하면 모든 번역이 재수행됨 (비권장)
- 정기적인 백업 권장

## 로그 해석

### 로그 레벨

```bash
[DEBUG] 상세 디버깅 정보
[INFO]  일반 정보
[START] 작업 시작
[SUCCESS] 작업 완료
[WARN]  경고
[ERROR] 에러
```

### 일반적인 로그 메시지

#### 번역 진행 중

```
[START] [RICE] 작업 시작 (원본 파일 경로: ck3/RICE)
[DEBUG] [RICE] 메타데이터: upstream.language: english, upstream.localization: [...]
[VERBOSE] [RICE/events.yml:event_1] 원본파일 문자열: abc123 | "The duke arrives"
[VERBOSE] [RICE/events.yml:event_1] 번역파일 문자열: abc123 | "공작이 도착합니다" (번역됨)
```

#### 캐시 히트

```
[VERBOSE] 캐시에서 번역 로드: abc123
```

#### 사전 사용

```
[DEBUG] 사전에서 번역: "duke" -> "공작"
```

#### AI 번역

```
[INFO] AI 번역 요청: "The duke arrives"
[SUCCESS] AI 번역 완료: "공작이 도착합니다"
```

#### 번역 거부 (2025-12 추가)

```
[WARN] [RICE/events_l_english.yml:event.1.desc] 번역 거부됨: SAFETY
[WARN] [RICE] 번역 거부로 인해 번역 중단됨
[INFO] 번역 거부: 처리된 작업(50/100)까지 저장하고 종료합니다
[INFO] 거부 사유: SAFETY
```

**의미:**
- AI가 안전성 필터나 콘텐츠 정책으로 인해 번역 거부
- 처리된 항목까지는 저장됨 (중간 저장)
- `{game}-untranslated-items.json` 파일에 거부 항목 기록
- GitHub Actions에서 자동으로 Issues 생성

**확인:**
```bash
# 번역 거부 리포트 확인
cat ck3-untranslated-items.json
cat vic3-untranslated-items.json
cat stellaris-untranslated-items.json

# GitHub Issues 확인
# `translation-refused` 레이블로 필터링
```

**해결:**
1. GitHub Issues에서 거부된 항목 확인
2. `scripts/utils/dictionary.ts`에 수동 번역 추가
3. `pnpm {game}:retranslate` 실행

#### 해시 업데이트

```
[DEBUG] [RICE/events.yml:event_1] 해시 업데이트: old_hash -> new_hash
```

### 에러 메시지

#### API 키 누락

```
[ERROR] GOOGLE_AI_STUDIO_TOKEN 환경 변수가 설정되지 않았습니다
```

**해결:** `.env` 파일에 API 키 설정

#### Upstream 다운로드 실패

```
[ERROR] Git clone 실패: fatal: repository not found
```

**해결:** `meta.toml`의 URL 확인

#### 파일 파싱 오류

```
[ERROR] YAML 파싱 실패: Unexpected token
```

**해결:** 소스 파일 형식 확인

## 모범 사례

### 1. 정기적인 업데이트

```bash
# 주간 업데이트 스크립트
#!/bin/bash
pnpm upstream
pnpm ck3
pnpm vic3
pnpm stellaris
```

### 2. 사전 관리

- 자주 사용되는 용어는 사전에 추가
- 일관성 있는 번역 유지
- 게임 커뮤니티의 표준 용어 반영

### 3. 번역 검증

```bash
# 번역 후 검증
pnpm ck3
pnpm ck3:retranslate  # 문제 있는 번역 찾기
pnpm ck3              # 재번역
```

### 4. 백업

```bash
# 캐시 백업
cp translate-cache.db translate-cache.db.backup

# 번역 결과 백업
tar -czf translations-$(date +%Y%m%d).tar.gz ck3/*/mod vic3/*/mod stellaris/*/mod
```

### 5. 점진적 번역

대량의 새 모드를 추가할 때:

```bash
# 단계별 접근
pnpm ck3:update-hash  # 1. 변경 사항 확인
# 로그 검토
pnpm ck3              # 2. 실제 번역
```

## 문제 해결

일반적인 문제와 해결 방법은 [트러블슈팅](troubleshooting.md) 문서를 참조하세요.

## 다음 단계

- [설정 가이드](configuration.md) - `meta.toml` 상세 설정
- [개발 가이드](development.md) - 코드 수정 및 기여
- [API 레퍼런스](api-reference.md) - 함수 및 모듈 문서

---

**팁:** 처음 실행 시 모든 항목이 번역되므로 시간이 오래 걸릴 수 있습니다. 이후 실행은 변경된 항목만 번역하므로 훨씬 빠릅니다.
