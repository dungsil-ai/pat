# Paradox Auto Translate

Paradox Interactive 게임 모드를 위한 자동 번역 도구입니다. Google AI Studio(Gemini)를 ai-sdk.dev 기반으로 호출해 영어 현지화 파일을 한국어로 번역합니다.

## 지원 게임

- **Crusader Kings III (CK3)**
- **Victoria 3 (VIC3)**
- **Stellaris**

## 주요 기능

- 🤖 Google AI Studio(Gemini) 기반 자동 번역 (ai-sdk.dev)
- 🎮 게임별 특화 번역 (중세 역사, 역사적 인물, 지명 등)
- 🔤 **음역 모드**: 고유명사(문화명, 왕조명, 인물명)를 발음 기반으로 음역 (예: "Afar" → "아파르")
- 📝 게임 변수 및 형식 보존
- 💾 스마트 캐싱으로 중복 번역 방지 (번역/음역 별도 캐시)
- 📚 수동 단어사전 지원 (일반 용어 + 고유명사 사전)
- ✅ 번역 검증 및 재번역 기능
- ⏱️ `.env`에 설정 가능한 번역 타임아웃 및 배치 크기
- 🧭 업스트림 파일 해시 기반으로 변경 없는 파일은 자동 스킵
- ⚙️ 모드 수를 기준으로 자동 병렬 처리(ETC 하위 upstream 폴더도 독립 모드로 계산)

## 설치

```bash
pnpm install
```

## 테스트

이 프로젝트는 Vitest를 사용하여 포괄적인 단위 테스트를 제공합니다.

```bash
# 모든 테스트 실행
pnpm test

# Watch 모드로 테스트 실행 (파일 변경 시 자동 재실행)
pnpm test:watch

# UI 모드로 테스트 실행
pnpm test:ui

# 커버리지 리포트 생성
pnpm test:coverage
```

**테스트 커버리지:**
- `scripts/utils/hashing.ts` - 해시 생성 함수
- `scripts/utils/dictionary.ts` - 단어사전 로더 (TOML 파일 읽기)
- `scripts/parser/yaml.ts` - YAML 파서
- `scripts/utils/translation-validator.ts` - 번역 검증 로직
- `scripts/utils/delay.ts` - 지연 유틸리티
- `scripts/utils/cache.ts` - 캐싱 시스템
- `scripts/utils/queue.ts` - 큐 관리 및 재시도 로직

## 사용법

### 기본 번역

```bash
# CK3 모드 번역
pnpm ck3

# Victoria 3 모드 번역
pnpm vic3

# Stellaris 모드 번역
pnpm stellaris
```

### 유틸리티 명령어

```bash
# upstream 저장소 업데이트 (소스 파일 다운로드)
pnpm upstream                  # 모든 게임의 모든 모드 업데이트
pnpm upstream ck3              # CK3 게임의 모든 모드 업데이트
pnpm upstream vic3             # VIC3 게임의 모든 모드 업데이트
pnpm upstream stellaris        # Stellaris 게임의 모든 모드 업데이트
pnpm upstream ck3 RICE         # CK3 게임의 RICE 모드만 업데이트
pnpm upstream vic3 "Better Politics Mod"  # VIC3의 Better Politics Mod만 업데이트

# upstream 명령어 도움말
pnpm upstream --help

# 파일 해시만 업데이트 (번역 없이)
pnpm ck3:update-hash
pnpm vic3:update-hash
pnpm stellaris:update-hash

# 단어사전 기반 번역 무효화 (재번역 준비)
pnpm ck3:update-dict
pnpm vic3:update-dict
pnpm stellaris:update-dict

# 단어사전 무효화 - 커밋 기반 필터링 (특정 변경사항만 무효화)
pnpm ck3:update-dict -- --since-commit HEAD~3        # 최근 3개 커밋 이후
pnpm ck3:update-dict -- --commit-range abc..def      # 커밋 범위
pnpm ck3:update-dict -- --since-date "2024-01-01"    # 날짜 이후

# 잘못 번역된 항목 재번역
pnpm ck3:retranslate
pnpm vic3:retranslate
pnpm stellaris:retranslate

# meta.toml의 transliteration_files 변경분에 맞춰 음역 대상 파일 재무효화
pnpm ck3:retransliteration -- --since-commit=HEAD
pnpm vic3:retransliteration -- --since-commit=HEAD
pnpm stellaris:retransliteration -- --since-commit=HEAD
```

