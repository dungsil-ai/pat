import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { log } from './utils/logger'
import { markVerifiedMod, updateVerifiedMarker } from './mark-verified-upstream'

describe('updateVerifiedMarker', () => {
  it('검증 마커가 없으면 BOM과 언어 헤더 다음에 추가해야 한다', () => {
    expect(updateVerifiedMarker('\uFEFFl_korean:\n key:0 "번역"\n', 'abc1234')).toBe(
      '\uFEFFl_korean:\n# PAT verified upstream: abc1234\n key:0 "번역"\n'
    )
  })

  it('언어 헤더 다음의 기존 검증 마커를 최신 리비전으로 교체해야 한다', () => {
    expect(updateVerifiedMarker(
      '\uFEFFl_korean:\n# PAT verified upstream: old1234\n key:0 "번역"\n',
      'new5678'
    )).toBe(
      '\uFEFFl_korean:\n# PAT verified upstream: new5678\n key:0 "번역"\n'
    )
  })

  it('같은 리비전의 레거시 마커도 BOM과 언어 헤더 다음으로 이동해야 한다', () => {
    expect(updateVerifiedMarker(
      '# PAT verified upstream: abc1234\n\uFEFFl_korean:\n key:0 "번역"\n',
      'abc1234'
    )).toBe(
      '\uFEFFl_korean:\n# PAT verified upstream: abc1234\n key:0 "번역"\n'
    )
  })

  it('정상 순서의 같은 리비전은 바이트 단위로 변경하지 않아야 한다', () => {
    const content = '\uFEFFl_korean:\r\n# PAT verified upstream: abc1234\r\n key:0 "번역"\r\n'
    expect(updateVerifiedMarker(content, 'abc1234')).toBe(content)
  })
})

const execFileAsync = promisify(execFile)

describe('검증 완료 업스트림 파일 기록', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'pat-mark-verified-'))
    vi.mocked(log.warn).mockClear()
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'win32')('대상 경로가 심볼릭 링크면 링크 대상을 수정하지 않아야 한다', async () => {
    const { targetPath } = await createVerifiedMod(rootDir)
    const victimPath = join(rootDir, 'victim.txt')
    await mkdir(join(targetPath, '..'), { recursive: true })
    await writeFile(victimPath, '원본 내용\n', 'utf-8')
    await symlink(victimPath, targetPath)

    await expect(markVerifiedMod(rootDir, 'ck3', 'TestMod', new Set())).resolves.toBe(0)
    await expect(readFile(victimPath, 'utf-8')).resolves.toBe('원본 내용\n')
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(expect.stringContaining('심볼릭 링크'))
  })

  it('중간 경로가 심볼릭 링크로 출력 루트를 벗어나면 대상 파일을 수정하지 않아야 한다', async () => {
    const { targetPath } = await createVerifiedMod(rootDir, 'nested/example_l_english.yml')
    const victimDir = join(rootDir, 'outside')
    const victimPath = join(victimDir, '___example_l_korean.yml')
    await mkdir(victimDir, { recursive: true })
    await mkdir(join(targetPath, '..', '..'), { recursive: true })
    await writeFile(victimPath, '원본 내용\n', 'utf-8')
    await symlink(victimDir, join(targetPath, '..'), 'junction')

    await expect(markVerifiedMod(rootDir, 'ck3', 'TestMod', new Set())).resolves.toBe(0)
    await expect(readFile(victimPath, 'utf-8')).resolves.toBe('원본 내용\n')
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(expect.stringContaining('심볼릭 링크'))
  })

  it('정규 파일에는 검증 마커를 기록하고 갱신 수에 포함해야 한다', async () => {
    const { targetPath } = await createVerifiedMod(rootDir)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, 'l_korean:\n key:0 "번역"\n', 'utf-8')

    await expect(markVerifiedMod(rootDir, 'ck3', 'TestMod', new Set())).resolves.toBe(1)
    await expect(readFile(targetPath, 'utf-8')).resolves.toMatch(
      /^l_korean:\n# PAT verified upstream: [0-9a-f]{7}\n key:0 "번역"\n$/
    )
  })

  it('대상 경로가 정규 파일이 아니면 갱신하지 않아야 한다', async () => {
    const { targetPath } = await createVerifiedMod(rootDir)
    await mkdir(targetPath, { recursive: true })

    await expect(markVerifiedMod(rootDir, 'ck3', 'TestMod', new Set())).resolves.toBe(0)
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(expect.stringContaining('일반 파일'))
  })

  it.skipIf(process.platform === 'win32')('계산된 대상 경로가 출력 루트 밖이면 갱신하지 않아야 한다', async () => {
    const { targetPath } = await createVerifiedMod(rootDir, '..\\..\\escaped_l_english.yml')
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, '원본 내용\n', 'utf-8')

    await expect(markVerifiedMod(rootDir, 'ck3', 'TestMod', new Set())).resolves.toBe(0)
    await expect(readFile(targetPath, 'utf-8')).resolves.toBe('원본 내용\n')
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(expect.stringContaining('출력 경로'))
  })
})

async function createVerifiedMod(rootDir: string, sourceFile = 'example_l_english.yml'): Promise<{ targetPath: string }> {
  const modDir = join(rootDir, 'ck3', 'TestMod')
  const upstreamRoot = join(modDir, 'upstream')
  const normalizedSourceFile = sourceFile.replace(/\\/g, '/')
  const sourceRelativePath = join('localization', 'english', normalizedSourceFile).replace(/\\/g, '/')
  const sourcePath = join(upstreamRoot, 'localization', 'english', sourceFile)
  const targetFileName = `___${basename(normalizedSourceFile).replace('_l_english.yml', '_l_korean.yml')}`
  const targetPath = join(modDir, 'mod', 'localization', 'korean', dirname(normalizedSourceFile), targetFileName)

  await mkdir(join(sourcePath, '..'), { recursive: true })
  await writeFile(join(modDir, 'meta.toml'), `
[upstream]
url = "https://example.com/mod.git"
localization = ["localization/english"]
language = "english"
`, 'utf-8')
  await writeFile(sourcePath, 'l_english:\n key:0 "Source"\n', 'utf-8')
  await writeFile(
    join(modDir, '.pat-file-hashes.json'),
    `${JSON.stringify({ [sourceRelativePath]: 'verified' }, null, 2)}\n`,
    'utf-8'
  )

  await execFileAsync('git', ['init', '--quiet'], { cwd: upstreamRoot })
  await execFileAsync('git', [
    '-c', 'user.email=test@example.com',
    '-c', 'user.name=PAT Test',
    '-c', 'commit.gpgsign=false',
    'commit', '--quiet', '--allow-empty', '--no-verify', '-m', '테스트 준비'
  ], { cwd: upstreamRoot })

  return { targetPath }
}
