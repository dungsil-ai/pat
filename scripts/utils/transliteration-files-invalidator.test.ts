import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { parseYaml } from '../parser'
import { invalidateTransliterationFilesChanges } from './transliteration-files-invalidator'
import { getChangedTransliterationFiles } from './transliteration-files-changes'

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

vi.mock('./transliteration-files-changes', () => ({
  getChangedTransliterationFiles: vi.fn()
}))

describe('음역 파일 설정 변경 무효화', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'pat-transliteration-invalidator-'))
    vi.mocked(getChangedTransliterationFiles).mockResolvedValue([{
      modPath: 'ck3/Test',
      addedFiles: ['names_l_english.yml'],
      removedFiles: []
    }])
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('컴포넌트의 replace output_subdir 번역 파일을 찾아 해시를 비워야 함', async () => {
    const modDir = join(rootDir, 'Test')
    const targetDir = join(modDir, 'mod', 'localization', 'korean', 'replace', 'sample')
    const targetPath = join(targetDir, '___names_l_korean.yml')
    await mkdir(targetDir, { recursive: true })
    await writeFile(join(modDir, 'meta.toml'), `
[upstream]
language = "english"

[[upstream.components]]
id = "sample"
localization = ["Mod/localization/replace/english"]
output_subdir = "sample"
`, 'utf-8')
    await writeFile(targetPath, `l_korean:
  sample_name: "샘플" # source-hash
`, 'utf-8')

    await invalidateTransliterationFilesChanges('ck3', rootDir, 'HEAD')

    const parsed = parseYaml(await readFile(targetPath, 'utf-8'))
    expect(parsed.l_korean.sample_name).toEqual(['샘플', null])
  })
})
