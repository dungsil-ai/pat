# 설정 가이드

## meta.toml 파일

`meta.toml` 파일은 각 모드의 번역 설정을 정의합니다. 모든 모드 디렉토리는 이 파일을 포함해야 합니다.

## 파일 위치

```
게임디렉토리/
└── 모드명/
    └── meta.toml    # 필수
```

예제:
```
ck3/RICE/meta.toml
vic3/Better Politics Mod/meta.toml
stellaris/Pouchkinn-s-Gigastructures/meta.toml
```

## 기본 구조

```toml
[upstream]
url = "저장소_URL"
localization = ["경로1", "경로2", ...]
language = "소스_언어"
```

## 필드 상세 설명

### `upstream.url` (선택사항)

**타입:** String (URL)

**설명:** 모드의 Git 저장소 URL

**사용 시기:**
- GitHub/GitLab 등의 원격 저장소에서 자동으로 소스 파일을 다운로드할 때
- 모드가 정기적으로 업데이트되는 경우

**생략 가능:**
- 로컬 파일 기반 upstream을 사용할 때
- 수동으로 upstream 디렉토리를 관리할 때

**예제:**
```toml
[upstream]
url = "https://github.com/cybrxkhan/RICE-for-CK3.git"
```

**지원 프로토콜:**
- HTTPS: `https://github.com/user/repo.git`
- SSH: `git@github.com:user/repo.git`

### `upstream.localization` (필수)

**타입:** Array of Strings

**설명:** 번역할 localization 파일이 있는 경로들

**특징:**
- 배열 형태로 여러 경로 지정 가능
- 각 경로는 upstream 디렉토리 내의 상대 경로
- 재귀적으로 하위 디렉토리 탐색

**예제:**

기본 경로:
```toml
[upstream]
localization = ["RICE/localization/english"]
```

여러 경로:
```toml
[upstream]
localization = [
  "ModName/localization/english",
  "ModName/localization/replace/english"
]
```

깊은 경로:
```toml
[upstream]
localization = [
  "common/localization/english",
  "dlc/expansion1/localization/english"
]
```

### `upstream.language` (필수)

**타입:** String

**설명:** 소스 localization의 언어

**현재 지원:**
- `"english"` (기본값)

**향후 확장 가능:**
- `"french"`, `"german"`, `"spanish"` 등

**예제:**
```toml
[upstream]
language = "english"
```

## 전체 예제

### CK3 모드 (Git 저장소)

```toml
[upstream]
url = "https://github.com/cybrxkhan/RICE-for-CK3.git"
localization = ["RICE/localization/english", "RICE/localization/replace/english"]
language = "english"
```

**동작:**
1. GitHub에서 저장소 클론
2. Sparse checkout으로 localization 경로만 체크아웃
3. 두 경로 모두에서 `*_l_english.yml` 파일 탐색
4. 한국어로 번역

### VIC3 모드 (로컬 파일)

```toml
[upstream]
localization = ["Better_Politics/localization/english"]
language = "english"
```

**동작:**
1. URL 없음 → Git 클론 건너뜀
2. 기존 upstream 디렉토리 사용
3. 지정된 경로에서 `*_l_english.yml` 파일 탐색
4. 한국어로 번역

### Stellaris 모드 (여러 DLC)

```toml
[upstream]
url = "https://github.com/user/stellaris-mod.git"
localization = [
  "base/localisation/english",
  "dlc_1/localisation/english",
  "dlc_2/localisation/english"
]
language = "english"
```

**동작:**
1. 저장소 클론
2. 세 경로 모두 체크아웃
3. 각 경로에서 `*_l_english.yml` 파일 탐색
4. 모든 파일 번역

## 디렉토리 구조

### Git 저장소 기반

```
ck3/RICE/
├── meta.toml                        # 설정 파일
├── upstream/                        # 자동 생성 (Git 클론)
│   └── RICE/
│       └── localization/
│           └── english/
│               ├── events_l_english.yml
│               └── characters_l_english.yml
└── mod/                             # 출력 디렉토리 (자동 생성)
    └── localization/
        └── korean/
            ├── ___events_l_korean.yml
            └── ___characters_l_korean.yml
```

