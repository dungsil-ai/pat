import { describe, it, expect } from 'vitest'
import { parseBulkResponse, postProcessTranslation, TranslationRefusedError } from './ai'

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

  describe('postProcessTranslation', () => {
    it('실제 개행을 \\n 리터럴로 변환해야 함', () => {
      expect(postProcessTranslation('줄1\n줄2')).toBe('줄1\\n줄2')
    })

    it('이스케이프되지 않은 따옴표를 이스케이프해야 함', () => {
      expect(postProcessTranslation('안녕"세계"')).toBe('안녕\\"세계\\"')
    })

    it('이미 이스케이프된 따옴표는 그대로 유지해야 함', () => {
      expect(postProcessTranslation('안녕\\"세계')).toBe('안녕\\"세계')
    })

    it('이스케이프된 역슬래시 뒤의 따옴표는 이스케이프해야 함', () => {
      // \\" → 이스케이프된 역슬래시 + 이스케이프 필요한 따옴표
      expect(postProcessTranslation('텍스트\\\\"끝')).toBe('텍스트\\\\\\"끝')
    })

    it('#약화된, #약하게, #약한 태그를 #weak으로 변환해야 함', () => {
      expect(postProcessTranslation('#약화된텍스트')).toBe('#weak텍스트')
      expect(postProcessTranslation('#약하게')).toBe('#weak')
      expect(postProcessTranslation('#약한')).toBe('#weak')
    })

    it('#강조 태그를 #bold로 변환해야 함', () => {
      expect(postProcessTranslation('#강조텍스트')).toBe('#bold텍스트')
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

      let jsonParseErrorMessage = ''
      try {
        JSON.parse(raw)
      } catch (error) {
        if (error instanceof Error) {
          jsonParseErrorMessage = error.message
        }
      }

      try {
        parseBulkResponse(raw, 2)
        throw new Error('parseBulkResponse가 예외를 던져야 하지만 그렇지 않았습니다.')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        const message = (error as Error).message
        expect(message).toMatch(/벌크 번역 JSON 파싱에 실패했습니다/)
        if (jsonParseErrorMessage) {
          expect(message).toContain(jsonParseErrorMessage)
        }
        expect(message).toContain('AI 응답 원문:')
        expect(message).toContain(raw)
      }
    })

    it('코드블록 외부 배열 텍스트는 벌크 응답으로 오인하지 않아야 함', () => {
      const raw = '참고용 배열: ["첫째","둘째"]\n결과는 아래 객체를 확인하세요.\n{"translations":["정상1","정상2"]}'
      const parsed = parseBulkResponse(raw, 2)

      expect(parsed).toEqual(['정상1', '정상2'])
    })
  })
})
