import 'dotenv/config'
import process from 'node:process'
import { readdir } from 'node:fs/promises'
import { join } from 'pathe'
import { processModTranslations } from './factory/translate'
import { invalidateDictionaryTranslations } from './utils/dictionary-invalidator'
import { invalidateIncorrectTranslations } from './utils/retranslation-invalidator'
import { invalidateTransliterationFilesChanges } from './utils/transliteration-files-invalidator'
import { getChangedDictionaryKeys } from './utils/dictionary-changes'
import { parseDictionaryFilterArgs, parseTranslateCommandArgs } from './utils/cli-args'
import { log } from './utils/logger'
import { isSqliteIOError } from './utils/cache'
import { getDiskUsageString } from './utils/disk-usage'
import { filterMods } from './utils/mod-filter'
import { getTranslationTimeoutMinutesFromEnv } from './utils/translation-timeout'

async function main () {
  try {
    const stellarisDir = join(import.meta.dirname, '..', 'stellaris')
    const allMods = await readdir(stellarisDir)
    const { command, targetMod, commandArgs } = parseTranslateCommandArgs(process.argv.slice(2))
    const onlyHash = command === 'onlyHash'
    const updateDict = command === 'updateDict'
    const retranslate = command === 'retranslate'
    const updateTransliterationFiles = command === 'updateTransliterationFiles'

    // 특정 모드가 지정된 경우 해당 모드만 처리 (`pnpm stellaris rice` 형식 지원)
    const mods = filterMods(allMods, targetMod)

    // 타임아웃 설정: 환경변수 TRANSLATION_TIMEOUT_MINUTES(.env 포함) 또는 false(비활성화)
    const timeoutMinutes = getTranslationTimeoutMinutesFromEnv()

    if (updateDict) {
      // CLI 인자 파싱: --since-commit, --commit-range, --since-date
      const filterArgs = parseDictionaryFilterArgs(commandArgs)
      
      // 필터링 옵션이 지정되었을 경우, 변경된 키만 추출
      let filterKeys: string[] | undefined
      if (filterArgs.hasFilterOptions) {
        filterKeys = await getChangedDictionaryKeys('stellaris', filterArgs)
        
        if (filterKeys.length === 0) {
          log.info('지정한 커밋/날짜 범위에 변경된 딕셔너리 키가 없습니다. 이는 (1) 해당 범위에 변경이 없거나, (2) 범위가 잘못 지정된 경우일 수 있습니다. 무효화를 건너뜁니다.')
          return
        }
      }
      
      log.box(
        `
        Stellaris 단어사전 기반 번역 무효화
        - 대상 경로: ${stellarisDir}
        - 대상 모드 (${mods.length}개): ${mods}
        ${filterKeys ? `- 필터링된 키: ${filterKeys.length}개` : '- 전체 딕셔너리 사용'}
        `,
      )
      
      await invalidateDictionaryTranslations('stellaris', stellarisDir, mods, filterKeys)
      
      log.success(`단어사전 기반 번역 무효화 완료!`)
    } else if (retranslate) {
      log.box(
        `
        Stellaris 잘못 번역된 항목 재번역
        - 대상 경로: ${stellarisDir}
        - 대상 모드 (${mods.length}개): ${mods}
        `,
      )
      
      await invalidateIncorrectTranslations('stellaris', stellarisDir, mods)
      
      log.success(`잘못 번역된 항목 무효화 완료!`)
    } else if (updateTransliterationFiles) {
      // CLI 인자 파싱: --since-commit
      const commitArg = process.argv.find(arg => arg.startsWith('--since-commit='))
      const commitId = commitArg ? commitArg.split('=')[1] : 'HEAD'
      
      log.box(
        `
        Stellaris transliteration_files 변경 기반 번역 무효화
        - 대상 경로: ${stellarisDir}
        - 커밋: ${commitId}
        `,
      )
      
      await invalidateTransliterationFilesChanges('stellaris', stellarisDir, commitId)
      
      log.success(`transliteration_files 변경 기반 번역 무효화 완료!`)
    } else {
      log.box(
        `
        Stellaris 번역 스크립트 구동
        - 번역 대상 경로: ${stellarisDir}
        - 번역 대상 모드 (${mods.length}개): ${mods}
        `,
      )

      await processModTranslations({
        rootDir: stellarisDir,
        mods,
        gameType: 'stellaris',
        onlyHash,
        timeoutMinutes
      })

      log.success(`번역 완료! 스크립트를 종료합니다. (처리된 모드: ${mods})`)
    }
  } catch (error) {
    // SQLite I/O 오류인 경우 디스크 사용률 정보 추가
    if (isSqliteIOError(error)) {
      const diskUsage = getDiskUsageString()
      if (diskUsage) {
        log.warn(diskUsage)
      }
    }
    throw new Error(`Stellaris 번역 처리 중 오류 발생: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    })
  }
}

main().catch((error) => {
  log.error('번역 도중 오류가 발생하였습니다.', error)
  process.exit(1)
})
