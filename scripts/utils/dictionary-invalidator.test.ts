import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as dictionaryChanges from './dictionary-changes'
import { invalidateDictionaryTranslations } from './dictionary-invalidator'

// dictionary-changes 모듈 모킹
vi.mock('./dictionary-changes', async () => {
  const actual = await vi.importActual('./dictionary-changes')
  return {
    ...actual,
    getChangedDictionaryKeys: vi.fn(),
    getChangedDictionaryKeysWithInfo: vi.fn()
  }
})

describe('dictionary-invalidator', () => {
  const testDir = '/tmp/dict-invalidator-test'
  const modDir = join(testDir, 'test-mod')
  const upstreamDir = join(modDir, 'upstream', 'localization', 'english')
  const targetDir = join(modDir, 'mod', 'localization', 'korean')

  beforeEach(async () => {
    // 테스트 디렉토리 생성
    await mkdir(upstreamDir, { recursive: true })
    await mkdir(targetDir, { recursive: true })
  })

  afterEach(async () => {
    // 테스트 디렉토리 정리
    await rm(testDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  describe('isOnlyFunctions 로직', () => {
    it('함수로만 구성된 값은 무시되어야 함', async () => {
      // meta.toml 생성
      await writeFile(
        join(modDir, 'meta.toml'),
        `[upstream]
localization = ["localization/english"]
language = "english"`
      )

      // 원본 파일: "ok"라는 단어가 포함된 값
      await writeFile(
        join(upstreamDir, 'test_l_english.yml'),
        `l_english:
  test_key1: "ok"
  test_key2: "[GetTitle]"`
      )

      // 번역 파일: test_key1은 일반 번역, test_key2는 함수만
      await writeFile(
        join(targetDir, '___test_l_korean.yml'),
        `l_korean:
  test_key1: "네"
  test_key2: "[GetTitle]"`
      )

      // "ok" 키가 변경되었다고 가정
      vi.mocked(dictionaryChanges.getChangedDictionaryKeys).mockResolvedValue(['ok'])

      // 무효화 실행
      await invalidateDictionaryTranslations('ck3', testDir, ['test-mod'], ['ok'])

      // 결과 확인
      const result = await readFile(join(targetDir, '___test_l_korean.yml'), 'utf-8')

      // test_key1은 "ok"를 포함하고, 번역이 단어사전과 정확히 일치하므로
      // "dict" 해시가 추가되어야 함
      expect(result).toContain('test_key1: "네" # 18189234847377284345')

      // test_key2는 함수만 포함하므로 변경되지 않아야 함
      expect(result).toContain('test_key2: "[GetTitle]"')
      expect(result).not.toContain('test_key2: "[GetTitle]" #')
    })
  })

  describe('단어사전 완전 일치 처리', () => {
    it('번역이 단어사전과 완전히 일치하면 유지되어야 함', async () => {
      // meta.toml 생성
      await writeFile(
        join(modDir, 'meta.toml'),
        `[upstream]
localization = ["localization/english"]
language = "english"`
      )

      // 원본 파일
      await writeFile(
        join(upstreamDir, 'test_l_english.yml'),
        `l_english:
  test_key: "ok"`
      )

      // 번역 파일: "네"는 dictionary.ts의 "ok" 번역과 정확히 일치
      await writeFile(
        join(targetDir, '___test_l_korean.yml'),
        `l_korean:
  test_key: "네"`
      )

      // "ok" 키가 변경되었다고 가정
      await invalidateDictionaryTranslations('ck3', testDir, ['test-mod'], ['ok'])

      // 결과 확인
      const result = await readFile(join(targetDir, '___test_l_korean.yml'), 'utf-8')

      // 단어사전과 일치하므로 "dict" 해시가 추가되어야 함
      expect(result).toContain('test_key: "네" # 18189234847377284345')
    })

    it('번역이 단어사전과 일치하지 않으면 해시가 제거되어야 함', async () => {
      // meta.toml 생성
      await writeFile(
        join(modDir, 'meta.toml'),
        `[upstream]
localization = ["localization/english"]
language = "english"`
      )

      // 원본 파일
      await writeFile(
        join(upstreamDir, 'test_l_english.yml'),
        `l_english:
  test_key: "This is ok"`
      )

      // 번역 파일: "ok"가 포함되어 있지만 완전히 일치하지는 않음
      await writeFile(
        join(targetDir, '___test_l_korean.yml'),
        `l_korean:
  test_key: "이것은 좋습니다" # abc123`
      )

      // "ok" 키가 변경되었다고 가정
      await invalidateDictionaryTranslations('ck3', testDir, ['test-mod'], ['ok'])

      // 결과 확인
      const result = await readFile(join(targetDir, '___test_l_korean.yml'), 'utf-8')

      // 완전히 일치하지 않으므로 해시가 제거되어야 함
      expect(result).toContain('test_key: "이것은 좋습니다"')
      expect(result).not.toContain('# abc123')
    })

    it('컴포넌트 출력 하위 경로의 번역 파일을 무효화해야 함', async () => {
      const componentTargetDir = join(targetDir, 'sample')
      await mkdir(componentTargetDir, { recursive: true })
      await writeFile(
        join(modDir, 'meta.toml'),
        `[upstream]
language = "english"

[[upstream.components]]
id = "sample"
localization = ["localization/english"]
output_subdir = "sample"`
      )
      await writeFile(
        join(upstreamDir, 'test_l_english.yml'),
        `l_english:
  test_key: "This is ok"`
      )
      await writeFile(
        join(componentTargetDir, '___test_l_korean.yml'),
        `l_korean:
  test_key: "이것은 좋습니다" # abc123`
      )

      await invalidateDictionaryTranslations('ck3', testDir, ['test-mod'], ['ok'])

      const result = await readFile(join(componentTargetDir, '___test_l_korean.yml'), 'utf-8')
      expect(result).toContain('test_key: "이것은 좋습니다"')
      expect(result).not.toContain('# abc123')
    })
  })

  describe('게임 타입 검증', () => {
    it('변경사항이 없으면 조기에 종료해야 함', async () => {
      // meta.toml 생성
      await writeFile(
        join(modDir, 'meta.toml'),
        `[upstream]
localization = ["localization/english"]
language = "english"`
      )

      // 원본 파일
      await writeFile(
        join(upstreamDir, 'test_l_english.yml'),
        `l_english:
  test_key: "empire"`
      )

      // 번역 파일
      await writeFile(
        join(targetDir, '___test_l_korean.yml'),
        `l_korean:
  test_key: "제국" # abc123`
      )

      // CK3에 대한 변경사항이 없다고 모킹
      vi.mocked(dictionaryChanges.getChangedDictionaryKeys).mockResolvedValue([])
      vi.mocked(dictionaryChanges.getChangedDictionaryKeysWithInfo).mockResolvedValue([])

      // 무효화 실행 - DictionaryChangeOptions 객체 전달
      await invalidateDictionaryTranslations('ck3', testDir, ['test-mod'], { sinceCommit: 'abc1234' })

      // 결과 확인: 파일이 변경되지 않아야 함
      const result = await readFile(join(targetDir, '___test_l_korean.yml'), 'utf-8')
      expect(result).toContain('test_key: "제국" # abc123')
    })
  })

  describe('대소문자 구분 없는 매칭', () => {
    it('대소문자 관계없이 단어사전 키를 찾아야 함', async () => {
      // meta.toml 생성
      await writeFile(
        join(modDir, 'meta.toml'),
        `[upstream]
localization = ["localization/english"]
language = "english"`
      )

      // 원본 파일: 대문자로 시작
      await writeFile(
        join(upstreamDir, 'test_l_english.yml'),
        `l_english:
  test_key: "OK"`
      )

      // 번역 파일
      await writeFile(
        join(targetDir, '___test_l_korean.yml'),
        `l_korean:
  test_key: "좋아요" # abc123`
      )

      // "ok" 키가 변경되었다고 가정 (소문자)
      await invalidateDictionaryTranslations('ck3', testDir, ['test-mod'], ['ok'])

      // 결과 확인: 대소문자 무시하고 매칭되어 해시가 제거되어야 함
      const result = await readFile(join(targetDir, '___test_l_korean.yml'), 'utf-8')
      expect(result).toContain('test_key: "네" # 6555574919958437967')
    })
  })

  describe('복합 함수 패턴', () => {
    it('복잡한 함수 패턴도 함수 전용으로 감지해야 함', async () => {
      // meta.toml 생성
      await writeFile(
        join(modDir, 'meta.toml'),
        `[upstream]
localization = ["localization/english"]
language = "english"`
      )

      // 원본 파일
      await writeFile(
        join(upstreamDir, 'test_l_english.yml'),
        `l_english:
  test_key1: "ok"
  test_key2: "[GetTitle] $VALUE$ #CODE#"
  test_key3: "[GetTitle] and ok"`
      )

      // 번역 파일
      await writeFile(
        join(targetDir, '___test_l_korean.yml'),
        `l_korean:
  test_key1: "네"
  test_key2: "[GetTitle] $VALUE$ #CODE#"
  test_key3: "[GetTitle] 그리고 네"`
      )

      // "ok" 키가 변경되었다고 가정
      await invalidateDictionaryTranslations('ck3', testDir, ['test-mod'], ['ok'])

      // 결과 확인
      const result = await readFile(join(targetDir, '___test_l_korean.yml'), 'utf-8')

      // test_key1: 일반 텍스트 - 무효화
      expect(result).toContain('test_key1: "네"')

      // test_key2: 함수만 - 무시 (변경 없음)
      expect(result).toContain('test_key2: "[GetTitle] $VALUE$ #CODE#"')

      // test_key3: 함수 + 텍스트 - 무효화
      expect(result).toContain('test_key3: "[GetTitle] 그리고 네"')
    })
  })

  describe('ck3ProperNouns 처리', () => {
    it('ck3ProperNouns에서 온 키는 4-3 단계를 건너뛰어야 함', async () => {
      // meta.toml 생성
      await writeFile(
        join(modDir, 'meta.toml'),
        `[upstream]
localization = ["localization/english"]
language = "english"`
      )

      // 원본 파일: "man"은 ck3ProperNouns에 있는 키
      await writeFile(
        join(upstreamDir, 'proper_nouns_l_english.yml'),
        `l_english:
  test_key1: "man"
  test_key2: "This man is good"`
      )

      // 번역 파일
      await writeFile(
        join(targetDir, '___proper_nouns_l_korean.yml'),
        `l_korean:
  test_key1: "만" # oldHash
  test_key2: "이 남자는 좋다" # def456`
      )

      // "man" 키가 ck3ProperNouns에서 변경되었다고 모킹
      vi.mocked(dictionaryChanges.getChangedDictionaryKeysWithInfo).mockResolvedValue([
        { key: 'man', section: 'ck3ProperNouns' }
      ])

      // 무효화 실행
      await invalidateDictionaryTranslations('ck3', testDir, ['test-mod'], { sinceCommit: 'abc1234' })

      // 결과 확인
      const result = await readFile(join(targetDir, '___proper_nouns_l_korean.yml'), 'utf-8')

      // test_key2: "man"을 포함하지만 완전히 일치하지 않음
      // 그러나 ck3ProperNouns에서 온 키이므로 4-3 단계 건너뜀 (해시 유지)
      // 이것이 이 기능의 핵심 동작임
      expect(result).toContain('test_key2: "이 남자는 좋다" # def456')
    })

    it('ck3Glossary에서 온 키는 정상적으로 4-3 단계를 처리해야 함', async () => {
      // meta.toml 생성
      await writeFile(
        join(modDir, 'meta.toml'),
        `[upstream]
localization = ["localization/english"]
language = "english"`
      )

      // 원본 파일: "ok"는 ck3Glossary에 있는 키
      await writeFile(
        join(upstreamDir, 'test_l_english.yml'),
        `l_english:
  test_key1: "ok"
  test_key2: "This is ok"`
      )

      // 번역 파일
      await writeFile(
        join(targetDir, '___test_l_korean.yml'),
        `l_korean:
  test_key1: "네" # oldHash
  test_key2: "이것은 좋다" # def456`
      )

      // "ok" 키가 ck3Glossary에서 변경되었다고 모킹
      vi.mocked(dictionaryChanges.getChangedDictionaryKeysWithInfo).mockResolvedValue([
        { key: 'ok', section: 'ck3Glossary' }
      ])

      // 무효화 실행
      await invalidateDictionaryTranslations('ck3', testDir, ['test-mod'], { sinceCommit: 'abc1234' })

      // 결과 확인
      const result = await readFile(join(targetDir, '___test_l_korean.yml'), 'utf-8')

      // test_key1: "ok"와 정확히 일치하므로 4-2 단계에서 처리됨 (해시 추가)
      expect(result).toContain('test_key1: "네"')
      expect(result).toMatch(/test_key1: "네" # \d+/)

      // test_key2: "ok"를 포함하지만 완전히 일치하지 않음
      // ck3Glossary에서 온 키이므로 4-3 단계 처리됨 (해시 제거)
      expect(result).toContain('test_key2: "이것은 좋다"')
      expect(result).not.toContain('# def456')
    })

    it('일부만 ck3ProperNouns인 경우 정상적으로 4-3 단계를 처리해야 함', async () => {
      // meta.toml 생성
      await writeFile(
        join(modDir, 'meta.toml'),
        `[upstream]
localization = ["localization/english"]
language = "english"`
      )

      // 원본 파일: "ok man"은 ck3Glossary와 ck3ProperNouns 모두 포함
      await writeFile(
        join(upstreamDir, 'test_l_english.yml'),
        `l_english:
  test_key: "ok man"`
      )

      // 번역 파일
      await writeFile(
        join(targetDir, '___test_l_korean.yml'),
        `l_korean:
  test_key: "좋은 남자" # abc123`
      )

      // "ok"는 ck3Glossary, "man"은 ck3ProperNouns에서 변경
      vi.mocked(dictionaryChanges.getChangedDictionaryKeysWithInfo).mockResolvedValue([
        { key: 'ok', section: 'ck3Glossary' },
        { key: 'man', section: 'ck3ProperNouns' }
      ])

      // 무효화 실행
      await invalidateDictionaryTranslations('ck3', testDir, ['test-mod'], { sinceCommit: 'abc1234' })

      // 결과 확인
      const result = await readFile(join(targetDir, '___test_l_korean.yml'), 'utf-8')

      // test_key: ck3Glossary 키가 포함되어 있으므로 4-3 단계 처리됨 (해시 제거)
      expect(result).toContain('test_key: "좋은 남자"')
      expect(result).not.toContain('# abc123')
    })

    it('배열 기반 필터로 고유명사 키를 전달하면 4-3 단계를 건너뛰어야 함', async () => {
      // 고유한 파일명 사용
      const testFile = 'array_filter_test_l_english.yml'
      const translatedFile = '___array_filter_test_l_korean.yml'
      
      // meta.toml 생성
      await writeFile(
        join(modDir, 'meta.toml'),
        `[upstream]
localization = ["localization/english"]
language = "english"`
      )

      // 원본 파일: "man"은 고유명사, "ok"는 일반 용어
      await writeFile(
        join(upstreamDir, testFile),
        `l_english:
  test_key1: "This man is good"
  test_key2: "This is ok"`
      )

      // 번역 파일
      await writeFile(
        join(targetDir, translatedFile),
        `l_korean:
  test_key1: "이 남자는 좋다" # hash1
  test_key2: "이것은 좋다" # hash2`
      )

      // 배열 기반 필터: "man" (고유명사)만 전달
      await invalidateDictionaryTranslations('ck3', testDir, ['test-mod'], ['man'])

      // 결과 확인
      const result = await readFile(join(targetDir, translatedFile), 'utf-8')

      // test_key1: "man"은 고유명사이므로 4-3 단계 건너뜀 (해시 유지)
      expect(result).toContain('test_key1: "이 남자는 좋다" # hash1')
      // test_key2: "man"을 포함하지 않으므로 변경 없음
      expect(result).toContain('test_key2: "이것은 좋다" # hash2')
    })

    it('배열 기반 필터로 일반 용어 키를 전달하면 정상적으로 4-3 단계를 처리해야 함', async () => {
      // 고유한 파일명 사용
      const testFile = 'array_filter_glossary_test_l_english.yml'
      const translatedFile = '___array_filter_glossary_test_l_korean.yml'
      
      // meta.toml 생성
      await writeFile(
        join(modDir, 'meta.toml'),
        `[upstream]
localization = ["localization/english"]
language = "english"`
      )

      // 원본 파일
      await writeFile(
        join(upstreamDir, testFile),
        `l_english:
  test_key1: "This is ok"`
      )

      // 번역 파일
      await writeFile(
        join(targetDir, translatedFile),
        `l_korean:
  test_key1: "이것은 좋다" # hash1`
      )

      // 배열 기반 필터: "ok" (일반 용어)만 전달
      await invalidateDictionaryTranslations('ck3', testDir, ['test-mod'], ['ok'])

      // 결과 확인
      const result = await readFile(join(targetDir, translatedFile), 'utf-8')

      // test_key1: "ok"는 일반 용어이므로 4-3 단계 처리됨 (해시 제거)
      expect(result).toContain('test_key1: "이것은 좋다"')
      expect(result).not.toContain('# hash1')
    })

    it('전체 딕셔너리 모드에서 고유명사는 4-3 단계를 건너뛰어야 함', async () => {
      // 고유한 파일명 사용
      const testFile = 'full_dict_test_l_english.yml'
      const translatedFile = '___full_dict_test_l_korean.yml'
      
      // meta.toml 생성
      await writeFile(
        join(modDir, 'meta.toml'),
        `[upstream]
localization = ["localization/english"]
language = "english"`
      )

      // 원본 파일: 고유명사만 포함
      await writeFile(
        join(upstreamDir, testFile),
        `l_english:
  test_key1: "This man is good"`
      )

      // 번역 파일
      await writeFile(
        join(targetDir, translatedFile),
        `l_korean:
  test_key1: "이 남자는 좋다" # hash1`
      )

      // 전체 딕셔너리 모드 (필터 없음)
      await invalidateDictionaryTranslations('ck3', testDir, ['test-mod'])

      // 결과 확인
      const result = await readFile(join(targetDir, translatedFile), 'utf-8')

      // test_key1: "man" (고유명사)만 포함
      // → 고유명사만 있으므로 4-3 단계 건너뜀 (해시 유지)
      expect(result).toContain('test_key1: "이 남자는 좋다" # hash1')
    })
  })
})
