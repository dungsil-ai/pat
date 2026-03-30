# 개발 가이드

## 개발 환경 설정

### 필수 도구

- **Node.js**: v18+ (LTS 권장)
- **pnpm**: 10.24.0+
- **Git**: 최신 버전
- **TypeScript**: 5.8.3 (프로젝트 의존성에 포함)
- **에디터**: VS Code 권장 (TypeScript 지원)

### 초기 설정

```bash
# 1. 저장소 포크 및 클론
git clone https://github.com/YOUR_USERNAME/paradox-auto-translate.git
cd paradox-auto-translate

# 2. 의존성 설치
pnpm install

# 3. 환경 변수 설정
cp .env.sample .env
# .env 파일에 API 키 입력

# 4. 타입 체크
pnpm exec tsc --noEmit
```

## 프로젝트 구조

```
paradox-auto-translate/
├── .github/              # GitHub Actions 워크플로우
├── docs/                 # 프로젝트 문서
├── scripts/              # 소스 코드
│   ├── ck3.ts           # CK3 진입점
│   ├── vic3.ts          # VIC3 진입점
│   ├── stellaris.ts     # Stellaris 진입점
│   ├── upstream.ts      # Upstream 관리 진입점
│   ├── factory/         # 번역 처리 로직
│   │   └── translate.ts # 핵심 번역 팩토리
│   ├── parser/          # 파일 파서
│   │   ├── index.ts
│   │   ├── toml.ts
│   │   └── yaml.ts
│   └── utils/           # 유틸리티 모듈
│       ├── ai.ts                      # AI 통합
│       ├── cache.ts                   # 캐싱 시스템
│       ├── delay.ts                   # 지연 유틸리티
│       ├── dictionary.ts              # 번역 사전
│       ├── dictionary-invalidator.ts  # 사전 무효화
│       ├── hashing.ts                 # 해싱 유틸리티
│       ├── logger.ts                  # 로깅 시스템
│       ├── prompts.ts                 # AI 프롬프트
│       ├── queue.ts                   # 큐 시스템
│       ├── retranslation-invalidator.ts # 재번역 무효화
│       ├── translate.ts               # 번역 오케스트레이터
│       ├── translation-validator.ts   # 번역 검증
│       └── upstream.ts                # Upstream 관리
├── ck3/                  # CK3 모드 디렉토리
├── vic3/                 # VIC3 모드 디렉토리
├── stellaris/            # Stellaris 모드 디렉토리
├── translate-cache.db    # 번역 캐시 (자동 생성)
├── package.json          # NPM 패키지 설정
├── tsconfig.json         # TypeScript 설정
├── .editorconfig         # 에디터 설정
├── .gitignore            # Git 무시 파일
├── AGENTS.md             # AI 에이전트 가이드
└── README.md             # 프로젝트 README (작성 예정)
```

## 개발 워크플로우

### 1. 기능 브랜치 생성

```bash
git checkout -b feature/your-feature-name
```

### 2. 코드 작성

#### TypeScript 실행 방식

이 프로젝트는 **jiti**를 사용하여 TypeScript를 직접 실행합니다:

```bash
# jiti를 통한 직접 실행 (컴파일 불필요)
pnpm exec jiti scripts/ck3.ts

# 또는 npm 스크립트 사용
pnpm ck3
```

**장점:**
- 빌드 단계 불필요
- 빠른 개발 사이클
- TypeScript 타입 안정성 유지

#### 타입 체크

```bash
# 전체 프로젝트 타입 체크
pnpm exec tsc --noEmit

# 특정 파일 타입 체크
pnpm exec tsc --noEmit scripts/utils/ai.ts
```

### 3. 테스트

이 프로젝트는 Vitest를 사용하여 자동화된 테스트를 제공합니다.

#### 테스트 실행

```bash
# 전체 테스트 실행
pnpm test

# 특정 테스트 파일 실행
pnpm test -- prompts

# 워치 모드로 테스트 실행
pnpm test:watch

# 커버리지와 함께 테스트 실행
pnpm test:coverage
```

#### 테스트 작성 원칙

**제거/작성하지 말아야 할 테스트:**

- **라이브러리/OS API 래퍼 동작 테스트**
  - 예: xxhash-wasm의 유니코드 처리, Node.js의 statfsSync 호출
  - 이유: 외부 의존성의 동작을 테스트하는 것이지 우리의 비즈니스 로직이 아님

