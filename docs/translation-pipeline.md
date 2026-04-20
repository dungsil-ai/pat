# 번역 파이프라인

## 개요

번역 파이프라인은 원본 영어 localization 파일을 한국어로 번역하는 전체 프로세스를 관리합니다. 이 문서는 각 단계의 상세한 동작 방식을 설명합니다.

## 파이프라인 단계

### 1. Upstream 업데이트

원본 모드 저장소에서 최신 영어 파일을 가져옵니다.

**담당 모듈:** `scripts/utils/upstream.ts`

**처리 과정:**

```
┌─────────────────────────────────────┐
│ 1. meta.toml 스캔                   │
│    - ck3/, vic3/, stellaris/에서   │
│      모든 meta.toml 파일 검색       │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 2. Upstream 설정 파싱               │
│    - URL 추출                       │
│    - localization 경로 추출         │
│    - 대상 언어 확인                 │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 3. Git 저장소 상태 확인             │
│    ├─ 존재하지 않으면: Clone        │
│    └─ 존재하면: Pull                │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 4. Sparse Checkout 설정             │
│    - localization 폴더만 체크아웃   │
│    - 불필요한 파일 제외             │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 5. 최신 버전 체크아웃               │
│    ├─ 태그 존재: 최신 태그 사용     │
│    └─ 태그 없음: 기본 브랜치 사용   │
└─────────────────────────────────────┘
```

**예제:**

```bash
# meta.toml
[upstream]
url = "https://github.com/cybrxkhan/RICE-for-CK3.git"
localization = ["RICE/localization/english"]
language = "english"

# 실행되는 Git 명령
git clone --filter=blob:none --no-checkout --depth=1 \
  https://github.com/cybrxkhan/RICE-for-CK3.git \
  ck3/RICE/upstream

cd ck3/RICE/upstream
git sparse-checkout init --cone
git sparse-checkout set RICE/localization/english
git checkout
```

**최적화:**
- **Partial Clone**: 전체 히스토리 없이 최신 버전만 다운로드
- **Sparse Checkout**: 필요한 파일만 체크아웃
- **병렬 처리**: 여러 저장소 동시 업데이트

### 2. 모드 발견 및 설정 로드

번역할 모드를 발견하고 설정을 로드합니다.

**담당 모듈:** `scripts/factory/translate.ts`

**처리 과정:**

```typescript
// 1. 모드 디렉토리 스캔
const mods = await readdir('ck3/')
// ['RICE', 'VIET', 'CFP', ...]

// 2. 각 모드의 meta.toml 파싱
for (const mod of mods) {
  const metaPath = join('ck3', mod, 'meta.toml')
  const meta = parseToml(await readFile(metaPath, 'utf-8'))
  
  // 3. localization 경로 추출
  for (const locPath of meta.upstream.localization) {
    // 번역 처리 시작
  }
}
```

**meta.toml 구조:**

```toml
[upstream]
# Git 저장소 URL (선택사항: 파일 기반 upstream인 경우 생략)
url = "https://github.com/user/mod.git"

# Localization 파일 경로 (배열)
localization = [
  "Mod/localization/english",
  "Mod/localization/replace/english"  # replace 폴더도 지원
]

# 소스 언어
language = "english"
```

### 3. 파일 발견 및 파싱

localization 파일을 찾아 파싱합니다.

**담당 모듈:** `scripts/parser/yaml.ts`

**처리 과정:**

```
┌─────────────────────────────────────┐
│ 1. 소스 디렉토리 스캔               │
│    upstream/Mod/localization/english│
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 2. *_l_english.yml 필터링           │
│    - events_l_english.yml           │
│    - characters_l_english.yml       │
│    - ...                            │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 3. YAML 파싱                        │
│    ├─ 언어 키 추출 (l_english:)     │
│    ├─ 각 항목 파싱                  │
│    ├─ U+200E 문자 제거              │
│    └─ 주석 보존                     │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 4. 타겟 파일 로드 (있는 경우)       │
│    mod/localization/korean/         │
│    ___events_l_korean.yml           │
└─────────────────────────────────────┘
```

