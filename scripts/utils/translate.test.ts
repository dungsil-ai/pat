import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TranslationRefusedError 클래스 정의
 *
 * 주의: vi.mock() 호이스팅 제약 때문에 테스트 전용 최소 구현을 사용합니다.
 * 운영 코드의 상세 메시지 포맷에 의존하지 않도록 필요한 속성만 유지합니다.
 */
class TranslationRefusedError extends Error {
  constructor(
    public readonly text: string,
    public readonly reason: string,
  ) {
    super(`번역 거부: ${reason}`)
    this.name = 'TranslationRefusedError'
  }
}

interface MockWithCalls {
  mock: {
    calls: any[][]
  }
}

function getInfoLogMessages(logInfoMock: MockWithCalls): string[] {
  return logInfoMock.mock.calls
    .map(call => call[0])
    .filter((value): value is string => typeof value === 'string')
}

function expectInfoLogContains(logInfoMock: MockWithCalls, ...keywords: string[]): void {
  const messages = getInfoLogMessages(logInfoMock)
  const hasMatchedMessage = messages.some(message => keywords.every(keyword => message.includes(keyword)))
  expect(hasMatchedMessage).toBe(true)
}

// 의존성 모킹
vi.mock('./ai', () => ({
  translateAI: vi.fn((text: string) => Promise.resolve(`[번역됨]${text}`)),
  translateAIBulk: vi.fn((texts: string[]) => Promise.resolve(texts.map(text => `[벌크번역]${text}`))),
  TranslationRefusedError,
}))

vi.mock('./cache', () => ({
  getCache: vi.fn(),
  hasCache: vi.fn(() => Promise.resolve(false)),
  removeCache: vi.fn(),
  setCache: vi.fn(),
}))

vi.mock('./dictionary', () => ({
  getDictionary: vi.fn(),
  hasDictionary: vi.fn(() => false),
}))

vi.mock('./logger', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}))

vi.mock('./translation-validator', () => ({
  validateTranslation: vi.fn(() => ({ isValid: true })),
}))

