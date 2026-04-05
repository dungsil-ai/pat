import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { invalidateIncorrectTranslations, getLocalizationFolderName } from './retranslation-invalidator'
import { getUpstreamFileHashesPath } from './upstream-file-hashes'
import { parseYaml } from '../parser'

vi.mock('./logger', () => ({
  log: {
    start: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

describe('retranslation-invalidator', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `retranslation-invalidator-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('getLocalizationFolderName', () => {
    it('CK3는 localization 폴더를 반환해야 함', () => {
      expect(getLocalizationFolderName('ck3')).toBe('localization')
    })

    it('VIC3는 localization 폴더를 반환해야 함', () => {
      expect(getLocalizationFolderName('vic3')).toBe('localization')
    })

    it('Stellaris는 localisation 폴더를 반환해야 함 (영국식 철자)', () => {
      expect(getLocalizationFolderName('stellaris')).toBe('localisation')
    })

    it('지원하지 않는 게임 타입에 대해 오류를 발생시켜야 함', () => {
      expect(() => getLocalizationFolderName('invalid' as never)).toThrow('Unsupported game type: invalid')
    })
  })

  it('번역 파일이 누락되면 upstream 파일 해시를 제거해야 함', async () => {
    const context = await createModFixture(testDir, {
      sourceEntries: {
        test_key: ['Hello world', null]
      },
      targetEntries: undefined,
      fileHashes: {
        'localization/english/test_l_english.yml': 'hash-1'
      }
    })

    await invalidateIncorrectTranslations('ck3', testDir, ['test-mod'])

    const hashes = await readHashFile(context.hashFilePath)
    expect(hashes).not.toHaveProperty('localization/english/test_l_english.yml')
  })

  it('한국어 파일에 누락 키가 있으면 upstream 파일 해시를 제거해야 함', async () => {
    const context = await createModFixture(testDir, {
      sourceEntries: {
        key1: ['Hello world', null],
        key2: ['Goodbye world', null]
      },
      targetEntries: {
        key1: ['안녕하세요 세계', 'hash-a']
      },
      fileHashes: {
        'localization/english/test_l_english.yml': 'hash-2'
      }
    })

    await invalidateIncorrectTranslations('ck3', testDir, ['test-mod'])

    const hashes = await readHashFile(context.hashFilePath)
    expect(hashes).not.toHaveProperty('localization/english/test_l_english.yml')
  })

  it('빈 번역 값이 있으면 upstream 파일 해시를 제거해야 함', async () => {
    const context = await createModFixture(testDir, {
      sourceEntries: {
        key1: ['Hello world', null],
        key2: ['', null]
      },
      targetEntries: {
        key1: ['', 'hash-a'],
        key2: ['', 'hash-b']
      },
      fileHashes: {
        'localization/english/test_l_english.yml': 'hash-3'
      }
    })

    await invalidateIncorrectTranslations('ck3', testDir, ['test-mod'])

    const hashes = await readHashFile(context.hashFilePath)
    const parsedTarget = parseYaml(await readFile(context.targetFilePath, 'utf-8'))
    expect(hashes).not.toHaveProperty('localization/english/test_l_english.yml')
    expect(parsedTarget.l_korean.key1).toEqual(['', null])
    expect(parsedTarget.l_korean.key2).toEqual(['', 'hash-b'])
  })

  it('잘못된 번역이 있으면 엔트리 해시를 비우고 upstream 파일 해시를 제거해야 함', async () => {
    const context = await createModFixture(testDir, {
      sourceEntries: {
        key1: ['Hello [GetTitle]', null],
        key2: ['Simple text', null]
      },
      targetEntries: {
        key1: ['안녕하세요', 'hash-a'],
        key2: ['간단한 텍스트', 'hash-b']
      },
      fileHashes: {
        'localization/english/test_l_english.yml': 'hash-4'
      }
    })

    await invalidateIncorrectTranslations('ck3', testDir, ['test-mod'])

    const hashes = await readHashFile(context.hashFilePath)
    const parsedTarget = parseYaml(await readFile(context.targetFilePath, 'utf-8'))
    expect(hashes).not.toHaveProperty('localization/english/test_l_english.yml')
    expect(parsedTarget.l_korean.key1).toEqual(['안녕하세요', null])
    expect(parsedTarget.l_korean.key2).toEqual(['간단한 텍스트', 'hash-b'])
  })

  it('정상 파일은 해시와 번역 파일을 그대로 유지해야 함', async () => {
    const context = await createModFixture(testDir, {
      sourceEntries: {
        key1: ['Hello world', null],
        key2: ['', null],
        key3: [' ', null]
      },
      targetEntries: {
        key1: ['안녕하세요 세계', 'hash-a'],
        key2: ['', 'hash-b'],
        key3: [' ', 'hash-c']
      },
      fileHashes: {
        'localization/english/test_l_english.yml': 'hash-5'
      }
    })

    const beforeContent = await readFile(context.targetFilePath, 'utf-8')

    await invalidateIncorrectTranslations('ck3', testDir, ['test-mod'])

    const hashes = await readHashFile(context.hashFilePath)
    const afterContent = await readFile(context.targetFilePath, 'utf-8')
    expect(hashes).toHaveProperty('localization/english/test_l_english.yml', 'hash-5')
    expect(afterContent).toBe(beforeContent)
  })

  it('원본도 빈 값인 항목은 재처리 대상으로 오탐하지 않아야 함', async () => {
    const context = await createModFixture(testDir, {
      sourceEntries: {
        key1: ['', null],
        key2: [' ', null]
      },
      targetEntries: {
        key1: ['', 'hash-a'],
        key2: [' ', 'hash-b']
      },
      fileHashes: {
        'localization/english/test_l_english.yml': 'hash-6'
      }
    })

    await invalidateIncorrectTranslations('ck3', testDir, ['test-mod'])

    const hashes = await readHashFile(context.hashFilePath)
    const parsedTarget = parseYaml(await readFile(context.targetFilePath, 'utf-8'))
    expect(hashes).toHaveProperty('localization/english/test_l_english.yml', 'hash-6')
    expect(parsedTarget.l_korean.key1).toEqual(['', 'hash-a'])
    expect(parsedTarget.l_korean.key2).toEqual([' ', 'hash-b'])
  })
})

interface FixtureOptions {
  sourceEntries: Record<string, [string, string | null]>
  targetEntries?: Record<string, [string, string | null]>
  fileHashes: Record<string, string>
}

interface FixtureContext {
  hashFilePath: string
  targetFilePath: string
}

async function createModFixture(rootDir: string, options: FixtureOptions): Promise<FixtureContext> {
  const modDir = join(rootDir, 'test-mod')
  const sourceDir = join(modDir, 'upstream', 'localization', 'english')
  const targetDir = join(modDir, 'mod', 'localization', 'korean')
  const sourceFilePath = join(sourceDir, 'test_l_english.yml')
  const targetFilePath = join(targetDir, '___test_l_korean.yml')
  const hashFilePath = getUpstreamFileHashesPath(modDir)

  await mkdir(sourceDir, { recursive: true })
  await mkdir(targetDir, { recursive: true })
  await writeFile(join(modDir, 'meta.toml'), '[upstream]\nlocalization = ["localization/english"]\nlanguage = "english"\n', 'utf-8')
  await writeFile(sourceFilePath, buildYaml('l_english', options.sourceEntries), 'utf-8')
  await writeFile(hashFilePath, `${JSON.stringify(options.fileHashes, null, 2)}\n`, 'utf-8')

  if (options.targetEntries) {
    await writeFile(targetFilePath, buildYaml('l_korean', options.targetEntries), 'utf-8')
  }

  return { hashFilePath, targetFilePath }
}

function buildYaml(languageKey: string, entries: Record<string, [string, string | null]>): string {
  const lines = [`${languageKey}:`]

  for (const [key, [value, hash]] of Object.entries(entries)) {
    const escaped = value.replace(/"/g, '""')
    const comment = hash == null ? '' : ` # ${hash}`
    lines.push(`  ${key}: "${escaped}"${comment}`)
  }

  return `${lines.join('\n')}\n`
}

async function readHashFile(hashFilePath: string): Promise<Record<string, string>> {
  return JSON.parse(await readFile(hashFilePath, 'utf-8')) as Record<string, string>
}
