import { type DictionaryChangeOptions } from './dictionary-changes'

export interface ParsedDictionaryFilterArgs extends DictionaryChangeOptions {
  hasFilterOptions: boolean
}

export interface ParsedTranslateCommandArgs {
  command?: TranslateCommand
  targetMod?: string
  commandArgs: string[]
}

type TranslateCommand = 'onlyHash' | 'updateDict' | 'retranslate' | 'updateTransliterationFiles'

const TRANSLATE_COMMANDS: ReadonlySet<TranslateCommand> = new Set([
  'onlyHash',
  'updateDict',
  'retranslate',
  'updateTransliterationFiles'
])

/**
 * CLI 인자에서 딕셔너리 필터링 옵션을 파싱합니다.
 * --since-commit, --commit-range, --since-date 옵션을 지원합니다.
 * @param args CLI 인자 배열 (process.argv.slice(3)으로 전달)
 */
export function parseDictionaryFilterArgs(args: string[]): ParsedDictionaryFilterArgs {
  let sinceCommit: string | undefined
  let commitRange: string | undefined
  let sinceDate: string | undefined
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--since-commit' && args[i + 1]) {
      sinceCommit = args[i + 1]
      i++
    } else if (args[i] === '--commit-range' && args[i + 1]) {
      commitRange = args[i + 1]
      i++
    } else if (args[i] === '--since-date' && args[i + 1]) {
      sinceDate = args[i + 1]
      i++
    }
  }
  
  const hasFilterOptions = !!(sinceCommit || commitRange || sinceDate)
  
  return {
    sinceCommit,
    commitRange,
    sinceDate,
    hasFilterOptions
  }
}

/**
 * 번역 스크립트용 CLI 인자를 파싱합니다.
 * - 예: `pnpm ck3 rice` → targetMod='rice'
 * - 예: `pnpm ck3 updateDict rice --since-commit abc1234` → command='updateDict', targetMod='rice'
 */
export function parseTranslateCommandArgs(args: string[]): ParsedTranslateCommandArgs {
  const firstArg = args[0]?.trim()
  const hasCommand = !!firstArg && TRANSLATE_COMMANDS.has(firstArg as TranslateCommand)
  const command = hasCommand ? firstArg as TranslateCommand : undefined
  const targetMod = hasCommand ? args[1] : args[0]
  const commandArgs = hasCommand ? args.slice(1) : args.slice(0)

  return {
    command,
    targetMod,
    commandArgs
  }
}
