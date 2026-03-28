import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname, basename } from 'pathe'
import { log } from './utils/logger'
import process from 'node:process'
import { parseYaml } from './parser/yaml'
import { parseToml } from './parser/toml'

const execFileAsync = promisify(execFile)

interface DictionaryEntry {
  key: string
  value: string
  gameType: 'ck3' | 'stellaris' | 'vic3'
}

// Git revision 형식 검증 (명령 주입 방지: -로 시작하는 값은 git 옵션으로 해석될 수 있어 거부)
const GIT_REV_PATTERN = /^[a-zA-Z0-9~^:/._][a-zA-Z0-9~^:/._-]*$/

function isValidGitRevision(revision: string): boolean {
  return GIT_REV_PATTERN.test(revision)
}

/**
 * git commit의 *_l_korean.yml 변경사항을 파싱하여 추가된 항목들을 추출합니다.
 * 키는 업스트림 영어 파일에서 가져오고, 값은 커밋의 한국어 번역을 사용합니다.
 */
async function extractDictionaryChangesFromCommit(commitId: string): Promise<DictionaryEntry[]> {
  log.info(`커밋 ${commitId}에서 *_l_korean.yml 변경사항 추출 중...`)
  
  try {
    // git show로 커밋에서 변경된 *_l_korean.yml 파일 목록 가져오기
    const { stdout: filesOutput } = await execFileAsync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', commitId])
    const changedFiles = filesOutput.split('\n').filter(f => f.endsWith('_l_korean.yml'))
    
    if (changedFiles.length === 0) {
      log.warn(`커밋 ${commitId}에서 *_l_korean.yml 변경사항이 없습니다.`)
      return []
    }
    
    log.info(`발견된 파일: ${changedFiles.length}개`)
    
    const entries: DictionaryEntry[] = []
    
    for (const koreanFile of changedFiles) {
      log.debug(`파일 처리 중: ${koreanFile}`)
      
      // 게임 타입 결정 (경로에서 추출)
      let gameType: 'ck3' | 'stellaris' | 'vic3'
      if (koreanFile.startsWith('ck3/')) {
        gameType = 'ck3'
      } else if (koreanFile.startsWith('stellaris/')) {
        gameType = 'stellaris'
      } else if (koreanFile.startsWith('vic3/')) {
        gameType = 'vic3'
      } else {
        log.warn(`게임 타입을 알 수 없는 파일: ${koreanFile}`)
        continue
      }
      
      // 커밋에서 변경된 내용 가져오기 (추가된 라인만)
      const { stdout: diffOutput } = await execFileAsync('git', ['show', commitId, '--', koreanFile])
      
      if (!diffOutput) {
        continue
      }
      
      // 추가된 라인에서 번역 키 추출
      const addedLines = diffOutput.split('\n').filter(line => line.startsWith('+') && line.includes(':'))
      const translationKeys: Map<string, string> = new Map()
      
      // YAML 라인 패턴: + key: "value" # hash
      // 캡처 그룹: (1) 키, (2) 값 (이스케이프된 따옴표 포함)
      const YAML_LINE_PATTERN = /^\+\s+([^:]+):\s+"((?:[^"\\]|\\.)*)"\s*(?:#|$)/
      
      for (const line of addedLines) {
        const match = line.match(YAML_LINE_PATTERN)
        if (match) {
          const [, key, koreanValue] = match
          // YAML에서 이스케이프된 따옴표를 실제 따옴표로 변환
          // 다른 이스케이프 시퀀스(\n, \t 등)는 YAML 파서가 이미 처리함
          const unescapedValue = koreanValue.replace(/\\"/g, '"')
          translationKeys.set(key, unescapedValue)
        }
      }
      
      if (translationKeys.size === 0) {
        log.debug(`${koreanFile}에서 추가된 번역 항목이 없습니다.`)
        continue
      }
      
      log.debug(`${koreanFile}에서 ${translationKeys.size}개의 번역 키 발견`)
      
      // 대응하는 업스트림 영어 파일 찾기
      const englishFile = await findUpstreamEnglishFile(koreanFile, gameType)
      
      if (!englishFile) {
        log.warn(`${koreanFile}에 대응하는 영어 파일을 찾을 수 없습니다.`)
        continue
      }
      
      log.debug(`영어 파일: ${englishFile}`)
      
      // 영어 파일에서 해당 키의 영어 텍스트 추출
      try {
        const englishContent = await readFile(englishFile, 'utf-8')
        const parsedEnglish = parseYaml(englishContent)
        
        // l_english 섹션에서 키 추출
        for (const [sectionKey, sectionData] of Object.entries(parsedEnglish)) {
          for (const [translationKey, [englishText]] of Object.entries(sectionData)) {
            if (translationKeys.has(translationKey)) {
              const koreanValue = translationKeys.get(translationKey)!
              entries.push({
                key: englishText,
                value: koreanValue,
                gameType
              })
              log.debug(`매핑: [${gameType}] "${englishText}" → "${koreanValue}"`)
            }
          }
        }
      } catch (error) {
        log.warn(`영어 파일 읽기 실패: ${englishFile}`, error)
      }
    }
    
    log.success(`총 ${entries.length}개의 딕셔너리 항목을 추출했습니다.`)
    return entries
    
  } catch (error) {
    // 더 안전한 에러 타입 체크
    if (error && typeof error === 'object' && 'code' in error && error.code === 128) {
      throw new Error(`커밋 ${commitId}을(를) 찾을 수 없습니다. 올바른 커밋 해시인지 확인해주세요.`)
    }
    throw error
  }
}