**YAML 파싱 예제:**

```yaml
# 입력: events_l_english.yml
l_english:
  event_title: "The Duke Arrives" # abc123
  event_desc: "A powerful duke has arrived"
```

```typescript
// 출력: JavaScript 객체
{
  "l_english": {
    "event_title": ["The Duke Arrives", "abc123"],
    "event_desc": ["A powerful duke has arrived", null]
  }
}
```

**sanitize 규칙:**
- YAML 키와 값에서 U+200E(Left-to-Right Mark)를 제거합니다.
- 직렬화 시에도 동일한 sanitize를 적용해 이전에 섞여 들어온 제어 문자가 다시 저장되지 않도록 합니다.

### 4. 해시 계산 및 변경 감지

각 텍스트의 해시를 계산하여 변경 사항을 감지합니다.

**담당 모듈:** `scripts/utils/hashing.ts`

**처리 과정:**

```typescript
import { xxhash64 } from 'xxhash-wasm'

// 1. 소스 텍스트 해시 계산
const sourceText = "The Duke Arrives"
const sourceHash = await hashing(sourceText)
// "abc123def456..." (xxHash64)

// 2. 타겟 파일의 기존 해시와 비교
const [targetText, targetHash] = targetYaml['l_korean']['event_title'] || []

// 3. 변경 감지
if (sourceHash === targetHash) {
  // 변경 없음: 기존 번역 사용
  newYaml['l_korean']['event_title'] = [targetText, targetHash]
} else {
  // 변경 감지: 재번역 필요
  const translated = await translate(sourceText, sourceHash, gameType)
  newYaml['l_korean']['event_title'] = [translated, sourceHash]
}
```

**해시 알고리즘 선택 (xxHash):**
- **빠른 속도**: 암호화 해시보다 10배 빠름
- **충돌 저항성**: 실용적인 수준의 충돌 방지
- **일관성**: 동일한 입력에 항상 동일한 출력

### 4-1. 업스트림 파일 해시 기반 스킵

업스트림 파일 자체의 해시를 기록해두고, 이전 실행과 동일하면 **파일 단위**로 번역을 건너뜁니다.

- 새로 계산한 업스트림 해시 ↔ 캐시된 해시가 동일하면 번역 루프를 수행하지 않음
- 변경된 파일만 번역하므로 전체 실행 시간이 크게 단축
- 해시가 불일치하면 일반적인 해시 비교/캐시/AI 번역 플로우를 그대로 진행

### 5. 번역 결정 트리

각 텍스트를 어떻게 번역할지 결정합니다.

**담당 모듈:** `scripts/utils/translate.ts`

**결정 흐름:**

```
┌─────────────────────────────────────┐
│ 입력: 소스 텍스트                   │
│ "The Duke Arrives"                  │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 1. 사전 확인                        │
│    hasDictionary(text)?             │
├─────────────┬───────────────────────┤
│ Yes         │ No                    │
│ ↓           │ ↓                     │
│ 사전 번역   │ 다음 단계             │
│ 반환        │                       │
└─────────────┴───────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 2. 해시 비교                        │
│    sourceHash == targetHash?        │
├─────────────┬───────────────────────┤
│ Yes         │ No                    │
│ ↓           │ ↓                     │
│ 기존 번역   │ 다음 단계             │
│ 반환        │                       │
└─────────────┴───────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 3. 캐시 확인                        │
│    hasCache(sourceHash)?            │
├─────────────┬───────────────────────┤
│ Yes         │ No                    │
│ ↓           │ ↓                     │
│ 캐시 번역   │ AI 번역               │
│ 반환        │ 요청                  │
└─────────────┴───────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 4. AI 번역 (캐시 미스 시)           │
│    - Gemini API 호출                │
│    - 재시도 로직                    │
│    - 캐시 저장                      │
└─────────────────────────────────────┘
```

