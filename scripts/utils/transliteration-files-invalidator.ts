import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, parse } from 'pathe'
import { parseYaml, stringifyYaml } from '../parser'
import { isReplaceLocalizationPath, readModMeta } from '../config/mod-meta'
import { log } from './logger'
import { type GameType } from './prompts'
import { matchWildcardPattern } from './pattern-matcher'
import { getChangedTransliterationFiles, type TransliterationFileChange } from './transliteration-files-changes'

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
 * transliteration_files 변경에 따라 영향받는 번역 파일들의 해시를 무효화합니다.
 * @param gameType 게임 타입
 * @param rootDir 루트 디렉토리
 * @param commitId 비교할 커밋 ID
 */
export async function invalidateTransliterationFilesChanges(
  gameType: GameType,
  rootDir: string,
  commitId: string
): Promise<void> {
  log.start(`[${gameType.toUpperCase()}] transliteration_files 변경 기반 번역 무효화 시작`)
  log.info(`대상 디렉토리: ${rootDir}`)
  log.info(`커밋: ${commitId}`)

  // 변경된 transliteration_files 추출
  const allChanges = await getChangedTransliterationFiles(commitId)
  
  // 현재 게임 타입에 해당하는 변경사항만 필터링
  const changes = allChanges.filter(change => change.modPath.startsWith(gameType))
  
  if (changes.length === 0) {
    log.info(`[${gameType.toUpperCase()}] transliteration_files 변경사항이 없습니다.`)
    return
  }

  let totalInvalidated = 0

  for (const change of changes) {
    const modName = change.modPath.split('/').pop() || change.modPath
    const modDir = join(rootDir, modName)
    
    log.info(`[${modName}] 처리 시작`)
    log.info(`[${modName}] 추가된 파일: [${change.addedFiles.join(', ')}]`)
    log.info(`[${modName}] 제거된 파일: [${change.removedFiles.join(', ')}]`)

    try {
      const metaPath = join(modDir, 'meta.toml')
      const meta = await readModMeta(metaPath)

      // 추가되거나 제거된 모든 파일에 대해 무효화
      const affectedFiles = [...new Set([...change.addedFiles, ...change.removedFiles])]
      
      for (const component of meta.upstream.components) {
        for (const locPath of component.localizationPaths) {
          const invalidatedCount = await invalidateAffectedFiles(
            modName,
            modDir,
            locPath,
            meta.upstream.language,
            gameType,
            affectedFiles,
            component.outputSubdir
          )
          totalInvalidated += invalidatedCount
        }
      }

      log.success(`[${modName}] 완료`)
    } catch (error) {
      log.error(`[${modName}] 오류 발생:`, error)
      // 다른 모드 처리를 계속하기 위해 throw하지 않음
      // 대신 오류를 기록하고 계속 진행
    }
  }

  log.success(`transliteration_files 변경 기반 번역 무효화 완료 - 총 ${totalInvalidated}개 항목 무효화`)
}

async function invalidateAffectedFiles(
  modName: string,
  modDir: string,
  locPath: string,
  sourceLanguage: string,
  gameType: GameType,
  affectedFiles: string[],
  outputSubdir?: string
): Promise<number> {
  const targetRoot = join(
    modDir,
    'mod',
    getLocalizationFolderName(gameType),
    isReplaceLocalizationPath(locPath) ? 'korean/replace' : 'korean'
  )
  const targetDir = outputSubdir ? join(targetRoot, outputSubdir) : targetRoot

  let invalidatedCount = 0

  try {
    const targetFiles = await readdir(targetDir, { recursive: true })

    for (const file of targetFiles) {
      if (!file.endsWith('_l_korean.yml')) continue

      // 파일명이 영향받는 파일 목록에 있는지 확인
      const { base } = parse(file)
      const sourceFileName = base.replace('___', '').replace('_l_korean.yml', `_l_${sourceLanguage}.yml`)
      
      const isAffected = affectedFiles.some(affectedFile => {
        // 정확한 매칭 또는 와일드카드 매칭
        return matchWildcardPattern(affectedFile, sourceFileName)
      })

      if (!isAffected) continue

      const targetFilePath = join(targetDir, file)
      
      try {
        const targetContent = await readFile(targetFilePath, 'utf-8')
        const targetYaml = parseYaml(targetContent) as Record<string, Record<string, [string, string | null]>>
        
        const langKey = Object.keys(targetYaml)[0]
        if (!langKey || !targetYaml[langKey]) continue

        let fileInvalidatedCount = 0
        
        // 모든 항목의 해시를 null로 설정하여 재번역 대상으로 표시
        for (const key of Object.keys(targetYaml[langKey])) {
          const [value, hash] = targetYaml[langKey][key]
          if (hash) {
            targetYaml[langKey][key] = [value, null]
            fileInvalidatedCount++
          }
        }

        if (fileInvalidatedCount > 0) {
          const updatedContent = stringifyYaml(targetYaml)
          await writeFile(targetFilePath, updatedContent, 'utf-8')
          log.info(`[${modName}] ${file}: ${fileInvalidatedCount}개 항목 무효화`)
          invalidatedCount += fileInvalidatedCount
        }
      } catch (error) {
        log.warn(`[${modName}] ${file} 처리 실패:`, error)
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      log.debug(`[${modName}] 타겟 디렉토리 없음: ${targetDir}`)
      return 0
    }
    throw error
  }

  return invalidatedCount
}
