import { describe, it, expect } from 'vitest'
import { parseYaml, stringifyYaml } from './yaml'

describe('parseYaml 파싱', () => {
  it('기본 YAML 구조를 파싱할 수 있어야 함', () => {
    const content = `l_english:
  key1: "value1"
  key2: "value2"`
    
    const result = parseYaml(content)
    
    expect(result).toEqual({
      'l_english': {
        'key1': ['value1', null],
        'key2': ['value2', null]
      }
    })
  })

  it('주석이 있는 값을 처리할 수 있어야 함', () => {
    const content = `l_english:
  key1: "value1" # comment1
  key2: "value2" # comment2`
    
    const result = parseYaml(content)
    
    expect(result).toEqual({
      'l_english': {
        'key1': ['value1', 'comment1'],
        'key2': ['value2', 'comment2']
      }
    })
  })

  it('주석 라인을 건너뛸 수 있어야 함', () => {
    const content = `l_english:
  # This is a comment
  key1: "value1"
  # Another comment
  key2: "value2"`
    
    const result = parseYaml(content)
    
    expect(result).toEqual({
      'l_english': {
        'key1': ['value1', null],
        'key2': ['value2', null]
      }
    })
  })

  it('키 정의의 숫자 값을 처리할 수 있어야 함', () => {
    const content = `l_english: 0
  key1: "value1"
  key2: "value2"`
    
    const result = parseYaml(content)
    
    expect(result['l_english']).toBeDefined()
    expect(result['l_english']['key1']).toEqual(['value1', null])
  })

  it('빈 값을 처리할 수 있어야 함', () => {
    const content = `l_english:
  key1: ""
  key2: "value2"`
    
    const result = parseYaml(content)
    
    expect(result['l_english']['key1']).toEqual(['', null])
    expect(result['l_english']['key2']).toEqual(['value2', null])
  })

  it('공백만 있는 값을 처리할 수 있어야 함', () => {
    const content = `l_english:
  key1: " "
  key2: "value2"`

    const result = parseYaml(content)

    expect(result['l_english']['key1']).toEqual([' ', null])
    expect(result['l_english']['key2']).toEqual(['value2', null])
  })

  it('Unix 줄바꿈(LF)을 처리할 수 있어야 함', () => {
    const content = `l_english:\n  key1: "value1"\n  key2: "value2"`
    
    const result = parseYaml(content)
    
    expect(result['l_english']['key1']).toEqual(['value1', null])
    expect(result['l_english']['key2']).toEqual(['value2', null])
  })

  it('Windows 줄바꿈(CRLF)을 처리할 수 있어야 함', () => {
    const content = `l_english:\r\n  key1: "value1"\r\n  key2: "value2"`
    
    const result = parseYaml(content)
    
    expect(result['l_english']['key1']).toEqual(['value1', null])
    expect(result['l_english']['key2']).toEqual(['value2', null])
  })

  it('값의 특수 문자를 처리할 수 있어야 함', () => {
    const content = `l_english:
  key1: "Value with $variable$"
  key2: "Value with [GetTitle]"`
    
    const result = parseYaml(content)
    
    expect(result['l_english']['key1']).toEqual(['Value with $variable$', null])
    expect(result['l_english']['key2']).toEqual(['Value with [GetTitle]', null])
  })

  it('값의 이스케이프된 따옴표를 처리할 수 있어야 함', () => {
    const content = `l_english:
  key1: "Value with \\"quoted\\" text"`
    
    const result = parseYaml(content)
    
    expect(result['l_english']['key1']).toEqual(['Value with \\"quoted\\" text', null])
  })

  it('Paradox 형식의 이스케이프된 따옴표 (큰따옴표 두 개)를 처리할 수 있어야 함', () => {
    const content = `l_english:
  key1: ""Quoted text at start"
  key2: """Multiple quotes"""
  key3: "Normal text"`
    
    const result = parseYaml(content)
    
    // ""는 리터럴 "로 변환되어야 함
    expect(result['l_english']['key1']).toEqual(['"Quoted text at start', null])
    expect(result['l_english']['key2']).toEqual(['"Multiple quotes"', null])
    expect(result['l_english']['key3']).toEqual(['Normal text', null])
  })

  it('따옴표 뒤에 추가 텍스트가 있는 경우를 처리할 수 있어야 함', () => {
    const content = `l_english:
  key1: ""Quoted speech"\\n\\n-Author Name"
  key2: "Simple text" extra content`
    
    const result = parseYaml(content)
    
    // 마지막 따옴표와 그 이후의 텍스트 모두 포함되어야 함
    expect(result['l_english']['key1']).toEqual(['"Quoted speech"\\n\\n-Author Name', null])
    expect(result['l_english']['key2']).toEqual(['Simple text" extra content', null])
  })

  it('실제 Paradox 게임 케이스: 긴 인용문과 출처를 처리할 수 있어야 함', () => {
    // 실제 VIC3 BPM_acw_events_l_english.yml 파일의 문제 케이스
    const content = `l_english:
  bpm_acw_events.314.f:0 ""The right of citizens of the United States to vote shall not be denied or abridged by the United States or by any State on account of race, color, or previous condition of servitude."\\n\\n-15th Amendment, 1870`
    
    const result = parseYaml(content)
    
    // 예상되는 파싱 결과: 선행 따옴표 + 본문 + 닫는 따옴표 + 개행 + 출처
    const expected = '"The right of citizens of the United States to vote shall not be denied or abridged by the United States or by any State on account of race, color, or previous condition of servitude."\\n\\n-15th Amendment, 1870'
    expect(result['l_english']['bpm_acw_events.314.f']).toEqual([expected, null])
  })

  it('U+200E 문자가 포함된 키와 값을 정리해야 함', () => {
    const content = `l_english:
  key\u200e1: "val\u200eue1"
  key2: "value2\u200e"`

    const result = parseYaml(content)

    expect(result).toEqual({
      l_english: {
        key1: ['value1', null],
        key2: ['value2', null]
      }
    })
  })

  it('여러 섹션을 처리할 수 있어야 함', () => {
    // 별도 파일 또는 적절한 분리로
    const content1 = `l_english:
  key1: "value1"`
    const content2 = `l_korean:
  key1: "값1"`
    
    const result1 = parseYaml(content1)
    const result2 = parseYaml(content2)
    
    expect(result1['l_english']['key1']).toEqual(['value1', null])
    expect(result2['l_korean']['key1']).toEqual(['값1', null])
  })
})

