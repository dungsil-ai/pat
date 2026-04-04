import { describe, it, expect } from 'vitest'
import { filterMods } from './mod-filter'

describe('모드 필터링 유틸리티', () => {
  const allMods = ['RICE', 'VIET', 'CFP', 'ETC']

  describe('filterMods', () => {
    it('특정 모드가 지정되지 않으면 전체 모드를 반환해야 함', () => {
      const result = filterMods(allMods)
      expect(result).toEqual(allMods)
    })

    it('특정 모드가 지정되면 해당 모드만 반환해야 함', () => {
      const result = filterMods(allMods, 'RICE')
      expect(result).toEqual(['RICE'])
    })


    it('모드 이름 대소문자를 구분하지 않고 매칭해야 함', () => {
      const result = filterMods(allMods, 'rice')
      expect(result).toEqual(['RICE'])
    })

    it('지정된 모드가 존재하지 않으면 에러를 발생시켜야 함', () => {
      expect(() => filterMods(allMods, 'NONEXISTENT')).toThrowError(
        `지정된 모드 'NONEXISTENT'가 존재하지 않습니다. 사용 가능한 모드: RICE, VIET, CFP, ETC`
      )
    })

    it('undefined가 전달되면 전체 모드를 반환해야 함', () => {
      const result = filterMods(allMods, undefined)
      expect(result).toEqual(allMods)
    })

    it('빈 문자열이 전달되면 전체 모드를 반환해야 함', () => {
      // 빈 문자열은 falsy이므로 전체 모드를 반환
      const result = filterMods(allMods, '')
      expect(result).toEqual(allMods)
    })

    it('"--"가 전달되면 전체 모드를 반환해야 함', () => {
      // CLI 옵션 구분자 "--"는 모드 이름이 아니므로 전체 모드 반환
      const result = filterMods(allMods, '--')
      expect(result).toEqual(allMods)
    })

    it('"--"로 시작하는 값이 전달되면 전체 모드를 반환해야 함', () => {
      // CLI 옵션 "--since-commit" 등은 모드 이름이 아니므로 전체 모드 반환
      const result = filterMods(allMods, '--since-commit')
      expect(result).toEqual(allMods)
    })
  })
})
