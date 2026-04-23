import { describe, expect, it } from 'vitest'
import { buildKoreanTargetFileName } from './localization-file-name'

describe('buildKoreanTargetFileName', () => {
  it('영어 소스 파일에는 한국어 접두사를 한 번만 붙여야 함', () => {
    expect(buildKoreanTargetFileName('events_l_english.yml', 'english')).toBe('___events_l_korean.yml')
  })

  it('한국어 소스 파일의 기존 ___ 접두사는 중복해서 붙이면 안 됨', () => {
    expect(buildKoreanTargetFileName('___events_l_korean.yml', 'korean')).toBe('___events_l_korean.yml')
  })

  it('한국어 소스 파일에 접두사가 없어도 결과에는 ___ 접두사를 붙여야 함', () => {
    expect(buildKoreanTargetFileName('events_l_korean.yml', 'korean')).toBe('___events_l_korean.yml')
  })
})
