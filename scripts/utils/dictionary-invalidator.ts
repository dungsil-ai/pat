import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, parse } from 'pathe'
import { parseToml, parseYaml, stringifyYaml } from '../parser'
import { getDictionaries, getDictionary, getProperNouns } from './dictionary'
import { type DictionaryChangeOptions, type DictionaryKeyInfo, getChangedDictionaryKeysWithInfo } from './dictionary-changes'
import { hashing } from './hashing'
import { log } from './logger'
import { type GameType, shouldUseTransliteration } from './prompts'
import { buildKoreanTargetFileName } from './localization-file-name'

interface ModMeta {
  upstream: {
    localization: string[]
    language: string
  }
}

/**
 * 번역 값이 함수 호출로만 구성되어 있는지 확인합니다.
 * 게임 로컬라이제이션에서 [Function], $VARIABLE$ 등의 형태로만 구성된 값을 감지합니다.
 */
function isOnlyFunctions(value: string): boolean {
  // 빈 문자열이면 함수 전용이 아님
  if (!value?.trim()) {
    return false
  }

  // 모든 함수/변수 패턴 제거
  // [Function], [Function|E], $VARIABLE$, #코드#, @변수@ 형태를 제거
  const withoutFunctions = value
    .replace(/\[[^\]]+\]/g, '') // [Function] 제거
    .replace(/\$[^$]+\$/g, '')   // $VARIABLE$ 제거
    .replace(/#[^#]+#/g, '')      // #코드# 제거
    .replace(/@[^@]+@/g, '')      // @변수@ 제거
    .trim()

  // 함수를 모두 제거한 후 아무것도 남지 않으면 함수 전용
  return withoutFunctions === ''
}

/**
 * 단어사전 업데이트에 따라 번역 파일을 무효화합니다.
 *
 * 주요 로직:
 * 1. --since-commit에서 해당 커밋의 dictionary.ts 파일의 변경사항을 확인
 * 2. 해당 변경 사항이 현재 실행된 스크립트의 게임 종류와 동일한지 확인하고 동일하지 않으면 스크립트를 종료
 * 3. 변경된 단어사전의 key값을 upstream 내 value 값 중 일치하는지 확인 (대소문자 구분 없음)
 * 4. 해당 upstream의 value 값의 key 값을 번역 파일의 key 값에서 찾음
 *    4-1. 번역 value 값이 함수로만 이루어져있는 경우, 무시
 *    4-2. 번역 value 값이 단어사전과 완전히 일치하는 경우 단어사전의 값으로 교체
 *    4-3. 위의 경우가 아닌 경우 해시 값을 제거해 재번역 대상임을 표시
 *         (단, ck3ProperNouns에서 온 키는 4-3 단계를 건너뜀)
 *
 * @param gameType 게임 타입
 * @param rootDir 루트 디렉토리
 * @param targetMods 대상 모드 목록 (선택사항)
 * @param filterKeysOrOptions 필터링할 키 목록 또는 딕셔너리 변경 옵션 (선택사항)
 */
