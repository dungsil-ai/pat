import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { findUpstreamSourceFile } from './add-dict-from-commit'

describe('딕셔너리 원본 파일 탐색', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'pat-add-dict-'))
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  it('같은 파일명을 가진 컴포넌트를 output_subdir로 구분해야 함', async () => {
    const modDir = join(rootDir, 'vic3', 'Bundle')
    const firstSource = join(modDir, 'upstream', 'First', 'localization', 'english', 'shared_l_english.yml')
    const secondSource = join(modDir, 'upstream', 'Second', 'localization', 'english', 'shared_l_english.yml')
    await mkdir(join(firstSource, '..'), { recursive: true })
    await mkdir(join(secondSource, '..'), { recursive: true })
    await writeFile(firstSource, 'l_english:\n key: "First"\n', 'utf-8')
    await writeFile(secondSource, 'l_english:\n key: "Second"\n', 'utf-8')
    await writeFile(join(modDir, 'meta.toml'), `
[upstream]
language = "english"

[[upstream.components]]
id = "first"
localization = ["First/localization/english"]
output_subdir = "first"

[[upstream.components]]
id = "second"
localization = ["Second/localization/english"]
output_subdir = "second"
`, 'utf-8')

    await expect(findUpstreamSourceFile(
      'vic3/Bundle/mod/localization/korean/second/___shared_l_korean.yml',
      'vic3',
      rootDir
    )).resolves.toBe(secondSource)
  })

  it('replace 출력 경로를 replace 현지화 원본에만 연결해야 함', async () => {
    const modDir = join(rootDir, 'vic3', 'Bundle')
    const normalSource = join(modDir, 'upstream', 'Mod', 'localization', 'english', 'shared_l_english.yml')
    const replaceSource = join(modDir, 'upstream', 'Mod', 'localization', 'replace', 'english', 'shared_l_english.yml')
    await mkdir(join(normalSource, '..'), { recursive: true })
    await mkdir(join(replaceSource, '..'), { recursive: true })
    await writeFile(normalSource, 'l_english:\n key: "Normal"\n', 'utf-8')
    await writeFile(replaceSource, 'l_english:\n key: "Replace"\n', 'utf-8')
    await writeFile(join(modDir, 'meta.toml'), `
[upstream]
language = "english"

[[upstream.components]]
id = "sample"
localization = [
  "Mod/localization/english",
  "Mod/localization/replace/english"
]
output_subdir = "sample"
`, 'utf-8')

    await expect(findUpstreamSourceFile(
      'vic3/Bundle/mod/localization/korean/replace/sample/___shared_l_korean.yml',
      'vic3',
      rootDir
    )).resolves.toBe(replaceSource)
  })

  it('일반 현지화 경로 아래의 중첩 replace 원본을 찾아야 함', async () => {
    const modDir = join(rootDir, 'vic3', 'Grey')
    const nestedReplaceSource = join(
      modDir,
      'upstream',
      'Urban Synergy Unleashed',
      'localization',
      'english',
      'replace',
      'USU_replace_l_english.yml'
    )
    await mkdir(join(nestedReplaceSource, '..'), { recursive: true })
    await writeFile(nestedReplaceSource, 'l_english:\n key: "Replace"\n', 'utf-8')
    await writeFile(join(modDir, 'meta.toml'), `
[upstream]
language = "english"

[[upstream.components]]
id = "usu"
localization = ["Urban Synergy Unleashed/localization/english"]
`, 'utf-8')

    await expect(findUpstreamSourceFile(
      'vic3/Grey/mod/localization/korean/replace/___USU_replace_l_korean.yml',
      'vic3',
      rootDir
    )).resolves.toBe(nestedReplaceSource)
  })
})
