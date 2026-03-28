# 아키텍처

## 시스템 개요

Paradox Auto Translate는 메타데이터 기반 번역 파이프라인 아키텍처를 채택하고 있습니다. 각 컴포넌트는 독립적으로 작동하며, 명확한 책임 분리를 통해 유지보수성과 확장성을 확보합니다.

## 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────┐
│                     Entry Points                             │
│  (ck3.ts / vic3.ts / stellaris.ts / upstream.ts)            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                  Translation Factory                         │
│              (factory/translate.ts)                          │
│                                                              │
│  • Upstream 업데이트 오케스트레이션                           │
│  • 모드 발견 및 메타데이터 파싱                               │
│  • 병렬 처리 관리                                            │
└──────┬────────────────┬────────────────┬────────────────────┘
       │                │                │
       ▼                ▼                ▼
┌─────────────┐  ┌─────────────┐  ┌──────────────┐
│   Parsers   │  │  Utilities  │  │  Validation  │
└─────────────┘  └─────────────┘  └──────────────┘
       │                │                │
       │                │                │
   ┌───┴────┐      ┌────┴────┐      ┌───┴────┐
   │ YAML   │      │ Upstream│      │Validator│
   │ TOML   │      │ AI/Cache│      │         │
   │        │      │Dictionary│      │         │
   └────────┘      └─────────┘      └─────────┘
```

## 핵심 컴포넌트

### 1. Entry Points (진입점)

각 게임별 독립적인 CLI 진입점을 제공합니다.

**파일 위치:**
- `scripts/ck3.ts`
- `scripts/vic3.ts`
- `scripts/stellaris.ts`
- `scripts/upstream.ts`

**책임:**
- 커맨드 라인 인자 파싱
- 작업 모드 결정 (번역 / 해시 업데이트 / 사전 무효화 / 재번역)
- Translation Factory 호출
- 에러 핸들링 및 종료 코드 관리

**예제:**
```typescript
// ck3.ts
const onlyHash = process.argv?.[2] === 'onlyHash'
const updateDict = process.argv?.[2] === 'updateDict'
const retranslate = process.argv?.[2] === 'retranslate'

if (updateDict) {
  await invalidateDictionaryTranslations('ck3', ck3Dir)
} else if (retranslate) {
  await invalidateIncorrectTranslations('ck3', ck3Dir)
} else {
  await processModTranslations({ rootDir: ck3Dir, mods, gameType: 'ck3', onlyHash })
}
```

### 2. Translation Factory

번역 처리의 핵심 오케스트레이터입니다.

**파일 위치:** `scripts/factory/translate.ts`

**주요 함수:**
- `processModTranslations()`: 모든 모드의 번역 처리 조율
- `processLanguageFile()`: 개별 파일 번역 처리
- `getLocalizationFolderName()`: 게임별 폴더명 결정
- `saveAndReturnResult()`: 번역 결과 저장 및 반환 (내부 함수, 2025-12 추가)
- **병렬 처리 기본값**: 모드 개수만큼 워커를 자동 할당하며 ETC의 `upstream/` 하위 폴더도 개별 모드로 계산
- **업스트림 해시 스킵**: 업스트림 파일 해시가 이전 실행과 동일하면 파일 단위로 번역을 건너뛰어 실행 시간 절약

**처리 흐름:**
```typescript
export async function processModTranslations ({ rootDir, mods, gameType, onlyHash }: ModTranslationsOptions) {
  // 1. Upstream 업데이트
  await updateAllUpstreams(projectRoot, gameType)
  
  const allUntranslatedItems: UntranslatedItem[] = []
  
  // 2. 각 모드 처리
  for (const mod of mods) {
    // 2.1. meta.toml 파싱
    const meta = parseToml(metaContent)
    
    // 2.2. 각 localization 경로 처리
    for (const locPath of meta.upstream.localization) {
      // 2.3. 소스 파일 발견
      const sourceFiles = await readdir(sourceDir, { recursive: true })
      
      // 2.4. 병렬 번역 처리
      processes.push(processLanguageFile(...))
    }
    
    // 2.5. 번역 거부 처리 (2025-12 추가)
    try {
      const results = await Promise.all(processes)
      const untranslatedItems = results.flat()
      allUntranslatedItems.push(...untranslatedItems)
    } catch (error) {
      if (error instanceof TranslationRefusalStopError) {
        log.warn(`[${mod}] 번역 거부로 인해 번역 중단됨`)
        // 처리된 항목까지 저장하고 graceful exit
        return saveAndReturnResult(projectRoot, gameType, allUntranslatedItems)
      }
      throw error
    }
  }
  
  // 3. 번역 결과 저장 및 반환
  return saveAndReturnResult(projectRoot, gameType, allUntranslatedItems)
}
```

**번역 거부 처리 (2025-12):**
- AI 번역 거부 시 자동 감지 (`TranslationRefusedError`)
- 처리된 항목까지 중간 저장 (graceful degradation)
- `{game}-untranslated-items.json` 파일로 리포트 저장
- 모드, 파일, 키, 원문 메시지 정보 포함
- GitHub Actions에서 자동으로 Issues 생성

### 3. Parsers (파서)

다양한 파일 형식을 파싱하고 직렬화합니다.

**파일 위치:** `scripts/parser/`

#### YAML Parser (`yaml.ts`)
Paradox 게임의 localization 파일 형식을 처리합니다.

**특징:**
- UTF-8 BOM 지원 (`\uFEFF`)
- 주석 보존
- 해시 메타데이터 관리

**구조:**
```typescript
// 파싱 결과 구조
Record<string, Record<string, [string, string | null]>>
//     ↑              ↑            ↑       ↑
//  언어키(l_english)  항목키      텍스트   해시