### 로컬 파일 기반

```
ck3/LocalMod/
├── meta.toml                        # 설정 파일
├── upstream/                        # 수동 관리
│   └── Mod/
│       └── localization/
│           └── english/
│               └── text_l_english.yml
└── mod/                             # 출력 디렉토리
    └── localization/
        └── korean/
            └── ___text_l_korean.yml
```

## 고급 설정

### `upstream.version_strategy` (선택사항)

**타입:** String  
**값:** `"semantic"` | `"natural"` | `"github"` | `"default"`  
**기본값:** `"default"`  

**설명:** 버전 선택 전략을 지정합니다. `github`는 GitHub Releases의 최신 태그를 그대로 사용합니다.

### Replace 폴더 처리

일부 모드는 `replace` 폴더를 사용하여 바닐라 게임의 텍스트를 덮어씁니다.

```toml
[upstream]
url = "https://github.com/user/mod.git"
localization = [
  "Mod/localization/english",
  "Mod/localization/replace/english"
]
language = "english"
```

**출력:**
```
mod/
└── localization/
    └── korean/
        ├── ___normal_l_korean.yml        # 일반 파일
        └── replace/
            └── ___replace_l_korean.yml   # replace 파일
```

### 조건부 경로

특정 게임 버전이나 DLC에 따라 경로가 다를 수 있습니다.

```toml
[upstream]
url = "https://github.com/user/mod.git"
localization = [
  "Mod/localization/english",           # 기본
  "Mod/dlc/expansion1/localization/english"  # DLC
]
language = "english"
```

## 파일 발견 규칙

### 파일명 패턴

번역 대상 파일은 다음 패턴을 따라야 합니다:

```
*_l_english.yml
```

예제:
- ✓ `events_l_english.yml`
- ✓ `character_interactions_l_english.yml`
- ✓ `my_custom_mod_l_english.yml`
- ✗ `events.yml` (패턴 불일치)
- ✗ `events_l_french.yml` (다른 언어)

### 재귀 탐색

지정된 경로 하위의 모든 디렉토리를 재귀적으로 탐색합니다.

```toml
[upstream]
localization = ["Mod/localization/english"]
```

**탐색 범위:**
```
Mod/localization/english/
├── events_l_english.yml           ✓ 포함
├── subfolder/
│   └── more_events_l_english.yml  ✓ 포함
└── deep/
    └── nested/
        └── text_l_english.yml     ✓ 포함
```

## 출력 설정

### 출력 디렉토리

출력 디렉토리는 자동으로 결정됩니다:

```
게임디렉토리/모드명/mod/localization/korean/
```

또는 (Stellaris):
```
게임디렉토리/모드명/mod/localisation/korean/
```

### 파일명 변환

```
입력:  events_l_english.yml
출력:  ___events_l_korean.yml
```

**변환 규칙:**
1. `_l_english` → `_l_korean`
2. `___` 접두사 추가

### 언어 키 변환

```yaml
# 입력
l_english:
  key: "text"

# 출력
l_korean:
  key: "번역된 텍스트"
```

## 환경 변수

### GOOGLE_AI_STUDIO_TOKEN

**필수:** 예

**설명:** Google Gemini API 키

**설정 방법:**

`.env` 파일:
```env
GOOGLE_AI_STUDIO_TOKEN=your_api_key_here
```

또는 환경 변수:
```bash
export GOOGLE_AI_STUDIO_TOKEN=your_api_key
pnpm ck3
```

### GOOGLE_GENERATIVE_AI_API_KEY

**필수:** 아니오 (선택)

**설명:** 기존 Gemini SDK 키. `GOOGLE_AI_STUDIO_TOKEN`이 없을 때 폴백으로 사용됩니다.

### GEMINI_MODEL

**필수:** 아니오

**기본값:** `gemini-2.0-flash` (코드 기본값), `.env.sample` 권장값: `gemini-flash-lite-latest`

**설명:** 사용할 Gemini 모델 ID를 지정합니다.