/**
 * 한국어 번역 파일에 대응하는 업스트림 영어 파일을 찾습니다.
 * meta.toml에 정의된 localization 경로를 존중합니다.
 */
async function findUpstreamEnglishFile(koreanFilePath: string, gameType: string): Promise<string | null> {
  // 경로 구조: {game}/MOD_NAME/mod/localization/korean/___*_l_korean.yml
  // 업스트림: {game}/MOD_NAME/upstream/{localization_path}/*_l_english.yml (meta.toml에 정의됨)
  
  const parts = koreanFilePath.split('/')
  
  if (parts.length < 5) {
    return null
  }
  
  const modName = parts[1] // 예: RICE, VIET
  const fileName = basename(koreanFilePath)
  
  // ___ 프리픽스 제거 및 _l_korean.yml을 _l_english.yml로 변경
  const englishFileName = fileName.replace(/^___/, '').replace(/_l_korean\.yml$/, '_l_english.yml')
  
  // meta.toml 읽기
  const modDir = join(process.cwd(), gameType, modName)
  const metaPath = join(modDir, 'meta.toml')
  
  try {
    const metaContent = await readFile(metaPath, 'utf-8')
    const meta = parseToml(metaContent) as {
      upstream: {
        localization: string[]
        language: string
      }
    }
    
    // meta.toml에 정의된 각 localization 경로에서 파일 찾기
    for (const locPath of meta.upstream.localization) {
      const searchDir = join(modDir, 'upstream', locPath)
      
      try {
        // 해당 경로에서 영어 파일 찾기
        const { stdout } = await execFileAsync(
          'find',
          [searchDir, '-name', englishFileName, '-type', 'f'],
          { maxBuffer: 10 * 1024 * 1024 }
        )
        const foundFiles = stdout.trim().split('\n').filter(f => f)
        
        if (foundFiles.length > 0) {
          return foundFiles[0]
        }
      } catch (error) {
        // find 명령 실패 시 다음 경로 시도
        continue
      }
    }
  } catch (error) {
    log.warn(`meta.toml 읽기 실패: ${metaPath}`, error)
  }
  
  return null
}

/**
 * 딕셔너리 파일에 새로운 항목들을 추가합니다.
 * TOML 파일로 직접 추가합니다.
 */