describe('stringifyYaml 직렬화', () => {
  it('기본 데이터 구조를 직렬화할 수 있어야 함', () => {
    const data = {
      'l_korean': {
        'key1': ['값1', null] as [string, string | null],
        'key2': ['값2', null] as [string, string | null]
      }
    }
    
    const result = stringifyYaml(data)
    
    expect(result).toContain('\uFEFFl_korean:')
    expect(result).toContain('  key1: "값1"')
    expect(result).toContain('  key2: "값2"')
  })

  it('해시 주석이 있을 때 포함해야 함', () => {
    const data = {
      'l_korean': {
        'key1': ['값1', 'hash123'] as [string, string | null]
      }
    }
    
    const result = stringifyYaml(data)
    
    expect(result).toContain('  key1: "값1" # hash123')
  })

  it('섹션 헤더에 UTF-8 BOM을 추가해야 함', () => {
    const data = {
      'l_korean': {
        'key1': ['값1', null] as [string, string | null]
      }
    }
    
    const result = stringifyYaml(data)
    
    expect(result.startsWith('\uFEFFl_korean:')).toBe(true)
  })

  it('값의 따옴표를 이스케이프해야 함', () => {
    const data = {
      'l_korean': {
        'key1': ['값 with "quotes"', null] as [string, string | null]
      }
    }
    
    const result = stringifyYaml(data)
    
    expect(result).toContain('  key1: "값 with \\"quotes\\""')
  })

  it('이미 이스케이프된 따옴표를 올바르게 처리해야 함', () => {
    const data = {
      'l_korean': {
        'key1': ['값 with \\"quotes\\"', null] as [string, string | null]
      }
    }
    
    const result = stringifyYaml(data)
    
    // 중복 이스케이프하지 않아야 함
    expect(result).toContain('  key1: "값 with \\"quotes\\""')
  })

  it('빈 값을 처리할 수 있어야 함', () => {
    const data = {
      'l_korean': {
        'key1': ['', null] as [string, string | null],
        'key2': ['값2', null] as [string, string | null]
      }
    }
    
    const result = stringifyYaml(data)
    
    expect(result).toContain('  key1: ""')
    expect(result).toContain('  key2: "값2"')
  })

  it('공백만 있는 값도 그대로 직렬화할 수 있어야 함', () => {
    const data = {
      'l_korean': {
        'key1': [' ', null] as [string, string | null]
      }
    }

    const result = stringifyYaml(data)

    expect(result).toContain('  key1: " "')
  })

  it('여러 섹션을 처리할 수 있어야 함', () => {
    const data = {
      'l_korean': {
        'key1': ['값1', null] as [string, string | null]
      },
      'l_japanese': {
        'key1': ['値1', null] as [string, string | null]
      }
    }
    
    const result = stringifyYaml(data)
    
    expect(result).toContain('\uFEFFl_korean:')
    expect(result).toContain('\uFEFFl_japanese:')
  })

  it('값의 특수 문자를 처리할 수 있어야 함', () => {
    const data = {
      'l_korean': {
        'key1': ['$variable$ 변수', null] as [string, string | null],
        'key2': ['[GetTitle] 제목', null] as [string, string | null]
      }
    }
    
    const result = stringifyYaml(data)
    
    expect(result).toContain('  key1: "$variable$ 변수"')
    expect(result).toContain('  key2: "[GetTitle] 제목"')
  })

  it('직렬화 시 U+200E 문자를 제거해야 함', () => {
    const data = {
      'l_korean\u200e': {
        'key\u200e1': ['값\u200e1', null] as [string, string | null]
      }
    }

    const result = stringifyYaml(data)

    expect(result).toContain('\uFEFFl_korean:')
    expect(result).toContain('  key1: "값1"')
    expect(result).not.toContain('\u200E')
  })
})

