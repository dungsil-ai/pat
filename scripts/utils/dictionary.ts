// noinspection SpellCheckingInspection
import { type GameType } from './types'
import { parse as parseToml } from '@iarna/toml'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// 프로젝트 루트 디렉토리
const projectRoot = join(import.meta.dirname, '../..')

interface GameDictionaryBundle {
  all: Record<string, string>
  glossary: Record<string, string>
  properNouns: Record<string, string>
  lookup: Record<string, string>
}

/**
 * TOML 파일에서 단어사전을 로드합니다.
 * @param filename 파일명 (dictionaries/ 디렉토리 기준 상대 경로)
 * @returns 단어사전 객체
 */
function loadDictionaryFromFile(filename: string): Record<string, string> {
  const filePath = join(projectRoot, 'dictionaries', filename)
  try {
    const content = readFileSync(filePath, 'utf-8')
    const parsed = parseToml(content)
    
    // TOML 파싱 결과를 Record<string, string>으로 변환
    const dict: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        dict[key] = value
      } else {
        console.warn(`[dictionary] 비문자열 값을 건너뜁니다: ${filename}의 ${key} (타입: ${typeof value})`)
      }
    }
    
    return dict
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      console.warn(
        `[dictionary] 딕셔너리 파일을 찾을 수 없습니다: ${filePath}\n` +
        `빈 딕셔너리가 대신 사용됩니다.\n` +
        `해결 방법: 위 경로에 TOML 형식의 파일을 생성하세요.`
      )
      return {}
    } else {
      console.warn(
        `[dictionary] 딕셔너리 로드 실패: ${filePath}: ${getErrorMessage(error)}\n` +
        `빈 딕셔너리가 대신 사용됩니다.\n` +
        `해결 방법: 파일의 TOML 문법 오류를 확인하세요.`
      )
      return {}
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function createNormalizedLookup(dictionary: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dictionary).map(([key, value]) => [normalizeKey(key), value])
  )
}

// CK3 일반 용어 사전 (번역 메모리로 LLM에 전달됨)
// 게임 용어, 일반 표현, 가문명 접두사/접미사 등을 포함
const ck3Glossary: Record<string, string> = loadDictionaryFromFile('ck3-glossary.toml')

// CK3 고유명사 사전 (번역 메모리에 포함되지 않음)
// 이름, 가문명, 지명 등의 고유명사
const ck3ProperNouns: Record<string, string> = loadDictionaryFromFile('ck3-proper-nouns.toml')

// Stellaris 전용 딕셔너리
const stellarisDictionaries: Record<string, string> = loadDictionaryFromFile('stellaris.toml')

// VIC3 전용 딕셔너리
const vic3Dictionaries: Record<string, string> = loadDictionaryFromFile('vic3.toml')

// CK3 딕셔너리: 일반 용어와 고유명사를 합친 전체 사전
const ck3Dictionaries: Record<string, string> = { ...ck3Glossary, ...ck3ProperNouns }

const EMPTY_DICTIONARY: Record<string, string> = {}

const gameDictionaryBundles: Record<GameType, GameDictionaryBundle> = {
  ck3: {
    all: ck3Dictionaries,
    glossary: ck3Glossary,
    properNouns: ck3ProperNouns,
    lookup: createNormalizedLookup(ck3Dictionaries)
  },
  stellaris: {
    all: stellarisDictionaries,
    glossary: stellarisDictionaries,
    properNouns: EMPTY_DICTIONARY,
    lookup: createNormalizedLookup(stellarisDictionaries)
  },
  vic3: {
    all: vic3Dictionaries,
    glossary: vic3Dictionaries,
    properNouns: EMPTY_DICTIONARY,
    lookup: createNormalizedLookup(vic3Dictionaries)
  }
}

function getGameDictionaryBundle(gameType: GameType): GameDictionaryBundle {
  const bundle = gameDictionaryBundles[gameType]
  if (!bundle) {
    throw new Error(`Unsupported game type: ${gameType}`)
  }

  return bundle
}

export function getDictionaries(gameType: GameType): Record<string, string> {
  return getGameDictionaryBundle(gameType).all
}

// 일반 용어만 반환하는 함수 (번역 메모리용)
export function getGlossary(gameType: GameType): Record<string, string> {
  return getGameDictionaryBundle(gameType).glossary
}

export function hasDictionary (key: string, gameType: GameType = 'ck3') {
  return Object.hasOwn(getGameDictionaryBundle(gameType).lookup, normalizeKey(key))
}

export function getDictionary (key: string, gameType: GameType = 'ck3'): string | null {
  return getGameDictionaryBundle(gameType).lookup[normalizeKey(key)] || null
}

// 고유명사 사전만 반환하는 함수
export function getProperNouns(gameType: GameType): Record<string, string> {
  return getGameDictionaryBundle(gameType).properNouns
}

// 원문에서 고유명사를 찾아 반환하는 함수
export function findProperNounsInText(text: string, gameType: GameType = 'ck3'): Record<string, string> {
  const properNouns = getProperNouns(gameType)
  const foundNouns: Record<string, string> = {}
  const lowerText = text.toLowerCase()

  for (const [key, value] of Object.entries(properNouns)) {
    const lowerKey = key.toLowerCase()

    // 짧은 키(3글자 이하)는 단어 경계를 체크하여 false positive 방지
    if (lowerKey.length <= 3) {
      // 특수문자를 이스케이프하고 단어 경계 사용
      const escapedKey = lowerKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`\\b${escapedKey}\\b`, 'i')
      if (regex.test(lowerText)) {
        foundNouns[key] = value
      }
    } else {
      // 긴 키는 단순 포함 검사
      if (lowerText.includes(lowerKey)) {
        foundNouns[key] = value
      }
    }
  }

  return foundNouns
}

// 번역 메모리를 생성하는 함수 (일반 용어만 포함, 고유명사 제외)
export function getTranslationMemories (gameType: GameType = 'ck3'): string {
  const glossary = getGlossary(gameType)
  return Object.keys(glossary).map((key) => ` - "${key}" → "${glossary[key]}"`).join('\n')
}

// 원문에 포함된 고유명사를 포함하여 번역 메모리를 생성하는 함수
export function getTranslationMemoriesWithContext(text: string, gameType: GameType = 'ck3'): string {
  const glossary = getGlossary(gameType)
  const foundProperNouns = findProperNounsInText(text, gameType)

  // 일반 용어와 원문에서 발견된 고유명사를 합침
  const combinedDict = { ...glossary, ...foundProperNouns }

  return Object.keys(combinedDict).map((key) => ` - "${key}" → "${combinedDict[key]}"`).join('\n')
}

function normalizeKey (key: string): string {
  return key.toLowerCase()
}
