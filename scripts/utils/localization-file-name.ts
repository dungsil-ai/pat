import { basename } from 'pathe'

const KOREAN_OVERRIDE_PREFIX = '___'

export function buildKoreanTargetFileName(sourceFilePath: string, sourceLanguage: string): string {
  const sourceBaseName = basename(sourceFilePath)
  const normalizedSourceBaseName = sourceLanguage === 'korean'
    ? sourceBaseName.replace(/^___/, '')
    : sourceBaseName

  return KOREAN_OVERRIDE_PREFIX + normalizedSourceBaseName.replace(`_l_${sourceLanguage}.yml`, '_l_korean.yml')
}
