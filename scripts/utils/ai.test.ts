import { describe, it, expect } from 'vitest'
import { parseBulkResponse, TranslationRefusedError } from './ai'

describe('AI 유틸리티', () => {
  describe('TranslationRefusedError', () => {
    it('오류 메시지를 올바르게 포맷해야 함', () => {
      const text = 'This is a test text that needs translation'
      const reason = 'SAFETY'
      
      const error = new TranslationRefusedError(text, reason)
      
      expect(error.name).toBe('TranslationRefusedError')
      expect(error.text).toBe(text)
      expect(error.reason).toBe(reason)
      expect(error.message).toContain('번역 거부')
      expect(error.message).toContain(reason)
    })

    it('긴 텍스트를 50자로 자르고 말줄임표를 추가해야 함', () => {
      const longText = 'a'.repeat(100)
      const reason = 'BLOCKLIST'
      
      const error = new TranslationRefusedError(longText, reason)
      
      expect(error.message).toContain('...')
      expect(error.message).toContain(longText.substring(0, 50))
      // 전체 긴 텍스트가 포함되지 않았는지 확인
      expect(error.message.length).toBeLessThan(longText.length + 50)
    })

    it('50자 이하 텍스트는 말줄임표 없이 전체를 표시해야 함', () => {
      const shortText = 'Short text'
      const reason = 'PROHIBITED_CONTENT'
      
      const error = new TranslationRefusedError(shortText, reason)
      
      expect(error.message).not.toContain('...')
      expect(error.message).toContain(shortText)
    })
  })

  describe('parseBulkResponse', () => {
    it('코드블록 외부 텍스트가 포함되어도 JSON을 파싱해야 함', () => {
      const raw = '참고: 아래는 결과입니다.\n```json\n{"translations":["첫째","둘째"]}\n```\n끝'
      const parsed = parseBulkResponse(raw, 2)

      expect(parsed).toEqual(['첫째', '둘째'])
    })

    it('JSON이 손상되면 원인을 포함한 오류를 던져야 함', () => {
      const raw = '{"translations":["정상","비정상]}'

      expect(() => parseBulkResponse(raw, 2))
        .toThrowError(/벌크 번역 JSON 파싱에 실패했습니다/)
    })
  })
})