### 단어사전 관리

Git 커밋에서 한국어 번역 파일의 변경사항을 추출하여 TOML 단어사전에 추가할 수 있습니다:

```bash
# 커밋 ID를 입력하면 해당 커밋의 *_l_korean.yml 변경사항을 추출하여 TOML 사전에 추가
pnpm add-dict <commit-id>

# 예시
pnpm add-dict abc123
```

**기능:**
- 커밋의 한국어 번역 파일(`*_l_korean.yml`)에서 추가된 항목만 추출
- 영어 원문은 업스트림 파일에서 자동으로 매칭
- CK3, Stellaris, VIC3 모든 게임 타입 지원
- 자동 중복 검사로 기존 항목은 건너뜀
- 해당 게임의 TOML 파일에 자동 저장 (예: `dictionaries/ck3-glossary.toml`)

**사용 시나리오:**
- 다른 브랜치나 과거 커밋에서 검증된 번역을 단어사전으로 가져올 때
- 여러 커밋에 분산된 번역을 단어사전으로 통합할 때
- 팀원이 작성한 번역을 단어사전에 추가할 때

## 환경 변수 설정

`.env` 파일을 생성하고 다음 환경 변수를 설정하세요:

```bash
GOOGLE_AI_STUDIO_TOKEN=your_api_key_here   # 필수: Google AI Studio 토큰
# 선택: 구키도 허용
GOOGLE_GENERATIVE_AI_API_KEY=legacy_api_key
# 선택: GitHub API 인증(레이트 리밋 완화, 대시보드/버전 조회 안정화)
GITHUB_TOKEN=github_pat_xxx

# 실행 옵션
LOG_LEVEL=info
TRANSLATE_BATCH_SIZE=10
TRANSLATION_TIMEOUT_MINUTES=15
TRANSLATE_MOD_CONCURRENCY=4
GEMINI_MODEL=gemini-flash-lite-latest
```

- `GOOGLE_AI_STUDIO_TOKEN`: ai-sdk.dev에서 사용하는 기본 Gemini API 키입니다.
- `GOOGLE_GENERATIVE_AI_API_KEY`: (선택) 기존 Gemini SDK 키. 존재하면 폴백용으로 사용됩니다.
- `GITHUB_TOKEN`: (선택) GitHub API 호출 시 인증 헤더를 추가해 레이트 리밋을 완화합니다. 업스트림 대시보드와 GitHub 기반 버전 조회 안정화에 유용합니다.
- `TRANSLATE_BATCH_SIZE`: 벌크 번역 시 한 번에 요청할 항목 수입니다.
- `TRANSLATION_TIMEOUT_MINUTES`: 번역 작업 타임아웃(분)입니다. `false` 또는 `0`으로 설정하면 비활성화됩니다.
- `TRANSLATE_MOD_CONCURRENCY`: 모드 단위 병렬 처리 동시성입니다. 미설정 시 모드 개수만큼 자동 설정됩니다.
- `GEMINI_MODEL`: 사용할 Gemini 모델 ID입니다. 미설정 시 코드 기본값(`gemini-flash-lite-latest`)을 사용합니다.

## 프로젝트 구조

