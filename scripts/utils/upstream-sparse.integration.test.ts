import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { configureSparseCheckout } from './upstream'

const execFileAsync = promisify(execFile)

describe('실제 git sparse checkout', () => {
  let repositoryPath: string

  beforeEach(async () => {
    repositoryPath = await mkdtemp(join(tmpdir(), 'pat-sparse-checkout-'))
    await execFileAsync('git', ['init', '--quiet'], { cwd: repositoryPath })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repositoryPath })
    await execFileAsync('git', ['config', 'user.name', 'PAT Test'], { cwd: repositoryPath })

    for (const directory of ['#hash', '!bang', '[bracket]', 'other']) {
      const targetDir = join(repositoryPath, directory, 'localization', 'english')
      await mkdir(targetDir, { recursive: true })
      await writeFile(join(targetDir, 'test.yml'), directory, 'utf-8')
    }

    await execFileAsync('git', ['add', '.'], { cwd: repositoryPath })
    await execFileAsync('git', ['commit', '--quiet', '-m', '테스트 준비'], { cwd: repositoryPath })
  })

  afterEach(async () => {
    await rm(repositoryPath, { recursive: true, force: true })
  })

  it('gitignore 메타문자가 있는 디렉터리를 literal 경로로 선택해야 함', async () => {
    await configureSparseCheckout(repositoryPath, {
      url: 'https://example.com/repo.git',
      path: 'test/upstream',
      localizationPaths: [
        '#hash/localization/english',
        '!bang/localization/english',
        '[bracket]/localization/english'
      ],
      versionStrategy: 'default'
    })

    await expect(access(join(repositoryPath, '#hash', 'localization', 'english', 'test.yml')))
      .resolves.toBeUndefined()
    await expect(access(join(repositoryPath, '!bang', 'localization', 'english', 'test.yml')))
      .resolves.toBeUndefined()
    await expect(access(join(repositoryPath, '[bracket]', 'localization', 'english', 'test.yml')))
      .resolves.toBeUndefined()
    await expect(access(join(repositoryPath, 'other', 'localization', 'english', 'test.yml')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})
