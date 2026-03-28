import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'pathe'
import { tmpdir } from 'node:os'
import { parseYaml } from '../parser/yaml'

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

vi.mock('../utils/translate', () => {
  class TranslationRetryExceededError extends Error {
    constructor(text: string) {
      super(`번역 재시도 횟수 초과: ${text}`)
      this.name = 'TranslationRetryExceededError'
    }
  }

  class TranslationRefusedError extends Error {
    constructor(public readonly text: string, public readonly reason: string) {
      super(`번역 거부: ${text} (사유: ${reason})`)
      this.name = 'TranslationRefusedError'
    }
  }

  const mockTranslate = vi.fn().mockImplementation(function(text: string, gameType?: any, retryCount?: number, lastError?: any, useTransliteration?: boolean) {
    // 기본적으로 [KO] 접두사 사용, 음역 모드면 [TRANSLITERATION] 접두사 사용
    const prefix = useTransliteration ? '[TRANSLITERATION]' : '[KO]'
    return Promise.resolve(`${prefix}${text}`)
  })

  const mockTranslateBulk = vi.fn(async (texts: string[], gameType?: any, useTransliteration?: boolean) => {
    // 벌크 모킹은 실제 번역 로직을 재현하지 않고, 테스트에서 필요한 최소 계약만 유지
    const results: Array<{ translatedText: string; error?: Error }> = []
    for (const text of texts) {
      try {
        const translatedText = await mockTranslate(text, gameType, 0, undefined, useTransliteration)
        results.push({ translatedText })
      } catch (error) {
        if (error instanceof TranslationRetryExceededError || error instanceof TranslationRefusedError) {
          results.push({ translatedText: text, error })
          continue
        }
        throw error
      }
    }
    return results
  })

  return {
    translate: mockTranslate,
    translateBulk: mockTranslateBulk,
    TranslationRetryExceededError,
    TranslationRefusedError
  }
})

vi.mock('../utils/upstream', () => ({
  updateAllUpstreams: vi.fn(() => Promise.resolve())
}))

interface MockWithCalls {
  mock: {
    calls: any[][]
  }
}

function getWarnLogMessages(warnMock: MockWithCalls): string[] {
  return warnMock.mock.calls
    .map(call => call[0])
    .filter((value): value is string => typeof value === 'string')
}

function expectWarnLogContains(warnMock: MockWithCalls, ...keywords: string[]): void {
  const warnMessages = getWarnLogMessages(warnMock)
  const hasMatchedMessage = warnMessages.some(message => keywords.every(keyword => message.includes(keyword)))
  expect(hasMatchedMessage).toBe(true)
}

function findTranslateBulkCallByText(
  bulkMock: MockWithCalls,
  targetText: string,
): { texts: string[]; useTransliteration: boolean } | undefined {
  for (const call of bulkMock.mock.calls) {
    const texts = call[0]
    const useTransliteration = call[2]
    if (!Array.isArray(texts) || typeof useTransliteration !== 'boolean') {
      continue
    }
    if (texts.includes(targetText)) {
      return { texts, useTransliteration }
    }
  }

  return undefined
}

