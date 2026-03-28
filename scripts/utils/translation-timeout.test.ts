import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTranslationTimeoutMinutesFromEnv } from './translation-timeout'
import { log } from './logger'

describe('번역 타임아웃 환경변수 파서', () => {
  afterEach(() => {
    delete process.env.TRANSLATION_TIMEOUT_MINUTES
    vi.restoreAllMocks()
  })

  it('환경변수가 없으면 undefined를 반환해야 함', () => {
    expect(getTranslationTimeoutMinutesFromEnv()).toBeUndefined()
  })

  it('false 또는 0이면 타임아웃 비활성화(false)를 반환해야 함', () => {
    process.env.TRANSLATION_TIMEOUT_MINUTES = 'false'
    expect(getTranslationTimeoutMinutesFromEnv()).toBe(false)

    process.env.TRANSLATION_TIMEOUT_MINUTES = '0'
    expect(getTranslationTimeoutMinutesFromEnv()).toBe(false)
  })

  it('소수 포함 양수 값은 숫자로 반환해야 함', () => {
    process.env.TRANSLATION_TIMEOUT_MINUTES = '0.5'
    expect(getTranslationTimeoutMinutesFromEnv()).toBe(0.5)

    process.env.TRANSLATION_TIMEOUT_MINUTES = '10'
    expect(getTranslationTimeoutMinutesFromEnv()).toBe(10)
  })

  it('잘못된 값이면 경고 로그를 남기고 undefined를 반환해야 함', () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    process.env.TRANSLATION_TIMEOUT_MINUTES = '-1'

    expect(getTranslationTimeoutMinutesFromEnv()).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledOnce()
  })
})
