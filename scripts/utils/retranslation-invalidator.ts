import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, parse } from 'pathe'
import { parseToml, parseYaml, stringifyYaml } from '../parser'
import { log } from './logger'
import { type GameType, shouldUseTransliteration } from './prompts'
import { validateTranslationEntries } from './translation-validator'
import { getUpstreamFileHashesPath, readUpstreamFileHashes, removeUpstreamFileHash, writeUpstreamFileHashes } from './upstream-file-hashes'

interface ModMeta {
  upstream: {
    localization: string[]
    language: string
  }
}

/**
 * 잘못되었거나 누락된 번역 출력을 찾아 다음 번역 시 복구되도록 무효화합니다.
 * 항목 수준 문제는 엔트리 해시를 비우고, 파일 수준 문제는 upstream 파일 해시를 제거합니다.
 * @param gameType 게임 타입 (ck3, vic3, stellaris)
 * @param rootDir 루트 디렉토리 경로
 * @param targetMods 처리할 모드 목록 (선택사항, 미지정시 전체 모드 처리)
 */
export async function invalidateIncorrectTranslations(gameType: GameType, rootDir: string, targetMods?: string[]): Promise<void> {
  log.start(`[${gameType.toUpperCase()}] 잘못되었거나 누락된 번역 출력 복구 무효화 시작`)
  log.info(`대상 디렉토리: ${rootDir}`)

  const mods = targetMods ?? await readdir(rootDir)
  log.info(`대상 모드: [${mods.join(', ')}]`)

  let totalInvalidatedEntries = 0
  let totalRequeuedFiles = 0

  for (const mod of mods) {
    const modDir = join(rootDir, mod)
    const metaPath = join(modDir, 'meta.toml')

    log.info(`[${mod}] 처리 시작`)
    log.debug(`[${mod}] meta.toml 경로: ${metaPath}`)

    try {
      const metaContent = await readFile(metaPath, 'utf-8')
      const meta = parseToml(metaContent) as ModMeta

      log.debug(`[${mod}] 메타데이터 읽기 성공`)
      log.debug(`[${mod}] upstream.language: ${meta.upstream.language}`)
      log.debug(`[${mod}] upstream.localization: [${meta.upstream.localization.join(', ')}]`)

      for (const locPath of meta.upstream.localization) {
        log.info(`[${mod}] localization 경로 처리: ${locPath}`)
        const result = await invalidateModLocalization(mod, modDir, locPath, meta.upstream.language, gameType)
        totalInvalidatedEntries += result.invalidatedEntries
        totalRequeuedFiles += result.requeuedFiles
        log.info(`[${mod}/${locPath}] 항목 무효화: ${result.invalidatedEntries}개, 파일 재처리 예약: ${result.requeuedFiles}개`)
      }

      log.success(`[${mod}] 완료`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        log.debug(`[${mod}] meta.toml 없음, 건너뛰기`)
        continue
      }
      log.error(`[${mod}] 오류 발생:`, error)
      throw error
    }
  }

  log.success(`번역 출력 복구 무효화 완료 - 항목 무효화: ${totalInvalidatedEntries}개, 파일 재처리 예약: ${totalRequeuedFiles}개`)
}

interface InvalidationResult {
  invalidatedEntries: number
  requeuedFiles: number
}

