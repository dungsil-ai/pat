import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, dirname, join } from 'pathe'
import { parseToml, parseYaml, stringifyYaml } from '../parser'
import { hashing } from '../utils/hashing'
import { log } from '../utils/logger'
import { translate, translateBulk, TranslationRetryExceededError, TranslationRefusedError } from '../utils/translate'
import { updateAllUpstreams } from '../utils/upstream'
import { getUpstreamFileHashesPath, readUpstreamFileHashes, type UpstreamFileHashMap, writeUpstreamFileHashes } from '../utils/upstream-file-hashes'
import { type GameType, shouldUseTransliteration, shouldUseTransliterationForKey } from '../utils/prompts'

const execAsync = promisify(exec)

// 번역 거부 항목 출력 파일 이름 접미사
const UNTRANSLATED_ITEMS_FILE_SUFFIX = 'untranslated-items.json'
const DEFAULT_TRANSLATE_BATCH_SIZE = 20
const HANGUL_CHOSEONG_LIST = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'] as const
const HANGUL_BASE_CODE = 0xAC00
const HANGUL_CHOSEONG_INTERVAL = 588
const LATIN_INITIAL_CONSONANT_MAP: Record<string, string[]> = {
  a: ['ㅇ'],
  b: ['ㅂ', 'ㅍ'],
  c: ['ㅋ', 'ㅅ', 'ㅊ'],
  d: ['ㄷ', 'ㅌ'],
  e: ['ㅇ'],
  f: ['ㅍ'],
  g: ['ㄱ', 'ㅋ'],
  h: ['ㅎ'],
  i: ['ㅇ'],
  j: ['ㅈ', 'ㅊ'],
  k: ['ㅋ', 'ㄱ'],
  l: ['ㄹ'],
  m: ['ㅁ'],
  n: ['ㄴ'],
  o: ['ㅇ'],
  p: ['ㅍ', 'ㅂ'],
  q: ['ㅋ'],
  r: ['ㄹ'],
  s: ['ㅅ', 'ㅆ', 'ㅈ', 'ㅊ'],
  t: ['ㅌ', 'ㄷ'],
  u: ['ㅇ'],
  v: ['ㅂ', 'ㅍ'],
  w: ['ㅇ', 'ㅂ'],
  x: ['ㅅ', 'ㅆ', 'ㅈ', 'ㅊ', 'ㅋ'],
  y: ['ㅇ'],
  z: ['ㅈ', 'ㅅ']
}

/**
 * Shell 명령어에 안전하게 사용할 수 있도록 파일 경로를 이스케이프합니다.
 * @param filePath 이스케이프할 파일 경로
 * @returns 이스케이프된 파일 경로
 */
function escapeShellArg(filePath: string): string {
  // 작은따옴표로 감싸고, 내부의 작은따옴표는 이스케이프
  return `'${filePath.replace(/'/g, "'\\''")}'`
}

function getLocalizationFolderName(gameType: GameType): string {
  switch (gameType) {
    case 'ck3':
    case 'vic3':
      return 'localization'
    case 'stellaris':
      return 'localisation'
    default:
      throw new Error(`Unsupported game type: ${gameType}`)
  }
}

/**
 * 배치 번역 크기를 환경변수에서 읽어옵니다.
 * 잘못된 값이 들어오면 기본값을 사용합니다.
 */
function getTranslateBatchSize (): number {
  const batchSizeEnv = process.env.TRANSLATE_BATCH_SIZE
  if (!batchSizeEnv) {
    return DEFAULT_TRANSLATE_BATCH_SIZE
  }

  const parsed = Number.parseInt(batchSizeEnv, 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    log.warn(`TRANSLATE_BATCH_SIZE 값이 올바르지 않아 기본값(${DEFAULT_TRANSLATE_BATCH_SIZE})을 사용합니다: ${batchSizeEnv}`)
    return DEFAULT_TRANSLATE_BATCH_SIZE
  }

  return parsed
}

function countHangulSyllables(text: string): number {
  return (text.match(/[가-힣]/g) || []).length
}

function getHangulInitialConsonant(char: string): string | null {
  if (!/^[가-힣]$/.test(char)) {
    return null
  }

  const code = char.charCodeAt(0) - HANGUL_BASE_CODE
  const choIndex = Math.floor(code / HANGUL_CHOSEONG_INTERVAL)
  return HANGUL_CHOSEONG_LIST[choIndex] || null
}

function getExpectedInitialConsonantsForLatin(char: string): string[] {
  const lower = char.toLowerCase()

  return LATIN_INITIAL_CONSONANT_MAP[lower] || []
}

