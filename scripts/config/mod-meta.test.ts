import { describe, expect, it } from 'vitest'
import { isReplaceLocalizationPath, ModMetaConfigError, parseModMeta } from './mod-meta'

describe('모드 메타 설정 정규화', () => {
  it('replace 경로 세그먼트만 교체 현지화 경로로 판별해야 함', () => {
    expect(isReplaceLocalizationPath('localization/replace/english')).toBe(true)
    expect(isReplaceLocalizationPath('RICE/localisation/replace/english')).toBe(true)
    expect(isReplaceLocalizationPath('Localization/Some Mod/localization/replace/english')).toBe(true)
    expect(isReplaceLocalizationPath('localization/notreplace/english')).toBe(false)
    expect(isReplaceLocalizationPath('Replace/localization/english')).toBe(false)
  })

  it('기존 localization 설정을 암시적 컴포넌트로 완전히 호환해야 함', () => {
    const meta = parseModMeta(`
[upstream]
url = "https://github.com/example/mod.git"
localization = ["localization/english/", "./localization/replace/english"]
language = "english"
version_strategy = "natural"
transliteration_files = ["names_l_english.yml"]
`, 'ck3/Test/meta.toml')

    expect(meta.upstream).toEqual({
      url: 'https://github.com/example/mod.git',
      language: 'english',
      transliterationFiles: ['names_l_english.yml'],
      versionStrategy: 'natural',
      localizationPaths: [
        'localization/english',
        'localization/replace/english'
      ],
      components: [{
        id: 'default',
        name: 'default',
        localizationPaths: [
          'localization/english',
          'localization/replace/english'
        ],
        versionStrategy: 'natural',
        implicit: true
      }]
    })
  })

  it('transliteration_files 와일드카드 본문을 경로처럼 변경하지 않아야 함', () => {
    const meta = parseModMeta(String.raw`
[upstream]
localization = ["localization/english"]
language = "english"
transliteration_files = ["./names//*.yml", "folder\\*_names.yml"]
`)

    expect(meta.upstream.transliterationFiles).toEqual([
      './names//*.yml',
      String.raw`folder\*_names.yml`
    ])
  })

  it('명시적 컴포넌트 설정을 공통 설정과 함께 정규화해야 함', () => {
    const meta = parseModMeta(`
[upstream]
url = "https://github.com/example/mod-pack.git"
language = "english"
version_strategy = "default"

[[upstream.components]]
id = "sea"
name = "Soft Econ Adjustments"
localization = ["Soft Econ Adjustments/localization/english"]
version_strategy = "natural"
tag_pattern = '^SEA-v'
output_subdir = "sea"

[[upstream.components]]
id = "spa"
localization = ["Soft Pop Adjustments/localization/english"]
version_strategy = "natural"
tag_pattern = '^SPA-v'
output_subdir = "."
`, "vic3/Grey's Little Reworks/meta.toml")

    expect(meta.upstream.localizationPaths).toEqual([
      'Soft Econ Adjustments/localization/english',
      'Soft Pop Adjustments/localization/english'
    ])
    expect(meta.upstream.components).toEqual([
      {
        id: 'sea',
        name: 'Soft Econ Adjustments',
        localizationPaths: ['Soft Econ Adjustments/localization/english'],
        versionStrategy: 'natural',
        tagPattern: '^SEA-v',
        outputSubdir: 'sea',
        implicit: false
      },
      {
        id: 'spa',
        name: 'spa',
        localizationPaths: ['Soft Pop Adjustments/localization/english'],
        versionStrategy: 'natural',
        tagPattern: '^SPA-v',
        outputSubdir: undefined,
        implicit: false
      }
    ])
  })

  it('localization과 components를 동시에 사용하면 거부해야 함', () => {
    expect(() => parseModMeta(`
[upstream]
localization = ["localization/english"]
language = "english"

[[upstream.components]]
id = "test"
localization = ["mods/test/localization/english"]
`)).toThrow('동시에 사용할 수 없습니다')
  })

  it('중복 컴포넌트 ID를 거부해야 함', () => {
    expect(() => parseModMeta(`
[upstream]
language = "english"

[[upstream.components]]
id = "same"
localization = ["mods/one/localization/english"]

[[upstream.components]]
id = "same"
localization = ["mods/two/localization/english"]
`)).toThrow('중복되었습니다')
  })

  it('규칙을 벗어난 컴포넌트 ID를 거부해야 함', () => {
    expect(() => parseModMeta(`
[upstream]
language = "english"

[[upstream.components]]
id = "Soft Econ"
localization = ["mods/one/localization/english"]
`)).toThrow('소문자 영숫자')
  })

  it.each([
    '../outside/localization/english',
    '/absolute/localization/english',
    'C:\\absolute\\localization\\english'
  ])('안전하지 않은 현지화 경로를 거부해야 함: %s', localizationPath => {
    expect(() => parseModMeta(`
[upstream]
localization = ["${localizationPath.replace(/\\/g, '\\\\')}"]
language = "english"
`)).toThrow(ModMetaConfigError)
  })

  it('유효하지 않은 태그 정규식을 거부해야 함', () => {
    expect(() => parseModMeta(`
[upstream]
language = "english"

[[upstream.components]]
id = "test"
localization = ["mods/test/localization/english"]
tag_pattern = "["
    `)).toThrow('유효한 정규식')
  })

  it('컴포넌트 이름의 제어 문자를 거부해야 함', () => {
    expect(() => parseModMeta(`
[upstream]
language = "english"

[[upstream.components]]
id = "test"
name = "Test\\nInjected"
localization = ["mods/test/localization/english"]
`)).toThrow('제어 문자가 없는')
  })

  it('컴포넌트형 저장소의 최상위 버전 전략은 default만 허용해야 함', () => {
    expect(() => parseModMeta(`
[upstream]
language = "english"
version_strategy = "natural"

[[upstream.components]]
id = "test"
localization = ["mods/test/localization/english"]
version_strategy = "natural"
tag_pattern = "^TEST-v"
`)).toThrow('기본 브랜치를 추적하도록 default여야 합니다')
  })

  it('컴포넌트의 태그 버전 전략에는 tag_pattern이 필요해야 함', () => {
    expect(() => parseModMeta(`
[upstream]
language = "english"

[[upstream.components]]
id = "test"
localization = ["mods/test/localization/english"]
version_strategy = "natural"
`)).toThrow('컴포넌트 태그를 구분할 정규식')
  })

  it('default 컴포넌트 전략에 의미 없는 tag_pattern을 거부해야 함', () => {
    expect(() => parseModMeta(`
[upstream]
language = "english"

[[upstream.components]]
id = "test"
localization = ["mods/test/localization/english"]
tag_pattern = "^TEST-v"
`)).toThrow('default 버전 전략과 함께 사용할 수 없습니다')
  })

  it('서로 다른 컴포넌트가 같은 현지화 경로를 소유하면 거부해야 함', () => {
    expect(() => parseModMeta(`
[upstream]
language = "english"

[[upstream.components]]
id = "one"
localization = ["shared/localization/english"]

[[upstream.components]]
id = "two"
localization = ["shared/localization/english/"]
`)).toThrow('여러 컴포넌트가 공유할 수 없습니다')
  })

  it('안전하지 않은 출력 하위 경로를 거부해야 함', () => {
    expect(() => parseModMeta(`
[upstream]
language = "english"

[[upstream.components]]
id = "test"
localization = ["mods/test/localization/english"]
output_subdir = "../outside"
`)).toThrow('상위 디렉터리 이동')
  })

  it('출력 하위 경로에서 예약된 replace 디렉터리를 거부해야 함', () => {
    expect(() => parseModMeta(`
[upstream]
language = "english"

[[upstream.components]]
id = "test"
localization = ["mods/test/localization/english"]
output_subdir = "replace/test"
`)).toThrow('예약 디렉터리 replace')
  })
})
