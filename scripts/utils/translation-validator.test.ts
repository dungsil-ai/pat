import { describe, it, expect } from 'vitest'
import { validateTranslation, validateTranslationEntries } from './translation-validator'

describe('번역 검증', () => {
  describe('불필요한 구문 감지', () => {
    it('불필요한 한국어 구문이 포함된 번역을 거부해야 함', () => {
      const source = 'Hello world'
      const translated = '네, 알겠습니다. 안녕하세요 세계'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('불필요한 응답 포함')
    })

    it('불필요한 영어 구문이 포함된 번역을 거부해야 함', () => {
      const source = 'Hello world'
      const translated = 'yes, i understand. Hello world'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
    })

    it('불필요한 구문이 없는 유효한 번역을 수락해야 함', () => {
      const source = 'Hello world'
      const translated = '안녕하세요 세계'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('"As requested"의 번역인 "요청하신 대로"를 유효한 번역으로 수락해야 함', () => {
      // "요청하신 대로"는 원본 텍스트의 "As requested"를 번역한 것이므로 유효함
      // "요청하신 번역" 패턴만 불필요한 LLM 응답으로 감지되어야 함
      const source = `As requested, [witness.GetTitledFirstName] and I served as the highest-ranking witnesses at the major land sale.`
      const translated = `요청하신 대로, [witness.GetTitledFirstName]와 저는 대규모 토지 매각의 최고위 증인으로 참석했습니다.`
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('"요청하신 번역" 패턴을 불필요한 LLM 응답으로 감지해야 함', () => {
      const source = 'Hello world'
      const translated = '요청하신 번역입니다. 안녕하세요 세계'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('불필요한 응답 포함')
    })
  })

  describe('기술 식별자 보존', () => {
    it('snake_case 식별자가 번역되면 거부해야 함', () => {
      const source = 'Icon: mod_icon_stewardship'
      const translated = '아이콘: 관리_아이콘_관리력'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('기술 식별자')
    })

    it('snake_case 식별자가 보존되면 수락해야 함', () => {
      const source = 'Icon: mod_icon_stewardship'
      const translated = '아이콘: mod_icon_stewardship'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('대문자 이름은 번역을 허용해야 함', () => {
      const source = 'Name: A_Chi_Mo'
      const translated = '이름: 아치모'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('아이콘 참조를 식별자와 혼동하지 않아야 함', () => {
      const source = '@mod_icon_stewardship! bonus'
      const translated = '@mod_icon_stewardship! 보너스'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })
  })

  describe('게임 변수 보존', () => {
    it('게임 변수가 누락되면 거부해야 함', () => {
      const source = 'Welcome to [GetTitle]'
      const translated = '환영합니다'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('누락된 게임 변수')
    })

    it('게임 변수가 보존되면 수락해야 함', () => {
      const source = 'Welcome to [GetTitle]'
      const translated = '[GetTitle]에 오신 것을 환영합니다'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('게임 변수 구조 내에 한국어가 있으면 거부해야 함', () => {
      const source = 'Region: [region|E]'
      const translated = '지역: [지역|E]'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      // [region|E] 변수가 [지역|E]로 대체되어 누락된 것으로 감지됨
      expect(result.reason).toMatch(/누락된 게임 변수|게임 변수 내부에 한글 포함/)
    })

    it('게임 변수 내부의 문자열 리터럴이 번역되는 것을 허용해야 함', () => {
      const source = '[Concatenate(\' or \', GetName)]'
      const translated = '[Concatenate(\' 혹은 \', GetName)]'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('게임 변수 내의 네임스페이스를 처리해야 함', () => {
      const source = 'Owner: [owner.GetName]'
      const translated = '소유자: [owner.GetName]'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('함수가 포함된 복잡한 게임 변수를 처리해야 함', () => {
      const source = 'Activity: [GetActivityType(\'activity_RICE_aachen_pilgrimage\').GetName]'
      const translated = '활동: [GetActivityType(\'activity_RICE_aachen_pilgrimage\').GetName]'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('한국어에서 성별 함수가 생략되는 것을 허용해야 함', () => {
      const source = 'He or she: [GetSheHe]'
      const translated = '그 사람'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('네임스페이스가 있는 성별 함수가 생략되는 것을 허용해야 함', () => {
      const source = 'Character: [character.GetHerHis] name'
      const translated = '인물: 그의 이름'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })
  })

  describe('text style preservation', () => {
    it('스타일 키워드가 번역되면 거부해야 함', () => {
      const source = '#bold Important#!'
      const translated = '#굵게 중요함#!'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('텍스트 스타일 키워드가 번역됨')
    })

    it('스타일 키워드가 보존되면 수락해야 함', () => {
      const source = '#bold Important#!'
      const translated = '#bold 중요함#!'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('여러 스타일 키워드를 처리해야 함', () => {
      const source = '#weak Weak# and #bold Strong#'
      const translated = '#weak 약함# 그리고 #bold 강함#'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('# 다음에 한글 한 글자(조사)를 허용해야 함', () => {
      const source = 'Value is 10'
      const translated = '값은 10#를'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('달러 변수 뒤의 텍스트 스타일 마커를 수락해야 함 (단일 문자)', () => {
      const source = 'Does not have a #v$pause_nuclear_weapons_development$#! #Treaty#! with any country'
      const translated = '$country_name$는 그 어떤 국가와도 #v$pause_nuclear_weapons_development$#! #Treaty#!를 맺고 있지 않습니다.'
      
      const result = validateTranslation(source, translated, 'vic3')
      
      expect(result.isValid).toBe(true)
    })

    it('달러 변수 뒤의 텍스트 스타일 마커를 수락해야 함 (여러 문자)', () => {
      const source = 'Text #bold$value$#!'
      const translated = '텍스트 #bold$value$#!'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('달러 변수를 포함한 여러 텍스트 스타일 마커를 수락해야 함', () => {
      const source = '#v$var1$#! and #p$var2$#! and #bold$var3$#!'
      const translated = '#v$var1$#! 그리고 #p$var2$#! 그리고 #bold$var3$#!'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('#crisis와 같은 스타일 키워드가 번역되면 거부해야 함 (issue report)', () => {
      const source = '#crisis Play as the Reactionary Revolution#!'
      const translated = '#위기 반응주의 혁명으로 플레이#!'
      
      const result = validateTranslation(source, translated, 'vic3')
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('텍스트 스타일 키워드가 번역됨')
    })
  })

  describe('잘못된 형식의 변수 감지', () => {
    it('텍스트 스타일 마커 없이 균형이 맞지 않는 달러 기호를 거부해야 함', () => {
      const source = 'Text'
      const translated = '텍스트 word$ value'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
    })

    it('혼합된 변수 구문을 거부해야 함: $[', () => {
      const source = 'Gold: $gold$'
      const translated = '금: $[gold]'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
    })

    it('혼합된 변수 구문을 거부해야 함: £[', () => {
      const source = 'Prestige: £prestige£'
      const translated = '위신: £[prestige]'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
    })

    it('균형이 맞지 않는 달러 기호를 거부해야 함', () => {
      const source = 'Value: $gold$'
      const translated = '값: $gold'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
    })

    it('균형이 맞지 않는 파운드 기호를 거부해야 함', () => {
      const source = 'Value: £gold£'
      const translated = '값: £gold'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
    })

    it('유효한 달러 기호 변수를 수락해야 함', () => {
      const source = 'Gold: $gold$'
      const translated = '금: $gold$'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('달러 변수 내의 유효한 형식 지정자를 수락해야 함', () => {
      const source = 'Value: $VALUE|=+0$'
      const translated = '값: $VALUE|=+0$'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('일반 달러 변수에서 @ 문자를 수락해야 함 (실제 게임 패턴)', () => {
      // 실제 Stellaris 게임 파일에서 사용되는 패턴: $@shroud_seal_decrease|0$
      const source = 'Value: $@shroud_seal_decrease|0$'
      const translated = '값: $@shroud_seal_decrease|0$'
      
      const result = validateTranslation(source, translated, 'stellaris')
      
      expect(result.isValid).toBe(true)
    })

    it('일반 달러 변수에서 @ 문자와 공백을 함께 수락해야 함', () => {
      const source = 'Value: $@variable with space|0$'
      const translated = '값: $@variable with space|0$'
      
      const result = validateTranslation(source, translated, 'stellaris')
      
      expect(result.isValid).toBe(true)
    })

    it('텍스트 스타일 마커와 @ 문자를 포함한 달러 변수를 수락해야 함', () => {
      const source = 'Text #bold$@value|0$#!'
      const translated = '텍스트 #bold$@value|0$#!'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('유효한 @icon! 구문을 수락해야 함', () => {
      const source = '@icon! bonus'
      const translated = '@icon! 보너스'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('@icon:number:color! 구문을 수락해야 함', () => {
      const source = '@aptitude:4:color_green! High aptitude'
      const translated = '@aptitude:4:color_green! 높은 적성'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('이스케이프된 변수 패턴을 허용해야 함', () => {
      const source = 'Escape: \\$[test]'
      const translated = '이스케이프: \\$[test]'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('문장 끝의 달러 기호를 플래그하지 않아야 함', () => {
      const source = 'This costs 100 gold.'
      const translated = '이것은 100 금화가 듭니다.$'
      
      const result = validateTranslation(source, translated)
      
      // $ 기호가 단순히 구두점이고 변수가 아니므로 유효해야 함
      expect(result.isValid).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('빈 소스와 번역을 처리해야 함', () => {
      const result = validateTranslation('', '')
      
      expect(result.isValid).toBe(true)
    })

    it('특수 구문이 없는 소스를 처리해야 함', () => {
      const source = 'Simple text'
      const translated = '간단한 텍스트'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('여러 검증 실패를 처리해야 함', () => {
      const source = 'Icon: mod_icon_test with [GetTitle]'
      const translated = '네, 알겠습니다. 아이콘: 모드_아이콘_테스트'
      
      const result = validateTranslation(source, translated)
      
      // 첫 번째로 발견된 문제에서 실패해야 함
      expect(result.isValid).toBe(false)
    })

    it('게임 변수의 공백 변형을 처리해야 함', () => {
      const source = '[GetTitle(\'test\')]'
      const translated = '[GetTitle(\'test\')]'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })
  })

  describe('regression tests for PR #92 - @icon:number:color! syntax', () => {
    it('@aptitude:4:color_green!을 잘못된 형식으로 플래그하지 않아야 함 (원본 버그)', () => {
      // PR #92에서 거짓 양성을 일으킨 정확한 패턴
      const source = '@aptitude:4:color_green![aptitude|E] of other [court_positions|E]: #p +[SCOPE.ScriptValue(\'yeke_jarquchi_improve_court_value\')|0]#!'
      const translated = '@aptitude:4:color_green![aptitude|E] 다른 [court_positions|E]의 수치: #p +[SCOPE.ScriptValue(\'yeke_jarquchi_improve_court_value\')|0]#!'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('여러 콜론이 있는 아이콘 구문을 수락해야 함', () => {
      const source = '@icon:1:2:3:4! Multiple colons'
      const translated = '@icon:1:2:3:4! 여러 콜론'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('@ 아이콘 구문에서 콜론이 있는 혼합 문자를 수락해야 함', () => {
      const source = '@test_icon:5:color-red! Mixed'
      const translated = '@test_icon:5:color-red! 혼합'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('느낌표 없는 불완전한 @ 패턴을 여전히 감지해야 함', () => {
      const source = 'Text with @incomplete_icon'
      const translated = 'Text with @incomplete_icon'
      
      const result = validateTranslation(source, translated)
      
      // 닫는 !가 없으므로 잘못된 형식으로 감지되어야 함
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
    })

    it('콜론이 있는 일반 텍스트를 @ 아이콘 구문과 혼동하지 않아야 함', () => {
      const source = 'Time: 10:30 in the morning'
      const translated = '시간: 10:30 오전'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('시작 부분에 콜론이 있는 @ 아이콘을 수락해야 함', () => {
      const source = '@:icon:test! Beginning colon'
      const translated = '@:icon:test! 시작 콜론'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('@ 및 [가 혼합된 변수 구문을 여전히 감지해야 함', () => {
      const source = 'Icon: @icon!'
      const translated = 'Icon: @[icon]'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
    })

    it('CK3 모드의 복잡한 실제 패턴을 수락해야 함', () => {
      // Unofficial Patch 모드의 실제 패턴
      const source = '@aptitude:4:color_green![aptitude|E] of other [court_positions|E]'
      const translated = '@aptitude:4:color_green![aptitude|E] 다른 [court_positions|E]의'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('동일한 텍스트에서 콜론이 있는 여러 @ 아이콘 패턴을 처리해야 함', () => {
      const source = '@icon1:red! text @icon2:blue! more text'
      const translated = '@icon1:red! 텍스트 @icon2:blue! 더 많은 텍스트'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('적절한 닫힘이 없는 @ 아이콘 패턴을 거부해야 함', () => {
      const source = '@aptitude:4:color_green value'
      const translated = '@aptitude:4:color_green 값'
      
      const result = validateTranslation(source, translated)
      
      // ! 종료자가 없으므로 불완전한 것으로 플래그되어야 함
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
    })
  })

  describe('regression tests for PR #101 - cross-delimiter pattern detection', () => {
    // 참고: PR #101은 "@transportation$"과 같은 패턴을 두 개의 별도 패턴 대신
    // 하나의 잘못된 형식 패턴으로 보고하도록 cross-delimiter 패턴 감지를 수정함.
    // 이 테스트들은 수정 사항이 유지되는지 확인함.

    it('@...$ cross-delimiter 패턴을 감지해야 함 (PR #101 수정)', () => {
      // PR #101 이전: ["transportation$", "@transportation"]를 별도 패턴으로 보고
      // PR #101 이후: "@transportation$"를 단일 cross-delimiter 패턴으로 보고해야 함
      const source = '@transportation! Construction'
      const translated = '@transportation! 건설: @transportation$ 산출량'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
      // 오류는 잘못된 형식의 패턴을 언급해야 함 (구현에 따라 다를 수 있음)
    })

    it('@...£ cross-delimiter 패턴을 감지해야 함', () => {
      const source = 'Value'
      const translated = '@icon£ 값'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
    })

    it('$...@ cross-delimiter 패턴을 감지해야 함', () => {
      const source = 'Value'
      const translated = '$value@ 값'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
    })

    it('$...£ cross-delimiter 패턴을 감지해야 함', () => {
      const source = 'Value'
      const translated = '$gold£ 금'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
    })

    it('£...$ cross-delimiter 패턴을 감지해야 함', () => {
      const source = 'Value'
      const translated = '£prestige$ 위신'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
    })

    it('£...@ cross-delimiter 패턴을 감지해야 함', () => {
      const source = 'Value'
      const translated = '£icon@ 아이콘'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
    })

    it('$ 변수 앞의 콜론이 있는 유효한 @ 아이콘을 수락해야 함', () => {
      const source = '@icon:4:red! Cost: $gold$'
      const translated = '@icon:4:red! 비용: $gold$'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('유효한 변수 패턴을 개별적으로 수락해야 함', () => {
      const source = '@icon! Gold: $gold$ Prestige: £prestige£'
      const translated = '@icon! 금: $gold$ 위신: £prestige£'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })

    it('적절히 이스케이프되지 않은 경우 이스케이프된 cross-delimiter 패턴을 잘못된 형식으로 감지해야 함', () => {
      // 적절한 이스케이프 없이는 잘못된 형식으로 감지되어야 함
      const source = 'Text'
      const translated = '@test$ 텍스트'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
    })

    it('동일한 텍스트에서 여러 cross-delimiter 패턴을 감지해야 함', () => {
      const source = 'Text'
      const translated = '@icon1$ 텍스트 £value@ 값'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
    })

    it('@ 패턴에서 콜론이 있는 cross-delimiter를 감지해야 함', () => {
      const source = 'Icon'
      const translated = '@icon:1:2:3$ 아이콘'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
    })

    it('복잡한 텍스트에서 cross-delimiter 패턴을 감지해야 함 (PR #101 원래 케이스)', () => {
      // PR #101의 원래 버그: "@transportation$"가 두 패턴으로 보고되었음
      const source = 'Building'
      const translated = '건물: @transportation$ 수치'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('잘못된 형식의 변수 패턴')
      // PR #101 수정 후, 이것은 cross-delimiter 패턴으로 감지되어야 함
    })

    it('유효한 혼합 변수 타입을 가진 복잡한 실제 텍스트를 수락해야 함', () => {
      const source = '@aptitude:4:color_green! Bonus: $VALUE|=+0$ in £gold£'
      const translated = '@aptitude:4:color_green! 보너스: $VALUE|=+0$ in £gold£'
      
      const result = validateTranslation(source, translated)
      
      expect(result.isValid).toBe(true)
    })
  })

  describe('regression tests for identifiers in string literals (issue #64)', () => {
    // 이 테스트들은 게임 변수 내의 문자열 리터럴 안에 있는 식별자가
    // 독립적으로 보존될 필요가 없음을 보장함.
    //
    // 컨텍스트: "독립 보존"이란 `mod_icon_test`와 같은 snake_case 식별자가
    // 텍스트에 직접 나타날 때 변경되지 않은 상태로 유지되어야 함을 의미함. 그러나
    // 게임 변수 내의 문자열 리터럴 안에 나타나는 식별자(예: [GetLawGroup('lawgroup_migration').GetName]의
    // 'lawgroup_migration')는 게임 변수 구문 자체의 일부이며
    // 독립 식별자 요구사항을 트리거해서는 안 됨.

    it('게임 변수 내의 문자열 리터럴 안의 식별자에 대해 독립 보존을 요구하지 않아야 함', () => {
      // 'lawgroup_migration'은 [GetLawGroup('...')]의 문자열 리터럴 안에 있으므로
      // 게임 변수 자체의 일부이며 독립 식별자 요구사항을 트리거해서는 안 됨
      const source = "[GetLawGroup('lawgroup_migration').GetName] is important"
      const translated = "[GetLawGroup('lawgroup_migration').GetName] 는 중요합니다"
      
      const result = validateTranslation(source, translated, 'vic3')
      
      expect(result.isValid).toBe(true)
    })

    it('문자열 리터럴에 식별자가 포함되어 있더라도 누락된 게임 변수를 감지해야 함', () => {
      const source = "[GetLawGroup('lawgroup_migration').GetName] is important"
      const translated = "[concept_law_group_migration] 는 중요합니다"
      
      const result = validateTranslation(source, translated, 'vic3')
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('누락된 게임 변수')
    })

    it('게임 변수 내의 문자열 리터럴에 있는 여러 식별자를 처리해야 함', () => {
      const source = "[GetLawType('law_closed_borders').GetName] and [GetLawGroup('lawgroup_migration').GetName]"
      const translated = "[GetLawType('law_closed_borders').GetName] 그리고 [GetLawGroup('lawgroup_migration').GetName]"
      
      const result = validateTranslation(source, translated, 'vic3')
      
      expect(result.isValid).toBe(true)
    })

    it('독립적인 기술 식별자는 여전히 보존되어야 함', () => {
      const source = "The mod_icon_test is important"
      const translated = "The 모드_아이콘_테스트 is important"
      
      const result = validateTranslation(source, translated, 'vic3')
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('기술 식별자')
    })

    it('독립적인 기술 식별자가 올바르게 보존되면 수락해야 함', () => {
      const source = "The mod_icon_test is important"
      const translated = "The mod_icon_test 는 중요합니다"
      
      const result = validateTranslation(source, translated, 'vic3')
      
      expect(result.isValid).toBe(true)
    })

    it('혼합을 처리해야 함: 문자열 리터럴의 식별자 + 독립 식별자', () => {
      const source = "[GetLawType('law_closed_borders').GetName] with mod_icon_test"
      const translated = "[GetLawType('law_closed_borders').GetName] 와 mod_icon_test"
      
      const result = validateTranslation(source, translated, 'vic3')
      
      expect(result.isValid).toBe(true)
    })

    it('독립 식별자가 누락되었지만 문자열 리터럴 식별자가 보존된 경우를 감지해야 함', () => {
      const source = "[GetLawType('law_closed_borders').GetName] with mod_icon_test"
      const translated = "[GetLawType('law_closed_borders').GetName] 와 모드_아이콘"
      
      const result = validateTranslation(source, translated, 'vic3')
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('기술 식별자')
    })

    it('복잡한 게임 변수를 가진 실제 케이스를 처리해야 함 (issue #64)', () => {
      const source = 
        "An [concept_instant_diplomatic_action] that forces a change in the " +
        "[GetLawGroup('lawgroup_migration').GetName] [concept_law] of the target " +
        "[concept_subject] to the [GetLawType('law_closed_borders').GetName]. Instead, " +
        "damages [concept_relations] with the target [concept_subject] and some of the " +
        "[concept_subject] [concept_pop] becomes [concept_radical]."
      const translated = 
        "대상 [concept_subject]의 [concept_law_group_migration] [concept_law]를 " +
        "[GetLawType('law_closed_borders').GetName]으로 강제 변경하는 " +
        "[concept_instant_diplomatic_action]입니다. 대신, 대상 [concept_subject]와의 " +
        "[concept_relations]에 피해를 입히고, [concept_subject]의 일부 [concept_pop]가 " +
        "[concept_radical]로 변모하게 됩니다."
      
      const result = validateTranslation(source, translated, 'vic3')
      
      // [GetLawGroup('lawgroup_migration').GetName]이 [concept_law_group_migration]으로 대체되어 실패해야 함
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('누락된 게임 변수')
    })

    it('올바른 실제 번역을 수락해야 함', () => {
      const source = 
        "An [concept_instant_diplomatic_action] that forces a change in the " +
        "[GetLawGroup('lawgroup_migration').GetName] [concept_law] of the target " +
        "[concept_subject] to the [GetLawType('law_closed_borders').GetName]."
      const translated = 
        "대상 [concept_subject]의 [GetLawGroup('lawgroup_migration').GetName] [concept_law]를 " +
        "[GetLawType('law_closed_borders').GetName]으로 강제 변경하는 " +
        "[concept_instant_diplomatic_action]입니다."
      
      const result = validateTranslation(source, translated, 'vic3')
      
      expect(result.isValid).toBe(true)
    })

    it('큰따옴표 문자열 리터럴을 처리해야 함', () => {
      const source = '[GetLawGroup("lawgroup_migration").GetName] is important'
      const translated = '[GetLawGroup("lawgroup_migration").GetName] 는 중요합니다'
      
      const result = validateTranslation(source, translated, 'vic3')
      
      expect(result.isValid).toBe(true)
    })

    it('문자열 리터럴과 독립적으로 모두 나타날 때 독립 식별자를 요구해야 함', () => {
      const source = '[GetLawType("law_test").GetName] law_another is important'
      const translated = '[GetLawType("law_test").GetName] 법률_다른 is important'
      
      const result = validateTranslation(source, translated, 'vic3')
      
      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('기술 식별자')
    })

    it('문자열 리터럴과 독립 식별자가 모두 올바르게 보존되면 수락해야 함', () => {
      const source = '[GetLawType("law_test").GetName] law_another is important'
      const translated = '[GetLawType("law_test").GetName] law_another 는 중요합니다'
      
      const result = validateTranslation(source, translated, 'vic3')
      
      expect(result.isValid).toBe(true)
    })
  })
})

describe('번역 항목 검증', () => {
  it('번역 파일에서 잘못된 항목을 찾아야 함', () => {
    const sourceEntries = {
      'key1': ['Hello [GetTitle]', 'hash1'],
      'key2': ['Icon: mod_icon_test', 'hash2'],
      'key3': ['Simple text', 'hash3']
    }
    
    const translationEntries = {
      'key1': ['안녕하세요', 'hash1'], // 누락된 게임 변수
      'key2': ['아이콘: 모드_아이콘_테스트', 'hash2'], // 번역된 식별자
      'key3': ['간단한 텍스트', 'hash3'] // 유효함
    }
    
    const result = validateTranslationEntries(sourceEntries, translationEntries)
    
    expect(result.length).toBe(2)
    expect(result[0].key).toBe('key1')
    expect(result[0].reason).toContain('누락된 게임 변수')
    expect(result[1].key).toBe('key2')
    expect(result[1].reason).toContain('기술 식별자')
  })

  it('번역이 없는 항목은 건너뛰어야 함', () => {
    const sourceEntries = {
      'key1': ['Hello world', 'hash1'],
      'key2': ['Goodbye world', 'hash2']
    }
    
    const translationEntries = {
      'key1': ['안녕하세요 세계', 'hash1']
      // key2는 번역이 없음
    }
    
    const result = validateTranslationEntries(sourceEntries, translationEntries)
    
    expect(result.length).toBe(0)
  })

  it('빈 번역이 있는 항목은 건너뛰어야 함', () => {
    const sourceEntries = {
      'key1': ['Hello world', 'hash1'],
      'key2': ['Goodbye world', 'hash2']
    }
    
    const translationEntries = {
      'key1': ['안녕하세요 세계', 'hash1'],
      'key2': ['', 'hash2']
    }
    
    const result = validateTranslationEntries(sourceEntries, translationEntries)
    
    expect(result.length).toBe(0)
  })

  it('번역이 소스와 같은 항목은 건너뛰어야 함', () => {
    const sourceEntries = {
      'key1': ['RICE', 'hash1'],
      'key2': ['Hello world', 'hash2']
    }
    
    const translationEntries = {
      'key1': ['RICE', 'hash1'],
      'key2': ['안녕하세요 세계', 'hash2']
    }
    
    const result = validateTranslationEntries(sourceEntries, translationEntries)
    
    expect(result.length).toBe(0)
  })

  it('다른 게임 타입에서 작동해야 함', () => {
    const sourceEntries = {
      'key1': ['Science ship', 'hash1']
    }
    
    const translationEntries = {
      'key1': ['네, 알겠습니다. 과학선', 'hash1']
    }
    
    const result = validateTranslationEntries(sourceEntries, translationEntries, 'stellaris')
    
    expect(result.length).toBe(1)
    expect(result[0].reason).toContain('불필요한 응답 포함')
  })

  it('모든 번역이 유효하면 빈 배열을 반환해야 함', () => {
    const sourceEntries = {
      'key1': ['Hello world', 'hash1'],
      'key2': ['Goodbye world', 'hash2']
    }
    
    const translationEntries = {
      'key1': ['안녕하세요 세계', 'hash1'],
      'key2': ['안녕히 가세요 세계', 'hash2']
    }
    
    const result = validateTranslationEntries(sourceEntries, translationEntries)
    
    expect(result.length).toBe(0)
  })
})

describe('Regression tests for PR #88 - Escaped newline patterns', () => {
  it('\\n$VARIABLE$를 유효한 것으로 수락해야 함 (이스케이프된 줄바꿈 + 완전한 달러 변수)', () => {
    const result = validateTranslation('\\n$BULLET_WITH_TAB$', '\\n$BULLET_WITH_TAB$');
    expect(result.isValid).toBe(true);
  });

  it('긴 텍스트에서 \\n$VAR$를 포함한 텍스트를 수락해야 함', () => {
    const result = validateTranslation(
      'Some text\\n$BULLET_WITH_TAB$ more text',
      'Some text\\n$BULLET_WITH_TAB$ more text'
    );
    expect(result.isValid).toBe(true);
  });

  it('여러 \\n$VARIABLE$ 패턴을 수락해야 함', () => {
    const result = validateTranslation(
      '\\n$VAR1$ and \\n$VAR2$ and \\n$VAR3$',
      '\\n$VAR1$ and \\n$VAR2$ and \\n$VAR3$'
    );
    expect(result.isValid).toBe(true);
  });

  it('동일한 텍스트에서 이스케이프된 \\n$와 이스케이프되지 않은 n$를 올바르게 구분해야 함 (핵심 버그)', () => {
    // 핵심 버그: $commission_artifact_decision$ 내부에 'on$'이 있어서
    // \\n$BULLET_WITH_TAB$이 'on$'이 이스케이프되지 않았기 때문에 잘못 플래그됨
    const result = validateTranslation(
      '\\n$BULLET_WITH_TAB$ $commission_artifact_decision$',
      '\\n$BULLET_WITH_TAB$ $commission_artifact_decision$'
    );
    expect(result.isValid).toBe(true);
  });

  it('원래 버그 보고서의 실제 패턴을 수락해야 함', () => {
    const result = validateTranslation(
      'Options:\\n$BULLET_WITH_TAB$ $commission_artifact_decision$',
      'Options:\\n$BULLET_WITH_TAB$ $commission_artifact_decision$'
    );
    expect(result.isValid).toBe(true);
  });

  it('백슬래시 이스케이프 없는 독립적인 n$를 거부해야 함', () => {
    const result = validateTranslation('Text n$VARIABLE', 'Text n$VARIABLE');
    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('잘못된 형식의 변수 패턴 감지');
  });

  it('£ 변수와 함께 이스케이프된 줄바꿈을 수락해야 함', () => {
    const result = validateTranslation('\\n£VALUE£', '\\n£VALUE£');
    expect(result.isValid).toBe(true);
  });

  it('@ 아이콘 패턴과 함께 이스케이프된 줄바꿈을 수락해야 함', () => {
    const result = validateTranslation('\\n@icon_name!', '\\n@icon_name!');
    expect(result.isValid).toBe(true);
  });

  it('대괄호 변수와 함께 이스케이프된 줄바꿈을 수락해야 함', () => {
    const result = validateTranslation('\\n[GetTitle]', '\\n[GetTitle]');
    expect(result.isValid).toBe(true);
  });

  it('백슬래시-n 뒤에 변수가 아닌 문자가 오는 것을 수락해야 함', () => {
    const result = validateTranslation('\\n text', '\\n text');
    expect(result.isValid).toBe(true);
  });

  it('여러 이스케이프된 줄바꿈이 있는 복잡한 실제 텍스트를 수락해야 함', () => {
    const result = validateTranslation(
      'Header\\n$ITEM1$ text\\n$ITEM2$ more\\n$ITEM3$ text',
      'Header\\n$ITEM1$ text\\n$ITEM2$ more\\n$ITEM3$ text'
    );
    expect(result.isValid).toBe(true);
  });

  it('\\n$VAR$ (유효함)와 끝나는 달러 기호 (역시 유효함)가 모두 있는 텍스트를 처리해야 함', () => {
    // 위치 기반 검사가 작동하는지 확인: 두 패턴 모두 해당 컨텍스트에서 유효함
    const result = validateTranslation(
      'Text before\\n$BULLET$ and more $commission$ here',
      'Text before\\n$BULLET$ and more $commission$ here'
    );
    expect(result.isValid).toBe(true);
  });
})

describe('Regression tests for issue with dollar variables containing spaces', () => {
  it('공백이 있는 달러 변수를 수락해야 함 (실제 VIC3 모드 케이스)', () => {
    // VIC3 Daoyu Cheat 모드의 실제 패턴
    const source =
      "You can set the $decree_daoyu_target_state$ again after $Open Daoyu Cheat$.\n" +
      "If $decree_daoyu_target_state$ cannot be found in $concept_political_lens$ => $concept_decrees$, " +
      "attempt to save and reload the game.";
    const translated = "$Open Daoyu Cheat$ 이후 $decree_daoyu_target_state$를 다시 설정할 수 있습니다.\n만약 $concept_political_lens$ 내 $concept_decrees$에서 $decree_daoyu_target_state$를 찾을 수 없다면, 게임을 저장하고 다시 불러오십시오."
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('공백으로 구분된 여러 단어가 있는 달러 변수를 수락해야 함', () => {
    const source = "Use $My Special Variable$ for this."
    const translated = "이것을 위해 $My Special Variable$를 사용하세요."
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(true)
  })

  it('공백이 있거나 없는 혼합 변수를 수락해야 함', () => {
    const source = "$simple_var$ and $Multi Word Var$ together"
    const translated = "$simple_var$와 $Multi Word Var$가 함께"
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(true)
  })

  it('공백이 있는 실제 잘못된 형식의 패턴은 여전히 거부해야 함', () => {
    // 닫는 $ 누락
    const source = "Normal text"
    const translated = "$Open Daoyu Cheat text"
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(false)
    expect(result.reason).toContain('잘못된 형식의 변수 패턴')
  })

  it('대문자와 공백이 있는 변수를 수락해야 함', () => {
    const source = "The $BULLET WITH TAB$ is here"
    const translated = "$BULLET WITH TAB$가 여기 있습니다"
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(true)
  })
})

describe('Regression tests for section sign (§) color formatting', () => {
  // Paradox 게임 (특히 Stellaris)에서는 §Y, §G, §R 등의 색상 코드를 사용합니다.
  // 이러한 색상 코드는 달러 변수와 함께 사용될 수 있습니다.
  // 예: §Y$variable$§! (노란색으로 변수 표시)

  it('§Y$variable$§! 패턴을 수락해야 함 (색상 코드 + 달러 변수)', () => {
    const source = '£menu_2£§Y$name_planetary_seeder_nexus$§!'
    const translated = '£menu_2£§Y$name_planetary_seeder_nexus$§!'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('§G$variable$§! 패턴을 수락해야 함 (녹색)', () => {
    const source = '§G$blokkat_knowledge$§!'
    const translated = '§G$blokkat_knowledge$§!'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })

  it('§R$variable$§! 패턴을 수락해야 함 (빨간색)', () => {
    const source = '§R$bad_thing$§!'
    const translated = '§R$bad_thing$§!'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })

  it('§B$variable$§! 패턴을 수락해야 함 (파란색)', () => {
    const source = '§B$research_project$§!'
    const translated = '§B$research_project$§!'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })

  it('여러 색상 코드가 있는 복잡한 텍스트를 수락해야 함', () => {
    const source = '§Y$value1$§! and §G$value2$§! text §R$value3$§!'
    const translated = '§Y$value1$§! 그리고 §G$value2$§! 텍스트 §R$value3$§!'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })

  it('파운드 변수와 색상 코드 조합을 수락해야 함', () => {
    const source = '£menu_2£§Y$name_planetary_seeder_nexus$§!'
    const translated = '£menu_2£§Y$name_planetary_seeder_nexus$§!'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })

  it('실제 Stellaris 텍스트 패턴을 수락해야 함', () => {
    const source = '§Y은하핵§!에 접근 가능성이 열렸습니다.'
    const translated = '§Y은하핵§!에 접근 가능성이 열렸습니다.'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })

  it('잘못된 형식의 Y$ 패턴은 여전히 감지해야 함 (§ 없이)', () => {
    const source = 'Normal text'
    const translated = 'Text Y$variable here'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(false)
    expect(result.reason).toContain('잘못된 형식의 변수 패턴')
  })

  it('소문자 색상 코드도 수락해야 함 (완전한 달러 변수와 인접한 경우)', () => {
    // §y$variable$는 y$가 $variable$의 시작 $와 공유하므로 유효함
    // $variable$가 완전한 변수이므로 전체 구조는 유효함
    const source = 'Normal text'
    const translated = 'Text §y$variable$ here'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    // $variable$가 완전한 변수이므로 유효함
    expect(result.isValid).toBe(true)
  })

  it('섹션 기호 없이 대문자 + $는 여전히 잘못된 형식으로 감지되어야 함', () => {
    const source = 'Normal text'
    const translated = 'Some G$variable text'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(false)
    expect(result.reason).toContain('잘못된 형식의 변수 패턴')
  })

  it('§ 다음에 비-알파벳 문자가 오는 경우도 수락해야 함 (완전한 달러 변수와 인접한 경우)', () => {
    // §1$variable$는 1$가 $variable$의 시작 $와 공유하므로 유효함
    // $variable$가 완전한 변수이므로 전체 구조는 유효함
    const source = 'Normal text'
    const translated = 'Text §1$variable$ here'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    // $variable$가 완전한 변수이므로 유효함
    expect(result.isValid).toBe(true)
  })

  it('§BA$variable$§! 패턴을 수락해야 함 (다중 문자 색상 코드)', () => {
    const source = '§BA$building_name$§!'
    const translated = '§BA$building_name$§!'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })

  it('§BDATABANK$variable$§! 패턴을 수락해야 함 (긴 다중 문자 색상 코드)', () => {
    const source = '§BDATABANK$resource$§!'
    const translated = '§BDATABANK$resource$§!'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })

  it('여러 다중 문자 색상 코드를 수락해야 함', () => {
    const source = '§BA$value1$§! and §BB$value2$§!'
    const translated = '§BA$value1$§! 그리고 §BB$value2$§!'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })

  it('색상 코드와 함께 @ 문자를 포함하는 달러 변수를 수락해야 함 (issue 보고)', () => {
    // 실제 Stellaris 패턴: §G$@variable$§!
    // @ 문자는 변수 이름의 일부이며 별도의 @ 구문이 아님
    const source = 'Reduces by §G$@matrioshka_brain_uplink_anti_deviancy_reduction|0%$§! multiplicatively'
    const translated = '§G$@matrioshka_brain_uplink_anti_deviancy_reduction|0%$§!만큼 곱셈 방식으로 감소시킵니다'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('색상 코드와 함께 형식 지정자가 있는 달러 변수를 수락해야 함', () => {
    // 형식 지정자 (|0%, |=+0 등)를 포함하는 달러 변수
    const source = '§Y$VALUE|=+0$§! bonus'
    const translated = '§Y$VALUE|=+0$§! 보너스'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })

  it('색상 코드와 함께 복잡한 달러 변수 이름을 수락해야 함', () => {
    // @ 문자와 형식 지정자를 모두 포함하는 전체 패턴
    const source = 'Value: §G$@complex_variable_name|0%$§!'
    const translated = '값: §G$@complex_variable_name|0%$§!'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })

  it('실제 문제 케이스를 수락해야 함 (전체 문장)', () => {
    // 이슈에서 보고된 실제 전체 문장
    const source = "Reduces base £crime£ §Y$PLANET_CRIME_NO_HAPPINESS_TITLE$§! per $pop_group_unit$ Drones by §G$@matrioshka_brain_uplink_anti_deviancy_reduction|0%$§! multiplicatively\n "
    const translated = "$pop_group_unit$ 드론당 기본 £crime£ §Y$PLANET_CRIME_NO_HAPPINESS_TITLE$§!을(를) §G$@matrioshka_brain_uplink_anti_deviancy_reduction|0%$§!만큼 곱셈 방식으로 감소시킵니다."
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('§H£energy£ 패턴을 수락해야 함 (색상 코드 + 파운드 변수)', () => {
    // 이슈: §H£energy£ 패턴이 H£를 잘못된 형식으로 감지
    const source = '$sa_lootbox$§H£energy£ Energy§!.'
    const translated = '$sa_lootbox$§H£energy£ 에너지§!.'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('§Y£variable£§! 패턴을 수락해야 함 (다른 색상 코드 + 파운드 변수)', () => {
    const source = '§Y£prestige£§! value'
    const translated = '§Y£prestige£§! 값'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })

  it('여러 색상 코드 + 파운드 변수 조합을 수락해야 함', () => {
    const source = '§H£energy£§! and §G£minerals£§!'
    const translated = '§H£energy£§! 그리고 §G£minerals£§!'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })

  it('§BA£variable£ 패턴을 수락해야 함 (다중 문자 색상 코드 + 파운드 변수)', () => {
    const source = '§BA£building_resource£§!'
    const translated = '§BA£building_resource£§!'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })

  it('§BDATABANK£variable£ 패턴을 수락해야 함 (긴 다중 문자 색상 코드 + 파운드 변수)', () => {
    const source = '§BDATABANK£energy£§!'
    const translated = '§BDATABANK£energy£§!'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })

  it('여러 다중 문자 색상 코드 + 파운드 변수 조합을 수락해야 함', () => {
    const source = '§BA£energy£§! and §BB£minerals£§!'
    const translated = '§BA£energy£§! 그리고 §BB£minerals£§!'
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
  })
})

describe('문자열 리터럴 내부의 변수 패턴 처리', () => {
  // 이 테스트 그룹은 문자열 리터럴 내부의 변수 구문이 잘못된 형식으로 플래그되지 않도록 보장합니다.
  // 문자열 리터럴은 게임 변수 내에서 사용되며, 그 안의 내용은 게임 변수 구조의 일부입니다.

  it('문자열 리터럴 내부의 불완전한 달러 변수를 수락해야 함 (Concept 패턴)', () => {
    // 실제 VIC3 게임에서 사용되는 패턴: [Concept('concept_name','$concept_name')]
    const source = "As the ancient institution of [Concept('concept_serfdom','$concept_serfdom')] has finally been abolished."
    const translated = "오랜 제도였던 [Concept('concept_serfdom','$concept_serfdom')]이 마침내 폐지되었습니다."
    
    const result = validateTranslation(source, translated, 'vic3')
    
    expect(result.isValid).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('여러 Concept 패턴을 포함한 복잡한 텍스트를 수락해야 함', () => {
    const source = "The [Concept('concept_law','$concept_law')] and [Concept('concept_government','$concept_government')] systems."
    const translated = "[Concept('concept_law','$concept_law')]와 [Concept('concept_government','$concept_government')] 시스템."
    
    const result = validateTranslation(source, translated, 'vic3')
    
    expect(result.isValid).toBe(true)
  })

  it('문자열 리터럴 내부의 다른 변수 타입도 수락해야 함', () => {
    const source = "[GetFunction('param_with_£pound£')]"
    const translated = "[GetFunction('param_with_£pound£')]"
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(true)
  })

  it('문자열 리터럴 내부와 외부의 변수를 모두 수락해야 함', () => {
    const source = "$external$ text [Concept('concept','$internal$')]"
    const translated = "$external$ 텍스트 [Concept('concept','$internal$')]"
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(true)
  })

  it('문자열 리터럴 외부의 불완전한 변수는 여전히 감지해야 함', () => {
    const source = "Normal text"
    const translated = "텍스트 $incomplete [Concept('concept','$complete')]"
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(false)
    expect(result.reason).toContain('잘못된 형식의 변수 패턴')
  })

  it('문자열 리터럴 내부의 혼합 패턴도 수락해야 함', () => {
    const source = "[Function('$var1', '$var2')]"
    const translated = "[Function('$var1', '$var2')]"
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(true)
  })

  it('실제 문제 보고 케이스를 수락해야 함 (전체 문장)', () => {
    const source = "As the ancient institution of [Concept('concept_serfdom','$concept_serfdom')] has finally been abolished. Millions of our peasants are now free, unshackled from the land they were bound to. This great reform, championed by the [SCOPE.gsInterestGroup('russia_peasants_scope').GetName], promises to reshape our society and economy. This will surely help to maintain order in [ROOT.GetCountry.GetName]."
    const translated = "오랜 제도였던 [Concept('concept_serfdom','$concept_serfdom')]이 마침내 폐지되었습니다. 수백만 농민들이 마침내 자유로워져 그들이 묶여 있던 토지로부터 해방되었습니다. [SCOPE.gsInterestGroup('russia_peasants_scope').GetName]이 주창한 이 위대한 개혁은 우리 사회와 경제를 재편할 것을 약속합니다. 이는 분명히 [ROOT.GetCountry.GetName]의 질서를 유지하는 데 도움이 될 것입니다."
    
    const result = validateTranslation(source, translated, 'vic3')
    
    expect(result.isValid).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('큰따옴표 문자열 리터럴 내부의 변수도 수락해야 함', () => {
    const source = '[Concept("concept_name","$concept_name")]'
    const translated = '[Concept("concept_name","$concept_name")]'
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(true)
  })

  it('이스케이프된 따옴표가 있는 문자열 리터럴을 처리해야 함', () => {
    const source = "[Function('text with \\'quote\\'', '$var')]"
    const translated = "[Function('text with \\'quote\\'', '$var')]"
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(true)
  })

  it('문자열 리터럴 내부의 @ 패턴도 수락해야 함', () => {
    const source = "[Function('param@icon')]"
    const translated = "[Function('param@icon')]"
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(true)
  })

  it('문자열 리터럴 내부의 혼합 구분자도 수락해야 함', () => {
    const source = "[Function('$mixed@pattern')]"
    const translated = "[Function('$mixed@pattern')]"
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(true)
  })
})

describe('대괄호 불균형 감지 (이슈: AI가 게임 변수의 닫는 괄호 제거)', () => {
  it('게임 변수의 닫는 대괄호가 누락된 경우 감지해야 함', () => {
    // 실제 문제 케이스: [founder.GetTitleAsNameNoTooltip] 가 [founder.GetTitleAsNameNoTooltip" 로 변경됨
    const source = '""[founder.GetTitleAsNameNoTooltip]" [founder.GetFirstName] of [new_title.GetNameNoTierNoTooltip] has declared a new hegemony'
    const translated = '""[founder.GetTitleAsNameNoTooltip" [founder.GetFirstName] 오브 [new_title.GetNameNoTierNoTooltip]가 새로운 패권을 선포했는데'
    
    const result = validateTranslation(source, translated, 'ck3')
    
    expect(result.isValid).toBe(false)
    expect(result.reason).toContain('대괄호 불균형')
  })

  it('모든 대괄호가 올바르게 닫힌 경우 수락해야 함', () => {
    const source = '""[founder.GetTitleAsNameNoTooltip]" [founder.GetFirstName] of [new_title.GetNameNoTierNoTooltip]'
    const translated = '""[founder.GetTitleAsNameNoTooltip]" [founder.GetFirstName] 오브 [new_title.GetNameNoTierNoTooltip]'
    
    const result = validateTranslation(source, translated, 'ck3')
    
    expect(result.isValid).toBe(true)
  })

  it('여는 대괄호만 있고 닫는 대괄호가 없는 경우 감지해야 함', () => {
    const source = 'Title: [GetTitle]'
    const translated = '제목: [GetTitle'
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(false)
    expect(result.reason).toContain('대괄호 불균형')
  })

  it('닫는 대괄호가 여는 대괄호보다 많은 경우 감지해야 함', () => {
    const source = 'Title: [GetTitle]'
    const translated = '제목: GetTitle]]'
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(false)
    expect(result.reason).toContain('대괄호 불균형')
  })

  it('여러 게임 변수가 있고 하나의 닫는 괄호가 누락된 경우 감지해야 함', () => {
    const source = '[GetTitle] and [GetName] and [GetRealm]'
    const translated = '[GetTitle and [GetName] 그리고 [GetRealm]'
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(false)
    expect(result.reason).toContain('대괄호 불균형')
  })

  it('전체 문제 케이스를 감지해야 함 (이슈에서 보고된 전체 문장)', () => {
    const source = '""[founder.GetTitleAsNameNoTooltip]" [founder.GetFirstName] of [new_title.GetNameNoTierNoTooltip] has declared a new hegemony, and that some of #EMP my#! rightful territory is a part of it! [founder.GetSheHe] even has the nerve to claim that [founder.GetSheHe] rivals the gods themselves! How foolish and arrogant!"'
    const translated = '""[founder.GetTitleAsNameNoTooltip" [founder.GetFirstName] 오브 [new_title.GetNameNoTierNoTooltip]가 새로운 패권을 선포했는데, 심지어 #EMP 나의#! 정당한 영토 일부가 그 일부라고 주장하고 있소! [founder.GetSheHe]는 뻔뻔하게도 신들과도 맞먹는다고 주장하기까지 하는군! 얼마나 어리석고 오만한 처사인가!"'
    
    const result = validateTranslation(source, translated, 'ck3')
    
    expect(result.isValid).toBe(false)
    expect(result.reason).toContain('대괄호 불균형')
  })
})

describe('리터럴 텍스트와 완전한 변수가 인접한 패턴 처리', () => {
  // 이 테스트 그룹은 "DLC$giga_var$"와 같이 리터럴 텍스트 뒤에 바로 완전한 변수가 오는 경우를 처리합니다.
  // 이 경우 "DLC$"는 잘못된 형식이 아닙니다 - $는 다음 변수의 시작 부분입니다.

  it('리터럴 텍스트 뒤에 완전한 변수가 바로 오는 경우를 수락해야 함 (원래 이슈)', () => {
    // 원본 이슈: $giga_compendium_fail$Overlord DLC$giga_compendium_one_planet_origin$$giga_compendium_affix$
    // "DLC$"가 잘못된 형식으로 감지되었지만, 실제로는 "DLC" + "$giga_compendium_one_planet_origin$"입니다
    const source = "$giga_compendium_fail$Overlord DLC$giga_compendium_one_planet_origin$$giga_compendium_affix$"
    const translated = "$giga_compendium_fail$종주국 DLC$giga_compendium_one_planet_origin$$giga_compendium_affix$"
    
    const result = validateTranslation(source, translated, 'stellaris')
    
    expect(result.isValid).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('여러 연속 변수를 수락해야 함 (빈 구분자)', () => {
    // $$는 두 개의 연속 변수를 나타냄 (사이에 텍스트 없음)
    const source = "$var1$$var2$$var3$"
    const translated = "$var1$$var2$$var3$"
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(true)
  })

  it('단어 뒤에 바로 변수가 오는 경우를 수락해야 함', () => {
    const source = "Text$variable$more"
    const translated = "텍스트$variable$추가"
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(true)
  })

  it('숫자 뒤에 바로 변수가 오는 경우를 수락해야 함', () => {
    const source = "Count: 100$units$"
    const translated = "개수: 100$units$"
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(true)
  })

  it('실제 잘못된 형식의 패턴은 여전히 거부해야 함 (닫는 $ 누락)', () => {
    const source = "Text"
    const translated = "텍스트 DLC$missing_close"
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(false)
    expect(result.reason).toContain('잘못된 형식의 변수 패턴')
  })

  it('혼합 패턴 (유효한 연속 변수 + 잘못된 패턴)을 거부해야 함', () => {
    const source = "Text"
    const translated = "$valid1$$valid2$incomplete$"
    
    const result = validateTranslation(source, translated)
    
    expect(result.isValid).toBe(false)
    expect(result.reason).toContain('잘못된 형식의 변수 패턴')
  })
})

describe('음역 검증', () => {
  describe('의미 번역 감지 (문자 수 불균형)', () => {
    it('짧은 원본에 대해 너무 긴 번역은 의미 번역으로 감지해야 함', () => {
      const sourceEntries = {
        culture_1: ['Afar', ''], // 4글자
        culture_2: ['Test', ''] // 4글자
      }
      const translationEntries = {
        culture_1: ['아주아주아주먼매우먼곳의먼지역', 'hash1'], // 15글자 (3.75배)
        culture_2: ['매우긴설명문장입니다정말긴데요', 'hash2'] // 15글자 (3.75배)
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(2)
      expect(result[0].reason).toContain('문자 수 불균형')
      expect(result[1].reason).toContain('문자 수 불균형')
    })

    it('음역된 경우 유효한 것으로 수락해야 함', () => {
      const sourceEntries = {
        culture_1: ['Afar', ''],
        culture_2: ['Algonquian', ''],
        culture_3: ['Iroquoian', '']
      }
      const translationEntries = {
        culture_1: ['아파르', 'hash1'], // 음역
        culture_2: ['알곤킨', 'hash2'], // 음역
        culture_3: ['이로쿼이', 'hash3'] // 음역
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(0)
    })
  })

  describe('문자 수 불균형 감지', () => {
    it('짧은 원본에 대해 너무 긴 번역은 의미 번역으로 감지해야 함', () => {
      const sourceEntries = {
        name_1: ['Afar', ''] // 4글자
      }
      const translationEntries = {
        name_1: ['아주아주먼매우먼곳의먼지역들', 'hash1'] // 14글자 (4 * 3배 초과, 일반 단어 없음)
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(1)
      expect(result[0].reason).toContain('문자 수 불균형')
    })

    it('적절한 길이의 음역은 수락해야 함', () => {
      const sourceEntries = {
        name_1: ['Afar', ''], // 4글자
        name_2: ['Algonquian', ''] // 10글자
      }
      const translationEntries = {
        name_1: ['아파르', 'hash1'], // 3글자
        name_2: ['알곤킨', 'hash2'] // 3글자
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(0)
    })

    it('긴 원본 단어는 음절 수 검증을 건너뛰어야 함', () => {
      const sourceEntries = {
        name_1: ['VeryLongNameExample', ''] // 19글자
      }
      const translationEntries = {
        name_1: ['매우긴이름의예시입니다', 'hash1'] // 긴 번역이지만 원본도 김
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      // 원본이 10자 초과이므로 음절 수 검증 건너뜀
      expect(result.length).toBe(0)
    })
  })

  describe('음역 모드가 아닐 때는 검증 건너뛰기', () => {
    it('useTransliteration=false일 때는 음역 검증을 수행하지 않아야 함', () => {
      const sourceEntries = {
        event_1: ['Afar', '']
      }
      const translationEntries = {
        event_1: ['멀리', 'hash1'] // 의미 번역이지만 일반 파일이므로 OK
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', false)
      
      expect(result.length).toBe(0)
    })

    it('기본값(useTransliteration 미지정)일 때는 음역 검증을 수행하지 않아야 함', () => {
      const sourceEntries = {
        event_1: ['Afar', '']
      }
      const translationEntries = {
        event_1: ['멀리', 'hash1']
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3')
      
      expect(result.length).toBe(0)
    })
  })

  describe('기존 검증과 음역 검증 함께 동작', () => {
    it('기존 검증 실패 시 음역 검증은 수행하지 않아야 함', () => {
      const sourceEntries = {
        culture_1: ['[GetTitle]', '']
      }
      const translationEntries = {
        culture_1: ['[GetTitle', 'hash1'] // 대괄호 불균형 (기존 검증 실패)
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(1)
      expect(result[0].reason).toContain('대괄호 불균형')
      expect(result[0].reason).not.toContain('의미 번역')
    })

    it('기존 검증 통과하고 음역 검증 실패 시 음역 오류를 반환해야 함', () => {
      const sourceEntries = {
        culture_1: ['Test', ''] // 4글자
      }
      const translationEntries = {
        culture_1: ['매우긴설명문장입니다정말긴데요', 'hash1'] // 15글자 (기존 검증 OK, 음역 검증 실패)
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(1)
      expect(result[0].reason).toContain('문자 수 불균형')
    })
  })

  describe('decisions/desc/event 키 제외', () => {
    it('desc 키워드로 끝나는 키는 음역 검증을 건너뛰어야 함 (예: *_desc)', () => {
      const sourceEntries = {
        heritage_desc: ['Very long heritage description', '']
      }
      const translationEntries = {
        heritage_desc: ['매우긴문화유산설명문장입니다', 'hash1'] // 긴 텍스트지만 desc로 끝나므로 OK
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(0)
    })


    it('점(.) 구분자로 desc로 끝나는 키는 음역 검증을 건너뛰어야 함', () => {
      const sourceEntries = {
        'red_sea.0050.desc': ['Very long heritage description', '']
      }
      const translationEntries = {
        'red_sea.0050.desc': ['매우긴문화유산설명문장입니다', 'hash1']
      }

      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)

      expect(result.length).toBe(0)
    })

    it('event 키워드로 끝나는 키는 음역 검증을 건너뛰어야 함', () => {
      const sourceEntries = {
        culture_event: ['Very long event description', '']
      }
      const translationEntries = {
        culture_event: ['매우긴이벤트설명문장입니다', 'hash1'] // 긴 텍스트지만 event으로 끝나므로 OK
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(0)
    })

    it('일반 culture/dynasty/names 키는 여전히 음역 검증을 수행해야 함', () => {
      const sourceEntries = {
        heritage_name: ['Test', ''] // 4글자
      }
      const translationEntries = {
        heritage_name: ['매우긴설명문장입니다정말긴데요', 'hash1'] // 15글자 (4 * 3.75배 - 문자 수 불균형)
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(1)
      expect(result[0].reason).toContain('문자 수 불균형')
    })

    it('여러 제외 키워드가 있어도 하나만 매칭되면 건너뛰어야 함', () => {
      const sourceEntries = {
        roman_culture_decision_event_desc: ['Long text', '']
      }
      const translationEntries = {
        roman_culture_decision_event_desc: ['매우긴텍스트입니다', 'hash1'] // decision+event+desc이므로 OK
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(0)
    })

    it('키 중간에 decision이 있는 경우(indecision 등)는 검증해야 함', () => {
      const sourceEntries = {
        indecision_culture: ['Test', ''] // 4글자
      }
      const translationEntries = {
        indecision_culture: ['매우긴설명문장입니다정말긴데요', 'hash1'] // 15글자
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(1) // indecision은 제외되지 않음
      expect(result[0].reason).toContain('문자 수 불균형')
    })

    it('키 중간에 desc가 있는 경우(descendant 등)는 검증해야 함', () => {
      const sourceEntries = {
        descendant_name: ['Test', ''] // 4글자
      }
      const translationEntries = {
        descendant_name: ['매우긴설명문장입니다정말긴데요', 'hash1'] // 15글자
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(1) // descendant는 제외되지 않음
      expect(result[0].reason).toContain('문자 수 불균형')
    })

    it('키 중간에 event가 있는 경우(prevention 등)는 검증해야 함', () => {
      const sourceEntries = {
        prevention_culture: ['Test', ''] // 4글자
      }
      const translationEntries = {
        prevention_culture: ['매우긴설명문장입니다정말긴데요', 'hash1'] // 15글자
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(1) // prevention은 제외되지 않음
      expect(result[0].reason).toContain('문자 수 불균형')
    })
  })

  describe('문자 수 불균형 경계값 테스트', () => {
    it('원본 10자, 번역 30자 (정확히 3배)는 통과해야 함', () => {
      const sourceEntries = {
        test_name: ['abcdefghij', ''] // 정확히 10자
      }
      const translationEntries = {
        test_name: ['가나다라마바사아자차카타파하너더러머버서어저처커터퍼허고노도', 'hash1'] // 정확히 30자
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(0) // 3배는 경계값이므로 통과
    })

    it('원본 10자, 번역 31자 (3배 초과)는 무효화되어야 함', () => {
      const sourceEntries = {
        test_name: ['abcdefghij', ''] // 정확히 10자
      }
      const translationEntries = {
        test_name: ['가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허고노도', 'hash1'] // 31자
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(1) // 3배 초과이므로 무효화
      expect(result[0].reason).toContain('문자 수 불균형')
    })

    it('원본 11자 (임계값 초과)는 번역이 길어도 검증하지 않음', () => {
      const sourceEntries = {
        test_name: ['abcdefghijk', ''] // 11자
      }
      const translationEntries = {
        test_name: ['가나다라마바사아자차카타파하너더러머버서어저처커터퍼허가나마사차파', 'hash1'] // 33자 (3배)
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(0) // 원본이 11자이므로 검증 제외
    })

    it('원본 10자, 번역 29자 (3배 미만)는 통과해야 함', () => {
      const sourceEntries = {
        test_name: ['abcdefghij', ''] // 정확히 10자
      }
      const translationEntries = {
        test_name: ['가나다라마바사아자차카타파하너더러머버서어저처커터퍼허고노', 'hash1'] // 29자
      }
      
      const result = validateTranslationEntries(sourceEntries, translationEntries, 'ck3', true)
      
      expect(result.length).toBe(0) // 3배 미만이므로 통과
    })
  })
})