- **타이밍/구현 세부사항 테스트**
  - 예: queue.ts의 재시도 백오프가 정확히 2^n초인지, setTimeout이 정확한 밀리초를 지연하는지
  - 이유: 구현 세부사항이 변경되면 테스트가 깨지며, 동작의 정확성을 보장하지 않음

- **정적 문자열 내용 검증 테스트**
  - 예: CK3_SYSTEM_PROMPT에 "Crusader Kings III" 키워드 포함 여부
  - 이유: 상수 값을 확인할 뿐 로직을 검증하지 않으며, 유지보수 시 불필요한 테스트 수정 발생

**작성해야 할 테스트:**

- 비즈니스 로직 및 애플리케이션 동작 테스트
- 함수 로직 테스트 (입력에 따른 출력, 오류 처리)
- 데이터 변환 테스트 (파일명 변환, 경로 매핑 등)

#### 테스트 예제

```typescript
// ✅ 좋은 예: 비즈니스 로직 테스트
describe('getLocalizationFolderName', () => {
  it('CK3는 localization 폴더를 반환해야 함', () => {
    expect(getLocalizationFolderName('ck3')).toBe('localization')
  })
  
  it('Stellaris는 localisation 폴더를 반환해야 함', () => {
    expect(getLocalizationFolderName('stellaris')).toBe('localisation')
  })
  
  it('지원하지 않는 게임 타입에 대해 오류를 발생시켜야 함', () => {
    expect(() => getLocalizationFolderName('invalid')).toThrow()
  })
})

// ❌ 나쁜 예: 정적 문자열 내용 검증
describe('프롬프트 내용', () => {
  it('CK3 프롬프트에 특정 키워드가 포함되어야 함', () => {
    // 상수 검증일 뿐, 로직을 검증하지 않음
    expect(CK3_SYSTEM_PROMPT).toContain('Crusader Kings III')
  })
})

// ❌ 나쁜 예: 라이브러리 내부 동작
describe('해싱', () => {
  it('xxhash 알고리즘이 특정 바이트 패턴을 생성해야 함', () => {
    // xxhash-wasm 라이브러리의 내부 알고리즘 구현을 테스트하는 것
    const hash = hashing('test')
    expect(hash).toMatch(/^[0-9a-f]{16}$/)  // 라이브러리 동작 검증
  })
})
```

#### 테스트 체크리스트

새로운 기능이나 버그 수정을 위한 테스트 작성 시 다음 체크리스트를 확인하세요:

**기본 체크리스트:**
- [ ] 함수의 모든 분기(if/else, switch case)를 테스트하는가?
- [ ] 오류 처리 경로를 테스트하는가?
- [ ] 경계 값(빈 문자열, null, undefined, 0, 음수 등)을 테스트하는가?
- [ ] 테스트 이름이 무엇을 테스트하는지 명확하게 설명하는가?

**피해야 할 안티패턴:**
- [ ] 테스트가 구현 로직을 그대로 복사하고 있지 않은가? (Tautological test)
- [ ] 테스트가 외부 라이브러리/API의 동작을 검증하고 있지 않은가?
- [ ] 테스트가 타이밍이나 구현 세부사항에 의존하지 않는가?
- [ ] 테스트가 정적 문자열 내용만 검증하고 있지 않은가?

**좋은 테스트의 특징:**
- [ ] 테스트가 비즈니스 로직을 검증하는가?
- [ ] 테스트가 실패했을 때 어떤 기능이 깨졌는지 명확한가?
- [ ] 테스트가 독립적으로 실행 가능한가? (다른 테스트에 의존하지 않음)
- [ ] 테스트가 빠르게 실행되는가? (외부 API 호출이나 파일 시스템 접근 최소화)

**예제 체크:**
```typescript
// ✅ 좋은 예: 모든 분기 커버
describe('getSystemPrompt', () => {
  it('번역 모드에서 번역 프롬프트를 반환', () => {
    expect(getSystemPrompt('ck3', false)).toBe(CK3_SYSTEM_PROMPT)
  })
  
  it('음역 모드에서 음역 프롬프트를 반환', () => {
    expect(getSystemPrompt('ck3', true)).toBe(CK3_TRANSLITERATION_PROMPT)
  })
  
  it('지원하지 않는 게임 타입에 오류 발생', () => {
    expect(() => getSystemPrompt('invalid')).toThrow()
  })
})
```