```env
GEMINI_MODEL=gemini-flash-lite-latest
```

### TRANSLATE_BATCH_SIZE

**필수:** 아니오

**기본값:** `20`

**설명:** 벌크 번역 시 한 번에 요청할 항목 수입니다. 잘못된 값이 입력되면 경고 후 기본값(20)을 사용합니다.

```env
TRANSLATE_BATCH_SIZE=10
```

### TRANSLATION_TIMEOUT_MINUTES

**필수:** 아니오

**기본값:** `15` (분)

**설명:** 번역 작업 타임아웃(분)입니다. `false` 또는 `0`으로 설정하면 타임아웃이 비활성화됩니다.

```env
TRANSLATION_TIMEOUT_MINUTES=15
```

### TRANSLATE_MOD_CONCURRENCY

**필수:** 아니오

**기본값:** 모드 개수 (자동 계산)

**설명:** 모드 단위 병렬 처리 동시성을 지정합니다. 미설정 시 현재 처리 중인 모드 개수만큼 자동으로 설정됩니다. ETC 모드의 경우 `upstream/` 하위 폴더 수를 기준으로 계산합니다. 잘못된 값이 입력되면 경고 후 자동 계산값을 사용합니다.

```env
TRANSLATE_MOD_CONCURRENCY=4
```

### LOG_LEVEL

**필수:** 아니오

**기본값:** `info`

**설명:** 로깅 레벨을 설정합니다. (`silent`, `error`, `warn`, `info`, `debug`, `verbose`)

```env
LOG_LEVEL=info
```

## 모범 사례

### 1. 저장소 URL은 HTTPS 사용

```toml
# 권장
url = "https://github.com/user/repo.git"

# 비권장 (SSH 키 필요)
url = "git@github.com:user/repo.git"
```

### 2. 필요한 경로만 포함

```toml
# 좋은 예: 필요한 경로만
localization = ["Mod/localization/english"]

# 나쁜 예: 불필요한 경로 포함
localization = [
  "Mod/",  # 너무 광범위
  "Mod/localization/",  # 다른 언어도 포함
]
```

### 3. Replace 폴더 명시적 지정

```toml
# 명확한 구조
localization = [
  "Mod/localization/english",
  "Mod/localization/replace/english"
]
```

### 4. 주석 활용

```toml
[upstream]
url = "https://github.com/user/mod.git"

# 기본 localization
localization = ["Mod/localization/english"]

# 소스 언어
language = "english"
```

## 검증

### 설정 검증 방법

```bash
# 1. 메타데이터 구문 확인
pnpm exec jiti -e "
  import { readFile } from 'node:fs/promises'
  import { parseToml } from './scripts/parser/toml.js'
  const content = await readFile('ck3/RICE/meta.toml', 'utf-8')
  console.log(parseToml(content))
"

# 2. 해시 업데이트로 파일 발견 테스트
pnpm ck3:update-hash

# 3. 로그에서 발견된 파일 확인
# [RICE] 메타데이터: upstream.language: english, upstream.localization: [...]
```

### 일반적인 오류

#### 1. URL 오타

```toml
# 잘못된 URL
url = "https://github.com/user/repo"  # .git 누락
```

**에러:**
```
fatal: repository 'https://github.com/user/repo' not found
```

#### 2. 경로 오타

```toml
# 잘못된 경로
localization = ["Mod/localizaton/english"]  # 오타
```

**결과:**
```
[RICE] 소스 디렉토리 없음: ck3/RICE/upstream/Mod/localizaton/english
```

#### 3. 필수 필드 누락

```toml
[upstream]
# localization 필드 누락
language = "english"
```

**에러:**
```
TypeError: Cannot read property 'localization' of undefined
```

## 다음 단계

- [사용 가이드](usage.md) - 번역 실행 방법
- [트러블슈팅](troubleshooting.md) - 문제 해결
- [개발 가이드](development.md) - 설정 확장

---

**팁:** `meta.toml` 파일을 수정한 후에는 다음 번역 실행 시 자동으로 반영됩니다. 재시작이나 캐시 클리어는 필요하지 않습니다.