function isSuspiciousShortTransliterationResult(sourceValue: string, translatedValue: string): boolean {
  const trimmedSource = sourceValue.trim()
  const trimmedTranslated = translatedValue.trim()

  if (!/^[A-Za-z]{3,6}$/.test(trimmedSource)) {
    return false
  }

  if (!/^[가-힣]+$/.test(trimmedTranslated)) {
    return false
  }

  const hangulLength = countHangulSyllables(trimmedTranslated)
  if (hangulLength < 1 || hangulLength > 2) {
    return false
  }

  const expectedInitials = getExpectedInitialConsonantsForLatin(trimmedSource[0])
  if (expectedInitials.length === 0) {
    return false
  }

  const actualInitial = getHangulInitialConsonant(trimmedTranslated[0])
  if (!actualInitial) {
    return false
  }

  return !expectedInitials.includes(actualInitial)
}

/**
 * 모드 단위 병렬 처리 동시성 값을 환경변수에서 읽어옵니다.
 * 잘못된 값이 들어오면 기본값을 사용합니다.
 */
function getModConcurrency (modCount: number): number {
  const concurrencyEnv = process.env.TRANSLATE_MOD_CONCURRENCY
  if (!concurrencyEnv) {
    return Math.max(modCount, 1)
  }

  const parsed = Number.parseInt(concurrencyEnv, 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    const fallback = Math.max(modCount, 1)
    log.warn(`TRANSLATE_MOD_CONCURRENCY 값이 올바르지 않아 기본값(${fallback})을 사용합니다: ${concurrencyEnv}`)
    return fallback
  }

  return parsed
}

interface ModTranslationsOptions {
  rootDir: string
  mods: string[]
  gameType: GameType
  onlyHash?: boolean
  timeoutMinutes?: number | false // false = 타임아웃 비활성화, undefined = 기본값(15분) 사용
}

interface ModMeta {
  upstream: {
    localization: string[];
    language: string;
    transliteration_files?: string[];
  };
}

export interface UntranslatedItem {
  mod: string
  file: string
  key: string
  message: string
}

export interface TranslationResult {
  untranslatedItems: UntranslatedItem[]
}

interface ModProcessResult {
  mod: string
  untranslatedItems: UntranslatedItem[]
  timeoutReached: boolean
}

interface ModWorkItem {
  mod: string
  etcSubMod?: string
}

function resolveLogModName(modName: string, filePath: string): string {
  if (modName.toLowerCase() !== 'etc') {
    return modName
  }

  const normalizedPath = filePath.replace(/\\/g, '/')
  const [actualModName] = normalizedPath.split('/')
  return actualModName || modName
}

function normalizePathForComparison(path: string): string {
  return path.replace(/\\/g, '/')
}

async function expandModWorkItems(rootDir: string, mods: string[]): Promise<ModWorkItem[]> {
  const workItems: ModWorkItem[] = []

  for (const mod of mods) {
    if (mod.toLowerCase() !== 'etc') {
      workItems.push({ mod })
      continue
    }

    const etcUpstreamDir = join(rootDir, mod, 'upstream')
    try {
      const entries = await readdir(etcUpstreamDir, { withFileTypes: true })
      const subMods = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)

      if (subMods.length === 0) {
        workItems.push({ mod })
        continue
      }

      for (const etcSubMod of subMods) {
        workItems.push({ mod, etcSubMod })
      }
    } catch {
      workItems.push({ mod })
    }
  }

  return workItems
}