export async function invalidateDictionaryTranslations(
  gameType: GameType,
  rootDir: string,
  targetMods?: string[],
  filterKeysOrOptions?: string[] | DictionaryChangeOptions
): Promise<void> {
  log.start(`[${gameType.toUpperCase()}] 단어사전 기반 번역 무효화 시작`)
  log.info(`대상 디렉토리: ${rootDir}`)

  // 1. 변경된 딕셔너리 키와 섹션 정보 추출
  let changedKeyInfos: DictionaryKeyInfo[] = []

  // filterKeysOrOptions 타입에 따라 처리
  const isArrayFilter = Array.isArray(filterKeysOrOptions)
  const isOptionsFilter = filterKeysOrOptions && !isArrayFilter &&
    (filterKeysOrOptions.sinceCommit || filterKeysOrOptions.commitRange || filterKeysOrOptions.sinceDate)

  if (isArrayFilter) {
    // filterKeysOrOptions가 배열이면 섹션 정보 없이 직접 사용 (기존 호환성)
    changedKeyInfos = filterKeysOrOptions.map(key => ({ key, section: 'unknown' }))
    log.info(`[${gameType.toUpperCase()}] 지정된 키 ${changedKeyInfos.length}개 사용`)
  } else if (isOptionsFilter) {
    // DictionaryChangeOptions 객체인 경우
    changedKeyInfos = await getChangedDictionaryKeysWithInfo(gameType, filterKeysOrOptions)

    // 2. 해당 게임 타입의 변경사항이 없으면 종료
    if (changedKeyInfos.length === 0) {
      log.info(`[${gameType.toUpperCase()}] 게임 타입에 대한 딕셔너리 변경사항이 없습니다. 무효화를 건너뜁니다.`)
      return
    }

    const keys = changedKeyInfos.map(info => info.key)
    log.info(`[${gameType.toUpperCase()}] 변경된 키 ${keys.length}개: [${keys.slice(0, 10).join(', ')}${keys.length > 10 ? '...' : ''}]`)
  } else {
    // filterKeysOrOptions가 없으면 전체 딕셔너리 사용
    const allKeys = Object.keys(getDictionaries(gameType))
    changedKeyInfos = allKeys.map(key => ({ key, section: 'unknown' }))
    log.info(`[${gameType.toUpperCase()}] 전체 딕셔너리 사용 (${changedKeyInfos.length}개 키)`)
  }

  const mods = targetMods ?? await readdir(rootDir)
  log.info(`대상 모드: [${mods.join(', ')}]`)

  let totalInvalidated = 0
  let totalReplaced = 0
  let totalIgnored = 0
  let totalSkippedProperNouns = 0

  for (const mod of mods) {
    const modDir = join(rootDir, mod)
    const metaPath = join(modDir, 'meta.toml')

    log.info(`[${mod}] 처리 시작`)

    try {
      const metaContent = await readFile(metaPath, 'utf-8')
      const meta = parseToml(metaContent) as ModMeta

      for (const locPath of meta.upstream.localization) {
        const result = await processModLocalization(
          mod,
          modDir,
          locPath,
          meta.upstream.language,
          gameType,
          changedKeyInfos
        )

        totalInvalidated += result.invalidated
        totalReplaced += result.replaced
        totalIgnored += result.ignored
        totalSkippedProperNouns += result.skippedProperNouns

        log.info(`[${mod}/${locPath}] 무효화: ${result.invalidated}개, 교체: ${result.replaced}개, 무시: ${result.ignored}개, 고유명사 건너뜀: ${result.skippedProperNouns}개`)
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

  log.success(`단어사전 기반 번역 무효화 완료 - 무효화: ${totalInvalidated}개, 교체: ${totalReplaced}개, 무시: ${totalIgnored}개, 고유명사 건너뜀: ${totalSkippedProperNouns}개`)
}

interface ProcessResult {
  invalidated: number
  replaced: number
  ignored: number
  skippedProperNouns: number
}

async function processModLocalization(
  modName: string,
  modDir: string,
  locPath: string,
  sourceLanguage: string,
  gameType: GameType,
  changedKeyInfos: DictionaryKeyInfo[]
): Promise<ProcessResult> {
  const sourceDir = join(modDir, 'upstream', locPath)
  const targetDir = join(
    modDir,
    'mod',
    getLocalizationFolderName(gameType),
    locPath.includes('replace') ? 'korean/replace' : 'korean'
  )

  let totalInvalidated = 0
  let totalReplaced = 0
  let totalIgnored = 0
  let totalSkippedProperNouns = 0

  try {
    const sourceFiles = await readdir(sourceDir, { recursive: true })

    for (const file of sourceFiles) {
      if (file.endsWith(`_l_${sourceLanguage}.yml`)) {
        const sourceFilePath = join(sourceDir, file)
        const { dir, base } = parse(file)
        const targetFileName = buildKoreanTargetFileName(base, sourceLanguage)
        const targetRelativePath = dir ? join(dir, targetFileName) : targetFileName
        const targetFilePath = join(targetDir, targetRelativePath)

        // 파일명으로 음역 모드 판단
        const useTransliteration = shouldUseTransliteration(file)
        
        const result = await processTranslationFile(
          modName,
          sourceFilePath,
          targetFilePath,
          gameType,
          changedKeyInfos,
          useTransliteration
        )

        totalInvalidated += result.invalidated
        totalReplaced += result.replaced
        totalIgnored += result.ignored
        totalSkippedProperNouns += result.skippedProperNouns
      }
    }

    return { invalidated: totalInvalidated, replaced: totalReplaced, ignored: totalIgnored, skippedProperNouns: totalSkippedProperNouns }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      log.warn(`[${modName}] 소스 디렉토리 없음: ${sourceDir}`)
      return { invalidated: 0, replaced: 0, ignored: 0, skippedProperNouns: 0 }
    }
    throw error
  }
}

async function processTranslationFile(
  modName: string,
  sourceFilePath: string,
  targetFilePath: string,
  gameType: GameType,
  changedKeyInfos: DictionaryKeyInfo[],
  useTransliteration: boolean = false
): Promise<ProcessResult> {
  let invalidated = 0
  let replaced = 0
  let ignored = 0
  let skippedProperNouns = 0

  if (useTransliteration) {
    log.debug(`[${modName}] 음역 모드 파일 처리: ${sourceFilePath}`)
  }

  try {
    // 원본 파일 읽기
    const sourceContent = await readFile(sourceFilePath, 'utf-8')
    const sourceYaml = parseYaml(sourceContent) as Record<string, Record<string, [string, string]>>

    // 번역 파일 읽기 (없으면 건너뜀)
    let targetContent: string
    try {
      targetContent = await readFile(targetFilePath, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        log.debug(`[${modName}] 번역 파일 없음: ${targetFilePath}`)
        return { invalidated: 0, replaced: 0, ignored: 0, skippedProperNouns: 0 }
      }
      throw error
    }

    const targetYaml = parseYaml(targetContent) as Record<string, Record<string, [string, string]>>

    // 원본 파일의 언어 키 찾기
    const sourceLangKey = Object.keys(sourceYaml)[0]
    if (!sourceLangKey || !sourceLangKey.startsWith('l_')) {
      return { invalidated: 0, replaced: 0, ignored: 0, skippedProperNouns: 0 }
    }

    // 번역 파일의 언어 키 찾기
    const targetLangKey = Object.keys(targetYaml)[0]
    if (!targetLangKey || !targetLangKey.startsWith('l_')) {
      return { invalidated: 0, replaced: 0, ignored: 0, skippedProperNouns: 0 }
    }

    let hasChanges = false

    // 3. upstream 파일의 각 항목에서 변경된 딕셔너리 키가 포함되어 있는지 확인
    for (const [upstreamKey, [upstreamValue]] of Object.entries(sourceYaml[sourceLangKey])) {
      const normalizedUpstreamValue = upstreamValue.toLowerCase()

      // 변경된 딕셔너리 키 중 upstream value에 포함된 것 찾기
      const matchedDictKeyInfos = changedKeyInfos.filter(keyInfo => {
        return normalizedUpstreamValue.includes(keyInfo.key.toLowerCase())
      })


      if (matchedDictKeyInfos.length === 0) {
        continue // 이 upstream 항목은 변경된 딕셔너리와 관련 없음
      }

      // 4. 번역 파일에서 해당 키 찾기
      if (!targetYaml[targetLangKey][upstreamKey]) {
        continue // 번역 파일에 해당 키가 없음
      }

      const [translationValue, translationHash] = targetYaml[targetLangKey][upstreamKey]

      // 4-1. 번역 value 값이 함수로만 이루어져있는 경우, 무시
      if (isOnlyFunctions(translationValue)) {
        log.verbose(`[${modName}] 함수 전용 값 무시: ${upstreamKey}`)
        ignored++
        continue
      }

      // 4-2. 번역 value 값이 단어사전과 완전히 일치하는 경우 단어사전의 값으로 교체
      let exactMatch = false

      for (const keyInfo of matchedDictKeyInfos) {
        const dictValue = getDictionary(keyInfo.key, gameType)

        // 단어사전과 완전히 일치하는 값인 경우 값을 그대로 넣고 hash
        if (dictValue && keyInfo.key.toLowerCase() === normalizedUpstreamValue) {
            const newHash = hashing(upstreamValue)
            targetYaml[targetLangKey][upstreamKey] = [dictValue, newHash]
            hasChanges = true
            exactMatch = true

            replaced++
            log.debug(`[${modName}] 단어사전 일치 (해시 추가): ${upstreamKey} = "${translationValue}"`)
          break
        }
      }

      // 4-2에서 처리가 완료되었으므로 다음 단계로 넘어감
      if (exactMatch) {
        continue
      }

      // 4-3. 위의 경우가 아닌 경우 해시 값을 제거해 재번역 대상임을 표시
      // 단, ProperNouns에서 온 키는 4-3 단계를 건너뜀
      const hasProperNounsOnly = matchedDictKeyInfos.every(keyInfo => {
        // 섹션이 명시적으로 ProperNouns인 경우
        if (keyInfo.section.endsWith('ProperNouns')) {
          return true
        }
        // 섹션이 'unknown'인 경우 (배열 기반 필터나 전체 딕셔너리 모드)
        // 실제로 고유명사 딕셔너리에 존재하는지 확인
        if (keyInfo.section === 'unknown') {
          const properNouns = getProperNouns(gameType)
          return Object.hasOwn(properNouns, keyInfo.key.toLowerCase())
        }
        return false
      })
      
      if (hasProperNounsOnly) {
        // 모든 매칭된 키가 ProperNouns에서 온 경우, 4-3 단계 건너뜀
        skippedProperNouns++
        log.verbose(`[${modName}] 고유명사 키 건너뜀 (4-3 무시): ${upstreamKey} (키: ${matchedDictKeyInfos.map(k => k.key).join(', ')})`)
        continue
      }

      // 해시가 있는 경우에만 제거 (이미 해시가 없으면 변경 불필요)
      if (translationHash && translationHash !== '') {
        targetYaml[targetLangKey][upstreamKey] = [translationValue, '']
        hasChanges = true
        invalidated++

        const dictMappings = matchedDictKeyInfos
          .map(keyInfo => `"${keyInfo.key}" -> "${getDictionary(keyInfo.key, gameType)}"`)
          .join(', ')
        log.debug(`[${modName}] 무효화: ${upstreamKey} (포함 단어: ${dictMappings})`)
      }
    }

    // 변경사항이 있으면 파일 저장
    if (hasChanges) {
      const updatedContent = stringifyYaml(targetYaml)
      await writeFile(targetFilePath, updatedContent, 'utf-8')
      log.debug(`[${modName}] 파일 업데이트 완료: ${targetFilePath}`)
    }

    return { invalidated, replaced, ignored, skippedProperNouns }
  } catch (error) {
    log.error(`[${modName}] 파일 처리 실패: ${sourceFilePath}`, error)
    return { invalidated: 0, replaced: 0, ignored: 0, skippedProperNouns: 0 }
  }
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