```
.
├── ck3/                    # CK3 모드 및 번역 파일
├── vic3/                   # Victoria 3 모드 및 번역 파일
├── stellaris/              # Stellaris 모드 및 번역 파일
├── scripts/
│   ├── add-dict-from-commit.ts  # Git 커밋에서 단어사전 추가 스크립트
│   ├── ck3.ts                   # CK3 번역 스크립트
│   ├── vic3.ts                  # VIC3 번역 스크립트
│   ├── stellaris.ts             # Stellaris 번역 스크립트
│   ├── factory/                 # 번역 처리 로직
│   ├── parser/                  # 파일 파싱 유틸리티
│   └── utils/
│       ├── dictionary.ts        # 단어사전 로더 (TOML 파일 읽기)
│       ├── prompts.ts           # 프롬프트 로더
│       ├── ai.ts                # AI 통합
│       ├── cache.ts             # 캐싱 시스템
│       └── logger.ts            # 로깅 유틸리티
├── dictionaries/                # 단어사전 파일 (TOML 형식)
│   ├── ck3-glossary.toml       # CK3 일반 용어
│   ├── ck3-proper-nouns.toml   # CK3 고유명사
│   ├── stellaris.toml          # Stellaris 사전
│   └── vic3.toml               # VIC3 사전
├── prompts/                     # AI 프롬프트 파일 (Markdown 형식)
│   ├── ck3-translation.md      # CK3 번역 프롬프트
│   ├── ck3-transliteration.md  # CK3 음역 프롬프트
│   └── ...                     # 기타 게임 프롬프트
└── package.json
```

## 번역 프로세스

1. **Upstream 업데이트**: 최신 소스 파일 다운로드 (sparse checkout 사용)
2. **파일 발견**: `meta.toml` 기반 모드 구성 로드
3. **파싱**: YAML 현지화 파일 파싱 (`l_english` → `l_korean`)
4. **모드 감지**: 파일명 기반 자동 번역/음역 모드 전환
5. **해싱**: 내용 기반 해시로 변경사항 감지
6. **번역/음역**: AI 번역 또는 음역 (게임별 컨텍스트 및 고유명사 사전 포함)
7. **캐싱**: 번역 결과 저장 (번역/음역 별도 캐시로 중복 방지)
8. **출력**: 한국어 파일 생성 (`___` 접두사로 로드 순서 보장)

### 음역 모드 (Transliteration Mode)

파일명 또는 키 이름에 특정 패턴이 포함된 경우, 의미 번역이 아닌 발음 기반 음역을 수행합니다.

#### 파일 단위 음역 모드

파일명에 특정 키워드가 포함된 경우 전체 파일을 음역 모드로 처리합니다.

**자동 감지 키워드**:
- `culture` / `cultures` - 문화 이름
- `dynasty` / `dynasties` - 왕조 이름  
- `names` - 이름 목록
- `character_name` - 캐릭터 이름
- `name_list` - 이름 리스트

**예시**:
```
파일: culture_name_lists_l_english.yml
자동 감지: ✓ 음역 모드 활성화

"Afar" → "아파르" (음역)
"Anglo-Saxon" → "앵글로색슨" (음역)

vs.

파일: events_l_english.yml  
자동 감지: 번역 모드

"Afar" → "멀리" (의미 번역)
```

#### 키 단위 음역 모드

일반 번역 파일 내에서도 특정 키 패턴은 음역 모드로 처리됩니다.

**자동 감지 패턴**:
- `dynn_*` - 왕조 이름 (예: `dynn_Austmadur`, `dynn_RICE_leslie`)
- `dynnp_*` - 왕조 접두사 (예: `dynnp_al-`, `dynnp_de`, `dynnp_banu`)
- `*_adj` - 형용사형 고유명사 (예: `dyn_c_pingnan_guo_adj`)
- `*_name` - 이름 (예: `dynasty_name`, `culture_name`)

**제외 규칙**:
- `*_desc`, `*_event`, `*_decision` 등으로 끝나는 키는 일반 번역 사용
- 설명, 이벤트, 결정 등의 컨텍스트는 의미 번역 필요

**예시**:
```yaml
# 일반 번역 파일 내에서도 키 단위로 음역 적용
# events_l_english.yml
dynn_Austmadur:0 "Austmadur"        → "아우스트마두르" (음역)
culture_name:0 "Korean"              → "한국인" (음역)
culture_adj:0 "Korean"               → "한국의" (음역)
heritage_desc:0 "Korean heritage"    → "한국 유산" (의미 번역, _desc로 끝남)
```

**특징**:
- 고유명사 사전 활용 (ck3ProperNouns 등)
- 별도 캐시 관리 (`transliteration:` prefix)
- 기존 번역 캐시와 독립적으로 동작
- 완전 자동, 수동 설정 불필요
- 파일 단위와 키 단위 감지를 모두 지원
- `meta.toml`의 `upstream.transliteration_files`로 파일명/와일드카드 패턴을 수동 지정 가능