export async function processModTranslations ({ rootDir, mods, gameType, onlyHash = false, timeoutMinutes }: ModTranslationsOptions): Promise<TranslationResult> {
  // 번역 작업 전에 해당 게임의 upstream 리포지토리만 업데이트
  log.start(`${gameType.toUpperCase()} Upstream 리포지토리 업데이트 중...`)
  const projectRoot = join(rootDir, '..') // rootDir은 ck3/ 같은 게임 디렉토리이므로 한 단계 위로
  await updateAllUpstreams(projectRoot, gameType)
  log.success(`${gameType.toUpperCase()} Upstream 리포지토리 업데이트 완료`)

  // 타임아웃 설정 (기본값: 15분)
  const timeoutMs = timeoutMinutes === false ? null : (timeoutMinutes ?? 15) * 60 * 1000
  const startTime = Date.now()
  
  if (timeoutMs === null) {
    log.info(`타임아웃 비활성화됨`)
  } else {
    log.info(`타임아웃 설정: ${timeoutMinutes ?? 15}분`)
  }

  const modWorkItems = await expandModWorkItems(rootDir, mods)
  const modConcurrency = Math.min(getModConcurrency(modWorkItems.length), Math.max(modWorkItems.length, 1))
  log.info(`모드 병렬 처리 동시성: ${modConcurrency}`)

  const modTasks = modWorkItems.map(({ mod, etcSubMod }) => async (): Promise<ModProcessResult> => {
    const processes: Promise<UntranslatedItem[]>[] = []
    const locPathCleanupTasks: Array<{ targetDir: string; expectedKoreanFiles: string[]; mod: string; locPath: string }> = []
    const workLabel = etcSubMod ? `${mod}/${etcSubMod}` : mod
    log.start(`[${workLabel}] 작업 시작 (원본 파일 경로: ${rootDir}/${mod})`)
    const modDir = join(rootDir, mod)
    const metaPath = join(modDir, 'meta.toml')

    // `meta.toml`이 존재하지 않거나 디렉토리 등 파일이 아니면 무시
    if (!(await stat(metaPath)).isFile()) {
      return { mod, untranslatedItems: [], timeoutReached: false }
    }

    const metaContent = await readFile(metaPath, 'utf-8')
    const meta = parseToml(metaContent) as ModMeta
      const hashFilePath = getUpstreamFileHashesPath(modDir)
    const savedFileHashes = await readUpstreamFileHashes(hashFilePath)
    const nextFileHashes: UpstreamFileHashMap = { ...savedFileHashes }
    const currentSourcePaths = new Set<string>()
    let hasHashChanges = false
    log.debug(`[${mod}] 메타데이터:  upstream.language: ${meta.upstream.language}, upstream.localization: [${meta.upstream.localization}]`)

    for (const locPath of meta.upstream.localization) {
      const sourceDir = join(modDir, 'upstream', locPath)
      const localizationFolder = getLocalizationFolderName(gameType)
      const targetDir = join(modDir, 'mod', localizationFolder, sourceDir.includes('replace') ? 'korean/replace' : 'korean')

      // 모드 디렉토리 생성
      await mkdir(targetDir, { recursive: true })

      const upstreamRoot = join(modDir, 'upstream')

      // upstream 루트 존재 여부 확인
      try {
        await access(upstreamRoot)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // 여러 모드를 한 번에 처리할 때는 누락된 모드만 건너뛰고 다음 모드를 계속 처리
          if (mods.length > 1) {
            log.warn(
              `[${mod}] upstream 디렉토리가 존재하지 않아 해당 localization 경로를 건너뜁니다: ${upstreamRoot}\n` +
              `upstream 클론이 누락되었을 수 있습니다.\n` +
              `필요 시 다음 명령어를 실행해 주세요: pnpm upstream ${gameType} \"${mod}\"`
            )
            return { mod, untranslatedItems: [], timeoutReached: false }
          }

          throw new Error(
            `[${mod}] upstream 디렉토리가 존재하지 않습니다: ${upstreamRoot}\n` +
            `upstream 클론이 누락되었을 수 있습니다.\n` +
            `먼저 다음 명령어를 실행해 주세요: pnpm upstream ${gameType} \"${mod}\"`
          )
        }
        throw error
      }

      // localization 경로 존재 여부 확인
      try {
        await access(sourceDir)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          log.warn(
            `[${mod}] upstream 디렉토리가 존재하지 않아 해당 localization 경로를 건너뜁니다: ${sourceDir}\n` +
            `meta.toml의 localization 경로를 확인하거나 upstream 업데이트 상태를 점검하세요.\n` +
            `경로: ${locPath}`
          )
          continue
        }
        throw error
      }

      const sourceFiles = await readdir(sourceDir, { recursive: true })
      const expectedKoreanFiles: string[] = []
      
      for (const file of sourceFiles) {
        const normalizedFile = file.replace(/\\/g, '/')

        if (etcSubMod && !normalizedFile.startsWith(`${etcSubMod}/`)) {
          continue
        }
        // 언어파일 이름이 `_l_언어코드.yml` 형식이면 처리
        if (normalizedFile.endsWith(`.yml`) && normalizedFile.includes(`_l_${meta.upstream.language}`)) {
          const sourcePath = join(sourceDir, normalizedFile)
          const sourceContent = await readFile(sourcePath, 'utf-8')
          const sourceFileHash = hashing(sourceContent)
          const sourceRelativePath = join(locPath, normalizedFile).replace(/\\/g, '/')
          currentSourcePaths.add(sourceRelativePath)
          const previousFileHash = savedFileHashes[sourceRelativePath]

          if (!onlyHash && previousFileHash === sourceFileHash) {
            log.debug(`[${mod}/${normalizedFile}] 업스트림 파일 해시 일치로 번역 건너뜀: ${sourceFileHash}`)
          } else {
            processes.push(processLanguageFile(mod, sourceDir, targetDir, normalizedFile, meta.upstream.language, gameType, onlyHash, startTime, timeoutMs, projectRoot, meta.upstream.transliteration_files))
          }

          if (nextFileHashes[sourceRelativePath] !== sourceFileHash) {
            nextFileHashes[sourceRelativePath] = sourceFileHash
            hasHashChanges = true
          }
          // 처리될 한국어 파일 경로 추적
          const targetParentDir = join(targetDir, dirname(normalizedFile))
          const targetFileName = '___' + basename(normalizedFile).replace(`_l_${meta.upstream.language}.yml`, '_l_korean.yml')
          const targetPath = join(targetParentDir, targetFileName)
          expectedKoreanFiles.push(targetPath)
        }
      }
      
      // 각 로케일 경로별 예상 파일 목록 저장
      if (!etcSubMod) {
        locPathCleanupTasks.push({ targetDir, expectedKoreanFiles, mod, locPath })
      }
    }

    // Promise.allSettled를 사용하여 모든 파일 처리가 완료될 때까지 대기
    // 일부 파일에서 번역 거부가 발생해도 다른 파일들의 결과를 모두 수집
    const results = await Promise.allSettled(processes)
    
    // 모든 파일 처리 완료 후 orphaned 파일 정리
    for (const task of locPathCleanupTasks) {
      const nestedCleanupDirs = locPathCleanupTasks
        .map(({ targetDir }) => targetDir)
        .filter(targetDir => normalizePathForComparison(targetDir).startsWith(`${normalizePathForComparison(task.targetDir)}/`))
        .filter(targetDir => targetDir !== task.targetDir)

      await cleanupOrphanedFiles(task.targetDir, task.expectedKoreanFiles, task.mod, task.locPath, projectRoot, nestedCleanupDirs)
    }

    for (const savedPath of Object.keys(nextFileHashes)) {
      if (!currentSourcePaths.has(savedPath)) {
        delete nextFileHashes[savedPath]
        hasHashChanges = true
      }
    }

    if (hasHashChanges) {
      await writeUpstreamFileHashes(hashFilePath, nextFileHashes)
    }
    
    const untranslatedItems: UntranslatedItem[] = []
    
    for (const result of results) {
      if (result.status === 'fulfilled') {
        // 성공한 경우: 번역되지 않은 항목들을 수집
        untranslatedItems.push(...result.value)
      } else {
        // 실패한 경우: 에러 타입에 따라 처리
        const error = result.reason
        if (error instanceof TimeoutReachedError) {
          log.warn(`[${workLabel}] 타임아웃으로 인해 번역 중단됨`)
          log.info(`타임아웃 도달: 처리된 작업까지 저장하고 종료합니다`)
          // 타임아웃 시에도 현재까지 수집된 항목은 반환하여 상위에서 저장합니다.
          return { mod, untranslatedItems, timeoutReached: true }
        } else {
          // 다른 예외는 그대로 throw
          throw error
        }
      }
    }

    log.success(`[${workLabel}] 번역 완료`)
    
    // 번역되지 않은 항목 요약 출력
    if (untranslatedItems.length > 0) {
      for (const item of untranslatedItems) {
        log.warn(`  [${item.mod}/${item.file}:${item.key}] "${item.message}"`)
      }
    } else if (!onlyHash) {
      log.success(`모든 항목이 성공적으로 번역되었습니다.`)
    }
    return { mod, untranslatedItems, timeoutReached: false }
  })

  const allUntranslatedItems: UntranslatedItem[] = []
  let hasTimeout = false

  for (let i = 0; i < modTasks.length; i += modConcurrency) {
    const chunk = modTasks.slice(i, i + modConcurrency)
    const executing = chunk.map(task => task())
    const results = await Promise.allSettled(executing)

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allUntranslatedItems.push(...result.value.untranslatedItems)
        if (result.value.timeoutReached) {
          hasTimeout = true
        }
      } else {
        throw result.reason
      }
    }

    if (hasTimeout) {
      break
    }
  }

  return saveAndReturnResult(projectRoot, gameType, allUntranslatedItems)
}

