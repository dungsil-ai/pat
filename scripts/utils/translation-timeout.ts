import process from 'node:process'
import { log } from './logger'

/**
 * 번역 타임아웃 분 값을 환경변수에서 읽어옵니다.
 * - undefined: 기본값 사용(translate.ts의 기본 15분)
 * - false: 타임아웃 비활성화
 * - number: 지정된 분 값 사용
 */
export function getTranslationTimeoutMinutesFromEnv (): number | false | undefined {
  const timeoutEnv = process.env.TRANSLATION_TIMEOUT_MINUTES

  if (!timeoutEnv) {
    return undefined
  }

  const normalizedValue = timeoutEnv.trim().toLowerCase()
  if (normalizedValue === 'false' || normalizedValue === '0') {
    return false
  }

  const parsed = Number.parseFloat(timeoutEnv)
  if (Number.isNaN(parsed) || parsed <= 0) {
    log.warn(`TRANSLATION_TIMEOUT_MINUTES 값이 올바르지 않아 기본값(15분)을 사용합니다: ${timeoutEnv}`)
    return undefined
  }

  return parsed
}