### 번역 결과 sanitize

- AI 응답, 캐시, 단어사전, YAML 입출력에서 U+200E(Left-to-Right Mark) 문자를 제거해 Paradox localization 키/값 오염을 방지합니다.
- 닫는 변수 마커 뒤에 바로 `[`가 오는 `$[` 형태는 공백을 보정해 잘못된 변수 구문이 출력되지 않도록 정리합니다.

## 자동화 워크플로우

### 단어사전 자동 무효화

단어사전 파일(`dictionaries/*.toml`)이 업데이트되면 자동으로 다음 작업을 수행합니다:

1. **자동 트리거**: `main` 브랜치에 `dictionaries/` 디렉토리의 파일이 변경되면 GitHub Actions 워크플로우가 자동 실행
2. **캐시 무효화**: 각 게임(CK3, Stellaris, VIC3)에 대해 단어사전 기반 번역 무효화 (`update-dict`)
3. **재번역**: 잘못 번역된 항목 재번역 (`retranslate`)
4. **자동 커밋**: 변경사항 자동 커밋 및 푸시

이를 통해 단어사전에 새로운 용어를 추가하거나 기존 번역을 수정하면 자동으로 모든 게임의 번역이 업데이트됩니다.

**워크플로우 파일**: `.github/workflows/invalidate-on-dictionary-update.yml`

### 번역 거부 항목 자동 이슈 등록

번역 과정에서 AI가 번역을 거부한 항목(예: 안전성 필터, 콘텐츠 정책 위반 등)을 자동으로 추적하고 GitHub Issues로 등록합니다:

1. **자동 감지**: 번역 중 AI가 거부한 항목을 자동으로 수집
2. **중간 저장**: 번역 거부 발생 시 처리된 항목까지 graceful하게 저장
3. **이슈 생성**: 모드별로 그룹화하여 GitHub Issues 자동 생성
4. **레이블 태깅**: `translation-refused`, 게임별 레이블(예: `ck3`) 자동 부여

번역 거부 항목은 `{game}-untranslated-items.json` 파일에 저장되며, 다음 정보를 포함합니다:
- 모드 이름
- 파일 경로
- 키 이름
- 원본 메시지

**관련 워크플로우**: `.github/workflows/translate-ck3.yml`, `translate-vic3.yml`, `translate-stellaris.yml`

**폴백 번역 워크플로우**: `translation-refused` 이슈를 자동으로 탐색해 폴백 번역을 적용하고 커밋하는 전용 워크플로우(`.github/workflows/fallback-translate-on-translation-refused.yml`)가 추가되었습니다.

### 업스트림 번역 미반영 대시보드

업스트림 저장소가 갱신됐지만 번역이 따라가지 못한 모드를 자동 집계하여 이슈 대시보드로 제공합니다.

- 워크플로우: `.github/workflows/upstream-translation-dashboard.yml` (12시간마다 스케줄 실행 + 수동 `workflow_dispatch`)
- 빌드: `pnpm exec jiti scripts/upstream-dashboard.ts` → `upstream-dashboard.md` 생성 (GitHub API/GraphQL로 태그·커밋 비교, `GITHUB_TOKEN` 설정 시 인증 사용, annotated 태그 지원)
- 게시: 제목 `[대시보드] 업스트림 변경 대비 번역 미반영 현황`, 라벨 `upstream-dashboard` 로 이슈 생성·갱신
- 내용: 게임/모드별 추적 방식(tag/commit), 기준 버전·최신 버전 값에 비교 링크 포함, 미반영 수 집계
- `github` 전략은 GitHub Releases의 공개 릴리스만 사용하며 프리릴리즈/드래프트는 제외합니다.
- `default` 전략은 기본 브랜치 전체가 아니라 `upstream.localization` 경로에 영향을 준 최신 커밋을 기준으로 미반영 여부를 계산합니다. `["."]`이면 저장소 전체를 추적합니다.

## 라이선스

이 프로젝트는 오픈소스입니다.