// 예제
{
  "l_english": {
    "key_name": ["Translated text", "abc123hash"],
    "another_key": ["More text", "def456hash"]
  }
}
```

**함수:**
- `parseYaml()`: YAML 문자열 → 객체
- `stringifyYaml()`: 객체 → YAML 문자열
- `parseYamlValue()`: 값 파싱 (텍스트와 주석 분리)

#### TOML Parser (`toml.ts`)
`meta.toml` 설정 파일을 파싱합니다.

**예제 설정:**
```toml
[upstream]
url = "https://github.com/cybrxkhan/RICE-for-CK3.git"
localization = ["RICE/localization/english", "RICE/localization/replace/english"]
language = "english"
```

### 4. Upstream Manager

Git 저장소 동기화를 효율적으로 관리합니다.

**파일 위치:** `scripts/utils/upstream.ts`

**핵심 개념:**
- **Sparse Checkout**: 필요한 파일만 다운로드
- **Partial Clone**: 전체 히스토리 없이 최신 버전만
- **병렬 처리**: 여러 저장소 동시 업데이트
- **게임/모드별 필터링**: 특정 게임이나 모드만 업데이트 가능

**주요 함수:**

#### `updateAllUpstreams(rootPath, targetGameType?, targetMod?)`
모든 upstream 저장소를 병렬로 업데이트합니다.

```typescript
// 사용 예
await updateAllUpstreams('/path/to/project')                // 모든 게임
await updateAllUpstreams('/path/to/project', 'ck3')         // CK3만
await updateAllUpstreams('/path/to/project', 'ck3', 'RICE') // CK3의 RICE 모드만
```

**CLI 사용법:**
```bash
pnpm upstream                  # 모든 게임의 모든 모드
pnpm upstream ck3              # CK3 게임만
pnpm upstream ck3 RICE         # CK3의 RICE 모드만
pnpm upstream --help           # 도움말
```

#### `parseUpstreamConfigs(rootPath, targetGameType?, targetMod?)`
`meta.toml` 파일에서 upstream 설정을 추출합니다.

```typescript
interface UpstreamConfig {
  url: string                 // Git 저장소 URL
  path: string                // 로컬 upstream 경로
  localizationPaths: string[] // 다운로드할 파일 경로
}
```

#### `updateUpstreamOptimized(config, rootPath)`
Sparse checkout과 partial clone을 사용한 효율적인 클론/업데이트:

```typescript
async function cloneOptimizedRepository(path: string, config: UpstreamConfig) {
  // 1. Shallow clone과 partial clone 초기화 (--depth=1 추가, 2025-11)
  await execAsync('git clone --filter=blob:none --no-checkout --depth=1 ...')
  
  // 2. Sparse checkout 설정
  await execAsync('git sparse-checkout init --cone')
  await execAsync(`git sparse-checkout set ${locPaths.join(' ')}`)
  
  // 3. 최신 버전 체크아웃
  await checkoutLatestVersion(path, config.path)
}
```

**버전 관리:**
- 태그가 있는 경우: 최신 태그 사용 (시맨틱 버전 정렬)
- 태그가 없는 경우: 기본 브랜치의 최신 커밋 사용

**최적화 개선 (2025-11~12):**
- **Shallow Clone 추가**: `--depth=1` 옵션으로 디스크 사용량 최대 90% 절감
- **자동 Unshallow**: 기존 shallow clone 업데이트 시 자동으로 `--unshallow` 처리
- **게임/모드별 필터링**: 특정 게임이나 모드만 업데이트 가능
- **Git 태그 정렬 개선**: GitHub Releases API를 통한 시맨틱 버전 기반 최신 태그 감지

### 5. AI Integration

Google Gemini API를 통한 AI 번역을 관리합니다.

**파일 위치:** `scripts/utils/ai.ts`

**모델 전략:**
1. 1차 시도: `gemini-flash-lite-latest` (빠르고 저렴)
2. 2차 시도: `gemini-flash-latest` (더 강력)

**설정:**
```typescript
const generationConfig = {
  temperature: 0.5,  // 창의성 vs 일관성 균형
  topP: 0.95,       // 핵 샘플링
  topK: 40,         // 상위 K개 토큰
  maxOutputTokens: 8192
}
```

**시스템 프롬프트:**
게임별 맞춤 프롬프트 (`utils/prompts.ts`):
- CK3: 중세 역사 및 봉건제 맥락
- VIC3: 19-20세기 산업화 시대
- Stellaris: SF 및 우주 탐험

**후처리:**
```typescript
const translated = response.text().trim()
  .replaceAll(/\n/g, '\\n')              // 개행 이스케이프
  .replaceAll(/[^\\]"/g, '\\"')          // 따옴표 이스케이프
  .replaceAll(/#약(하게|화된|[화한])/g, '#weak')  // 한글 마크업 수정
  .replaceAll(/#강조/g, '#bold')
```

### 6. Caching System

번역 결과를 영구 저장하여 API 비용을 절감합니다.

**파일 위치:** `scripts/utils/cache.ts`

**기술 스택:**
- **db0**: 데이터베이스 추상화 계층
- **LibSQL**: SQLite 호환 데이터베이스
- **unstorage**: 통합 저장소 인터페이스

**캐시 키 전략:**
```typescript
function getCacheKey(key: string, gameType: GameType): string {
  // CK3는 하위 호환성을 위해 프리픽스 없음
  if (gameType === 'ck3') return key
  
  // 다른 게임은 프리픽스 포함
  return `${gameType}:${key}`
}
```

**API:**
- `hasCache(key, gameType)`: 캐시 존재 여부
- `getCache(key, gameType)`: 캐시된 번역 조회
- `setCache(key, value, gameType)`: 번역 저장
- `removeCache(key, gameType)`: 캐시 무효화

### 7. Hashing System

컨텐츠 변경 감지를 위한 해싱 시스템입니다.

**파일 위치:** `scripts/utils/hashing.ts`

**알고리즘:** xxHash (빠른 비암호화 해시)

**용도:**
- 소스 텍스트 변경 감지
- 번역 유효성 검증
- 캐시 키 생성

**워크플로우:**
```typescript
const sourceHash = hashing(sourceValue)
const [targetValue, targetHash] = targetYaml[langKey][key] || []

if (sourceHash === targetHash) {
  // 변경 없음, 기존 번역 사용
  newYaml.l_korean[key] = [targetValue, targetHash]
} else {
  // 변경 감지, 재번역 필요
  const translated = await translate(sourceValue, sourceHash, gameType)
  newYaml.l_korean[key] = [translated, sourceHash]
}
```

### 8. Dictionary System

수동 번역 및 용어 통일을 위한 사전 시스템입니다.

**파일 위치:** `scripts/utils/dictionary.ts`

**구조:**
```typescript
// 게임별 사전
const ck3Dictionaries: Record<string, string> = {
  'duke': '공작',
  'high king': '고왕',
  'stewardship': '관리력',
  // ...
}

const stellarisDictionaries: Record<string, string> = {
  'empire': '제국',
  'federation': '연방',
  // ...
}

const vic3Dictionaries: Record<string, string> = {
  'ok': '네',
  // ...
}
```

**우선순위:**
1. Dictionary (최고 우선순위)
2. Cache
3. AI Translation

**API:**
- `getDictionaries(gameType)`: 게임별 사전 조회
- `hasDictionary(key, gameType)`: 사전 항목 존재 여부
- `getDictionary(key, gameType)`: 사전 번역 조회
- `getTranslationMemories(gameType)`: AI 프롬프트용 번역 메모리

### 9. Translation Validator

번역 품질을 검증하는 시스템입니다.

**파일 위치:** `scripts/utils/translation-validator.ts`

**검증 규칙:**

#### 1. 불필요한 LLM 응답 감지
```typescript
const unwantedResponses = [
  /네,?\s*(알겠습니다|이해했습니다)/i,
  /yes,?\s*(i understand|understood)/i,
  // ...
]
```

#### 2. 기술 식별자 보존
```typescript
// snake_case 패턴 (mod_icon_*, event_type_*)은 번역하지 않아야 함
if (!/^[a-z_]+$/.test(translatedText)) {
  return { isValid: false, reason: '기술 식별자가 번역됨' }
}
```

#### 3. 게임 변수 보존
```typescript
// 원본: "The [GetTitle] is strong"
// 번역: "[GetTitle]은(는) 강력합니다"
// ✓ 변수 보존됨

// 원본: "The [GetTitle] is strong"
// 번역: "제목은 강력합니다"
// ✗ 변수 누락됨
```

#### 4. 변수 내부 한글 검증
```typescript
// ✗ 잘못된 예: [Get제목] (변수 내부에 한글)
// ✓ 올바른 예: [GetTitle]
```

#### 5. 잘못된 변수 구문 감지
```typescript
// 잘못된 패턴들:
// $[culture|E]  - Dollar sign과 square bracket 혼합
// £[variable]£  - Pound sign과 square bracket 혼합
// @<variable>@  - At sign과 angle bracket 혼합
```

**API:**
- `validateTranslation()`: 단일 번역 검증
- `validateTranslationEntries()`: 파일 전체 검증
- `normalizeGameVariableStructure()`: 변수 구조 정규화

### 10. Retranslation System

잘못된 번역을 찾아 무효화하는 시스템입니다.

**파일 위치:** `scripts/utils/retranslation-invalidator.ts`

**처리 과정:**
1. 모든 번역 파일 스캔
2. 각 항목에 대해 검증 수행
3. 잘못된 번역 발견 시 캐시 무효화
4. 다음 번역 실행 시 재번역 트리거

**사용 예:**
```bash
pnpm ck3:retranslate
```

### 11. Dictionary Invalidator

사전 업데이트 시 관련 번역을 무효화합니다.

**파일 위치:** `scripts/utils/dictionary-invalidator.ts`

**처리 과정:**
1. 사전에 있는 모든 키 추출
2. 번역 파일에서 해당 키 포함 항목 검색
3. 발견된 항목의 캐시 무효화
4. 다음 번역 실행 시 사전 기반 재번역

**사용 예:**
```bash
pnpm ck3:update-dict
```

### 12. Queue System

API 요청 속도 제한 및 재시도를 관리합니다.

**파일 위치:** `scripts/utils/queue.ts`

**기능:**
- 요청 큐잉
- 동시 요청 제한
- 실패 시 재시도
- 백오프 전략

### 13. Logger System

구조화된 로깅을 제공합니다.

**파일 위치:** `scripts/utils/logger.ts`

**기반:** consola (컬러풀하고 구조화된 로깅)

**로그 레벨:**
- `debug`: 상세 디버깅 정보
- `verbose`: 자세한 처리 로그
- `info`: 일반 정보
- `start`: 작업 시작
- `success`: 작업 완료
- `warn`: 경고
- `error`: 에러
- `box`: 강조 박스 메시지

## 데이터 흐름

### 전체 번역 프로세스

```
1. Entry Point (ck3.ts)
   ↓
2. Translation Factory (processModTranslations)
   ↓
3. Upstream Update (updateAllUpstreams)
   ├─ Parse meta.toml
   ├─ Git sparse checkout
   └─ Checkout latest version
   ↓
4. Mod Discovery
   ├─ Read mod directories
   └─ Parse meta.toml for each mod
   ↓
5. File Processing (processLanguageFile)
   ├─ Parse source YAML (l_english)
   ├─ Parse target YAML (l_korean)
   └─ For each localization key:
       ↓
6. Translation Decision Tree
   ├─ Hash matches? → Use existing translation
   ├─ In dictionary? → Use dictionary translation
   ├─ In cache? → Use cached translation
   └─ Otherwise: → Request AI translation
       ↓
7. AI Translation (if needed)
   ├─ Build prompt with system instruction
   ├─ Call Gemini API (with retry)
   ├─ Post-process response
   └─ Validate translation
       ↓
8. Cache Update
   ├─ Store translation in cache
   └─ Update hash in YAML
       ↓
9. Output Generation
   ├─ Stringify YAML
   └─ Write to ___*_l_korean.yml
```

### 캐시 히트 시나리오

```
Source: "The duke is powerful"
Hash: abc123

Decision Tree:
┌─────────────────────────────┐
│ 1. Check dictionary         │ → Not found
├─────────────────────────────┤
│ 2. Compare hash             │ → abc123 == abc123 ✓
├─────────────────────────────┤
│ 3. Use existing translation │ → "공작이 강력합니다"
└─────────────────────────────┘

Result: No API call, instant translation
```

### 캐시 미스 시나리오

```
Source: "The duke is powerful" (updated to "The duke is very powerful")
Hash: def456 (changed)

Decision Tree:
┌─────────────────────────────┐
│ 1. Check dictionary         │ → Not found
├─────────────────────────────┤
│ 2. Compare hash             │ → def456 != abc123 ✗
├─────────────────────────────┤
│ 3. Check cache              │ → Cache miss
├─────────────────────────────┤
│ 4. Call AI API              │ → "공작이 매우 강력합니다"
├─────────────────────────────┤
│ 5. Validate translation     │ → Pass
├─────────────────────────────┤
│ 6. Update cache & hash      │ → Store with hash def456
└─────────────────────────────┘

Result: API call made, new translation cached
```

## 확장성 고려사항

### 새로운 게임 추가

1. **Entry Point 생성**
   ```typescript
   // scripts/newgame.ts
   await processModTranslations({
     rootDir: newgameDir,
     mods,
     gameType: 'newgame',
     onlyHash
   })
   ```

2. **GameType 타입 확장**
   ```typescript
   // scripts/utils/prompts.ts
   export type GameType = 'ck3' | 'stellaris' | 'vic3' | 'newgame'
   ```

3. **시스템 프롬프트 추가**
   ```typescript
   // scripts/utils/prompts.ts
   const NEWGAME_SYSTEM_PROMPT = `...`
   
   export function getSystemPrompt(gameType: GameType): string {
     switch (gameType) {
       case 'newgame': return NEWGAME_SYSTEM_PROMPT
       // ...
     }
   }
   ```

4. **사전 추가**
   ```typescript
   // scripts/utils/dictionary.ts
   const newgameDictionaries: Record<string, string> = { ... }
   ```

5. **NPM 스크립트 추가**
   ```json
   // package.json
   {
     "scripts": {
       "newgame": "jiti scripts/newgame.ts",
       "newgame:update-hash": "jiti scripts/newgame.ts onlyHash"
     }
   }
   ```

### 새로운 모드 추가

1. **모드 디렉토리 생성**
   ```
   ck3/NewMod/
   ```

2. **meta.toml 작성**
   ```toml
   [upstream]
   url = "https://github.com/modder/NewMod.git"
   localization = ["NewMod/localization/english"]
   language = "english"
   ```

3. **번역 실행**
   ```bash
   pnpm ck3
   ```

## 성능 최적화

### 병렬 처리
- 모드별 독립 처리 (Promise.all)
- Upstream 업데이트 병렬화
- 파일별 비동기 처리

### 메모리 효율성
- Sparse checkout으로 디스크 사용 최소화
- 스트림 기반 파일 처리 (필요시)
- 캐시 데이터베이스 인덱싱

### API 비용 절감
- 다층 캐싱 (Dictionary → Cache → AI)
- 해시 기반 변경 감지
- 배치 처리 및 큐잉

## 보안 고려사항

### API 키 관리
- 환경 변수 기반 설정 (`.env`)
- `.env.sample` 제공
- 키 파일 `.gitignore` 등록

### 데이터 검증
- 입력 검증 (파일 경로, 명령 인자)
- 출력 검증 (번역 품질 검사)
- Git 명령 인젝션 방지

### 에러 핸들링
- Try-catch 블록
- 명확한 에러 메시지
- 실패 시 롤백 없이 중단 (명시적 재시도 필요)

---

다음 단계: [번역 파이프라인](translation-pipeline.md) 문서에서 상세한 처리 과정을 확인하세요.