describe('parseYaml과 stringifyYaml 통합', () => {
  it('파싱과 직렬화를 왕복 처리할 수 있어야 함', () => {
    const original = `l_korean:
  key1: "값1"
  key2: "값2" # hash123`
    
    const parsed = parseYaml(original)
    const stringified = stringifyYaml(parsed)
    const reparsed = parseYaml(stringified)
    
    expect(reparsed).toEqual(parsed)
  })

  it('빈 문자열과 공백 문자열을 왕복 처리할 수 있어야 함', () => {
    const original = `l_korean:
  key1: ""
  key2: " "
  key3: "값3"`

    const parsed = parseYaml(original)
    const stringified = stringifyYaml(parsed)
    const reparsed = parseYaml(stringified)

    expect(reparsed).toEqual(parsed)
  })

  it('Paradox 형식의 인용문을 올바르게 이스케이프해야 함', () => {
    // 파싱된 텍스트는 리터럴 따옴표를 포함함 (예: "The quote"\n\n-Source)
    const data = {
      'l_korean': {
        'key1': ['"미합중국 시민의 투표권...아니 된다"\\n\\n- 수정헌법 제15조', '12345'] as [string, string | null]
      }
    }
    
    const result = stringifyYaml(data)
    
    // 출력 시 내부 따옴표는 이스케이프되어야 함
    expect(result).toContain('\\"미합중국')
    expect(result).toContain('아니 된다\\"\\n\\n')
    
    // YAML 구조의 따옴표는 이스케이프되지 않아야 함
    expect(result).toContain('key1: "')
    expect(result).toContain('" # 12345')
  })
})