**우선순위:**
1. **사전 (Dictionary)** - 수동 번역, 최고 우선순위
2. **해시 매칭** - 변경되지 않은 기존 번역
3. **캐시 (Cache)** - 이전에 AI가 번역한 결과
4. **AI 번역** - 새로운 텍스트, API 호출 필요

### 6. AI 번역 요청

새로운 텍스트를 AI로 번역합니다.

**담당 모듈:** `scripts/utils/ai.ts`

**처리 과정:**

```
┌─────────────────────────────────────┐
│ 1. 시스템 프롬프트 로드             │
│    - 게임별 맥락 (CK3/VIC3/...)    │
│    - 번역 가이드라인               │
│    - 번역 메모리 (사전)            │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 2. 모델 선택 및 설정               │
│    - Model: gemini-flash-lite-latest│
│    - Temperature: 0.5              │
│    - Max tokens: 8192              │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 3. API 요청                         │
│    - generateContent()             │
│    - 재시도 로직 (실패 시)         │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 4. 응답 후처리                     │
│    - 개행 문자 이스케이프          │
│    - 따옴표 이스케이프             │
│    - 한글 마크업 수정              │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 5. 번역 검증                       │
│    - 변수 보존 확인                │
│    - 한글 포함 확인                │
│    - 불필요한 응답 필터            │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 6. 캐시 저장                       │
│    setCache(sourceHash, translated)│
└─────────────────────────────────────┘
```

**시스템 프롬프트 구조:**

```
You are an expert translator for "Crusader Kings III" (CK3) mod localization...

Translation Guidelines:
1. Preserve all game variables exactly: $variable$, [GetTitle], @icon@, etc.
2. Maintain game mechanics terminology...
3. Translate according to medieval European/Middle Eastern context...
...

Translation Memory:
- "duke" → "공작"
- "stewardship" → "관리력"
...

Now translate the following:
```

**재시도 로직:**

```typescript
async function translateAI(text: string, gameType: GameType) {
  const modelName = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest'

  return await translateByModel(modelName, text)
}
```

### 7. 번역 검증

번역 품질을 검증합니다.

**담당 모듈:** `scripts/utils/translation-validator.ts`

**검증 규칙:**

#### 규칙 1: 불필요한 LLM 응답 필터링

```typescript
// 원본: "The Duke Arrives"
// 잘못된 번역: "네, 알겠습니다. 공작이 도착합니다"
// ✗ "네, 알겠습니다" 제거 필요

const unwantedResponses = [
  /네,?\s*(알겠습니다|이해했습니다)/i,
  /yes,?\s*(i understand|understood)/i,
  /okay,?\s*(i will translate)/i
]
```

#### 규칙 2: 기술 식별자 보존

```typescript
// 원본: "mod_icon_special"
// 올바른 번역: "mod_icon_special" (번역하지 않음)
// 잘못된 번역: "모드_아이콘_특별" (번역됨)

if (/^[a-z_]+$/.test(sourceText) && !/^[a-z_]+$/.test(translatedText)) {
  return { isValid: false, reason: '기술 식별자가 번역됨' }
}
```

#### 규칙 3: 게임 변수 보존

```typescript
// 원본: "The [GetTitle] is powerful"
// 올바른 번역: "[GetTitle]은(는) 강력합니다"
// 잘못된 번역: "제목은 강력합니다" (변수 누락)

const sourceVars = extractGameVariables(sourceText)
const targetVars = extractGameVariables(translatedText)

// 모든 소스 변수가 타겟에 존재하는지 확인
for (const sourceVar of sourceVars) {
  if (!targetVars.some(v => structureMatch(v, sourceVar))) {
    return { isValid: false, reason: `누락된 변수: ${sourceVar}` }
  }
}
```

**게임 변수 패턴:**

