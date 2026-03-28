import { describe, it, expect } from 'vitest'
import { getDictionaries, hasDictionary, getDictionary, getTranslationMemories, getGlossary, getProperNouns, findProperNounsInText, getTranslationMemoriesWithContext } from './dictionary'

describe('딕셔너리', () => {
  describe('getDictionaries', () => {
    it('CK3 딕셔너리를 반환해야 함', () => {
      const dict = getDictionaries('ck3')
      
      expect(dict).toBeDefined()
      expect(typeof dict).toBe('object')
      expect(dict['RICE']).toBe('RICE')
      expect(dict['duke']).toBe('공작')
    })

    it('CK3 딕셔너리에 고유명사도 포함되어야 함', () => {
      const dict = getDictionaries('ck3')
      
      // 일반 용어가 포함됨
      expect(dict['duke']).toBe('공작')
      expect(dict['king']).toBe('왕')
      // 고유명사도 포함됨
      expect(dict['bailjar']).toBe('벨자르')
      expect(dict['blackbird']).toBe('블랙버드')
    })

    it('Stellaris 딕셔너리를 반환해야 함', () => {
      const dict = getDictionaries('stellaris')
      
      expect(dict).toBeDefined()
      expect(typeof dict).toBe('object')
      expect(dict['empire']).toBe('제국')
      expect(dict['federation']).toBe('연방')
    })

    it('VIC3 딕셔너리를 반환해야 함', () => {
      const dict = getDictionaries('vic3')
      
      expect(dict).toBeDefined()
      expect(typeof dict).toBe('object')
      expect(dict['jodobjav']).toBe('요도브야브')
    })

    it('지원되지 않는 게임 타입에 대해 오류를 발생시켜야 함', () => {
      expect(() => getDictionaries('invalid' as any)).toThrow('Unsupported game type: invalid')
    })
  })

  describe('getGlossary', () => {
    it('CK3 일반 용어 사전을 반환해야 함 (고유명사 제외)', () => {
      const glossary = getGlossary('ck3')
      
      expect(glossary).toBeDefined()
      expect(typeof glossary).toBe('object')
      // 일반 용어가 포함됨
      expect(glossary['duke']).toBe('공작')
      expect(glossary['king']).toBe('왕')
      expect(glossary['RICE']).toBe('RICE')
      // 고유명사는 포함되지 않음
      expect(glossary['bailjar']).toBeUndefined()
      expect(glossary['blackbird']).toBeUndefined()
    })

    it('일반 용어 사전이 전체 사전보다 작아야 함', () => {
      const glossary = getGlossary('ck3')
      const fullDict = getDictionaries('ck3')
      
      expect(Object.keys(glossary).length).toBeLessThan(Object.keys(fullDict).length)
    })

    it('Stellaris는 전체 딕셔너리를 반환해야 함', () => {
      const glossary = getGlossary('stellaris')
      const fullDict = getDictionaries('stellaris')
      
      expect(Object.keys(glossary).length).toBe(Object.keys(fullDict).length)
    })

    it('VIC3는 전체 딕셔너리를 반환해야 함', () => {
      const glossary = getGlossary('vic3')
      const fullDict = getDictionaries('vic3')
      
      expect(Object.keys(glossary).length).toBe(Object.keys(fullDict).length)
    })

    it('지원되지 않는 게임 타입에 대해 오류를 발생시켜야 함', () => {
      expect(() => getGlossary('invalid' as any)).toThrow('Unsupported game type: invalid')
    })
  })

  describe('hasDictionary', () => {
    it('존재하는 CK3 딕셔너리 키에 대해 true를 반환해야 함', () => {
      expect(hasDictionary('duke', 'ck3')).toBe(true)
      expect(hasDictionary('king', 'ck3')).toBe(true)
    })

    it('대문자 키도 소문자 조회로 찾을 수 있어야 함', () => {
      expect(hasDictionary('RICE', 'ck3')).toBe(true)
      expect(hasDictionary('rice', 'ck3')).toBe(true)
      expect(hasDictionary('viet', 'ck3')).toBe(true)
    })

    it('존재하지 않는 키에 대해 false를 반환해야 함', () => {
      expect(hasDictionary('nonexistent_key', 'ck3')).toBe(false)
    })

    it('대소문자를 구분하지 않아야 함', () => {
      expect(hasDictionary('DUKE', 'ck3')).toBe(true)
      expect(hasDictionary('Duke', 'ck3')).toBe(true)
      expect(hasDictionary('duke', 'ck3')).toBe(true)
    })

    it('Stellaris 딕셔너리와 함께 작동해야 함', () => {
      expect(hasDictionary('empire', 'stellaris')).toBe(true)
      expect(hasDictionary('nonexistent', 'stellaris')).toBe(false)
    })

    it('게임 타입이 지정되지 않으면 ck3를 기본값으로 사용해야 함', () => {
      expect(hasDictionary('duke')).toBe(true)
    })
  })

  describe('getDictionary', () => {
    it('존재하는 키에 대한 번역을 반환해야 함', () => {
      expect(getDictionary('duke', 'ck3')).toBe('공작')
      expect(getDictionary('king', 'ck3')).toBe('왕')
    })

    it('대문자 원본 키도 소문자 조회로 같은 값을 반환해야 함', () => {
      expect(getDictionary('RICE', 'ck3')).toBe('RICE')
      expect(getDictionary('rice', 'ck3')).toBe('RICE')
      expect(getDictionary('viet', 'ck3')).toBe('VIET')
    })

    it('존재하지 않는 키에 대해 null을 반환해야 함', () => {
      expect(getDictionary('nonexistent_key', 'ck3')).toBe(null)
    })

    it('대소문자를 구분하지 않아야 함', () => {
      expect(getDictionary('DUKE', 'ck3')).toBe('공작')
      expect(getDictionary('Duke', 'ck3')).toBe('공작')
      expect(getDictionary('duke', 'ck3')).toBe('공작')
    })

    it('Stellaris 딕셔너리와 함께 작동해야 함', () => {
      expect(getDictionary('empire', 'stellaris')).toBe('제국')
      expect(getDictionary('federation', 'stellaris')).toBe('연방')
    })

    it('VIC3 딕셔너리와 함께 작동해야 함', () => {
      expect(getDictionary('ok', 'vic3')).toBe('네')
    })

    it('게임 타입이 지정되지 않으면 ck3를 기본값으로 사용해야 함', () => {
      expect(getDictionary('duke')).toBe('공작')
    })

    it('특수 딕셔너리 항목을 처리해야 함', () => {
      expect(getDictionary('af ', 'ck3')).toBe('아프 ')
      expect(getDictionary('de ', 'ck3')).toBe('데 ')
    })
  })

  describe('getTranslationMemories', () => {
    it('CK3에 대한 포맷된 번역 메모리를 반환해야 함', () => {
      const memories = getTranslationMemories('ck3')
      
      expect(memories).toContain('"duke" → "공작"')
      expect(memories).toContain('"RICE" → "RICE"')
      // 일반 용어만 포함되므로 100개 미만이어야 함 (고유명사는 제외됨)
      expect(memories.split('\n').length).toBeLessThan(100)
      expect(memories.split('\n').length).toBeGreaterThan(20) // 최소한의 일반 용어가 포함되어야 함
    })

    it('CK3 번역 메모리에 고유명사가 포함되지 않아야 함', () => {
      const memories = getTranslationMemories('ck3')
      
      // 고유명사는 번역 메모리에 포함되지 않아야 함
      expect(memories).not.toContain('"bailjar"')
      expect(memories).not.toContain('"blackbird"')
      expect(memories).not.toContain('"butler"')
    })

    it('Stellaris에 대한 포맷된 번역 메모리를 반환해야 함', () => {
      const memories = getTranslationMemories('stellaris')
      
      expect(memories).toContain('"empire" → "제국"')
      expect(memories).toContain('"federation" → "연방"')
    })

    it('VIC3에 대한 포맷된 번역 메모리를 반환해야 함', () => {
      const memories = getTranslationMemories('vic3')
      
      expect(memories).toContain('"jodobjav" → "요도브야브"')
    })

    it('게임 타입이 지정되지 않으면 ck3를 기본값으로 사용해야 함', () => {
      const memories = getTranslationMemories()
      
      expect(memories).toContain('"duke" → "공작"')
    })

    it('각 항목을 " - " 접두사로 포맷해야 함', () => {
      const memories = getTranslationMemories('ck3')
      const lines = memories.split('\n')
      
      lines.forEach(line => {
        // "the" → "" 같은 의도적인 빈 번역을 허용
        expect(line).toMatch(/^ - ".+" → ".*"$/)
      })
    })
  })

  describe('getProperNouns', () => {
    it('CK3 고유명사 사전을 반환해야 함', () => {
      const properNouns = getProperNouns('ck3')
      
      expect(properNouns).toBeDefined()
      expect(typeof properNouns).toBe('object')
      expect(properNouns['bailjar']).toBe('벨자르')
      expect(properNouns['blackbird']).toBe('블랙버드')
    })

    it('CK3 고유명사 사전에 일반 용어가 포함되지 않아야 함', () => {
      const properNouns = getProperNouns('ck3')
      
      expect(properNouns['duke']).toBeUndefined()
      expect(properNouns['king']).toBeUndefined()
    })

    it('Stellaris는 빈 객체를 반환해야 함', () => {
      const properNouns = getProperNouns('stellaris')
      
      expect(Object.keys(properNouns).length).toBe(0)
    })

    it('VIC3는 빈 객체를 반환해야 함', () => {
      const properNouns = getProperNouns('vic3')
      
      expect(Object.keys(properNouns).length).toBe(0)
    })

    it('지원되지 않는 게임 타입에 대해 오류를 발생시켜야 함', () => {
      expect(() => getProperNouns('invalid' as any)).toThrow('Unsupported game type: invalid')
    })
  })

  describe('findProperNounsInText', () => {
    it('원문에서 고유명사를 찾아야 함', () => {
      const text = 'The Bailjar dynasty ruled the land'
      const found = findProperNounsInText(text, 'ck3')
      
      expect(found['bailjar']).toBe('벨자르')
    })

    it('대소문자를 구분하지 않고 고유명사를 찾아야 함', () => {
      const text = 'The BAILJAR dynasty ruled the land'
      const found = findProperNounsInText(text, 'ck3')
      
      expect(found['bailjar']).toBe('벨자르')
    })

    it('여러 고유명사를 찾아야 함', () => {
      const text = 'Bailjar and Butler fought together'
      const found = findProperNounsInText(text, 'ck3')
      
      expect(found['bailjar']).toBe('벨자르')
      expect(found['butler']).toBe('버틀러')
    })

    it('원문에 고유명사가 없으면 빈 객체를 반환해야 함', () => {
      // 'i'가 glossary(접미사 항목)에 있으므로 'i'를 포함하지 않는 텍스트 사용
      const text = 'Hello world'
      const found = findProperNounsInText(text, 'ck3')
      
      expect(Object.keys(found).length).toBe(0)
    })
  })

  describe('getTranslationMemoriesWithContext', () => {
    it('원문에 고유명사가 없으면 일반 번역 메모리만 반환해야 함', () => {
      const text = 'This is a simple text'
      const memories = getTranslationMemoriesWithContext(text, 'ck3')
      
      // 일반 용어가 포함됨
      expect(memories).toContain('"ok" → "네"')
      // 고유명사는 포함되지 않음
      expect(memories).not.toContain('"bailjar"')
    })

    it('원문에 고유명사가 있으면 해당 고유명사가 번역 메모리에 포함되어야 함', () => {
      const text = 'The Bailjar dynasty ruled the land'
      const memories = getTranslationMemoriesWithContext(text, 'ck3')
      
      // 일반 용어도 포함됨
      expect(memories).toContain('"duke" → "공작"')
      // 원문에 있는 고유명사도 포함됨
      expect(memories).toContain('"bailjar" → "벨자르"')
    })

    it('원문에 없는 고유명사는 번역 메모리에 포함되지 않아야 함', () => {
      const text = 'The Bailjar dynasty ruled the land'
      const memories = getTranslationMemoriesWithContext(text, 'ck3')
      
      // 원문에 있는 고유명사만 포함됨
      expect(memories).toContain('"bailjar" → "벨자르"')
      // 원문에 없는 다른 고유명사는 포함되지 않음
      expect(memories).not.toContain('"butler"')
      expect(memories).not.toContain('"blackbird"')
    })

    it('여러 고유명사가 원문에 있으면 모두 번역 메모리에 포함되어야 함', () => {
      const text = 'Bailjar and Butler ruled together'
      const memories = getTranslationMemoriesWithContext(text, 'ck3')
      
      expect(memories).toContain('"bailjar" → "벨자르"')
      expect(memories).toContain('"butler" → "버틀러"')
    })
  })
})