async function invalidateModLocalization(
  modName: string,
  modDir: string,
  locPath: string,
  sourceLanguage: string,
  gameType: GameType
): Promise<InvalidationResult> {
  const sourceDir = join(modDir, 'upstream', locPath)
  const targetDir = join(modDir, 'mod', getLocalizationFolderName(gameType), locPath.includes('replace') ? 'korean/replace' : 'korean')
  const hashFilePath = getUpstreamFileHashesPath(modDir)

  log.debug(`[${modName}] 소스 디렉토리: ${sourceDir}`)
  log.debug(`[${modName}] 타겟 디렉토리: ${targetDir}`)

  try {
    const sourceFiles = await readdir(sourceDir, { recursive: true })
    log.debug(`[${modName}] 소스 파일들: [${sourceFiles.join(', ')}]`)

    let invalidatedEntries = 0
    let requeuedFiles = 0
    let hasHashChanges = false
    const upstreamFileHashes = await readUpstreamFileHashes(hashFilePath)

    for (const file of sourceFiles) {
      if (file.endsWith(`_l_${sourceLanguage}.yml`)) {
        const sourceFilePath = join(sourceDir, file)
        const { dir, base } = parse(file)
        const targetFileName = '___' + base.replace(`_l_${sourceLanguage}.yml`, '_l_korean.yml')
        const targetRelativePath = dir ? join(dir, targetFileName) : targetFileName
        const targetFilePath = join(targetDir, targetRelativePath)
        const sourceRelativePath = join(locPath, file).replace(/\\/g, '/')

        // 파일명으로 음역 모드 판단
        const useTransliteration = shouldUseTransliteration(file)
        if (useTransliteration) {
          log.debug(`[${modName}] 음역 모드 파일: ${file}`)
        }

        log.debug(`[${modName}] 처리할 파일: ${file}`)
        log.debug(`[${modName}] 소스: ${sourceFilePath}`)
        log.debug(`[${modName}] 타겟: ${targetFilePath}`)

        const result = await invalidateTranslationFile(modName, sourceFilePath, targetFilePath, gameType, useTransliteration)
        invalidatedEntries += result.invalidatedEntries

        if (result.shouldRequeueFile) {
          const removed = removeUpstreamFileHash(upstreamFileHashes, sourceRelativePath)
          if (removed) {
            hasHashChanges = true
            requeuedFiles++
            log.info(`[${modName}/${file}] 업스트림 파일 해시 무효화: ${result.requeueReason}`)
          } else {
            log.debug(`[${modName}/${file}] 업스트림 파일 해시가 이미 없어 재처리 예약 상태입니다`)
          }
        }

        log.debug(`[${modName}/${file}] 항목 무효화: ${result.invalidatedEntries}개`)
      }
    }

    if (hasHashChanges) {
      await writeUpstreamFileHashes(hashFilePath, upstreamFileHashes)
    }

    return { invalidatedEntries, requeuedFiles }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      log.warn(`[${modName}] 소스 디렉토리 없음: ${sourceDir}`)
      return { invalidatedEntries: 0, requeuedFiles: 0 }
    }
    log.error(`[${modName}] 디렉토리 읽기 오류:`, error)
    throw error
  }
}

interface InvalidateTranslationFileResult {
  invalidatedEntries: number
  shouldRequeueFile: boolean
  requeueReason?: string
}

