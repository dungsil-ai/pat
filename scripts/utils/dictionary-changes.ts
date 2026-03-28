import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { log } from './logger'
import { type GameType } from './prompts'

const execFileAsync = promisify(execFile)

export interface DictionaryChangeOptions {
  /** 특정 커밋의 변경사항만 추출 */
  sinceCommit?: string
  /** 커밋 범위 (예: abc123..def456) */
  commitRange?: string
  /** 특정 날짜 이후의 변경사항만 추출 (ISO 8601 형식 또는 git date 형식) */
  sinceDate?: string
}

/** 딕셔너리 키와 해당 키가 속한 섹션 정보 */
export interface DictionaryKeyInfo {
  key: string
  /** 키가 속한 딕셔너리 섹션 이름 (예: 'ck3Glossary', 'ck3ProperNouns') */
  section: string
}

// 커밋 ID 유효성 검증 (SHA-1: 7-40자의 16진수)
const COMMIT_ID_PATTERN = /^[a-f0-9]{7,40}$/i
// 커밋 범위 유효성 검증 (commit1..commit2)
const COMMIT_RANGE_PATTERN = /^[a-f0-9]{7,40}\.\.[a-f0-9]{7,40}$/i

/**
 * 커밋 ID 형식이 유효한지 검증합니다.
 */
function isValidCommitId(commitId: string): boolean {
  return COMMIT_ID_PATTERN.test(commitId)
}

/**
 * 커밋 범위 형식이 유효한지 검증합니다.
 */
function isValidCommitRange(commitRange: string): boolean {
  return COMMIT_RANGE_PATTERN.test(commitRange)
}

/**
 * dictionary.ts 파일에서 특정 조건에 맞는 변경된 딕셔너리 키들을 추출합니다.
 */
export async function getChangedDictionaryKeys(
  gameType: GameType,
  options: DictionaryChangeOptions = {}
): Promise<string[]> {
  const keyInfos = await getChangedDictionaryKeysWithInfo(gameType, options)
  return keyInfos.map(info => info.key)
}

/**
 * dictionary.ts 파일에서 특정 조건에 맞는 변경된 딕셔너리 키들과 섹션 정보를 추출합니다.
 */
export async function getChangedDictionaryKeysWithInfo(
  gameType: GameType,
  options: DictionaryChangeOptions = {}
): Promise<DictionaryKeyInfo[]> {
  const dictionaryPath = 'scripts/utils/dictionary.ts'
  
  log.info(`[${gameType.toUpperCase()}] 딕셔너리 변경사항 추출 중...`)
  
  // Git diff 명령 구성
  const gitArgs = ['log', '-p']
  
  if (options.sinceCommit) {
    // 커밋 ID 유효성 검증
    if (!isValidCommitId(options.sinceCommit)) {
      throw new Error(`유효하지 않은 커밋 ID 형식: ${options.sinceCommit}`)
    }
    // 해당 커밋 하나만 확인 (-1: 단일 커밋, -p: 패치 포함)
    gitArgs.push('-1', options.sinceCommit)
    log.debug(`조건: ${options.sinceCommit} 커밋만 확인`)
  } else if (options.commitRange) {
    // 커밋 범위 유효성 검증
    if (!isValidCommitRange(options.commitRange)) {
      throw new Error(`유효하지 않은 커밋 범위 형식: ${options.commitRange}`)
    }
    gitArgs.push(options.commitRange)
    log.debug(`조건: 커밋 범위 ${options.commitRange}`)
  } else if (options.sinceDate) {
    gitArgs.push(`--since=${options.sinceDate}`)
    log.debug(`조건: ${options.sinceDate} 이후`)
  } else {
    // 옵션이 없으면 빈 배열 반환 (전체 딕셔너리를 사용하도록)
    log.debug('조건 없음: 전체 딕셔너리 사용')
    return []
  }
  
  gitArgs.push('--', dictionaryPath)
  
  try {
    const { stdout } = await execFileAsync('git', gitArgs, { maxBuffer: 10 * 1024 * 1024 })
    
    if (!stdout || stdout.trim() === '') {
      log.info(`[${gameType.toUpperCase()}] 변경사항 없음`)
      return []
    }
    
    // 변경된 딕셔너리 키와 섹션 정보 추출
    const changedKeyInfos = extractKeysWithSectionFromDiff(stdout, gameType)
    
    log.success(`[${gameType.toUpperCase()}] ${changedKeyInfos.length}개의 변경된 키 발견`)
    if (changedKeyInfos.length > 0) {
      const keys = changedKeyInfos.map(info => info.key)
      log.debug(`변경된 키: [${keys.slice(0, 10).join(', ')}${keys.length > 10 ? '...' : ''}]`)
    }
    
    return changedKeyInfos
  } catch (error) {
    log.error(`[${gameType.toUpperCase()}] Git 히스토리 조회 실패:`, error)
    throw error
  }
}