/**
 * 번역되지 않은 항목을 JSON 파일로 저장하고 결과를 반환합니다.
 */
async function saveAndReturnResult(
  projectRoot: string,
  gameType: GameType,
  untranslatedItems: UntranslatedItem[]
): Promise<TranslationResult> {
  // 중복 항목 제거 (mod + file + key 조합으로 고유성 판단)
  const seen = new Map<string, UntranslatedItem>()
  for (const item of untranslatedItems) {
    const key = `${item.mod}::${item.file}::${item.key}`
    if (!seen.has(key)) {
      seen.set(key, item)
    }
  }
  const deduplicatedItems = Array.from(seen.values())
  
  const result: TranslationResult = { untranslatedItems: deduplicatedItems }
  
  // 항상 JSON 파일 저장 (빈 배열도 저장하여 close-translation-issues가 최신 상태를 확인할 수 있도록 함)
  const outputPath = join(projectRoot, `${gameType}-${UNTRANSLATED_ITEMS_FILE_SUFFIX}`)
  const outputData = {
    gameType,
    timestamp: new Date().toISOString(),
    items: deduplicatedItems
  }
  await writeFile(outputPath, JSON.stringify(outputData, null, 2), 'utf-8')
  
  if (deduplicatedItems.length > 0) {
    if (deduplicatedItems.length < untranslatedItems.length) {
      log.info(`중복 제거 후 번역되지 않은 항목 ${deduplicatedItems.length}개가 ${outputPath}에 저장되었습니다. (${untranslatedItems.length - deduplicatedItems.length}개 중복 제거됨)`)
    } else {
      log.info(`번역되지 않은 항목 ${deduplicatedItems.length}개가 ${outputPath}에 저장되었습니다.`)
    }
  } else {
    log.info(`모든 항목이 번역되었습니다. 결과가 ${outputPath}에 저장되었습니다.`)
  }
  
  return result
}