```typescript
const patterns = [
  /\$([a-zA-Z_][a-zA-Z0-9_]*)\$/g,           // $variable$
  /\[([^\]]+)\]/g,                           // [GetTitle]
  /@([a-zA-Z_][a-zA-Z0-9_]*)!/g,             // @icon!
  /£([a-zA-Z_][a-zA-Z0-9_]*)£/g,             // £currency£
  /#([a-zA-Z_]+)#/g                          // #bold#
]
```

#### 규칙 4: 변수 내부 한글 금지

```typescript
// 원본: "[GetTitle]"
// 올바른 번역: "[GetTitle]"
// 잘못된 번역: "[Get제목]" (변수 내부에 한글)

for (const variable of translationGameVariables) {
  if (containsKorean(variable)) {
    return { isValid: false, reason: `변수 내부 한글: ${variable}` }
  }
}
```

#### 규칙 5: 잘못된 변수 구문 감지

```typescript
// 잘못된 패턴들
const malformedPatterns = [
  /\$\[/g,      // $[ - dollar sign과 bracket 혼합
  /£\[/g,       // £[ - pound sign과 bracket 혼합
  /\[\$/g,      // [$ - bracket 내부에 dollar sign
  /\$\s+\w+\s+\$/g  // $ var $ - 공백 포함된 dollar sign
]

// 예: "$[culture|E]" → 잘못됨 (올바른: "$culture$" 또는 "[culture|E]")
```

### 8. 캐시 업데이트

번역 결과를 캐시에 저장합니다.

**담당 모듈:** `scripts/utils/cache.ts`

**처리 과정:**

```typescript
// 1. 캐시 키 생성
const cacheKey = `${gameType}:${sourceHash}`
// 예: "ck3:abc123def456..."

// 2. 캐시 저장
await setCache(sourceHash, translatedText, gameType)

// 3. SQLite 데이터베이스에 영구 저장
// translate-cache.db
```

**캐시 구조:**

```sql
-- 개념적 스키마 (unstorage가 관리)
CREATE TABLE cache (
  key TEXT PRIMARY KEY,      -- "ck3:abc123..." 또는 "abc123..."
  value TEXT NOT NULL        -- "번역된 텍스트"
)
```

**캐시 키 전략:**

```typescript
function getCacheKey(key: string, gameType: GameType): string {
  // CK3: 하위 호환성을 위해 프리픽스 없음
  if (gameType === 'ck3') return key
  
  // 다른 게임: 프리픽스 포함
  return `${gameType}:${key}`
}
```

### 9. 출력 파일 생성

번역된 내용을 YAML 파일로 저장합니다.

**담당 모듈:** `scripts/parser/yaml.ts`

**처리 과정:**

```
┌─────────────────────────────────────┐
│ 1. YAML 객체 생성                   │
│    {                                │
│      "l_korean": {                  │
│        "key": ["번역", "hash"]      │
│      }                               │
│    }                                │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 2. YAML 문자열 직렬화               │
│    - UTF-8 BOM 추가                 │
│    - 들여쓰기 (2칸)                 │
│    - 주석에 해시 포함               │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 3. 파일명 생성                      │
│    원본: events_l_english.yml       │
│    출력: ___events_l_korean.yml     │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 4. 디렉토리 생성 (필요시)           │
│    mkdir -p mod/localization/korean │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 5. 파일 쓰기                        │
│    writeFile(path, content, 'utf-8')│
└─────────────────────────────────────┘
```

**출력 예제:**

```yaml
l_korean:
  event_title: "공작이 도착합니다" # abc123def456
  event_desc: "강력한 공작이 도착했습니다" # 789ghijkl
```

**파일명 규칙:**

```typescript
// 원본 파일명
const sourceFile = "events_l_english.yml"

// 언어 부분 교체
const targetFile = sourceFile.replace('_l_english.yml', '_l_korean.yml')
// "events_l_korean.yml"

// 접두사 추가
const finalFile = '___' + targetFile
// "___events_l_korean.yml"
```

**접두사 이유:**
- 게임이 파일을 알파벳 순으로 로드
- `___`로 시작하면 가장 마지막에 로드됨
- 이전 번역을 덮어써서 최종 번역 적용

