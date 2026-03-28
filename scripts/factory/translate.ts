import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, dirname, join } from 'pathe'
import { parseToml, parseYaml, stringifyYaml } from '../parser'
import { hashing } from '../utils/hashing'
import { log } from '../utils/logger'
import { translateBulk, TranslationRetryExceededError, TranslationRefusedError } from '../utils/translate'
import { updateAllUpstreams } from '../utils/upstream'
import { type GameType, shouldUseTransliteration, shouldUseTransliterationForKey } from '../utils/prompts'

const execAsync = promisify(exec)

// 번역 거부 항목 출력 파일 이름 접미사
const UNTRANSLATED_ITEMS_FILE_SUFFIX = 'untranslated-items.json'

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

  const allUntranslatedItems: UntranslatedItem[] = []

  for (const mod of mods) {
    const processes: Promise<UntranslatedItem[]>[] = []
    const locPathCleanupTasks: Array<{ targetDir: string; expectedKoreanFiles: string[]; mod: string; locPath: string }> = []
    log.start(`[${mod}] 작업 시작 (원본 파일 경로: ${rootDir}/${mod})`)
    const modDir = join(rootDir, mod)
    const metaPath = join(modDir, 'meta.toml')

    // `meta.toml`이 존재하지 않거나 디렉토리 등 파일이 아니면 무시
    if (!(await stat(metaPath)).isFile()) {
      continue
    }

    const metaContent = await readFile(metaPath, 'utf-8')
    const meta = parseToml(metaContent) as ModMeta
    log.debug(`[${mod}] 메타데이터:  upstream.language: ${meta.upstream.language}, upstream.localization: [${meta.upstream.localization}]`)

    for (const locPath of meta.upstream.localization) {
      const sourceDir = join(modDir, 'upstream', locPath)
      const localizationFolder = getLocalizationFolderName(gameType)
      const targetDir = join(modDir, 'mod', localizationFolder, sourceDir.includes('replace') ? 'korean/replace' : 'korean')

      // 모드 디렉토리 생성
      await mkdir(targetDir, { recursive: true })

      // upstream 디렉토리 존재 여부 확인
      try {
        await access(sourceDir)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(
            `[${mod}] upstream 디렉토리가 존재하지 않습니다: ${sourceDir}\n` +
            `meta.toml의 localization 경로를 확인하거나 upstream 업데이트가 실패했을 수 있습니다.\n` +
            `경로: ${locPath}`
          )
        }
        throw error
      }

      const sourceFiles = await readdir(sourceDir, { recursive: true })
      const expectedKoreanFiles: string[] = []
      
      for (const file of sourceFiles) {
        // 언어파일 이름이 `_l_언어코드.yml` 형식이면 처리
        if (file.endsWith(`.yml`) && file.includes(`_l_${meta.upstream.language}`)) {
          processes.push(processLanguageFile(mod, sourceDir, targetDir, file, meta.upstream.language, gameType, onlyHash, startTime, timeoutMs, projectRoot, meta.upstream.transliteration_files))
          // 처리될 한국어 파일 경로 추적
          const targetParentDir = join(targetDir, dirname(file))
          const targetFileName = '___' + basename(file).replace(`_l_${meta.upstream.language}.yml`, '_l_korean.yml')
          expectedKoreanFiles.push(join(targetParentDir, targetFileName))
        }
      }
      
      // 각 로케일 경로별 예상 파일 목록 저장
      locPathCleanupTasks.push({ targetDir, expectedKoreanFiles, mod, locPath })
    }

    // Promise.allSettled를 사용하여 모든 파일 처리가 완료될 때까지 대기
    // 일부 파일에서 번역 거부가 발생해도 다른 파일들의 결과를 모두 수집
    const results = await Promise.allSettled(processes)
    
    // 모든 파일 처리 완료 후 orphaned 파일 정리
    for (const task of locPathCleanupTasks) {
      await cleanupOrphanedFiles(task.targetDir, task.expectedKoreanFiles, task.mod, task.locPath, projectRoot)
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
          log.warn(`[${mod}] 타임아웃으로 인해 번역 중단됨`)
          log.info(`타임아웃 도달: 처리된 작업까지 저장하고 종료합니다`)
          // 타임아웃 시에도 현재까지 수집된 항목 반환
          allUntranslatedItems.push(...untranslatedItems)
          return saveAndReturnResult(projectRoot, gameType, allUntranslatedItems)
        } else {
          // 다른 예외는 그대로 throw
          throw error
        }
      }
    }
    
    allUntranslatedItems.push(...untranslatedItems)
    
    log.success(`[${mod}] 번역 완료`)
    
    // 번역되지 않은 항목 요약 출력
    if (untranslatedItems.length > 0) {
      for (const item of untranslatedItems) {
        log.warn(`  [${item.mod}/${item.file}:${item.key}] "${item.message}"`)
      }
    } else if (!onlyHash) {
      log.success(`모든 항목이 성공적으로 번역되었습니다.`)
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
async function cleanupOrphanedFiles(targetDir: string, expectedKoreanFiles: string[], mod: string, locPath: string, projectRoot: string): Promise<void> {
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
  const expectedSet = new Set(expectedKoreanFiles)

  // 업스트림에 없는 한국어 파일의 변경사항을 git으로 롤백
  for (const file of koreanFiles) {
    const fullPath = join(targetDir, file)
    
    if (!expectedSet.has(fullPath)) {
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

  const SAVE_BATCH_SIZE = 1000 // 1,000 라인마다 파일에 저장
  const TRANSLATE_BATCH_SIZE = 20 // 번역 API는 20개 단위 벌크 처리
  let processedCount = 0
  const entries = Object.entries(sourceYaml[`l_${sourceLanguage}`])
  const totalEntries = entries.length
  const pendingTranslations: Array<{ key: string; sourceValue: string; sourceHash: string; shouldTransliterate: boolean }> = []

  async function flushPendingTranslations (): Promise<void> {
    if (pendingTranslations.length === 0) {
      return
    }

    const translationItems = pendingTranslations.splice(0, pendingTranslations.length)
    const transliterationItems = translationItems.filter(item => item.shouldTransliterate)
    const normalItems = translationItems.filter(item => !item.shouldTransliterate)

    const applyResults = (items: typeof translationItems, results: Awaited<ReturnType<typeof translateBulk>>) => {
      for (const [index, item] of items.entries()) {
        const result = results[index]
        let hashForEntry: string | null = item.sourceHash
        let translatedValue = result.translatedText

        if (result.error instanceof TranslationRetryExceededError) {
          log.warn(`[${mode}/${file}:${item.key}] 번역 재시도 초과, 원문을 유지합니다.`)
          translatedValue = item.sourceValue
          hashForEntry = null
          untranslatedItems.push({ mod: mode, file, key: item.key, message: item.sourceValue })
        } else if (result.error instanceof TranslationRefusedError) {
          log.warn(`[${mode}/${file}:${item.key}] 번역 거부됨: ${result.error.reason}`)
          log.info(`[${mode}/${file}:${item.key}] 원문을 유지하고 다음 항목으로 계속 진행합니다.`)
          translatedValue = item.sourceValue
          hashForEntry = null
          untranslatedItems.push({
            mod: mode,
            file,
            key: item.key,
            message: `${item.sourceValue} (번역 거부: ${result.error.reason})`
          })
        }

        newYaml.l_korean[item.key] = [translatedValue, hashForEntry]
        processedCount++
      }
    }

    async function processModeItems (items: typeof translationItems, useTransliteration: boolean): Promise<void> {
      if (items.length === 0) {
        return
      }

      try {
        const results = await translateBulk(items.map(item => item.sourceValue), gameType, useTransliteration)
        applyResults(items, results)
      } catch (error) {
        const modeLabel = useTransliteration ? '음역 모드' : '번역 모드'
        log.warn(`[${mode}/${file}] ${modeLabel} 처리 중 오류 발생, 해당 모드는 원문 유지 후 다음 모드로 진행합니다.`)
        log.warn(`[${mode}/${file}] ${modeLabel} 오류 상세: ${String(error)}`)

        for (const item of items) {
          newYaml.l_korean[item.key] = [item.sourceValue, null]
          untranslatedItems.push({
            mod: mode,
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
  }

  for (const [key, [sourceValue]] of entries) {
    // 타임아웃 확인: 100회마다만 체크
    if (timeoutMs !== null && processedCount % 100 === 0 && Date.now() - startTime >= timeoutMs) {
      log.info(`[${mode}/${file}] 타임아웃 도달 (${processedCount}/${totalEntries} 처리됨)`)
      // 현재까지 작업 저장
      const updatedContent = stringifyYaml(newYaml)
      await writeFile(targetPath, updatedContent, 'utf-8')
      log.info(`[${mode}/${file}] 타임아웃으로 인한 중간 저장 완료`)
      throw new TimeoutReachedError()
    }

    const sourceHash = hashing(sourceValue)
    log.verbose(`[${mode}/${file}:${key}] 원본파일 문자열: ${sourceHash} | "${sourceValue}" `)

    const [targetValue, targetHash] = (targetYaml[langKey] && targetYaml[langKey][key]) || []

    // 해싱 처리용 유틸리티
    if (onlyHash) {
      newYaml.l_korean[key] = [targetValue, sourceHash]
      log.debug(`[${mode}/${file}:${key}] 해시 업데이트: ${targetHash} -> ${sourceHash}`)
      processedCount++
      continue
    }

    // 번역이 존재하고 해시가 일치하면 스킵 (강화된 검증)
    if (targetValue && targetHash && (sourceHash === targetHash)) {
      log.verbose(`[${mode}/${file}:${key}] 번역파일 문자열: ${targetHash} | "${targetValue}" (번역됨)`)
      newYaml.l_korean[key] = [targetValue, targetHash]
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

    // 1,000 라인마다 중간 저장
    if (processedCount > 0 && processedCount % SAVE_BATCH_SIZE === 0) {
      const updatedContent = stringifyYaml(newYaml)
      await writeFile(targetPath, updatedContent, 'utf-8')
      log.info(`[${mode}/${file}] 중간 저장 완료 (${processedCount}/${totalEntries} 처리됨)`)
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
    const updatedContent = stringifyYaml(newYaml)
    await writeFile(targetPath, updatedContent, 'utf-8')
    log.debug(`[${mode}/${file}] 번역 완료 (번역 파일 위치: ${targetPath})`)
  }
  
  return untranslatedItems
}