#### 수동 통합 테스트

자동화된 단위 테스트 외에도 수동 통합 테스트를 수행할 수 있습니다:

```bash
# 로컬 테스트 모드 생성
mkdir -p ck3/TestMod
cat > ck3/TestMod/meta.toml << EOF
[upstream]
localization = []
language = "english"
EOF

# 테스트 파일 생성
mkdir -p ck3/TestMod/upstream/localization/english
cat > ck3/TestMod/upstream/localization/english/test_l_english.yml << EOF
l_english:
  test_key: "Test translation"
EOF

# 번역 실행
pnpm ck3

# 결과 확인
cat ck3/TestMod/mod/localization/korean/___test_l_korean.yml
```


### 4. 코드 리뷰 준비

```bash
# 변경 사항 확인
git diff

# 스테이징
git add .

# 커밋
git commit -m "feat: add new feature"

# 푸시
git push origin feature/your-feature-name
```

### 5. Pull Request 생성

GitHub에서 Pull Request를 생성하고 다음을 포함하세요:
- 변경 사항 설명
- 테스트 방법
- 관련 이슈 번호

## 코드 스타일

### TypeScript 규칙

#### 명명 규칙

```typescript
// 변수/함수: camelCase
const translationCache = createStorage()
async function processLanguageFile() {}

// 타입/인터페이스: PascalCase
interface UpstreamConfig {}
type GameType = 'ck3' | 'vic3' | 'stellaris'

// 상수: UPPER_SNAKE_CASE
const MAX_RETRY_COUNT = 3
```

#### 비동기 처리

```typescript
// async/await 사용 (Promise 체이닝 지양)
async function translateText(text: string): Promise<string> {
  const cached = await getCache(text)
  if (cached) return cached
  
  const translated = await translateAI(text)
  await setCache(text, translated)
  return translated
}
```

#### 에러 핸들링

```typescript
// try-catch 사용
try {
  await processTranslation()
} catch (error) {
  log.error('번역 처리 실패:', error)
  throw new Error('Translation failed', { cause: error })
}
```

#### 타입 안정성

```typescript
// any 지양, 명시적 타입 사용
interface ModMeta {
  upstream: {
    url?: string
    localization: string[]
    language: string
  }
}

// 타입 가드 사용
function isValidGameType(type: string): type is GameType {
  return ['ck3', 'vic3', 'stellaris'].includes(type)
}
```

### 파일 구조 규칙

#### 임포트 순서

```typescript
// 1. Node.js 내장 모듈
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// 2. 외부 라이브러리
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import dotenv from 'dotenv'

// 3. 내부 모듈
import { log } from './utils/logger'
import { parseYaml } from './parser/yaml'
```

#### 함수 순서

```typescript
// 1. 타입/인터페이스 정의
interface Config {}

// 2. 상수
const DEFAULT_CONFIG = {}

// 3. Export 함수 (공개 API)
export async function publicFunction() {}

// 4. 내부 함수 (비공개)
async function privateHelper() {}
```

### 주석 규칙

```typescript
/**
 * 함수 설명 (JSDoc)
 * 
 * @param text 번역할 텍스트
 * @param gameType 게임 타입
 * @returns 번역된 텍스트
 */
export async function translate(text: string, gameType: GameType): Promise<string> {
  // 단일 라인 주석은 간결하게
  const cached = await getCache(text, gameType)
  
  // 복잡한 로직에는 설명 추가
  if (!cached) {
    // 캐시 미스: AI 번역 요청
    // 재시도 로직 포함
    return await translateWithRetry(text, gameType)
  }
  
  return cached
}
```

## 새 기능 추가

### 새 게임 지원 추가

#### 1. 타입 정의 추가

```typescript
// scripts/utils/prompts.ts
export type GameType = 'ck3' | 'vic3' | 'stellaris' | 'newgame'
```

#### 2. 시스템 프롬프트 작성

```typescript
// scripts/utils/prompts.ts
const NEWGAME_SYSTEM_PROMPT = `
You are an expert translator specializing in "New Game" localization...