async function addEntriesToDictionary(entries: DictionaryEntry[]): Promise<void> {
  if (entries.length === 0) {
    log.info('추가할 딕셔너리 항목이 없습니다.')
    return
  }
  
  // 게임 타입별로 항목을 그룹화
  const entriesByGameType = entries.reduce((acc, entry) => {
    if (!acc[entry.gameType]) {
      acc[entry.gameType] = []
    }
    acc[entry.gameType].push(entry)
    return acc
  }, {} as Record<string, DictionaryEntry[]>)
  
  // 각 게임 타입별로 딕셔너리에 추가
  for (const [gameType, gameEntries] of Object.entries(entriesByGameType)) {
    log.info(`[${gameType.toUpperCase()}] ${gameEntries.length}개 항목 추가 중...`)
    
    // TOML 파일 경로 결정
    let tomlFilePath: string
    
    if (gameType === 'ck3') {
      // CK3는 glossary와 proper-nouns로 구분
      // 여기서는 모든 항목을 glossary에 추가 (사용자가 필요시 proper-nouns로 수동 이동)
      tomlFilePath = join(import.meta.dirname, '..', 'dictionaries', 'ck3-glossary.toml')
      log.info(`[CK3] 항목들을 ck3-glossary.toml에 추가합니다. 고유명사는 수동으로 ck3-proper-nouns.toml로 이동해주세요.`)
    } else {
      tomlFilePath = join(import.meta.dirname, '..', 'dictionaries', `${gameType}.toml`)
    }
    
    log.info(`TOML 파일 읽는 중: ${tomlFilePath}`)
    
    let content: string
    try {
      content = await readFile(tomlFilePath, 'utf-8')
    } catch (error) {
      log.error(`TOML 파일을 읽을 수 없습니다: ${tomlFilePath}`)
      continue
    }
    
    // 기존 항목 중복 체크를 위해 현재 딕셔너리의 키들을 추출
    const existingKeys = new Set<string>()
    // TOML 키 패턴: "key" = "value" 또는 key = "value"
    // 주석 라인(#로 시작)은 제외
    const keyRegex = /^(?!#)\s*"?([^"=]+)"?\s*=/gm
    let match
    while ((match = keyRegex.exec(content)) !== null) {
      existingKeys.add(match[1].toLowerCase())
    }
    
    // 중복되지 않은 항목만 필터링
    const newEntries = gameEntries.filter(entry => {
      const isDuplicate = existingKeys.has(entry.key.toLowerCase())
      if (isDuplicate) {
        log.debug(`[${gameType.toUpperCase()}] 중복 항목 건너뛰기: "${entry.key}"`)
      }
      return !isDuplicate
    })
    
    if (newEntries.length === 0) {
      log.info(`[${gameType.toUpperCase()}] 모든 항목이 이미 존재합니다.`)
      continue
    }
    
    // TOML 형식으로 새 항목 생성
    const newEntriesText = newEntries
      .map(entry => {
        // TOML 문자열 이스케이프: 백슬래시, 따옴표, 개행, 탭, 캐리지 리턴, 폼 피드, 백스페이스
        const escapedValue = entry.value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\t/g, '\\t')
          .replace(/\r/g, '\\r')
          .replace(/\f/g, '\\f')
          .replace(/\b/g, '\\b')
        // 키도 항상 따옴표로 감싸기 (특수문자, 공백 등 안전하게 처리)
        const escapedKey = entry.key
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\t/g, '\\t')
          .replace(/\r/g, '\\r')
          .replace(/\f/g, '\\f')
          .replace(/\b/g, '\\b')
        return `"${escapedKey}" = "${escapedValue}"`
      })
      .join('\n')
    
    // 파일 끝에 새 항목 추가 (빈 줄 하나 추가)
    content = content.trimEnd() + '\n' + newEntriesText + '\n'
    
    // 파일에 쓰기
    await writeFile(tomlFilePath, content, 'utf-8')
    
    log.success(`[${gameType.toUpperCase()}] ${newEntries.length}개 항목 추가 완료`)
    
    // 추가된 항목 출력
    for (const entry of newEntries) {
      log.info(`  + "${entry.key}" = "${entry.value}"`)
    }
  }
  
  log.success('딕셔너리 파일 업데이트 완료')
}

async function main() {
  try {
    const commitId = process.argv[2]
    
    if (commitId === '--help' || commitId === '-h') {
      log.box(`
      Git 커밋에서 딕셔너리 추가 스크립트
      
      사용법: pnpm add-dict <commit-id>
      
      설명:
        Git 커밋의 *_l_korean.yml 변경사항을 파싱하여
        업스트림 영어 파일과 매핑하여 단어사전 항목들을
        TOML 딕셔너리 파일에 추가합니다.
        
        키: 업스트림 영어 파일의 원문
        값: 커밋에서 변경된 한국어 번역
        
        대상 파일:
        - CK3: dictionaries/ck3-glossary.toml
        - Stellaris: dictionaries/stellaris.toml
        - VIC3: dictionaries/vic3.toml
        
        참고: CK3 고유명사는 수동으로 ck3-proper-nouns.toml로 이동 필요
      
      예시:
        pnpm add-dict abc123
        pnpm add-dict HEAD~1
      
      기능:
        - CK3, Stellaris, VIC3 모든 게임 타입 지원
        - 자동 중복 검사 (기존 항목은 건너뜀)
        - 업스트림 파일 자동 탐색 및 매핑
        - TOML 형식으로 자동 포맷팅
      `)
      process.exit(0)
    }
    
    if (!commitId) {
      log.error('사용법: pnpm add-dict <commit-id>')
      log.info('예시: pnpm add-dict abc123')
      log.info('도움말: pnpm add-dict --help')
      process.exit(1)
    }

    if (!isValidGitRevision(commitId)) {
      log.error(`유효하지 않은 커밋 ID 형식: ${commitId}`)
      process.exit(1)
    }
    
    log.box(`
    Git 커밋에서 딕셔너리 추가
    - 커밋 ID: ${commitId}
    - *_l_korean.yml 파일의 변경사항을 추출합니다
    - 업스트림 영어 파일과 매핑하여 TOML 딕셔너리에 추가합니다
    `)
    
    // 1. 커밋에서 딕셔너리 변경사항 추출
    const entries = await extractDictionaryChangesFromCommit(commitId)
    
    // 2. 딕셔너리 파일에 추가
    await addEntriesToDictionary(entries)
    
    log.success('완료!')
    
  } catch (error) {
    log.error('오류가 발생했습니다:', error)
    process.exit(1)
  }
}

main()