## 성능 최적화

### 병렬 처리

```typescript
// 모든 파일을 병렬로 처리
const promises: Promise<void>[] = []

for (const file of sourceFiles) {
  promises.push(processLanguageFile(file))
}

await Promise.all(promises)
```

**장점:**
- CPU 효율적 활용
- 처리 시간 단축
- I/O 대기 시간 최소화

### 캐시 효율성

```typescript
// 1차 실행: 모든 항목 번역 (느림)
// API 호출: 1000회

// 2차 실행: 변경된 항목만 번역 (빠름)
// API 호출: 10회 (변경된 항목만)
```

**캐시 히트율:**
- 초기 실행: 0%
- 이후 실행: 95%+ (대부분 변경 없음)

### API 비용 절감

**전략:**

1. **다층 캐싱**
   ```
   Dictionary → Cache → AI
   (즉시)      (빠름)   (느림/비용)
   ```

2. **해시 기반 변경 감지**
   - 변경되지 않은 텍스트는 API 호출 안 함

3. **사전 우선 사용**
   - 자주 사용되는 용어는 사전에 추가
   - API 호출 없이 즉시 번역

**비용 예측:**

```typescript
// 가정
const totalItems = 10000
const changedItems = 100  // 1% 변경률
const dictionaryHits = 50 // 사전에 있는 항목

// API 호출 수
const apiCalls = changedItems - dictionaryHits // 50

// 비용 (Gemini Flash 기준)
const costPerCall = 0.0001 // $0.0001
const totalCost = apiCalls * costPerCall // $0.005
```

## 에러 처리

### 재시도 전략

```typescript
async function translateWithRetry(text: string, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await translateAI(text)
    } catch (error) {
      if (attempt === maxRetries) throw error
      
      // 지수 백오프
      const delay = Math.pow(2, attempt) * 1000
      await sleep(delay)
    }
  }
}
```

### 실패 복구

```typescript
// 부분 실패 허용
for (const file of files) {
  try {
    await processFile(file)
  } catch (error) {
    log.error(`파일 처리 실패: ${file}`, error)
    // 다음 파일 계속 처리
    continue
  }
}
```

### 롤백 없음

- 번역 실패 시 롤백하지 않음
- 성공한 번역은 그대로 유지
- 실패한 항목만 재시도

## 모니터링 및 로깅

### 진행 상황 추적

```typescript
log.start(`[${mod}] 번역 시작`)
log.info(`총 ${totalItems}개 항목`)

let translated = 0
let cached = 0

for (const item of items) {
  if (fromCache) {
    cached++
  } else {
    translated++
  }
}

log.success(`번역 완료: ${translated}개 신규, ${cached}개 캐시`)
```

### 성능 측정

```typescript
const startTime = Date.now()

await processTranslations()

const duration = Date.now() - startTime
log.info(`처리 시간: ${duration}ms`)
```

## 확장 포인트

### 새 파서 추가

```typescript
// scripts/parser/json-parser.ts
export function parseJSON(content: string) {
  // JSON 형식 파싱
}

export function stringifyJSON(data: any) {
  // JSON 직렬화
}
```

### 새 검증 규칙 추가

```typescript
// scripts/utils/translation-validator.ts
function validateCustomRule(source: string, target: string): ValidationResult {
  // 커스텀 검증 로직
  return { isValid: true }
}
```

### 새 캐시 백엔드 추가

```typescript
// Redis, MongoDB 등
const cache = createStorage({
  driver: redisDriver({ ... })
})
```

## 다음 단계

- [API 레퍼런스](api-reference.md) - 각 함수의 상세 API
- [검증 시스템](validation.md) - 검증 규칙 상세
- [캐싱 시스템](caching.md) - 캐시 관리 전략

---

**참고:** 파이프라인은 지속적으로 개선되고 있습니다. 제안이나 개선 아이디어가 있으면 이슈를 생성해주세요.