Guidelines:
1. Maintain game-specific terminology...
2. Preserve game variables...
...
`

export function getSystemPrompt(gameType: GameType): string {
  switch (gameType) {
    case 'newgame':
      return NEWGAME_SYSTEM_PROMPT
    // ...
    default:
      throw new Error(`Unsupported game type: ${gameType}`)
  }
}
```

#### 3. 사전 추가

```typescript
// scripts/utils/dictionary.ts
const newgameDictionaries: Record<string, string> = {
  'common_term': '일반 용어',
  // ...
}

export function getDictionaries(gameType: GameType): Record<string, string> {
  switch (gameType) {
    case 'newgame':
      return newgameDictionaries
    // ...
  }
}
```

#### 4. 진입점 생성

```typescript
// scripts/newgame.ts
import process from 'node:process'
import { readdir } from 'node:fs/promises'
import { join } from 'pathe'
import { processModTranslations } from './factory/translate'
import { log } from './utils/logger'

async function main() {
  const newgameDir = join(import.meta.dirname, '..', 'newgame')
  const mods = await readdir(newgameDir)
  const onlyHash = process.argv?.[2] === 'onlyHash'

  log.box(`
    NewGame 번역 스크립트 구동
    - 번역 대상 경로: ${newgameDir}
    - 번역 대상 모드 (${mods.length}개): ${mods}
  `)

  await processModTranslations({
    rootDir: newgameDir,
    mods,
    gameType: 'newgame',
    onlyHash
  })

  log.success('번역 완료!')
}

main().catch((error) => {
  log.error('번역 도중 오류가 발생하였습니다.', error)
  process.exit(1)
})
```

#### 5. NPM 스크립트 추가

```json
// package.json
{
  "scripts": {
    "newgame": "jiti scripts/newgame.ts",
    "newgame:update-hash": "jiti scripts/newgame.ts onlyHash",
    "newgame:update-dict": "jiti scripts/newgame.ts updateDict",
    "newgame:retranslate": "jiti scripts/newgame.ts retranslate"
  }
}
```

#### 6. 게임별 설정 추가

```typescript
// scripts/factory/translate.ts
function getLocalizationFolderName(gameType: GameType): string {
  switch (gameType) {
    case 'newgame':
      return 'localization' // 또는 게임에 맞는 폴더명
    // ...
  }
}
```

#### 7. 테스트

```bash
# 디렉토리 생성
mkdir -p newgame/TestMod

# meta.toml 작성
cat > newgame/TestMod/meta.toml << EOF
[upstream]
url = "https://github.com/example/test-mod.git"
localization = ["TestMod/localization/english"]
language = "english"
EOF

# 테스트 실행
pnpm newgame
```

### 새 유틸리티 함수 추가

#### 예: 텍스트 정규화 함수

```typescript
// scripts/utils/text-normalizer.ts

/**
 * 번역 전 텍스트를 정규화합니다.
 */
export function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')  // 연속 공백 제거
    .replace(/\n+/g, '\n') // 연속 개행 제거
}

/**
 * 번역 후 텍스트를 정규화합니다.
 */
export function normalizeTranslation(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
}
```

#### 테스트

```typescript
// scripts/utils/__tests__/text-normalizer.test.ts (수동 테스트)
import { normalizeText } from '../text-normalizer'

console.log(normalizeText('  hello  world  ')) // "hello world"
console.log(normalizeText('line1\n\n\nline2')) // "line1\nline2"
```

### 새 검증 규칙 추가

```typescript
// scripts/utils/translation-validator.ts

// 기존 validateTranslation 함수에 규칙 추가
export function validateTranslation(
  sourceText: string,
  translatedText: string,
  gameType: GameType = 'ck3'
): ValidationResult {
  // ... 기존 검증 ...

  // 새 규칙: 괄호 균형 검사
  const sourceParenCount = (sourceText.match(/\(/g) || []).length
  const targetParenCount = (translatedText.match(/\(/g) || []).length
  
  if (sourceParenCount !== targetParenCount) {
    return {
      isValid: false,
      reason: '괄호 개수 불일치'
    }
  }

  return { isValid: true }
}
```

## 디버깅

### 로깅 레벨 조절

```typescript
// scripts/utils/logger.ts
import { createConsola } from 'consola'

export const log = createConsola({
  level: 5, // 0: silent, 5: verbose
})

// 사용 예
log.debug('디버그 메시지')    // level 5
log.verbose('상세 메시지')     // level 4
log.info('일반 메시지')        // level 3
log.warn('경고')              // level 2
log.error('에러')             // level 1
```

