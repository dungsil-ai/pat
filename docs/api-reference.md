# API 레퍼런스

## 개요

이 문서는 Paradox Auto Translate 프로젝트의 주요 함수와 모듈에 대한 API 참조를 제공합니다.

## 목차

- [Translation Factory](#translation-factory)
- [Parsers](#parsers)
- [AI Integration](#ai-integration)
- [Caching](#caching)
- [Hashing](#hashing)
- [Dictionary](#dictionary)
- [Translation Validator](#translation-validator)
- [Upstream Manager](#upstream-manager)
- [Logger](#logger)

---

## Translation Factory

**모듈:** `scripts/factory/translate.ts`

### `processModTranslations(options)`

모든 모드의 번역을 처리하는 메인 함수입니다.

**매개변수:**

```typescript
interface ModTranslationsOptions {
  rootDir: string    // 게임 디렉토리 경로 (예: "ck3/")
  mods: string[]     // 모드 이름 배열
  gameType: GameType // 'ck3' | 'vic3' | 'stellaris'
  onlyHash?: boolean // true면 번역 없이 해시만 업데이트
}
```

**반환값:** `Promise<void>`

**예제:**

```typescript
await processModTranslations({
  rootDir: '/path/to/ck3',
  mods: ['RICE', 'VIET'],
  gameType: 'ck3',
  onlyHash: false
})
```

**동작:**
1. Upstream 저장소 업데이트
2. 각 모드의 `meta.toml` 파싱
3. Localization 파일 발견 및 처리
4. 병렬 번역 실행

### `getLocalizationFolderName(gameType)`

게임별 localization 폴더 이름을 반환합니다.

**매개변수:**
- `gameType: GameType` - 게임 타입

**반환값:** `string`
- `'localization'` (CK3, VIC3)
- `'localisation'` (Stellaris - 영국식 철자)

**예제:**

```typescript
const folder = getLocalizationFolderName('ck3')
// "localization"

const folder = getLocalizationFolderName('stellaris')
// "localisation"
```

---

## Parsers

### YAML Parser

**모듈:** `scripts/parser/yaml.ts`

#### `parseYaml(content)`

YAML 문자열을 JavaScript 객체로 파싱합니다.

**매개변수:**
- `content: string` - YAML 문자열

**반환값:** `Record<string, Record<string, [string, string | null]>>`

**구조:**
```typescript
{
  "l_english": {
    "key_name": ["text", "hash"],
    "another_key": ["more text", null]
  }
}
```

**예제:**

```typescript
const yaml = parseYaml(`
l_english:
  greeting: "Hello World" # abc123
  farewell: "Goodbye"
`)

console.log(yaml['l_english']['greeting'])
// ["Hello World", "abc123"]
```

#### `stringifyYaml(data)`

JavaScript 객체를 YAML 문자열로 직렬화합니다.

**매개변수:**
- `data: Record<string, Record<string, [string, string | null]>>`

**반환값:** `string`

**예제:**

```typescript
const data = {
  'l_korean': {
    'greeting': ['안녕하세요', 'abc123'],
    'farewell': ['안녕히 가세요', 'def456']
  }
}

const yaml = stringifyYaml(data)
/*
l_korean:
  greeting: "안녕하세요" # abc123
  farewell: "안녕히 가세요" # def456
*/
```

### TOML Parser

**모듈:** `scripts/parser/toml.ts`

#### `parseToml(content)`

TOML 문자열을 JavaScript 객체로 파싱합니다.

**매개변수:**
- `content: string` - TOML 문자열

**반환값:** `any`

**예제:**

```typescript
const toml = parseToml(`
[upstream]
url = "https://github.com/user/repo.git"
localization = ["path/to/english"]
language = "english"
`)

console.log(toml.upstream.url)
// "https://github.com/user/repo.git"
```

---

## AI Integration

**모듈:** `scripts/utils/ai.ts`

### `translateAI(text, gameType)`

Google Gemini AI를 사용하여 텍스트를 번역합니다.

**매개변수:**
- `text: string` - 번역할 텍스트
- `gameType: GameType` - 게임 타입 (기본값: `'ck3'`)

**반환값:** `Promise<string>` - 번역된 텍스트

**예제:**

```typescript
const translated = await translateAI('The Duke arrives', 'ck3')
// "공작이 도착합니다"
```

**동작:**
1. `GEMINI_MODEL` 환경변수로 지정된 단일 모델 사용 (코드 기본값: `gemini-2.0-flash`)
2. 응답 후처리 (이스케이프, 마크업 수정)

**후처리:**
```typescript
// 개행 이스케이프
"line1\nline2" → "line1\\nline2"

// 따옴표 이스케이프
'say "hi"' → 'say \\"hi\\"'

// 한글 마크업 수정
"#약화된" → "#weak"
"#강조" → "#bold"
```

---

## Caching

**모듈:** `scripts/utils/cache.ts`

### `hasCache(key, gameType)`

캐시에 항목이 존재하는지 확인합니다.

**매개변수:**
- `key: string` - 캐시 키 (해시)
- `gameType: GameType` - 게임 타입 (기본값: `'ck3'`)

**반환값:** `Promise<boolean>`

**예제:**

```typescript
if (await hasCache('abc123', 'ck3')) {
  console.log('캐시 존재')
}
```

### `getCache(key, gameType)`

캐시에서 번역을 조회합니다.

**매개변수:**
- `key: string` - 캐시 키
- `gameType: GameType` - 게임 타입

**반환값:** `Promise<string | null>`

**예제:**

```typescript
const cached = await getCache('abc123', 'ck3')
if (cached) {
  console.log('캐시된 번역:', cached)
}
```

### `setCache(key, value, gameType)`

번역을 캐시에 저장합니다.

**매개변수:**
- `key: string` - 캐시 키
- `value: string` - 번역된 텍스트
- `gameType: GameType` - 게임 타입

**반환값:** `Promise<void>`

**예제:**

```typescript
await setCache('abc123', '공작이 도착합니다', 'ck3')
```

### `removeCache(key, gameType)`

캐시에서 항목을 제거합니다.

**매개변수:**
- `key: string` - 캐시 키
- `gameType: GameType` - 게임 타입

**반환값:** `Promise<void>`

**예제:**

```typescript
await removeCache('abc123', 'ck3')
```

---

## Hashing

**모듈:** `scripts/utils/hashing.ts`

### `hashing(text)`

텍스트의 xxHash64 해시를 계산합니다.

**매개변수:**
- `text: string` - 해시할 텍스트

**반환값:** `Promise<string>` - 16진수 해시 문자열

**예제:**

```typescript
const hash = await hashing('The Duke arrives')
// "a1b2c3d4e5f6..."

// 동일한 텍스트는 항상 동일한 해시
const hash2 = await hashing('The Duke arrives')
console.log(hash === hash2) // true
```

---

## Dictionary

**모듈:** `scripts/utils/dictionary.ts`

### `getDictionaries(gameType)`

게임별 사전을 조회합니다.

**매개변수:**
- `gameType: GameType` - 게임 타입

**반환값:** `Record<string, string>`

**예제:**

```typescript
const dict = getDictionaries('ck3')
console.log(dict['duke']) // "공작"
```

### `hasDictionary(key, gameType)`

사전에 키가 존재하는지 확인합니다.

**매개변수:**
- `key: string` - 검색할 키 (대소문자 무시)
- `gameType: GameType` - 게임 타입

**반환값:** `boolean`

**예제:**

```typescript
if (hasDictionary('duke', 'ck3')) {
  console.log('사전에 존재')
}

// 대소문자 무시
hasDictionary('DUKE', 'ck3') // true
hasDictionary('Duke', 'ck3') // true
```

### `getDictionary(key, gameType)`

사전에서 번역을 조회합니다.

**매개변수:**
- `key: string` - 검색할 키
- `gameType: GameType` - 게임 타입

**반환값:** `string | null`

**예제:**

```typescript
const translation = getDictionary('duke', 'ck3')
console.log(translation) // "공작"
```

### `getTranslationMemories(gameType)`

AI 프롬프트용 번역 메모리 문자열을 생성합니다.

**매개변수:**
- `gameType: GameType` - 게임 타입

**반환값:** `string`

**예제:**

```typescript
const memories = getTranslationMemories('ck3')
/*
 - "duke" → "공작"
 - "stewardship" → "관리력"
 - ...
*/
```

---

## Translation Validator

**모듈:** `scripts/utils/translation-validator.ts`

### `validateTranslation(sourceText, translatedText, gameType)`

번역의 유효성을 검증합니다.

**매개변수:**
- `sourceText: string` - 원본 텍스트
- `translatedText: string` - 번역된 텍스트
- `gameType: GameType` - 게임 타입

**반환값:** `ValidationResult`

```typescript
interface ValidationResult {
  isValid: boolean
  reason?: string
}
```

**예제:**

```typescript
const result = validateTranslation(
  'The [GetTitle] is strong',
  '[GetTitle]은(는) 강력합니다',
  'ck3'
)

if (!result.isValid) {
  console.error('검증 실패:', result.reason)
}
```

**검증 규칙:**
1. 불필요한 LLM 응답
2. 기술 식별자 보존
3. 게임 변수 보존
4. 변수 내부 한글 금지
5. 잘못된 변수 구문 감지

### `validateTranslationEntries(sourceEntries, translationEntries, gameType)`

번역 파일 전체를 검증합니다.

**매개변수:**
- `sourceEntries: Record<string, [string, string]>` - 소스 항목들
- `translationEntries: Record<string, [string, string]>` - 번역 항목들
- `gameType: GameType` - 게임 타입

**반환값:** `Array<{ key, sourceValue, translatedValue, reason }>`

**예제:**

```typescript
const invalidItems = validateTranslationEntries(
  sourceYaml['l_english'],
  targetYaml['l_korean'],
  'ck3'
)

for (const item of invalidItems) {
  console.log(`${item.key}: ${item.reason}`)
}
```

---

## Upstream Manager

**모듈:** `scripts/utils/upstream.ts`

### `updateAllUpstreams(rootPath, targetGameType?)`

모든 upstream 저장소를 업데이트합니다.

**매개변수:**
- `rootPath: string` - 프로젝트 루트 경로
- `targetGameType?: string` - 특정 게임만 업데이트 (선택사항)

**반환값:** `Promise<void>`

**예제:**

```typescript
// 모든 게임 업데이트
await updateAllUpstreams('/path/to/project')

// CK3만 업데이트
await updateAllUpstreams('/path/to/project', 'ck3')
```

### `parseUpstreamConfigs(rootPath, targetGameType?)`

모든 `meta.toml` 파일에서 upstream 설정을 추출합니다.

**매개변수:**
- `rootPath: string` - 프로젝트 루트 경로
- `targetGameType?: string` - 특정 게임만 (선택사항)

**반환값:** `Promise<UpstreamConfig[]>`

```typescript
interface UpstreamConfig {
  url: string              // Git 저장소 URL
  path: string             // 로컬 경로
  localizationPaths: string[] // 파일 경로들
}
```

**예제:**

```typescript
const configs = await parseUpstreamConfigs('/path/to/project', 'ck3')

for (const config of configs) {
  console.log(`URL: ${config.url}`)
  console.log(`Path: ${config.path}`)
}
```

### `updateUpstreamOptimized(config, rootPath)`

개별 upstream을 효율적으로 업데이트합니다.

**매개변수:**
- `config: UpstreamConfig` - Upstream 설정
- `rootPath: string` - 프로젝트 루트 경로

**반환값:** `Promise<void>`

**예제:**

```typescript
const config = {
  url: 'https://github.com/user/mod.git',
  path: 'ck3/ModName/upstream',
  localizationPaths: ['Mod/localization/english']
}

await updateUpstreamOptimized(config, '/path/to/project')
```

**동작:**
1. Partial clone (히스토리 없음)
2. Sparse checkout (필요한 파일만)
3. 최신 버전 체크아웃 (태그 또는 브랜치)

---

## Logger

**모듈:** `scripts/utils/logger.ts`

### `log`

구조화된 로깅 인터페이스입니다.

**메서드:**

#### `log.debug(message, ...args)`

디버그 메시지 출력 (상세)

```typescript
log.debug('상세 정보:', { key: 'value' })
```

#### `log.verbose(message, ...args)`

상세 메시지 출력

```typescript
log.verbose('[RICE/events.yml:key] 번역파일 문자열: hash | "text"')
```

#### `log.info(message, ...args)`

일반 정보 출력

```typescript
log.info('처리 시작')
```

#### `log.start(message, ...args)`

작업 시작 표시

```typescript
log.start('[RICE] 번역 작업 시작')
```

#### `log.success(message, ...args)`

성공 메시지 출력

```typescript
log.success('번역 완료!')
```

#### `log.warn(message, ...args)`

경고 메시지 출력

```typescript
log.warn('파일을 찾을 수 없습니다')
```

#### `log.error(message, ...args)`

에러 메시지 출력

```typescript
log.error('번역 실패:', error)
```

#### `log.box(message)`

강조 박스 메시지 출력

```typescript
log.box(`
  CK3 번역 스크립트
  - 대상: RICE, VIET
  - 모드: 전체 번역
`)
```

---

## Types

### `GameType`

지원하는 게임 타입

```typescript
type GameType = 'ck3' | 'vic3' | 'stellaris'
```

### `ModMeta`

`meta.toml` 파일 구조

```typescript
interface ModMeta {
  upstream: {
    url?: string
    localization: string[]
    language: string
  }
}
```

### `ValidationResult`

번역 검증 결과

```typescript
interface ValidationResult {
  isValid: boolean
  reason?: string
}
```

---

## 사용 예제

### 전체 번역 워크플로우

```typescript
import { processModTranslations } from './factory/translate'
import { log } from './utils/logger'

async function main() {
  try {
    await processModTranslations({
      rootDir: 'ck3/',
      mods: ['RICE', 'VIET'],
      gameType: 'ck3',
      onlyHash: false
    })
    
    log.success('번역 완료!')
  } catch (error) {
    log.error('번역 실패:', error)
    process.exit(1)
  }
}
```

### 캐시 확인 및 번역

```typescript
import { hasCache, getCache, setCache } from './utils/cache'
import { translateAI } from './utils/ai'
import { hashing } from './utils/hashing'

async function translateWithCache(text: string, gameType: GameType) {
  const hash = await hashing(text)
  
  if (await hasCache(hash, gameType)) {
    return await getCache(hash, gameType)
  }
  
  const translated = await translateAI(text, gameType)
  await setCache(hash, translated, gameType)
  
  return translated
}
```

### 사전 우선 번역

```typescript
import { hasDictionary, getDictionary } from './utils/dictionary'

function translate(text: string, gameType: GameType) {
  if (hasDictionary(text, gameType)) {
    return getDictionary(text, gameType)
  }
  
  // 캐시 또는 AI 번역
  return translateWithCache(text, gameType)
}
```

---

## 다음 단계

- [아키텍처](architecture.md) - 시스템 설계
- [번역 파이프라인](translation-pipeline.md) - 처리 흐름
- [개발 가이드](development.md) - 코드 작성

---

**참고:** 이 API는 프로젝트 내부 사용을 위한 것입니다. 공개 API로 사용하려면 추가적인 인터페이스 설계가 필요합니다.
