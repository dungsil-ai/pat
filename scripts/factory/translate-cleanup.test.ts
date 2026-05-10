import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, access } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'pathe'
import { tmpdir } from 'node:os'

// 의존성 모킹
vi.mock('../utils/logger', () => ({
  log: {
    start: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('../utils/translate', () => ({
  translate: vi.fn((text: string) => Promise.resolve(`[KO]${text}`)),
  translateBulk: vi.fn((texts: string[]) => Promise.resolve(texts.map(text => ({ translatedText: `[KO]${text}` })))),
  TranslationRetryExceededError: class TranslationRetryExceededError extends Error {
    constructor() {
      super()
      this.name = 'TranslationRetryExceededError'
    }
  },
  TranslationRefusedError: class TranslationRefusedError extends Error {
    constructor(public readonly text: string, public readonly reason: string) {
      super(`번역 거부: ${text} (사유: ${reason})`)
      this.name = 'TranslationRefusedError'
    }
  }
}))

vi.mock('../utils/upstream', () => ({
  updateAllUpstreams: vi.fn(() => Promise.resolve())
}))

// child_process의 exec 모킹 - git checkout 명령을 실제로 시뮬레이션
const mockExecAsync = vi.fn()

vi.mock('node:child_process', () => ({
  exec: vi.fn((cmd: string, options: any, callback: any) => {
    if (callback) {
      callback(null, { stdout: '', stderr: '' })
    }
    return {
      on: vi.fn()
    }
  })
}))

vi.mock('node:util', async () => {
  const actual = await vi.importActual<typeof import('node:util')>('node:util')
  const { exec } = await import('node:child_process')
  const { rm } = await import('node:fs/promises')
  
  return {
    ...actual,
    promisify: (fn: any) => {
      // exec 함수만 모킹하고 나머지는 실제 promisify 사용
      if (fn === exec) {
        return async (cmd: string, options?: any) => {
          mockExecAsync(cmd, options)
          
          // git checkout 명령 시뮬레이션: 파일을 삭제하여 "롤백" 효과 재현
          if (cmd.includes('git checkout HEAD --')) {
            // 작은따옴표로 감싼 파일 경로 매칭 (escapeShellArg 사용 시)
            const match = cmd.match(/git checkout HEAD -- '(.+)'/) || cmd.match(/git checkout HEAD -- "(.+)"/)
            if (match) {
              const filePath = match[1].replace(/'\\''/g, "'") // 이스케이프된 작은따옴표 복원
              try {
                // 테스트에서는 파일을 삭제하여 롤백을 시뮬레이션
                await rm(filePath, { force: true })
              } catch (error) {
                // 파일이 없으면 무시
              }
            }
          }
          
          return { stdout: '', stderr: '' }
        }
      } else {
        return actual.promisify(fn)
      }
    }
  }
})

describe('파일 정리 및 빈 파일 방지', () => {
  let testDir: string

  beforeEach(async () => {
    // 테스트를 위한 임시 디렉토리 생성
    testDir = join(tmpdir(), `translate-cleanup-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    
    // mock 초기화
    mockExecAsync.mockClear()
  })

  afterEach(async () => {
    // 정리
    vi.restoreAllMocks()
    try {
      await rm(testDir, { recursive: true, force: true })
    } catch (error) {
      // 정리 오류 무시
    }
  })

  it('업스트림에서 삭제된 파일은 한국어 번역 파일의 변경사항이 롤백되어야 함', async () => {
    const { processModTranslations } = await import('./translate')

    // meta.toml 및 디렉토리 구조 생성
    const modDir = join(testDir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const koreanDir = join(modDir, 'mod', 'localization', 'korean')
    
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await mkdir(koreanDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    
    // 초기 상태: upstream에 2개의 파일 존재
    await writeFile(join(upstreamDir, 'file1_l_english.yml'), `l_english:
 key1:0 "Value 1"
`, 'utf-8')
    await writeFile(join(upstreamDir, 'file2_l_english.yml'), `l_english:
 key2:0 "Value 2"
`, 'utf-8')

    // 첫 번째 번역 실행
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // 두 파일 모두 생성되었는지 확인
    const file1Output = join(koreanDir, '___file1_l_korean.yml')
    const file2Output = join(koreanDir, '___file2_l_korean.yml')
    await access(file1Output)
    await access(file2Output)

    // upstream에서 file2 삭제
    await rm(join(upstreamDir, 'file2_l_english.yml'))

    // 두 번째 번역 실행
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // file1은 여전히 존재해야 함 (upstream에 여전히 존재)
    await access(file1Output)
    
    // file2는 git checkout으로 롤백됨 (테스트에서는 삭제로 시뮬레이션)
    expect(existsSync(file2Output)).toBe(false)
    
    // git checkout 명령이 file2에 대해 호출되었는지 확인
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('git checkout HEAD --'),
      expect.objectContaining({ cwd: expect.any(String) })
    )
  })

  it('빈 YAML 파일(항목이 없는 파일)은 생성하지 않아야 함', async () => {
    const { processModTranslations } = await import('./translate')

    const modDir = join(testDir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const koreanDir = join(modDir, 'mod', 'localization', 'korean')
    
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    
    // 항목이 없는 파일 생성 (주석만 있음)
    await writeFile(join(upstreamDir, 'empty_l_english.yml'), `l_english:
# This file has no entries
`, 'utf-8')

    // 번역 실행
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // 빈 파일은 생성되지 않아야 함
    const emptyOutput = join(koreanDir, '___empty_l_korean.yml')
    expect(existsSync(emptyOutput)).toBe(false)
  })

  it('기존에 존재하던 한국어 파일이 업스트림에서 빈 파일로 변경되면 변경사항이 롤백되어야 함', async () => {
    const { processModTranslations } = await import('./translate')

    const modDir = join(testDir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const koreanDir = join(modDir, 'mod', 'localization', 'korean')
    
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    
    // 초기: 항목이 있는 파일
    await writeFile(join(upstreamDir, 'test_l_english.yml'), `l_english:
 key1:0 "Value 1"
`, 'utf-8')

    // 첫 번째 번역 실행
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    const testOutput = join(koreanDir, '___test_l_korean.yml')
    await access(testOutput) // 파일이 생성됨
    
    // upstream 파일을 빈 파일로 변경
    await writeFile(join(upstreamDir, 'test_l_english.yml'), `l_english:
# No entries
`, 'utf-8')

    // 두 번째 번역 실행
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // 빈 파일은 git checkout으로 롤백됨 (테스트에서는 삭제로 시뮬레이션)
    expect(existsSync(testOutput)).toBe(false)
  })

  it('여러 파일 중 일부가 업스트림에서 삭제되면 해당 파일의 변경사항이 롤백되어야 함', async () => {
    const { processModTranslations } = await import('./translate')

    const modDir = join(testDir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const koreanDir = join(modDir, 'mod', 'localization', 'korean')
    
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    
    // 초기: 3개의 파일
    await writeFile(join(upstreamDir, 'file1_l_english.yml'), `l_english:
 key1:0 "Value 1"
`, 'utf-8')
    await writeFile(join(upstreamDir, 'file2_l_english.yml'), `l_english:
 key2:0 "Value 2"
`, 'utf-8')
    await writeFile(join(upstreamDir, 'file3_l_english.yml'), `l_english:
 key3:0 "Value 3"
`, 'utf-8')

    // 첫 번째 번역 실행
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    const file1Output = join(koreanDir, '___file1_l_korean.yml')
    const file2Output = join(koreanDir, '___file2_l_korean.yml')
    const file3Output = join(koreanDir, '___file3_l_korean.yml')
    
    // 3개 파일 모두 존재
    await access(file1Output)
    await access(file2Output)
    await access(file3Output)

    // file2만 업스트림에서 삭제
    await rm(join(upstreamDir, 'file2_l_english.yml'))

    // 두 번째 번역 실행
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // file1과 file3는 유지
    await access(file1Output)
    await access(file3Output)
    
    // file2는 git checkout으로 롤백됨 (테스트에서는 삭제로 시뮬레이션)
    expect(existsSync(file2Output)).toBe(false)
  })

  it('하위 디렉토리의 파일도 올바르게 변경사항이 롤백되어야 함', async () => {
    const { processModTranslations } = await import('./translate')

    const modDir = join(testDir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const subDir = join(upstreamDir, 'subdir')
    const koreanDir = join(modDir, 'mod', 'localization', 'korean')
    
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(subDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    
    // 하위 디렉토리에 파일 생성
    await writeFile(join(subDir, 'nested_l_english.yml'), `l_english:
 key1:0 "Value 1"
`, 'utf-8')

    // 첫 번째 번역 실행
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    const nestedOutput = join(koreanDir, 'subdir', '___nested_l_korean.yml')
    await access(nestedOutput) // 파일 생성됨

    // upstream에서 파일 삭제
    await rm(join(subDir, 'nested_l_english.yml'))

    // 두 번째 번역 실행
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // 파일의 변경사항이 git checkout으로 롤백됨 (테스트에서는 삭제로 시뮬레이션)
    expect(existsSync(nestedOutput)).toBe(false)
  })

  it('중첩된 localization 경로가 있어도 하위 경로 파일을 상위 경로 정리에서 롤백하지 않아야 함', async () => {
    const { processModTranslations } = await import('./translate')

    const modDir = join(testDir, 'test-mod')
    const upstreamBaseDir = join(modDir, 'upstream')
    const upstreamEnglishDir = join(upstreamBaseDir, 'localization', 'english')
    const upstreamReplaceEnglishDir = join(upstreamBaseDir, 'localization', 'replace', 'english')
    const koreanDir = join(modDir, 'mod', 'localization', 'korean')
    const koreanReplaceDir = join(koreanDir, 'replace')

    const metaContent = `
[upstream]
localization = ["localization/english", "localization/replace/english"]
language = "english"
`

    await mkdir(upstreamEnglishDir, { recursive: true })
    await mkdir(upstreamReplaceEnglishDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')

    await writeFile(join(upstreamEnglishDir, 'base_l_english.yml'), `l_english:
 key1:0 "Base Value"
`, 'utf-8')
    await writeFile(join(upstreamReplaceEnglishDir, 'replace_l_english.yml'), `l_english:
 key2:0 "Replace Value"
`, 'utf-8')

    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    const baseOutput = join(koreanDir, '___base_l_korean.yml')
    const replaceOutput = join(koreanReplaceDir, '___replace_l_korean.yml')

    await access(baseOutput)
    await access(replaceOutput)

    mockExecAsync.mockClear()

    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    expect(existsSync(baseOutput)).toBe(true)
    expect(existsSync(replaceOutput)).toBe(true)

    // 상위 경로(localization/english) 정리 단계에서 replace 하위 파일을 건드리지 않아야 함
    expect(
      mockExecAsync.mock.calls.some(([cmd]) =>
        typeof cmd === 'string' &&
        cmd.includes('git checkout HEAD --') &&
        cmd.includes('___replace_l_korean.yml')
      )
    ).toBe(false)
  })
})