/**
 * 업스트림 소스가 없는 한국어 번역 파일의 변경사항을 git으로 롤백합니다.
 * 업스트림에서 삭제된 파일 또는 언어 파일 패턴과 일치하지 않아 처리되지 않은 파일이 대상입니다.
 * git checkout은 추적된 파일만 롤백하므로, 새로 생성된 미추적 파일은 남아있을 수 있습니다.
 * 
 * @param targetDir 한국어 번역 파일이 위치한 디렉토리
 * @param expectedKoreanFiles 처리 예상 파일 경로 목록 (절대 경로)
 * @param mod 모드 이름
 * @param locPath 로케일 경로
 * @param projectRoot 프로젝트 루트 디렉토리 (git 작업 디렉토리)
 */
async function cleanupOrphanedFiles(
  targetDir: string,
  expectedKoreanFiles: string[],
  mod: string,
  locPath: string,
  projectRoot: string,
  excludedSubDirs: string[] = []
): Promise<void> {
  try {
    // targetDir 디렉토리가 존재하는지 확인
    await access(targetDir)
  } catch (error) {
    // 디렉토리가 없으면 정리할 파일도 없음
    return
  }

  // targetDir의 모든 한국어 번역 파일 목록 가져오기
  const targetFiles = await readdir(targetDir, { recursive: true })
  const koreanFiles = targetFiles.filter(file => 
    file.endsWith('_l_korean.yml') && file.includes('___')
  )

  // expectedKoreanFiles를 Set으로 변환하여 빠른 검색
  const expectedSet = new Set(expectedKoreanFiles.map(path => normalizePathForComparison(path)))
  const excludedSet = excludedSubDirs
    .map(path => normalizePathForComparison(path))
    .map(path => path.endsWith('/') ? path : `${path}/`)

  // 업스트림에 없는 한국어 파일의 변경사항을 git으로 롤백
  for (const file of koreanFiles) {
    const fullPath = join(targetDir, file)
    const normalizedFullPath = normalizePathForComparison(fullPath)

    if (excludedSet.some(excludedDir => normalizedFullPath.startsWith(excludedDir))) {
      continue
    }
    
    if (!expectedSet.has(normalizedFullPath)) {
      log.info(`[${mod}/${locPath}] 업스트림에서 삭제된 파일 변경사항 롤백: ${file}`)
      try {
        // git checkout을 사용하여 파일의 변경사항을 HEAD 상태로 롤백
        await execAsync(`git checkout HEAD -- ${escapeShellArg(fullPath)}`, { cwd: projectRoot })
        log.debug(`[${mod}/${locPath}] 파일 롤백 완료: ${fullPath}`)
      } catch (error) {
        // git에 해당 파일이 없는 경우와 기타 에러를 구분하여 처리
        const errMsg = (error && typeof error === 'object' && 'message' in error) ? (error as Error).message : String(error)
        if (
          errMsg.includes('did not match any files') ||
          errMsg.includes('pathspec') ||
          errMsg.includes('unknown revision or path not in the working tree')
        ) {
          log.debug(`[${mod}/${locPath}] 파일 롤백 불가 (git에 없음): ${file}`)
        } else {
          log.warn(`[${mod}/${locPath}] 파일 롤백 중 오류 발생: ${file} - ${errMsg}`)
        }
      }
    }
  }
}