describe('processLanguageFile 증분 쓰기', () => {
  let testDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    // 테스트를 위한 임시 디렉토리 생성
    testDir = join(tmpdir(), `translate-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    delete process.env.TRANSLATE_BATCH_SIZE
    delete process.env.TRANSLATE_MOD_CONCURRENCY
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

  it('많은 수의 항목이 있는 파일을 성공적으로 번역하고 쓸 수 있어야 함', async () => {
    // 1000개 이상의 항목이 있는 소스 파일 생성
    const entryCount = 1500
    const sourceContent = createLargeYamlFile(entryCount, 'english')
    
    // 목 설정 후 임포트
    const { processModTranslations } = await import('./translate')

    // meta.toml 및 디렉토리 구조 생성
    const modDir = join(testDir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    await writeFile(join(upstreamDir, 'test_l_english.yml'), sourceContent, 'utf-8')

    // 번역 실행
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // 출력 파일 존재 확인
    const outputPath = join(modDir, 'mod', 'localization', 'korean', '___test_l_korean.yml')
    await access(outputPath) // 파일이 없으면 예외 발생

    // 출력 내용이 유효한지 확인
    const outputContent = await readFile(outputPath, 'utf-8')
    const parsedOutput = parseYaml(outputContent)
    
    expect(parsedOutput.l_korean).toBeDefined()
    expect(Object.keys(parsedOutput.l_korean).length).toBe(entryCount)
    
    // 번역이 적용되었는지 확인
    const firstKey = Object.keys(parsedOutput.l_korean)[0]
    const [translatedValue] = parsedOutput.l_korean[firstKey]
    expect(translatedValue).toContain('[KO]')
  })

  it('1000개 미만의 항목이 있어도 최종 파일을 올바르게 쓸 수 있어야 함', async () => {
    // 1000개 미만의 항목이 있는 소스 파일 생성
    const entryCount = 500
    const sourceContent = createLargeYamlFile(entryCount, 'english')

    // 목 설정 후 임포트
    const { processModTranslations } = await import('./translate')

    // meta.toml 및 디렉토리 구조 생성
    const modDir = join(testDir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    await writeFile(join(upstreamDir, 'small_l_english.yml'), sourceContent, 'utf-8')

    // 번역 실행
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // 출력 파일 존재 확인
    const outputPath = join(modDir, 'mod', 'localization', 'korean', '___small_l_korean.yml')
    await access(outputPath)

    // 출력 내용이 유효한지 확인
    const outputContent = await readFile(outputPath, 'utf-8')
    const parsedOutput = parseYaml(outputContent)
    
    expect(parsedOutput.l_korean).toBeDefined()
    expect(Object.keys(parsedOutput.l_korean).length).toBe(entryCount)
  })

  it('TRANSLATE_BATCH_SIZE 환경변수로 배치 크기를 조정해야 함', async () => {
    process.env.TRANSLATE_BATCH_SIZE = '2'
    const entryCount = 5
    const sourceContent = createLargeYamlFile(entryCount, 'english')
    const { processModTranslations } = await import('./translate')
    const { translateBulk } = await import('../utils/translate')

    const modDir = join(testDir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    await writeFile(join(upstreamDir, 'batch_l_english.yml'), sourceContent, 'utf-8')

    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // 5개 항목을 배치 크기 2로 처리하면 3번 호출되어야 함 (2,2,1)
    expect(vi.mocked(translateBulk)).toHaveBeenCalledTimes(3)
  })

  it('TRANSLATE_BATCH_SIZE가 잘못된 값이면 기본값을 사용하고 경고를 남겨야 함', async () => {
    process.env.TRANSLATE_BATCH_SIZE = '0'
    const entryCount = 41
    const sourceContent = createLargeYamlFile(entryCount, 'english')
    const { processModTranslations } = await import('./translate')
    const { translateBulk } = await import('../utils/translate')
    const { log } = await import('../utils/logger')

    const modDir = join(testDir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    await writeFile(join(upstreamDir, 'invalid-batch_l_english.yml'), sourceContent, 'utf-8')

    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // 기본 배치 크기(20) 적용 시 41개 항목은 3번 호출(20,20,1)
    expect(vi.mocked(translateBulk)).toHaveBeenCalledTimes(3)
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(expect.stringContaining('TRANSLATE_BATCH_SIZE 값이 올바르지'))
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(expect.stringContaining('기본값(20)'))
  })

  it('배치 번역이 끝나면 즉시 파일에 저장해야 함', async () => {
    process.env.TRANSLATE_BATCH_SIZE = '2'
    const entryCount = 4
    const sourceContent = createLargeYamlFile(entryCount, 'english')
    const { processModTranslations } = await import('./translate')
    const { log } = await import('../utils/logger')

    const modDir = join(testDir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    await writeFile(join(upstreamDir, 'immediate-save_l_english.yml'), sourceContent, 'utf-8')

    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // 배치 크기 2로 4개 항목 처리 시 배치 저장 로그가 2번 찍혀야 함
    const batchSaveLogs = vi.mocked(log.verbose).mock.calls
      .map(call => String(call[0]))
      .filter(message => message.includes('배치 번역 결과 저장 완료'))
    expect(batchSaveLogs.length).toBe(2)
  })

  it('타임아웃 중간 저장 시 아직 순회하지 않은 기존 번역 키를 보존해야 함', async () => {
    const { processModTranslations } = await import('./translate')

    const modDir = join(testDir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')

    const initialSource = createLargeYamlFile(3, 'english')
    const outputPath = join(modDir, 'mod', 'localization', 'korean', '___tail-preserve_l_korean.yml')

    await writeFile(join(upstreamDir, 'tail-preserve_l_english.yml'), initialSource, 'utf-8')
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    const firstOutput = await readFile(outputPath, 'utf-8')
    const updatedSource = initialSource.replace('Test value 0', 'Changed value 0')
    await writeFile(join(upstreamDir, 'tail-preserve_l_english.yml'), updatedSource, 'utf-8')

    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false,
      timeoutMinutes: 0
    })

    const outputAfterTimeout = await readFile(outputPath, 'utf-8')
    const parsedAfterTimeout = parseYaml(outputAfterTimeout)
    expect(Object.keys(parsedAfterTimeout.l_korean)).toHaveLength(3)
    expect(outputAfterTimeout).toBe(firstOutput)
  })

  it('기존 번역을 보존하고 변경된 항목만 업데이트해야 함', async () => {
    // 초기 파일 생성
    const entryCount = 100
    const sourceContent = createLargeYamlFile(entryCount, 'english')

    const { processModTranslations } = await import('./translate')

    // meta.toml 및 디렉토리 구조 생성
    const modDir = join(testDir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    await writeFile(join(upstreamDir, 'preserve_l_english.yml'), sourceContent, 'utf-8')

    // 첫 번째 실행
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // 첫 번째 출력 읽기
    const outputPath = join(modDir, 'mod', 'localization', 'korean', '___preserve_l_korean.yml')
    const firstOutput = await readFile(outputPath, 'utf-8')
    
    // 두 번째 실행 (기존 번역을 보존해야 함)
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })
    
    const secondOutput = await readFile(outputPath, 'utf-8')
    
    // 아무것도 변경되지 않았으므로 두 출력이 동일해야 함
    expect(secondOutput).toBe(firstOutput)
  })

  it('타임아웃을 우아하게 처리하고 진행 상황을 저장해야 함', async () => {
    // 타임아웃을 유발할 항목이 있는 파일 생성
    const entryCount = 100
    const sourceContent = createLargeYamlFile(entryCount, 'english')

    // translate 모킹 (시간이 걸리도록)
    const { translate } = await import('../utils/translate')
    vi.mocked(translate).mockImplementation(async (text: string) => {
      await new Promise(resolve => setTimeout(resolve, 10)) // 번역당 10ms
      return `[KO]${text}`
    })

    const { processModTranslations } = await import('./translate')

    // meta.toml 및 디렉토리 구조 생성
    const modDir = join(testDir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    await writeFile(join(upstreamDir, 'timeout_l_english.yml'), sourceContent, 'utf-8')

    // 매우 짧은 타임아웃으로 실행 (0.01분 = 600ms)
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false,
      timeoutMinutes: 0.01
    })

    // 일부 작업이 저장되었는지 확인 (파일이 존재해야 함)
    const outputPath = join(modDir, 'mod', 'localization', 'korean', '___timeout_l_korean.yml')
    await access(outputPath) // 예외가 발생하지 않아야 함

    // 파일에 일부 콘텐츠가 있는지 확인 (부분 번역 저장됨)
    const outputContent = await readFile(outputPath, 'utf-8')
    expect(outputContent).toBeTruthy()
    expect(outputContent).toContain('l_korean')
  })

  it('타임아웃이 비활성화되면 정상적으로 작동해야 함', async () => {
    const entryCount = 100
    const sourceContent = createLargeYamlFile(entryCount, 'english')

    const { processModTranslations } = await import('./translate')

    // meta.toml 및 디렉토리 구조 생성
    const modDir = join(testDir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    await writeFile(join(upstreamDir, 'notimeout_l_english.yml'), sourceContent, 'utf-8')

    // 타임아웃 비활성화 상태로 실행
    await processModTranslations({
      rootDir: testDir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false,
      timeoutMinutes: false // 비활성화
    })

    // 완전한 번역 확인
    const outputPath = join(modDir, 'mod', 'localization', 'korean', '___notimeout_l_korean.yml')
    const outputContent = await readFile(outputPath, 'utf-8')
    const parsedOutput = parseYaml(outputContent)
    
    expect(Object.keys(parsedOutput.l_korean).length).toBe(entryCount)
  })

  it('번역 실패한 항목을 추적하고 로그에 출력해야 함', async () => {
    const entryCount = 10
    const sourceContent = createLargeYamlFile(entryCount, 'english')

    // translate 모킹 - 일부 항목에 대해 TranslationRetryExceededError 발생
    const { translate, TranslationRetryExceededError } = await import('../utils/translate')
    vi.mocked(translate).mockImplementation(async (text: string) => {
      // test_key_3과 test_key_7에서 실패
      if (text.includes('value 3') || text.includes('value 7')) {
        throw new TranslationRetryExceededError(text)
      }
      return `[KO]${text}`
    })

    const { log } = await import('../utils/logger')
    const { processModTranslations } = await import('./translate')

    // meta.toml 및 디렉토리 구조 생성 (ck3/ 하위 디렉토리 구조 모방)
    const ck3Dir = join(testDir, 'ck3')
    const modDir = join(ck3Dir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    await writeFile(join(upstreamDir, 'fail_l_english.yml'), sourceContent, 'utf-8')

    // 번역 실행 - rootDir은 ck3Dir
    const result = await processModTranslations({
      rootDir: ck3Dir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // 반환값에 번역되지 않은 항목이 포함되어 있는지 확인
    expect(result.untranslatedItems).toBeDefined()
    expect(result.untranslatedItems.length).toBe(2)
    expect(result.untranslatedItems.some(item => item.key === 'test_key_3')).toBe(true)
    expect(result.untranslatedItems.some(item => item.key === 'test_key_7')).toBe(true)

    // 번역되지 않은 항목에 대한 경고 로그가 호출되었는지 확인
    // 번역 재시도 초과 경고 메시지 확인
    expectWarnLogContains(vi.mocked(log.warn), '번역 재시도 초과')
    // 로그 문구의 세부 포맷 대신, 핵심 식별자/원문 포함 여부만 확인
    expectWarnLogContains(vi.mocked(log.warn), 'test_key_3', 'Test value 3')
    expectWarnLogContains(vi.mocked(log.warn), 'test_key_7', 'Test value 7')

    // 출력 파일에 원문이 보존되었는지 확인
    const outputPath = join(modDir, 'mod', 'localization', 'korean', '___fail_l_korean.yml')
    const outputContent = await readFile(outputPath, 'utf-8')
    const parsedOutput = parseYaml(outputContent)
    
    // test_key_3과 test_key_7은 번역되지 않은 원문 그대로, hash는 null이어야 함
    expect(parsedOutput.l_korean['test_key_3'][0]).toBe('Test value 3')
    expect(parsedOutput.l_korean['test_key_3'][1]).toBeNull()
    expect(parsedOutput.l_korean['test_key_7'][0]).toBe('Test value 7')
    expect(parsedOutput.l_korean['test_key_7'][1]).toBeNull()
    
    // 다른 항목들은 정상적으로 번역되었는지 확인
    expect(parsedOutput.l_korean['test_key_0'][0]).toBe('[KO]Test value 0')
    expect(parsedOutput.l_korean['test_key_0'][1]).toBeTruthy() // hash가 있어야 함

    // JSON 파일이 생성되었는지 확인 (projectRoot = testDir)
    const jsonPath = join(testDir, 'ck3-untranslated-items.json')
    const jsonContent = await readFile(jsonPath, 'utf-8')
    const jsonData = JSON.parse(jsonContent)
    
    expect(jsonData.gameType).toBe('ck3')
    expect(jsonData.timestamp).toBeDefined()
    expect(jsonData.items.length).toBe(2)
    expect(jsonData.items.some((item: { key: string }) => item.key === 'test_key_3')).toBe(true)
    expect(jsonData.items.some((item: { key: string }) => item.key === 'test_key_7')).toBe(true)
  })

  it('번역 실패 항목이 없으면 빈 배열을 포함한 JSON 파일을 생성해야 함', async () => {
    const entryCount = 5
    const sourceContent = createLargeYamlFile(entryCount, 'english')

    // 모든 번역이 성공하도록 모킹 재설정
    const { translate } = await import('../utils/translate')
    vi.mocked(translate).mockImplementation(async (text: string) => {
      return `[KO]${text}`
    })

    const { processModTranslations } = await import('./translate')

    // meta.toml 및 디렉토리 구조 생성 (ck3/ 하위 디렉토리 구조 모방)
    const ck3Dir = join(testDir, 'ck3')
    const modDir = join(ck3Dir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    await writeFile(join(upstreamDir, 'success_l_english.yml'), sourceContent, 'utf-8')

    // 번역 실행 - rootDir은 ck3Dir
    const result = await processModTranslations({
      rootDir: ck3Dir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // 반환값에 번역되지 않은 항목이 비어 있어야 함
    expect(result.untranslatedItems).toBeDefined()
    expect(result.untranslatedItems.length).toBe(0)

    // JSON 파일이 생성되고 빈 배열을 포함해야 함 (close-translation-issues가 최신 상태를 확인할 수 있도록)
    const jsonPath = join(testDir, 'ck3-untranslated-items.json')
    expect(existsSync(jsonPath)).toBe(true)
    const jsonContent = JSON.parse(await readFile(jsonPath, 'utf-8'))
    expect(jsonContent.items).toEqual([])
    expect(jsonContent.gameType).toBe('ck3')
  })

  it('upstream 디렉토리가 없으면 경고를 남기고 다음 모드 처리를 계속해야 함', async () => {
    const { processModTranslations } = await import('./translate')
    const { log } = await import('../utils/logger')

    // mod1은 upstream 디렉토리가 없고, mod2는 정상 번역 가능한 상태로 구성
    const mod1Dir = join(testDir, 'missing-upstream-mod')
    const mod2Dir = join(testDir, 'normal-mod')
    const mod1MetaContent = `
[upstream]
localization = ["localisation/english"]
language = "english"
`
    const mod2MetaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(mod1Dir, { recursive: true })
    await mkdir(join(mod2Dir, 'upstream'), { recursive: true })
    await writeFile(join(mod1Dir, 'meta.toml'), mod1MetaContent, 'utf-8')
    await writeFile(join(mod2Dir, 'meta.toml'), mod2MetaContent, 'utf-8')
    await writeFile(join(mod2Dir, 'upstream', 'normal_l_english.yml'), `l_english:
 key1:0 "Value 1"
`, 'utf-8')

    // 번역 실행 시 전체 프로세스는 종료되지 않고 정상 완료되어야 함
    const result = await processModTranslations({
      rootDir: testDir,
      mods: ['missing-upstream-mod', 'normal-mod'],
      gameType: 'stellaris',
      onlyHash: false
    })

    expect(result.untranslatedItems).toEqual([])
    expectWarnLogContains(vi.mocked(log.warn), 'upstream 디렉토리가 존재하지 않아 해당 localization 경로를 건너뜁니다')

    const outputPath = join(mod2Dir, 'mod', 'localisation', 'korean', '___normal_l_korean.yml')
    const outputContent = await readFile(outputPath, 'utf-8')
    expect(outputContent).toContain('[KO]Value 1')
  })

  it('upstream 루트가 없으면 클론 명령어를 포함한 오류를 표시해야 함', async () => {
    const { processModTranslations } = await import('./translate')

    const modDir = join(testDir, 'cfp-like-mod')
    const metaContent = `
[upstream]
localization = ["localization/english"]
language = "english"
`
    await mkdir(modDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')

    await expect(processModTranslations({
      rootDir: testDir,
      mods: ['cfp-like-mod'],
      gameType: 'ck3',
      onlyHash: false
    })).rejects.toThrow(/pnpm upstream ck3 \"cfp-like-mod\"/)
  })

  it('번역 거부 시 원문을 유지하고 다음 항목 처리를 계속해야 함', async () => {
    const entryCount = 10
    const sourceContent = createLargeYamlFile(entryCount, 'english')

    // translate 모킹 - test_key_5에서 TranslationRefusedError 발생
    const { translate, TranslationRefusedError } = await import('../utils/translate')
    vi.mocked(translate).mockImplementation(async (text: string) => {
      // test_key_5에서 번역 거부
      if (text.includes('value 5')) {
        throw new TranslationRefusedError(text, 'SAFETY - 안전 필터에 의해 차단됨')
      }
      return `[KO]${text}`
    })

    const { log } = await import('../utils/logger')
    const { processModTranslations } = await import('./translate')

    // meta.toml 및 디렉토리 구조 생성 (ck3/ 하위 디렉토리 구조 모방)
    const ck3Dir = join(testDir, 'ck3')
    const modDir = join(ck3Dir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')
    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`
    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    await writeFile(join(upstreamDir, 'refusal_l_english.yml'), sourceContent, 'utf-8')

    // 번역 실행 - 예외 없이 정상 종료되어야 함, rootDir은 ck3Dir
    const result = await processModTranslations({
      rootDir: ck3Dir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // 번역 거부 로그가 호출되었는지 확인
    expectWarnLogContains(vi.mocked(log.warn), '번역 거부')

    // 반환값에 거부된 항목이 포함되어 있는지 확인
    expect(result.untranslatedItems).toBeDefined()
    expect(result.untranslatedItems.length).toBe(1)
    expect(result.untranslatedItems[0].key).toBe('test_key_5')
    expect(result.untranslatedItems[0].message).toContain('Test value 5')
    expect(result.untranslatedItems[0].message).toContain('번역 거부')

    // 출력 파일이 존재하고 모든 항목이 저장되었는지 확인
    const outputPath = join(modDir, 'mod', 'localization', 'korean', '___refusal_l_korean.yml')
    await access(outputPath) // 파일이 없으면 예외 발생

    // 파일에 모든 콘텐츠가 있는지 확인
    const outputContent = await readFile(outputPath, 'utf-8')
    expect(outputContent).toBeTruthy()
    expect(outputContent).toContain('l_korean')

    const parsedOutput = parseYaml(outputContent)
    
    // test_key_0 ~ test_key_4 까지는 번역되었는지 확인
    expect(parsedOutput.l_korean['test_key_0'][0]).toBe('[KO]Test value 0')
    expect(parsedOutput.l_korean['test_key_4'][0]).toBe('[KO]Test value 4')

    // test_key_5는 원문 그대로 유지되어야 함, hash는 null
    expect(parsedOutput.l_korean['test_key_5'][0]).toBe('Test value 5')
    expect(parsedOutput.l_korean['test_key_5'][1]).toBeNull()
    
    // test_key_6 ~ test_key_9도 정상 번역되었는지 확인 (거부 이후에도 계속 처리됨)
    expect(parsedOutput.l_korean['test_key_6'][0]).toBe('[KO]Test value 6')
    expect(parsedOutput.l_korean['test_key_9'][0]).toBe('[KO]Test value 9')
    
    // JSON 파일이 생성되었는지 확인 (projectRoot = testDir)
    const jsonPath = join(testDir, 'ck3-untranslated-items.json')
    const jsonContent = await readFile(jsonPath, 'utf-8')
    const jsonData = JSON.parse(jsonContent)
    
    expect(jsonData.gameType).toBe('ck3')
    expect(jsonData.timestamp).toBeDefined()
    expect(jsonData.items.length).toBe(1)
    expect(jsonData.items[0].key).toBe('test_key_5')
    expect(jsonData.items[0].message).toContain('Test value 5')
    expect(jsonData.items[0].message).toContain('번역 거부')
  })

  it('여러 모드가 있을 때도 번역 거부를 올바르게 처리해야 함', async () => {
    const testDir = join(tmpdir(), `translate-test-multi-${Date.now()}`)
    const ck3Dir = join(testDir, 'ck3')
    
    // 2개의 모드 생성
    const mod1Dir = join(ck3Dir, 'mod1')
    const mod2Dir = join(ck3Dir, 'mod2')
    const upstream1Dir = join(mod1Dir, 'upstream')
    const upstream2Dir = join(mod2Dir, 'upstream')

    await mkdir(upstream1Dir, { recursive: true })
    await mkdir(upstream2Dir, { recursive: true })

    // mod1: 번역 성공
    await writeFile(join(mod1Dir, 'meta.toml'), `
[upstream]
localization = ["."]
language = "english"
`, 'utf-8')
    await writeFile(join(upstream1Dir, 'mod1_l_english.yml'), `l_english:
 key1:0 "Value 1"
 key2:0 "Value 2"
`, 'utf-8')

    // mod2: 번역 거부
    await writeFile(join(mod2Dir, 'meta.toml'), `
[upstream]
localization = ["."]
language = "english"
`, 'utf-8')
    await writeFile(join(upstream2Dir, 'mod2_l_english.yml'), `l_english:
 key3:0 "Value 3"
 key4:0 "Bunsom"
`, 'utf-8')

    const { translate, TranslationRefusedError } = await import('../utils/translate')
    
    // Bunsom에 대해 번역 거부
    vi.mocked(translate).mockImplementation(async (text: string) => {
      if (text.includes('Bunsom')) {
        throw new TranslationRefusedError(text, 'SAFETY')
      }
      return `[KO]${text}`
    })

    const { processModTranslations } = await import('./translate')
    const result = await processModTranslations({
      rootDir: ck3Dir,
      mods: ['mod1', 'mod2'],
      gameType: 'ck3',
      onlyHash: false
    })

    // mod1은 완료, mod2에서 거부되어 1개의 untranslated item이 있어야 함
    expect(result.untranslatedItems).toBeDefined()
    expect(result.untranslatedItems.length).toBe(1)
    expect(result.untranslatedItems[0].key).toBe('key4')
    expect(result.untranslatedItems[0].message).toContain('Bunsom')

    // JSON 파일이 생성되었는지 확인
    const jsonPath = join(testDir, 'ck3-untranslated-items.json')
    const jsonContent = await readFile(jsonPath, 'utf-8')
    const jsonData = JSON.parse(jsonContent)
    
    expect(jsonData.items.length).toBe(1)
    expect(jsonData.items[0].key).toBe('key4')
    expect(jsonData.items[0].mod).toBe('mod2')

    // mod1의 번역 파일은 생성되었는지 확인
    const mod1Output = join(mod1Dir, 'mod', 'localization', 'korean', '___mod1_l_korean.yml')
    const mod1Content = await readFile(mod1Output, 'utf-8')
    expect(mod1Content).toContain('[KO]Value 1')
    expect(mod1Content).toContain('[KO]Value 2')

    // mod2의 번역 파일이 모두 생성되었는지 확인 (원문 포함)
    const mod2Output = join(mod2Dir, 'mod', 'localization', 'korean', '___mod2_l_korean.yml')
    const mod2Content = await readFile(mod2Output, 'utf-8')
    const mod2Yaml = parseYaml(mod2Content)
    expect(mod2Yaml.l_korean['key3'][0]).toBe('[KO]Value 3')
    // key4는 원문 그대로 유지되어야 함
    expect(mod2Yaml.l_korean['key4'][0]).toBe('Bunsom')
    expect(mod2Yaml.l_korean['key4'][1]).toBeNull()

    // 정리
    await rm(testDir, { recursive: true, force: true })
  })

  it('모드 이름이 ETC일 때는 하위 실제 모드 이름을 참조해야 함', async () => {
    const { processModTranslations } = await import('./translate')
    const { translateBulk, TranslationRefusedError } = await import('../utils/translate')

    const ck3Dir = join(testDir, 'ck3')
    const etcDir = join(ck3Dir, 'ETC')
    const upstreamDir = join(etcDir, 'upstream')

    await mkdir(join(upstreamDir, 'More Character Names', 'names'), { recursive: true })
    await writeFile(join(etcDir, 'meta.toml'), `
[upstream]
localization = ["."]
language = "english"
`, 'utf-8')

    await writeFile(
      join(upstreamDir, 'More Character Names', 'names', 'character_names_l_english.yml'),
      `l_english:
 key_ok:0 "Safe Name"
 key_refused:0 "Bunsom"
`,
      'utf-8'
    )

    vi.mocked(translateBulk).mockImplementationOnce(async (texts: string[]) => {
      return texts.map((text) => {
        if (text === 'Bunsom') {
          return {
            translatedText: text,
            error: new TranslationRefusedError(text, 'SAFETY')
          }
        }
        return { translatedText: `[KO]${text}` }
      })
    })

    const result = await processModTranslations({
      rootDir: ck3Dir,
      mods: ['ETC'],
      gameType: 'ck3',
      onlyHash: false
    })

    expect(result.untranslatedItems).toHaveLength(1)
    expect(result.untranslatedItems[0].mod).toBe('More Character Names')
    expect(result.untranslatedItems[0].file).toBe('More Character Names/names/character_names_l_english.yml')

    const jsonPath = join(testDir, 'ck3-untranslated-items.json')
    const jsonData = JSON.parse(await readFile(jsonPath, 'utf-8'))
    expect(jsonData.items[0].mod).toBe('More Character Names')

    const bulkCallContext = vi.mocked(translateBulk).mock.calls.at(-1)?.[3] as { modName?: string } | undefined
    expect(bulkCallContext?.modName).toBe('More Character Names')
  })

  it('모드 단위 병렬 처리 동시성을 적용해야 함', async () => {
    const testDir = join(tmpdir(), `translate-test-mod-concurrency-${Date.now()}`)
    const ck3Dir = join(testDir, 'ck3')

    const mod1Dir = join(ck3Dir, 'mod1')
    const mod2Dir = join(ck3Dir, 'mod2')
    await mkdir(join(mod1Dir, 'upstream'), { recursive: true })
    await mkdir(join(mod2Dir, 'upstream'), { recursive: true })

    await writeFile(join(mod1Dir, 'meta.toml'), `
[upstream]
localization = ["."]
language = "english"
`, 'utf-8')
    await writeFile(join(mod2Dir, 'meta.toml'), `
[upstream]
localization = ["."]
language = "english"
`, 'utf-8')
    await writeFile(join(mod1Dir, 'upstream', 'mod1_l_english.yml'), `l_english:\n key1:0 "Value 1"\n`, 'utf-8')
    await writeFile(join(mod2Dir, 'upstream', 'mod2_l_english.yml'), `l_english:\n key2:0 "Value 2"\n`, 'utf-8')

    const { translate } = await import('../utils/translate')
    vi.mocked(translate).mockImplementation(async (text: string) => {
      await new Promise(resolve => setTimeout(resolve, 120))
      return `[KO]${text}`
    })

    process.env.TRANSLATE_MOD_CONCURRENCY = '1'
    const { processModTranslations } = await import('./translate')
    const sequentialStart = Date.now()
    await processModTranslations({
      rootDir: ck3Dir,
      mods: ['mod1', 'mod2'],
      gameType: 'ck3',
      onlyHash: false
    })
    const sequentialElapsed = Date.now() - sequentialStart

    process.env.TRANSLATE_MOD_CONCURRENCY = '2'
    const parallelStart = Date.now()
    await processModTranslations({
      rootDir: ck3Dir,
      mods: ['mod1', 'mod2'],
      gameType: 'ck3',
      onlyHash: false
    })
    const parallelElapsed = Date.now() - parallelStart

    expect(parallelElapsed).toBeLessThan(sequentialElapsed)
  })

  it('한 모드에 여러 파일이 있을 때 번역 거부가 발생해도 다른 파일들은 정상 처리되어야 함', async () => {
    const testDir = join(tmpdir(), `translate-test-multi-files-${Date.now()}`)
    const ck3Dir = join(testDir, 'ck3')
    
    // 1개의 모드에 여러 파일 생성
    const modDir = join(ck3Dir, 'test-mod')
    const upstreamDir = join(modDir, 'upstream')

    await mkdir(upstreamDir, { recursive: true })

    // meta.toml 생성
    await writeFile(join(modDir, 'meta.toml'), `
[upstream]
localization = ["."]
language = "english"
`, 'utf-8')

    // file1: 번역 성공
    await writeFile(join(upstreamDir, 'file1_l_english.yml'), `l_english:
 key1:0 "Value 1"
 key2:0 "Value 2"
`, 'utf-8')

    // file2: 번역 거부 발생
    await writeFile(join(upstreamDir, 'file2_l_english.yml'), `l_english:
 key3:0 "Value 3"
 key4:0 "Forbidden Content"
 key5:0 "Value 5"
`, 'utf-8')

    // file3: 번역 성공
    await writeFile(join(upstreamDir, 'file3_l_english.yml'), `l_english:
 key6:0 "Value 6"
 key7:0 "Value 7"
`, 'utf-8')

    const { translate, TranslationRefusedError } = await import('../utils/translate')
    
    // Forbidden Content에 대해 번역 거부
    vi.mocked(translate).mockImplementation(async (text: string) => {
      if (text.includes('Forbidden Content')) {
        throw new TranslationRefusedError(text, 'SAFETY - 금지된 콘텐츠')
      }
      return `[KO]${text}`
    })

    const { processModTranslations } = await import('./translate')
    const result = await processModTranslations({
      rootDir: ck3Dir,
      mods: ['test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // 번역 거부된 항목이 1개 있어야 함
    expect(result.untranslatedItems).toBeDefined()
    expect(result.untranslatedItems.length).toBe(1)
    expect(result.untranslatedItems[0].key).toBe('key4')
    expect(result.untranslatedItems[0].file).toBe('file2_l_english.yml')
    expect(result.untranslatedItems[0].message).toContain('Forbidden Content')
    expect(result.untranslatedItems[0].message).toContain('번역 거부')

    // file1의 번역 파일이 정상적으로 생성되었는지 확인
    const file1Output = join(modDir, 'mod', 'localization', 'korean', '___file1_l_korean.yml')
    const file1Content = await readFile(file1Output, 'utf-8')
    const file1Yaml = parseYaml(file1Content)
    expect(file1Yaml.l_korean['key1'][0]).toBe('[KO]Value 1')
    expect(file1Yaml.l_korean['key2'][0]).toBe('[KO]Value 2')

    // file2의 번역 파일이 완전히 생성되었는지 확인 (원문 포함)
    const file2Output = join(modDir, 'mod', 'localization', 'korean', '___file2_l_korean.yml')
    const file2Content = await readFile(file2Output, 'utf-8')
    const file2Yaml = parseYaml(file2Content)
    // key3는 번역되었어야 함 (거부 이전)
    expect(file2Yaml.l_korean['key3'][0]).toBe('[KO]Value 3')
    // key4는 원문 그대로 유지되어야 함, hash는 null
    expect(file2Yaml.l_korean['key4'][0]).toBe('Forbidden Content')
    expect(file2Yaml.l_korean['key4'][1]).toBeNull()
    // key5도 정상 번역되었어야 함 (거부 이후에도 계속 진행)
    expect(file2Yaml.l_korean['key5'][0]).toBe('[KO]Value 5')

    // file3의 번역 파일이 정상적으로 생성되었는지 확인
    const file3Output = join(modDir, 'mod', 'localization', 'korean', '___file3_l_korean.yml')
    const file3Content = await readFile(file3Output, 'utf-8')
    const file3Yaml = parseYaml(file3Content)
    expect(file3Yaml.l_korean['key6'][0]).toBe('[KO]Value 6')
    expect(file3Yaml.l_korean['key7'][0]).toBe('[KO]Value 7')

    // JSON 파일 확인
    const jsonPath = join(testDir, 'ck3-untranslated-items.json')
    const jsonContent = await readFile(jsonPath, 'utf-8')
    const jsonData = JSON.parse(jsonContent)
    
    expect(jsonData.items.length).toBe(1)
    expect(jsonData.items[0].key).toBe('key4')
    expect(jsonData.items[0].file).toBe('file2_l_english.yml')

    // 정리
    await rm(testDir, { recursive: true, force: true })
  })

  it('meta.toml의 transliteration_files 옵션으로 수동 지정된 파일은 음역 모드를 사용해야 함', async () => {
    const { processModTranslations } = await import('./translate')
    const { translateBulk } = await import('../utils/translate')
    
    // meta.toml에 transliteration_files 옵션 추가
    const modDir = join(testDir, 'transliteration-test-mod')
    const upstreamDir = join(modDir, 'upstream')
    
    // 일반적으로 번역 모드를 사용할 파일명이지만, 수동으로 음역 모드 지정
    const metaContent = `
[upstream]
localization = ["."]
language = "english"

transliteration_files = ["custom_events_l_english.yml", "*_special_*"]
`
    
    const customEventsContent = `l_english:
  test_key_1: "Test Name 1"
  test_key_2: "Test Name 2"
`
    
    const specialNamesContent = `l_english:
  special_key_1: "Special Name 1"
  special_key_2: "Special Name 2"
`

    const regularContent = `l_english:
  regular_key_1: "Regular Text 1"
`

    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    await writeFile(join(upstreamDir, 'custom_events_l_english.yml'), customEventsContent, 'utf-8')
    await writeFile(join(upstreamDir, 'mod_special_names_l_english.yml'), specialNamesContent, 'utf-8')
    await writeFile(join(upstreamDir, 'regular_l_english.yml'), regularContent, 'utf-8')

    // 번역 실행
    await processModTranslations({
      rootDir: testDir,
      mods: ['transliteration-test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // 출력 파일 생성 여부 검증
    const customEventsOutput = join(modDir, 'mod', 'localization', 'korean', '___custom_events_l_korean.yml')
    await access(customEventsOutput) // 파일이 없으면 예외 발생

    const specialOutput = join(modDir, 'mod', 'localization', 'korean', '___mod_special_names_l_korean.yml')
    await access(specialOutput)

    const regularOutput = join(modDir, 'mod', 'localization', 'korean', '___regular_l_korean.yml')
    await access(regularOutput)

    // 수동 지정 파일은 음역 모드(true), 일반 파일은 번역 모드(false)로 요청되었는지 검증
    const customCall = findTranslateBulkCallByText(vi.mocked(translateBulk), 'Test Name 1')
    const specialCall = findTranslateBulkCallByText(vi.mocked(translateBulk), 'Special Name 1')
    const regularCall = findTranslateBulkCallByText(vi.mocked(translateBulk), 'Regular Text 1')

    expect(customCall).toBeDefined()
    expect(customCall?.useTransliteration).toBe(true)
    expect(specialCall).toBeDefined()
    expect(specialCall?.useTransliteration).toBe(true)
    expect(regularCall).toBeDefined()
    expect(regularCall?.useTransliteration).toBe(false)

    // 정리
    await rm(testDir, { recursive: true, force: true })
  })

  it('한 모드에서 오류가 발생해도 다음 모드 번역을 계속 진행해야 함', async () => {
    const { processModTranslations } = await import('./translate')
    const { translateBulk } = await import('../utils/translate')
    const prompts = await import('../utils/prompts')

    const modDir = join(testDir, 'mode-fallback-mod')
    const upstreamDir = join(modDir, 'upstream')

    const metaContent = `
[upstream]
localization = ["."]
language = "english"
`

    const sourceContent = `l_english:
  normal_key: "Normal text"
  dynasty_name: "Dynasty Name"
`

    await mkdir(upstreamDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    await writeFile(join(upstreamDir, 'events_l_english.yml'), sourceContent, 'utf-8')

    vi.spyOn(prompts, 'shouldUseTransliterationForKey').mockImplementation((key: string) => key === 'dynasty_name')

    const originalTranslateBulk = vi.mocked(translateBulk).getMockImplementation()
    vi.mocked(translateBulk).mockImplementation(async (texts: string[], gameType?: any, useTransliteration?: boolean) => {
      if (!useTransliteration) {
        throw new Error('일반 번역 모드 실패')
      }
      if (originalTranslateBulk) {
        return originalTranslateBulk(texts, gameType, useTransliteration)
      }
      return texts.map(text => ({ translatedText: `[TRANSLITERATION]${text}` }))
    })

    const result = await processModTranslations({
      rootDir: testDir,
      mods: ['mode-fallback-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    const outputPath = join(modDir, 'mod', 'localization', 'korean', '___events_l_korean.yml')
    const outputContent = await readFile(outputPath, 'utf-8')
    const outputYaml = parseYaml(outputContent)

    // 일반 번역 모드 오류가 난 항목은 원문 유지
    expect(outputYaml.l_korean['normal_key'][0]).toBe('Normal text')
    expect(outputYaml.l_korean['normal_key'][1]).toBeNull()

    // 다음 모드(음역)는 계속 진행되어 번역 결과가 반영되어야 함
    expect(outputYaml.l_korean['dynasty_name'][0]).not.toBe('Dynasty Name')
    expect(outputYaml.l_korean['dynasty_name'][1]).toBeDefined()

    expect(result.untranslatedItems.some(item => item.key === 'normal_key')).toBe(true)
    expect(result.untranslatedItems.some(item => item.key === 'dynasty_name')).toBe(false)

    await rm(testDir, { recursive: true, force: true })
  })

  it('중복되는 항목을 제거하고 고유한 항목만 JSON 파일에 저장해야 함', async () => {
    // 같은 모드 내에서 여러 localization 경로에 동일한 파일이 있는 경우를 시뮬레이션
    // 이런 경우 같은 mod::file::key 조합이 중복될 수 있음
    const { translate, TranslationRefusedError } = await import('../utils/translate')
    
    // 특정 키에서 번역 거부 발생하도록 모킹
    vi.mocked(translate).mockImplementation(async (text: string) => {
      if (text.startsWith('Test Item')) {
        throw new TranslationRefusedError(text, 'test refusal')
      }
      return `[KO]${text}`
    })

    const { processModTranslations } = await import('./translate')

    // ck3/ 하위 디렉토리 구조 모방
    const ck3Dir = join(testDir, 'ck3')
    const modDir = join(ck3Dir, 'dedup-test-mod')
    
    // 두 개의 localization 경로 생성 - 같은 파일명을 가진 파일을 넣음
    const upstreamPath1 = join(modDir, 'upstream', 'path1')
    const upstreamPath2 = join(modDir, 'upstream', 'path2')

    const metaContent = `
[upstream]
localization = ["path1", "path2"]
language = "english"
`

    // 두 경로 모두 같은 파일명과 키를 가진 파일 생성
    // 모든 항목이 번역 거부되도록 "Test Item"으로 시작하는 값 사용
    const sourceContent = `l_english:
  dup_key_1: "Test Item 1"
  dup_key_2: "Test Item 2"
`

    await mkdir(upstreamPath1, { recursive: true })
    await mkdir(upstreamPath2, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), metaContent, 'utf-8')
    
    // 같은 파일명으로 두 경로에 파일 생성
    await writeFile(join(upstreamPath1, 'shared_l_english.yml'), sourceContent, 'utf-8')
    await writeFile(join(upstreamPath2, 'shared_l_english.yml'), sourceContent, 'utf-8')

    // 번역 실행 - rootDir은 ck3Dir
    await processModTranslations({
      rootDir: ck3Dir,
      mods: ['dedup-test-mod'],
      gameType: 'ck3',
      onlyHash: false
    })

    // JSON 파일 확인 (projectRoot = testDir)
    const jsonPath = join(testDir, 'ck3-untranslated-items.json')
    expect(existsSync(jsonPath)).toBe(true)
    
    const jsonContent = JSON.parse(readFileSync(jsonPath, 'utf-8'))
    
    // 중복 제거 로직이 작동하여 같은 mod, file, key 조합은 한 번만 나타나야 함
    const keys = jsonContent.items.map((item: any) => `${item.mod}::${item.file}::${item.key}`)
    const uniqueKeys = new Set(keys)
    expect(keys.length).toBe(uniqueKeys.size)
    
    // 각 키는 두 경로에서 발생했지만 중복 제거되어 각각 1개씩만 있어야 함
    const key1Items = jsonContent.items.filter((item: any) => item.key === 'dup_key_1')
    expect(key1Items.length).toBe(1)
    
    const key2Items = jsonContent.items.filter((item: any) => item.key === 'dup_key_2')
    expect(key2Items.length).toBe(1)
    
    // 총 2개 항목만 있어야 함 (중복이 제거된 후)
    // 원래는 4개 (2개 경로 × 2개 키)이지만 중복 제거로 2개만 남음
    expect(jsonContent.items.length).toBe(2)

    // 정리
    await rm(testDir, { recursive: true, force: true })
  })
})

// 지정된 개수의 항목을 가진 YAML 파일을 생성하는 헬퍼 함수
function createLargeYamlFile(entryCount: number, language: string): string {
  let content = `l_${language}:\n`
  for (let i = 0; i < entryCount; i++) {
    content += `  test_key_${i}: "Test value ${i}"\n`
  }
  return content
}