describe('변수만 포함된 텍스트 감지 (AI 번역 없이 즉시 반환)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('§X$variable$§! 패턴 (색상 코드 + 달러 변수)', () => {
    it('§E$r_zro_crystal$§! 패턴을 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('§E$r_zro_crystal$§!')

      expect(result).toBe('§E$r_zro_crystal$§!')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('§Y$name$§! 패턴을 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('§Y$name$§!')

      expect(result).toBe('§Y$name$§!')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('§G$value$§! 패턴을 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('§G$value$§!')

      expect(result).toBe('§G$value$§!')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('§BA$building_name$§! 패턴을 변수로 인식하고 그대로 반환해야 함 (다중 문자 색상 코드)', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('§BA$building_name$§!')

      expect(result).toBe('§BA$building_name$§!')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('§G$@variable$§! 패턴을 변수로 인식하고 그대로 반환해야 함 (@ 변수)', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('§G$@matrioshka$§!')

      expect(result).toBe('§G$@matrioshka$§!')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('§Y$VALUE|=+0$§! 패턴을 변수로 인식하고 그대로 반환해야 함 (형식 지정자)', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('§Y$VALUE|=+0$§!')

      expect(result).toBe('§Y$VALUE|=+0$§!')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('§R$bad_thing$§! 패턴을 변수로 인식하고 그대로 반환해야 함 (빨간색)', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('§R$bad_thing$§!')

      expect(result).toBe('§R$bad_thing$§!')
      expect(translateAI).not.toHaveBeenCalled()
    })
  })

  describe('기존 변수 패턴', () => {
    it('$variable$ 패턴을 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('$k_france$')

      expect(result).toBe('$k_france$')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('£variable£ 패턴을 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('£gold£')

      expect(result).toBe('£gold£')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('@variable@ 패턴을 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('@crown_icon@')

      expect(result).toBe('@crown_icon@')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('@variable! 패턴을 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('@information!')

      expect(result).toBe('@information!')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('[GetTitle] 패턴을 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('[GetTitle]')

      expect(result).toBe('[GetTitle]')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('#bold# 패턴을 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('#bold#')

      expect(result).toBe('#bold#')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('<democratic_gen> 패턴을 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('<democratic_gen>')

      expect(result).toBe('<democratic_gen>')
      expect(translateAI).not.toHaveBeenCalled()
    })
  })

  describe('변수가 아닌 텍스트는 AI 번역을 호출해야 함', () => {
    it('일반 텍스트는 AI 번역을 호출해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('Hello World')

      expect(result).toBe('[번역됨]Hello World')
      expect(translateAI).toHaveBeenCalledWith('Hello World', 'ck3', undefined, false)
    })

    it('변수와 텍스트가 혼합된 경우 AI 번역을 호출해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('§E$r_zro_crystal$§! is a resource')

      expect(result).toBe('[번역됨]§E$r_zro_crystal$§! is a resource')
      expect(translateAI).toHaveBeenCalled()
    })
  })

  describe('변수 조합만 포함된 텍스트 감지 (AI 번역 없이 즉시 반환)', () => {
    // 회귀 테스트: PR #163 (https://github.com/dungsil/paradox-auto-translate/pull/163)
    it('회귀 테스트 PR #163: $advcm_heavy_cavalry_toughness_loc$[Multiply_float(...)] 패턴을 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      // 이슈: 게임 변수로만 구성된 텍스트가 AI에 전달되어 변수 구조가 잘못 수정됨
      // 원본: $advcm_heavy_cavalry_toughness_loc$[Multiply_float(...)]
      // 잘못된 번역: $advcm_heavy_cavalry_toughness_loc$ [FixedPointToFloat(...)|*0.01]
      // 수정: 변수로만 구성된 텍스트는 AI 호출 없이 원본 그대로 반환
      const text = "$advcm_heavy_cavalry_toughness_loc$[Multiply_float(FixedPointToFloat(GetPlayer.MakeScope.Var('advcm_modifier1_value').GetValue), '(float)0.01')|=+%0]"
      const result = await translate(text)

      expect(result).toBe(text)
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('$var$[GetTitle] 간단한 조합을 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('$variable$[GetTitle]')

      expect(result).toBe('$variable$[GetTitle]')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('$var1$$var2$ 달러 변수 여러 개를 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('$var1$$var2$')

      expect(result).toBe('$var1$$var2$')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('[Function1][Function2] 대괄호 함수 여러 개를 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('[Function1][Function2]')

      expect(result).toBe('[Function1][Function2]')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('§Y$name$§![GetTitle] 색상 코드와 대괄호 조합을 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('§Y$name$§![GetTitle]')

      expect(result).toBe('§Y$name$§![GetTitle]')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('$var$£gold£ 달러와 파운드 변수 조합을 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('$var$£gold£')

      expect(result).toBe('$var$£gold£')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('@icon!$var$ @ 아이콘과 달러 변수 조합을 변수로 인식하고 그대로 반환해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('@icon!$var$')

      expect(result).toBe('@icon!$var$')
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('변수 조합에 텍스트가 포함된 경우 AI 번역을 호출해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const result = await translate('Hello $variable$[GetTitle]')

      // sanitizeTranslationText에 의해 $variable$와 [GetTitle] 사이에 공백이 추가됨
      expect(result).toBe('[번역됨]Hello $variable$ [GetTitle]')
      expect(translateAI).toHaveBeenCalled()
    })

    it('중첩된 대괄호 함수를 올바르게 처리해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const text = "[GetActivityType('activity_RICE_aachen_pilgrimage').GetName]"
      const result = await translate(text)

      expect(result).toBe(text)
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('복잡한 변수 조합을 올바르게 처리해야 함', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      const text = "§G$@matrioshka_brain_uplink_anti_deviancy_reduction|0%$§![GetPlayer.GetName]"
      const result = await translate(text)

      expect(result).toBe(text)
      expect(translateAI).not.toHaveBeenCalled()
    })

    it('대괄호 불균형 시 AI 번역을 호출해야 함 (열린 괄호가 더 많음)', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      // 열린 괄호가 더 많은 잘못된 형식 - AI 번역 호출되어야 함
      await translate('$var$[GetTitle')

      expect(translateAI).toHaveBeenCalled()
    })

    it('대괄호 불균형 시 AI 번역을 호출해야 함 (닫힌 괄호가 더 많음)', async () => {
      const { translate } = await import('./translate')
      const { translateAI } = await import('./ai')

      // 닫힌 괄호가 더 많은 잘못된 형식 - AI 번역 호출되어야 함
      await translate('$var$GetTitle]')

      expect(translateAI).toHaveBeenCalled()
    })
  })
})

describe('음역 모드 (useTransliteration=true)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('음역 모드로 번역을 요청해야 함', async () => {
    const { translate } = await import('./translate')
    const { translateAI } = await import('./ai')

    const result = await translate('Afar', 'ck3', 0, undefined, true)

    expect(result).toBe('[번역됨]Afar')
    expect(translateAI).toHaveBeenCalledWith('Afar', 'ck3', undefined, true)
  })

  it('음역 모드에서도 변수만 있는 경우 그대로 반환해야 함', async () => {
    const { translate } = await import('./translate')
    const { translateAI } = await import('./ai')

    const result = await translate('$culture_name$', 'ck3', 0, undefined, true)

    expect(result).toBe('$culture_name$')
    expect(translateAI).not.toHaveBeenCalled()
  })

  it('음역 모드에서 캐시 키에 prefix가 추가되어야 함', async () => {
    const { translate } = await import('./translate')
    const { hasCache } = await import('./cache')

    // 음역 모드로 번역 요청
    await translate('Anglo-Saxon', 'ck3', 0, undefined, true)

    // 캐시 조회 시 transliteration prefix가 포함된 키로 조회되는지 확인
    // (hasCache가 호출될 때 prefix가 포함된 키로 호출됨)
    expect(hasCache).toHaveBeenCalledWith('transliteration:Anglo-Saxon', 'ck3')
  })
})

describe('캐시 재사용 (동일 소스 텍스트)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('동일한 소스 텍스트를 가진 두 번째 번역 요청은 캐시를 재사용해야 함', async () => {
    const { translate } = await import('./translate')
    const { translateAI } = await import('./ai')
    const { hasCache, getCache, setCache } = await import('./cache')

    // 첫 번째 번역 요청: 캐시 없음
    vi.mocked(hasCache).mockResolvedValueOnce(false)
    const result1 = await translate('Skull Cup', 'ck3')

    // AI가 호출되고 결과가 캐시에 저장됨
    expect(translateAI).toHaveBeenCalledTimes(1)
    expect(translateAI).toHaveBeenCalledWith('Skull Cup', 'ck3', undefined, false)
    expect(setCache).toHaveBeenCalledWith('Skull Cup', '[번역됨]Skull Cup', 'ck3')
    expect(result1).toBe('[번역됨]Skull Cup')

    // 모킹 초기화 (캐시 상태만 유지)
    vi.mocked(translateAI).mockClear()
    vi.mocked(setCache).mockClear()

    // 두 번째 번역 요청: 캐시 있음
    vi.mocked(hasCache).mockResolvedValueOnce(true)
    vi.mocked(getCache).mockResolvedValueOnce('[번역됨]Skull Cup')
    const result2 = await translate('Skull Cup', 'ck3')

    // 캐시에서 조회되고 AI는 호출되지 않음
    expect(hasCache).toHaveBeenCalledWith('Skull Cup', 'ck3')
    expect(getCache).toHaveBeenCalledWith('Skull Cup', 'ck3')
    expect(translateAI).not.toHaveBeenCalled() // ✓ AI 호출 없음
    expect(result2).toBe('[번역됨]Skull Cup')
  })

  it('동일한 소스 텍스트의 음역 모드 캐시는 번역 모드 캐시와 분리되어야 함', async () => {
    const { translate } = await import('./translate')
    const { hasCache, getCache } = await import('./cache')

    // 번역 모드로 첫 번째 번역
    vi.mocked(hasCache).mockResolvedValueOnce(false)
    await translate('Anglo-Saxon', 'ck3', 0, undefined, false)

    // 음역 모드로 두 번째 번역
    // 캐시 키가 다르므로 (transliteration: prefix) 캐시 미스
    vi.mocked(hasCache).mockResolvedValueOnce(false)
    await translate('Anglo-Saxon', 'ck3', 0, undefined, true)

    // 각각 다른 캐시 키로 조회되었는지 확인
    expect(hasCache).toHaveBeenNthCalledWith(1, 'Anglo-Saxon', 'ck3') // 번역 모드
    expect(hasCache).toHaveBeenNthCalledWith(2, 'transliteration:Anglo-Saxon', 'ck3') // 음역 모드
  })
})

describe('TranslationRefusedError 처리', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('TranslationRefusedError가 발생하면 상위로 전파해야 함', async () => {
    const { translate } = await import('./translate')
    const { translateAI } = await import('./ai')

    // TranslationRefusedError를 던지도록 모킹 (Once 사용: 다른 테스트에 영향 없도록)
    const testError = new TranslationRefusedError('test text', '프롬프트 차단됨: PROHIBITED_CONTENT')
    vi.mocked(translateAI).mockRejectedValueOnce(testError)

    // 에러 타입과 속성 검증: 한 번만 호출하여 에러를 받아 여러 속성 검증
    let caughtError: any
    try {
      await translate('test text', 'ck3')
      expect.fail('Expected translate to throw TranslationRefusedError')
    } catch (err) {
      caughtError = err
    }
    
    expect(caughtError).toBeInstanceOf(TranslationRefusedError)
    expect(caughtError).toHaveProperty('text', 'test text')
    expect(caughtError).toHaveProperty('reason', '프롬프트 차단됨: PROHIBITED_CONTENT')
    expect(caughtError.message).toContain('번역 거부')
    
    expect(translateAI).toHaveBeenCalledWith('test text', 'ck3', undefined, false)
  })

  it('일반 오류가 발생하면 상위로 전파해야 함', async () => {
    const { translate } = await import('./translate')
    const { translateAI } = await import('./ai')

    // 일반 오류를 던지도록 모킹
    const genericError = new Error('네트워크 오류')
    vi.mocked(translateAI).mockRejectedValueOnce(genericError)

    // translate 함수가 일반 오류도 재throw하는지 확인
    await expect(translate('another text', 'ck3')).rejects.toThrow('네트워크 오류')
  })
})

describe('translateBulk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('벌크 번역 응답을 순서대로 반환해야 함', async () => {
    const { translateBulk } = await import('./translate')
    const { log } = await import('./logger')
    const results = await translateBulk(['first', 'second'], 'ck3', false)

    expect(results).toEqual([
      { translatedText: '[벌크번역]first' },
      { translatedText: '[벌크번역]second' },
    ])

    // 내부 문구 전체에는 결합하지 않되, 요청/응답 단계가 각각 존재하는지 분리 검증
    const infoMessages = getInfoLogMessages(vi.mocked(log.info))
    const hasRequestLog = infoMessages.some(message =>
      message.includes('[벌크/0]') &&
      message.includes('first') &&
      !message.includes('[벌크번역]first')
    )
    const hasResponseLog = infoMessages.some(message =>
      message.includes('[벌크/0]') &&
      message.includes('[벌크번역]first')
    )

    expect(hasRequestLog).toBe(true)
    expect(hasResponseLog).toBe(true)
  })

  it('벌크 번역 실패 시 개별 번역으로 폴백해야 함', async () => {
    const { translateBulk } = await import('./translate')
    const { translateAIBulk, translateAI } = await import('./ai')

    vi.mocked(translateAIBulk).mockRejectedValueOnce(new Error('벌크 실패'))

    const results = await translateBulk(['fallback-test'], 'ck3', false)

    expect(results).toEqual([{ translatedText: '[번역됨]fallback-test' }])
    expect(translateAI).toHaveBeenCalledWith('fallback-test', 'ck3', undefined, false)
  })

  it('벌크 처리에서 캐시 응답 로그를 남겨야 함', async () => {
    const { translateBulk } = await import('./translate')
    const { hasCache, getCache } = await import('./cache')
    const { log } = await import('./logger')

    vi.mocked(hasCache).mockResolvedValueOnce(true)
    vi.mocked(getCache).mockResolvedValueOnce('[캐시번역]cached')

    const results = await translateBulk(['cached'], 'ck3', false)

    expect(results).toEqual([{ translatedText: '[캐시번역]cached' }])
    expectInfoLogContains(vi.mocked(log.info), '[벌크/0]', 'cached', '[캐시번역]cached')
  })
})