class TimeoutReachedError extends Error {
  constructor() {
    super('번역 타임아웃에 도달했습니다')
    this.name = 'TimeoutReachedError'
  }
}


async function processLanguageFile (mode: string, sourceDir: string, targetBaseDir: string, file: string, sourceLanguage: string, gameType: GameType, onlyHash: boolean, startTime: number, timeoutMs: number | null, projectRoot: string, transliterationFiles?: string[]): Promise<UntranslatedItem[]> {
  const sourcePath = join(sourceDir, file)
  const untranslatedItems: UntranslatedItem[] = []
  const logModName = resolveLogModName(mode, file)

  // 파일명을 기반으로 음역 모드 파일인지 감지
  const isTransliterationFile = shouldUseTransliteration(file, undefined, transliterationFiles)
  if (isTransliterationFile) {
    log.info(`[${mode}/${file}] 음역 대상 파일 감지 (파일명에 culture/dynasty/names 키워드 포함 또는 수동 지정)`)
  }

  // 파일 순서를 최상위로 유지해 덮어쓸 수 있도록 앞에 '___'를 붙임 (ex: `___00_culture_l_english.yml`)
  const targetParentDir = join(targetBaseDir, dirname(file))
  await mkdir(targetParentDir, { recursive: true })
  const targetPath = join(targetParentDir, '___' + basename(file).replace(`_l_${sourceLanguage}.yml`, '_l_korean.yml'))

  let targetContent = ''
  try {
    targetContent = await readFile(targetPath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    // 파일이 존재하지 않으면 원본에서 복사
    targetContent = await readFile(sourcePath, 'utf-8')
  }

  log.verbose(`[${mode}/${file}] 원본 파일 경로: ${sourcePath}`)

  const sourceContent = await readFile(sourcePath, 'utf-8')
  const sourceYaml: Record<string, Record<string, [string, string | null]>> = parseYaml(sourceContent)
  const targetYaml = parseYaml(targetContent)
  const newYaml: Record<`l_${string}`, Record<string, [string, string | null]>> = {
    l_korean: {}
  }

  log.verbose(`[${mode}/${file}] 원본 키 갯수: ${Object.keys(sourceContent).length}`)
  log.verbose(`[${mode}/${file}] 번역 키 갯수: ${Object.keys(targetContent).length}`)

  // 최상위 언어 코드 정의 변경
  const langKey = Object.keys(targetYaml)[0] || 'l_korean'
  if (langKey.startsWith('l_')) {
    log.verbose(`[${mode}/${file}] 언어 키 발견! "${langKey}" -> "l_korean"`)
  }

  const TRANSLATE_BATCH_SIZE = getTranslateBatchSize() // 번역 API 배치 크기 (환경변수로 조정 가능)
  let processedCount = 0
  const entries = Object.entries(sourceYaml[`l_${sourceLanguage}`])
  const totalEntries = entries.length
  const sourceKeys = new Set(entries.map(([key]) => key))
  const previousKoreanEntries = (targetYaml[langKey] ?? {}) as Record<string, [string, string | null]>
  const pendingTranslations: Array<{ key: string; sourceValue: string; sourceHash: string; shouldTransliterate: boolean }> = []
  let hasUnsavedChanges = false

  const buildProgressYaml = (): typeof newYaml => {
    const mergedEntries: Record<string, [string, string | null]> = { ...newYaml.l_korean }

    // 아직 순회하지 않은 키는 기존 번역 파일 값을 유지하여 중간 저장 시 파일 잘림을 방지
    for (const [key, value] of Object.entries(previousKoreanEntries)) {
      if (!Object.hasOwn(mergedEntries, key) && sourceKeys.has(key)) {
        mergedEntries[key] = value
      }
    }

    return { l_korean: mergedEntries }
  }

  async function saveCurrentProgress (): Promise<void> {
    const updatedContent = stringifyYaml(buildProgressYaml())
    await writeFile(targetPath, updatedContent, 'utf-8')
    hasUnsavedChanges = false
  }

  async function flushPendingTranslations (): Promise<void> {
    if (pendingTranslations.length === 0) {
      return
    }

    const translationItems = pendingTranslations.splice(0, pendingTranslations.length)
    const transliterationItems = translationItems.filter(item => item.shouldTransliterate)
    const normalItems = translationItems.filter(item => !item.shouldTransliterate)

    const applyResults = async (items: typeof translationItems, results: Awaited<ReturnType<typeof translateBulk>>) => {
      for (const [index, item] of items.entries()) {
        const result = results[index]
        let hashForEntry: string | null = item.sourceHash
        let translatedValue = result.translatedText

        if (result.error instanceof TranslationRetryExceededError) {
          log.warn(`[${mode}/${file}:${item.key}] 번역 재시도 초과, 원문을 유지합니다.`)
          translatedValue = item.sourceValue
          hashForEntry = null
          untranslatedItems.push({ mod: logModName, file, key: item.key, message: item.sourceValue })
        } else if (result.error instanceof TranslationRefusedError) {
          log.warn(`[${mode}/${file}:${item.key}] 번역 거부됨: ${result.error.reason}`)
          log.info(`[${mode}/${file}:${item.key}] 원문을 유지하고 다음 항목으로 계속 진행합니다.`)
          translatedValue = item.sourceValue
          hashForEntry = null
          untranslatedItems.push({
            mod: logModName,
            file,
            key: item.key,
            message: `${item.sourceValue} (번역 거부: ${result.error.reason})`
          })
        }

        if (item.shouldTransliterate && isSuspiciousShortTransliterationResult(item.sourceValue, translatedValue)) {
          try {
            const retried = await translate(
              item.sourceValue,
              gameType,
              0,
              {
                previousTranslation: translatedValue,
                failureReason: '음역 컨텍스트에서 의미 번역 가능성이 감지되었습니다. 사전적 의미 번역을 피하고 발음 기반 음역으로만 번역하세요.'
              },
              true,
              true
            )

            if (retried !== translatedValue) {
              log.info(`[${mode}/${file}:${item.key}] 짧은 음역 의심 항목 재번역 적용: "${translatedValue}" -> "${retried}"`)
              translatedValue = retried
            }
          } catch (error) {
            log.warn(`[${mode}/${file}:${item.key}] 짧은 음역 의심 항목 재번역 실패: ${String(error)}`)
          }
        }

        newYaml.l_korean[item.key] = [translatedValue, hashForEntry]
        hasUnsavedChanges = true
        processedCount++
      }
    }

    async function processModeItems (items: typeof translationItems, useTransliteration: boolean): Promise<void> {
      if (items.length === 0) {
        return
      }

      try {
        const results = await translateBulk(items.map(item => item.sourceValue), gameType, useTransliteration, { modName: logModName })
        await applyResults(items, results)
      } catch (error) {
        const modeLabel = useTransliteration ? '음역 모드' : '번역 모드'
        log.warn(`[${mode}/${file}] ${modeLabel} 처리 중 오류 발생, 해당 모드는 원문 유지 후 다음 모드로 진행합니다.`)
        log.warn(`[${mode}/${file}] ${modeLabel} 오류 상세: ${String(error)}`)

        for (const item of items) {
          newYaml.l_korean[item.key] = [item.sourceValue, null]
          hasUnsavedChanges = true
          untranslatedItems.push({
            mod: logModName,
            file,
            key: item.key,
            message: `${item.sourceValue} (${modeLabel} 오류: ${String(error)})`
          })
          processedCount++
        }
      }
    }

    await processModeItems(normalItems, false)
    await processModeItems(transliterationItems, true)

    // 배치 번역이 끝나면 즉시 파일에 반영
    await saveCurrentProgress()
    log.verbose(`[${mode}/${file}] 배치 번역 결과 저장 완료 (${processedCount}/${totalEntries} 처리됨)`)
  }

  for (const [key, [sourceValue]] of entries) {
    // 타임아웃 확인: 100회마다만 체크
    if (timeoutMs !== null && processedCount % 100 === 0 && Date.now() - startTime >= timeoutMs) {
      log.info(`[${mode}/${file}] 타임아웃 도달 (${processedCount}/${totalEntries} 처리됨)`)
      // 현재까지 작업 저장
      await saveCurrentProgress()
      log.info(`[${mode}/${file}] 타임아웃으로 인한 중간 저장 완료`)
      throw new TimeoutReachedError()
    }

    const sourceHash = hashing(sourceValue)
    log.verbose(`[${mode}/${file}:${key}] 원본파일 문자열: ${sourceHash} | "${sourceValue}" `)

    const [targetValue, targetHash] = (targetYaml[langKey] && targetYaml[langKey][key]) || []

    // 해싱 처리용 유틸리티
    if (onlyHash) {
      newYaml.l_korean[key] = [targetValue, sourceHash]
      hasUnsavedChanges = true
      log.debug(`[${mode}/${file}:${key}] 해시 업데이트: ${targetHash} -> ${sourceHash}`)
      processedCount++
      continue
    }

    // 번역이 존재하고 해시가 일치하면 스킵 (강화된 검증)
    if (targetValue && targetHash && (sourceHash === targetHash)) {
      log.verbose(`[${mode}/${file}:${key}] 번역파일 문자열: ${targetHash} | "${targetValue}" (번역됨)`)
      newYaml.l_korean[key] = [targetValue, targetHash]
      hasUnsavedChanges = true
      processedCount++
      continue
    }

    // 디버깅: 해시 비교 실패 시 상세 정보 로깅
    if (targetValue && targetHash && sourceHash !== targetHash) {
      log.debug(`[${mode}/${file}:${key}] 해시 불일치 감지:`)
      log.debug(`  - sourceHash: "${sourceHash}" (type: ${typeof sourceHash}, length: ${sourceHash.length})`)
      log.debug(`  - targetHash: "${targetHash}" (type: ${typeof targetHash}, length: ${targetHash.length})`)
      log.debug(`  - 비교 결과: ${sourceHash === targetHash}`)
      log.debug(`  - 엄격 비교: ${Object.is(sourceHash, targetHash)}`)
    }

    log.verbose(`[${mode}/${file}:${key}] 번역파일 문자열: ${targetHash} | "${targetValue}"`)

    // 음역 모드 결정: 파일 레벨 우선, 그 다음 키 레벨 검사
    const shouldTransliterate = isTransliterationFile || shouldUseTransliterationForKey(key)
    
    // 키 레벨 음역 모드가 활성화된 경우 로그 출력
    if (!isTransliterationFile && shouldTransliterate) {
      log.verbose(`[${mode}/${file}:${key}] 키 레벨 음역 모드 활성화됨 (키가 _adj 또는 _name으로 끝남)`)
    }

    log.verbose(`[${mode}/${file}:${key}] ${shouldTransliterate ? '음역' : '번역'} 요청 대기열 추가: ${sourceHash} | "${sourceValue}"`)
    pendingTranslations.push({ key, sourceValue, sourceHash, shouldTransliterate })

    if (pendingTranslations.length >= TRANSLATE_BATCH_SIZE) {
      await flushPendingTranslations()
    }

  }

  await flushPendingTranslations()

  // 최종 저장
  // 빈 파일 생성 방지: l_korean 객체가 비어있으면 파일을 쓰지 않음
  const hasEntries = Object.keys(newYaml.l_korean).length > 0
  
  if (!hasEntries) {
    log.warn(`[${mode}/${file}] 번역할 항목이 없습니다. 파일을 생성하지 않습니다.`)
    // 기존 파일이 있다면 git checkout으로 변경사항 롤백 (업스트림에서 내용이 모두 삭제된 경우)
    try {
      await access(targetPath)
      await execAsync(`git checkout HEAD -- ${escapeShellArg(targetPath)}`, { cwd: projectRoot })
      log.info(`[${mode}/${file}] 빈 파일 변경사항 롤백: ${targetPath}`)
    } catch (error) {
      // 파일이 없거나 git에 없으면 무시, 그 외는 경고
      if (error && typeof error === 'object') {
        // node:fs/promises access error
        if ('code' in error && error.code === 'ENOENT') {
          log.debug(`[${mode}/${file}] 롤백 불가 (파일 없음)`)
        // node:child_process exec error
        } else if ('message' in error) {
          const errMsg = (error as Error).message
          if (errMsg.includes('did not match any files') || errMsg.includes('pathspec')) {
            log.debug(`[${mode}/${file}] 롤백 불가 (git에 없음)`)
          } else {
            log.warn(`[${mode}/${file}] 롤백 중 예기치 않은 오류 발생:`, error)
          }
        } else {
          log.warn(`[${mode}/${file}] 롤백 중 알 수 없는 오류 발생:`, error)
        }
      }
    }
  } else {
    if (hasUnsavedChanges) {
      await saveCurrentProgress()
    }
    log.debug(`[${mode}/${file}] 번역 완료 (번역 파일 위치: ${targetPath})`)
  }
  
  return untranslatedItems
}