/**
 * Git diff 출력에서 추가되거나 수정된 딕셔너리 키를 추출합니다.
 */
function extractKeysFromDiff(diffOutput: string, gameType: GameType): string[] {
  const keyInfos = extractKeysWithSectionFromDiff(diffOutput, gameType)
  return keyInfos.map(info => info.key)
}

/**
 * Git diff 출력에서 추가되거나 수정된 딕셔너리 키와 섹션 정보를 추출합니다.
 */
function extractKeysWithSectionFromDiff(diffOutput: string, gameType: GameType): DictionaryKeyInfo[] {
  const keyInfoMap = new Map<string, string>() // key -> section
  
  // 해당 게임 타입의 딕셔너리 변수명 결정
  const dictionaryVarNames = getDictionaryVariableNames(gameType)
  
  // diff 출력을 줄 단위로 분석
  const lines = diffOutput.split('\n')
  let inRelevantSection = false
  let currentSection = ''
  let braceDepth = 0
  let justStartedSection = false
  
  for (const line of lines) {
    // 딕셔너리 섹션 시작 감지
    for (const varName of dictionaryVarNames) {
      if (line.includes(`const ${varName}`)) {
        inRelevantSection = true
        currentSection = varName
        justStartedSection = true
        // 섹션 시작 시 중괄호 깊이 초기화
        braceDepth = 0
        // 섹션 시작 라인에 '{'가 있으면 braceDepth 증가
        braceDepth += (line.match(/{/g) || []).length
        braceDepth -= (line.match(/}/g) || []).length
        break
      }
    }
    
    // 섹션 시작 라인은 중괄호 중복 카운트 방지를 위해 건너뛰기
    if (justStartedSection) {
      justStartedSection = false
      continue
    }
    
    // 섹션 내부에서 중괄호 깊이 추적
    if (inRelevantSection) {
      // '{'와 '}'의 개수 세기
      braceDepth += (line.match(/{/g) || []).length
      braceDepth -= (line.match(/}/g) || []).length
      // 딕셔너리 객체가 닫히면 섹션 종료
      if (braceDepth <= 0) {
        inRelevantSection = false
        currentSection = ''
        continue
      }
    }
    
    // 딕셔너리 섹션 종료 감지 (다른 const 선언 시작)
    if (inRelevantSection && line.match(/^[-+]?\s*const \w+/) && !dictionaryVarNames.some(name => line.includes(name))) {
      inRelevantSection = false
      currentSection = ''
      braceDepth = 0
    }
    
    // 관련 섹션이 아니면 건너뛰기
    if (!inRelevantSection) {
      continue
    }
    
    // 추가된 라인(+로 시작)에서 키 추출
    if (line.startsWith('+')) {
      // 통합 정규식: 작은따옴표, 큰따옴표, 또는 유효한 JS 식별자 키를 처리
      const match = line.match(/^\+\s+(?:'([^']+)'|"([^"]+)"|([a-zA-Z_$][a-zA-Z0-9_$]*))\s*:\s*/)
      if (match) {
        // match[1]: 작은따옴표로 감싼 키, match[2]: 큰따옴표로 감싼 키, match[3]: 따옴표 없는 키 (JS 식별자만)
        const key = match[1] ?? match[2] ?? match[3]
        if (key && !key.startsWith('//') && !key.match(/^[{}[\]()]/)) {
          keyInfoMap.set(key, currentSection)
        }
      }
    }
  }
  
  return Array.from(keyInfoMap.entries()).map(([key, section]) => ({ key, section }))
}

/**
 * 게임 타입에 따른 딕셔너리 변수명들을 반환합니다.
 */
function getDictionaryVariableNames(gameType: GameType): string[] {
  switch (gameType) {
    case 'ck3':
      // CK3는 ck3Glossary, ck3ProperNouns, ck3Dictionaries 모두 확인
      return ['ck3Glossary', 'ck3ProperNouns', 'ck3Dictionaries']
    case 'stellaris':
      return ['stellarisDictionaries']
    case 'vic3':
      return ['vic3Dictionaries']
    default:
      throw new Error(`Unsupported game type: ${gameType}`)
  }
}