async function invalidateTranslationFile(
  modName: string,
  sourceFilePath: string,
  targetFilePath: string,
  gameType: GameType,
  useTransliteration: boolean = false
): Promise<InvalidateTranslationFileResult> {
  try {
    log.debug(`[${modName}] 파일 처리 시작: ${sourceFilePath}`)

    // 원본 파일 읽기
    const sourceContent = await readFile(sourceFilePath, 'utf-8')
    const sourceYaml = parseYaml(sourceContent) as Record<string, Record<string, [string, string]>>

    // 번역 파일 읽기 (없으면 건너뜀)
    let targetContent: string
    try {
      targetContent = await readFile(targetFilePath, 'utf-8')
      log.debug(`[${modName}] 번역 파일 읽기 성공: ${targetFilePath}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        log.info(`[${modName}] 번역 파일 누락으로 파일 재처리 예약: ${targetFilePath}`)
        return { invalidatedEntries: 0, shouldRequeueFile: true, requeueReason: '번역 파일 누락' }
      }
      throw error
    }

    const targetYaml = parseYaml(targetContent) as Record<string, Record<string, [string, string]>>

    let invalidatedCount = 0
    let hasChanges = false

    // 원본 파일의 언어 키 찾기
    const sourceLangKey = Object.keys(sourceYaml)[0]
    if (!sourceLangKey || !sourceLangKey.startsWith('l_')) {
      log.debug(`[${modName}] 원본 파일에 언어 키 없음: ${sourceLangKey}`)
      return { invalidatedEntries: 0, shouldRequeueFile: false }
    }

    // 번역 파일의 언어 키 찾기
    const targetLangKey = Object.keys(targetYaml)[0]
    if (!targetLangKey || !targetLangKey.startsWith('l_')) {
      log.info(`[${modName}] 번역 파일 언어 키 누락으로 파일 재처리 예약: ${targetFilePath}`)
      return { invalidatedEntries: 0, shouldRequeueFile: true, requeueReason: '번역 파일 언어 키 누락' }
    }

    const sourceEntries = sourceYaml[sourceLangKey]
    const targetEntries = targetYaml[targetLangKey]

    log.debug(`[${modName}] 원본 키 개수: ${Object.keys(sourceEntries).length}`)
    log.debug(`[${modName}] 번역 키 개수: ${Object.keys(targetEntries).length}`)

    // 번역 검증 수행 (음역 모드 여부 전달)
    const invalidEntries = validateTranslationEntries(
      sourceEntries,
      targetEntries,
      gameType,
      useTransliteration
    )

    const missingKeys = Object.keys(sourceEntries).filter(key => !targetEntries[key])
    const emptyTranslationKeys = Object.entries(sourceEntries)
      .filter(([key, [sourceValue]]) => {
        const targetEntry = targetEntries[key]
        if (!targetEntry) {
          return false
        }

        const [translatedValue] = targetEntry
        return sourceValue.trim() !== '' && translatedValue !== sourceValue && translatedValue.trim() === ''
      })
      .map(([key]) => key)

    // 잘못된 번역에 대해 해시 초기화
    for (const entry of invalidEntries) {
      const [currentTranslation] = targetEntries[entry.key]
      targetEntries[entry.key] = [currentTranslation, ''] // 해시 초기화
      invalidatedCount++
      hasChanges = true

      log.info(`[${modName}] 무효화: "${entry.sourceValue}" -> "${entry.translatedValue}" (사유: ${entry.reason})`)
    }

    for (const key of emptyTranslationKeys) {
      const [currentTranslation, currentHash] = targetEntries[key]
      if (currentHash !== '') {
        targetEntries[key] = [currentTranslation, '']
        hasChanges = true
      }
      invalidatedCount++
      log.info(`[${modName}] 무효화: "${key}"의 번역 값이 비어 있어 파일 재처리 대상에 포함합니다`)
    }

    const shouldRequeueFile = invalidEntries.length > 0 || missingKeys.length > 0 || emptyTranslationKeys.length > 0
    const requeueReasons: string[] = []
    if (missingKeys.length > 0) {
      requeueReasons.push(`누락 키 ${missingKeys.length}개`)
      log.info(`[${modName}] 누락 키 감지: ${missingKeys.slice(0, 5).join(', ')}${missingKeys.length > 5 ? '...' : ''}`)
    }
    if (emptyTranslationKeys.length > 0) {
      requeueReasons.push(`빈 번역 값 ${emptyTranslationKeys.length}개`)
    }
    if (invalidEntries.length > 0) {
      requeueReasons.push(`잘못된 번역 ${invalidEntries.length}개`)
    }

    if (hasChanges) {
      const updatedContent = stringifyYaml(targetYaml)
      await writeFile(targetFilePath, updatedContent, 'utf-8')
      log.debug(`[${modName}] 파일 업데이트 완료: ${targetFilePath}`)
    } else {
      log.debug(`[${modName}] 변경사항 없음`)
    }

    return {
      invalidatedEntries: invalidatedCount,
      shouldRequeueFile,
      requeueReason: requeueReasons.join(', ')
    }
  } catch (error) {
    log.error(`[${modName}] 파일 처리 실패: ${sourceFilePath} -> ${targetFilePath}`, error)
    return { invalidatedEntries: 0, shouldRequeueFile: false }
  }
}

export function getLocalizationFolderName(gameType: GameType): string {
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