### 중단점 디버깅

VS Code `launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug CK3 Translation",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/node_modules/.bin/jiti",
      "args": ["scripts/ck3.ts"],
      "env": {
        "NODE_ENV": "development"
      }
    }
  ]
}
```

### 캐시 무효화

```bash
# 전체 캐시 삭제 (주의: 모든 번역 재수행)
rm translate-cache.db*

# 특정 게임만 캐시 삭제 (수동)
# SQLite 도구 사용하여 특정 키 삭제
```

## 성능 최적화

### 병렬 처리 최적화

```typescript
// 나쁜 예: 순차 처리
for (const file of files) {
  await processFile(file)
}

// 좋은 예: 병렬 처리
await Promise.all(files.map(file => processFile(file)))

// 더 나은 예: 제한된 병렬 처리 (리소스 절약)
const BATCH_SIZE = 5
for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = files.slice(i, i + BATCH_SIZE)
  await Promise.all(batch.map(file => processFile(file)))
}
```

### 메모리 최적화

```typescript
// 큰 파일 처리 시 스트림 사용 고려
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

async function processLargeFile(path: string) {
  const fileStream = createReadStream(path)
  const rl = createInterface({ input: fileStream })
  
  for await (const line of rl) {
    // 라인별 처리
  }
}
```

## 문서화

### 코드 주석

```typescript
/**
 * 번역 요청을 처리합니다.
 * 
 * @param sourceText - 번역할 원본 텍스트
 * @param sourceHash - 원본 텍스트의 해시
 * @param gameType - 게임 타입 (기본값: 'ck3')
 * @returns 번역된 텍스트
 * @throws {Error} API 호출 실패 시
 * 
 * @example
 * ```typescript
 * const translated = await translate('Hello', 'abc123', 'ck3')
 * console.log(translated) // "안녕하세요"
 * ```
 */
export async function translate(
  sourceText: string,
  sourceHash: string,
  gameType: GameType = 'ck3'
): Promise<string> {
  // 구현...
}
```

### README 업데이트

새 기능을 추가하거나 사용법이 변경되면 README를 업데이트하세요.

### 문서 업데이트

`docs/` 디렉토리의 관련 문서를 업데이트하세요:
- 아키텍처 변경 → `architecture.md`
- API 변경 → `api-reference.md`
- 사용법 변경 → `usage.md`

## 기여 가이드라인

### 커밋 메시지

```
<type>(<scope>): <subject>

<body>

<footer>
```

**타입:**
- `feat`: 새 기능
- `fix`: 버그 수정
- `docs`: 문서 변경
- `style`: 코드 포맷팅 (기능 변경 없음)
- `refactor`: 리팩토링
- `perf`: 성능 개선
- `test`: 테스트 추가/수정
- `chore`: 빌드/도구 변경

**예:**
```
feat(ck3): add new validation rule for parentheses

Add validation to check parentheses balance in translations.
This prevents malformed game text.

Closes #123
```

### Pull Request

- 작은 단위로 PR 생성
- 명확한 설명 작성
- 관련 이슈 링크
- 테스트 방법 포함

### 코드 리뷰

- 건설적인 피드백 제공
- 구체적인 개선 제안
- 질문은 명확하게

## 트러블슈팅

### TypeScript 에러

```bash
# 타입 에러 확인
pnpm exec tsc --noEmit

# node_modules 재설치
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### Git 충돌

```bash
# main 브랜치 최신화
git checkout main
git pull origin main

# 기능 브랜치에 리베이스
git checkout feature/your-feature
git rebase main

# 충돌 해결 후
git add .
git rebase --continue
```

### 개발 환경 문제

```bash
# Node.js 버전 확인
node --version  # v18+

# pnpm 버전 확인
pnpm --version  # 10.18.2+

# 환경 변수 확인
cat .env
```

## 추가 리소스

- [TypeScript 공식 문서](https://www.typescriptlang.org/docs/)
- [Google Gemini API 문서](https://ai.google.dev/docs)
- [Paradox 모딩 위키](https://ck3.paradoxwikis.com/Modding)

---

질문이나 제안사항이 있으면 이슈를 생성하거나 토론에 참여해주세요.
