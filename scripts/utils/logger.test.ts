import { describe, expect, it } from 'vitest'
import { LogLevels } from 'consola'
import { parseLogLevel } from './logger'

describe('로그 레벨 파서', () => {
  it('환경변수가 없으면 기본값 info를 반환해야 함', () => {
    expect(parseLogLevel(undefined)).toBe(LogLevels.info)
  })

  it('대소문자와 공백을 무시하고 문자열 레벨을 해석해야 함', () => {
    expect(parseLogLevel(' DEBUG ')).toBe(LogLevels.debug)
    expect(parseLogLevel(' Info')).toBe(LogLevels.info)
  })

  it('숫자 문자열 레벨을 해석해야 함', () => {
    expect(parseLogLevel('4')).toBe(4)
  })

  it('알 수 없는 값이면 기본값 info를 반환해야 함', () => {
    expect(parseLogLevel('unknown-level')).toBe(LogLevels.info)
  })
})
