import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { access, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'pathe'
import { tmpdir } from 'node:os'
import { exec } from 'node:child_process'

let fetchMock: ReturnType<typeof vi.fn>
let execAsyncHandler: (command: string) => Promise<{ stdout: string, stderr: string }>
let execFileAsyncHandler: (file: string, args?: readonly string[]) => Promise<{ stdout: string, stderr: string }>

vi.mock('node:child_process', () => ({
  exec: Object.assign(
    vi.fn((command: string, options: unknown, callback?: (error: Error | null, stdout: string, stderr: string) => void) => {
      const cb = typeof options === 'function' ? options : callback
      if (!cb) return {} as never

      execAsyncHandler(command)
        .then(({ stdout, stderr }) => cb(null, stdout, stderr))
        .catch((error) => cb(error as Error, '', ''))
      return {} as never
    }),
    {
      [Symbol.for('nodejs.util.promisify.custom')]: (command: string) => execAsyncHandler(command)
    }
  ),
  execFile: Object.assign(
    vi.fn((
      file: string,
      argsOrOptions: unknown,
      optionsOrCallback?: unknown,
      maybeCallback?: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      const args = Array.isArray(argsOrOptions) ? argsOrOptions : []
      const cb = typeof optionsOrCallback === 'function'
        ? optionsOrCallback
        : typeof maybeCallback === 'function'
          ? maybeCallback
          : null

      if (!cb) return {} as never

      execFileAsyncHandler(file, args)
        .then(({ stdout, stderr }) => cb(null, stdout, stderr))
        .catch((error) => cb(error as Error, '', ''))
      return {} as never
    }),
    {
      [Symbol.for('nodejs.util.promisify.custom')]: (file: string, args?: readonly string[]) => execFileAsyncHandler(file, args)
    }
  )
}))

// 의존성 모킹
vi.mock('./logger', () => ({
  log: {
    start: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    box: vi.fn()
  }
}))

describe('upstream 유틸리티', () => {
  let testDir: string

  beforeEach(async () => {
    vi.resetModules()

    // 테스트를 위한 임시 디렉토리 생성
    testDir = join(tmpdir(), `upstream-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })

    fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({})
    }))
    vi.stubGlobal('fetch', fetchMock)
    execAsyncHandler = async () => ({ stdout: '', stderr: '' })
    execFileAsyncHandler = async () => ({ stdout: '', stderr: '' })
    vi.mocked(exec).mockClear()
  })

  afterEach(async () => {
    // 정리
    vi.restoreAllMocks()
    vi.useRealTimers()
    try {
      await rm(testDir, { recursive: true, force: true })
    } catch (error) {
      // 정리 오류 무시
    }
  })

  describe('parseGitHubUrl', () => {
    it('GitHub URL에서 owner/repo를 올바르게 추출해야 함', async () => {
      const { parseGitHubUrl } = await import('./upstream')

      // HTTPS URL with .git suffix
      expect(parseGitHubUrl('https://github.com/cybrxkhan/RICE-for-CK3.git')).toEqual({
        owner: 'cybrxkhan',
        repo: 'RICE-for-CK3'
      })

      // HTTPS URL without .git suffix
      expect(parseGitHubUrl('https://github.com/cybrxkhan/VIET-Events-for-CK3')).toEqual({
        owner: 'cybrxkhan',
        repo: 'VIET-Events-for-CK3'
      })

      // SSH URL
      expect(parseGitHubUrl('git@github.com:cybrxkhan/RICE-for-CK3.git')).toEqual({
        owner: 'cybrxkhan',
        repo: 'RICE-for-CK3'
      })

      // Non-GitHub URLs should return null
      expect(parseGitHubUrl('https://gitlab.com/owner/repo.git')).toBeNull()
      expect(parseGitHubUrl('https://bitbucket.org/owner/repo.git')).toBeNull()
    })
  })

  describe('parseUpstreamConfigs', () => {
    it('특정 게임 타입만 필터링해야 함', async () => {
      // 테스트용 디렉토리 구조 생성
      const ck3Dir = join(testDir, 'ck3', 'TestMod')
      const vic3Dir = join(testDir, 'vic3', 'TestMod')
      await mkdir(ck3Dir, { recursive: true })
      await mkdir(vic3Dir, { recursive: true })

      // meta.toml 파일 생성
      const ck3MetaContent = `
[upstream]
url = "https://github.com/test/test.git"
localization = ["localization/english"]
language = "english"
`
      const vic3MetaContent = `
[upstream]
url = "https://github.com/test/test2.git"
localization = ["localization/english"]
language = "english"
`
      await writeFile(join(ck3Dir, 'meta.toml'), ck3MetaContent)
      await writeFile(join(vic3Dir, 'meta.toml'), vic3MetaContent)

      const { parseUpstreamConfigs } = await import('./upstream')

      // CK3만 필터링
      const ck3Configs = await parseUpstreamConfigs(testDir, 'ck3')
      expect(ck3Configs.length).toBe(1)
      expect(ck3Configs[0].path).toContain('ck3')

      // VIC3만 필터링
      const vic3Configs = await parseUpstreamConfigs(testDir, 'vic3')
      expect(vic3Configs.length).toBe(1)
      expect(vic3Configs[0].path).toContain('vic3')

      // 모든 게임
      const allConfigs = await parseUpstreamConfigs(testDir)
      expect(allConfigs.length).toBe(2)
    })

    it('특정 모드만 필터링해야 함', async () => {
      // 테스트용 디렉토리 구조 생성
      const mod1Dir = join(testDir, 'ck3', 'Mod1')
      const mod2Dir = join(testDir, 'ck3', 'Mod2')
      await mkdir(mod1Dir, { recursive: true })
      await mkdir(mod2Dir, { recursive: true })

      // meta.toml 파일 생성
      const metaContent = `
[upstream]
url = "https://github.com/test/test.git"
localization = ["localization/english"]
language = "english"
`
      await writeFile(join(mod1Dir, 'meta.toml'), metaContent)
      await writeFile(join(mod2Dir, 'meta.toml'), metaContent)

      const { parseUpstreamConfigs } = await import('./upstream')

      // Mod1만 필터링
      const mod1Configs = await parseUpstreamConfigs(testDir, undefined, 'Mod1')
      expect(mod1Configs.length).toBe(1)
      expect(mod1Configs[0].path).toContain('Mod1')

      // Mod2만 필터링
      const mod2Configs = await parseUpstreamConfigs(testDir, undefined, 'Mod2')
      expect(mod2Configs.length).toBe(1)
      expect(mod2Configs[0].path).toContain('Mod2')

      // 모든 모드
      const allConfigs = await parseUpstreamConfigs(testDir)
      expect(allConfigs.length).toBe(2)
    })

    it('여러 컴포넌트의 현지화 경로를 하나의 sparse checkout 설정으로 합쳐야 함', async () => {
      const modDir = join(testDir, 'vic3', 'ModPack')
      await mkdir(modDir, { recursive: true })
      await writeFile(join(modDir, 'meta.toml'), `
[upstream]
url = "https://github.com/test/mod-pack.git"
language = "english"
version_strategy = "default"

[[upstream.components]]
id = "first"
localization = ["First Mod/localization/english"]
version_strategy = "natural"
tag_pattern = '^FIRST-v'

[[upstream.components]]
id = "second"
name = "두 번째 모드"
localization = ["Second Mod/localization/english"]
version_strategy = "natural"
tag_pattern = '^SECOND-v'
`)

      const { parseUpstreamConfigs } = await import('./upstream')
      const [config] = await parseUpstreamConfigs(testDir, 'vic3', 'ModPack')

      expect(config.localizationPaths).toEqual([
        'First Mod/localization/english',
        'Second Mod/localization/english'
      ])
      expect(config.versionStrategy).toBe('default')
      expect(config.components).toEqual([
        expect.objectContaining({
          id: 'first',
          tagPattern: '^FIRST-v',
          versionStrategy: 'natural',
          implicit: false
        }),
        expect.objectContaining({
          id: 'second',
          name: '두 번째 모드',
          tagPattern: '^SECOND-v',
          versionStrategy: 'natural',
          implicit: false
        })
      ])
    })
  })

  describe('기존 저장소 업데이트', () => {
    it('로컬 변경사항이 있으면 기존 저장소를 지우고 재클론해야 함', async () => {
      const execFileCommands: string[] = []
      const repoPath = join(testDir, 'ck3/TestMod/upstream')
      await mkdir(join(repoPath, '.git'), { recursive: true })

      execFileAsyncHandler = async (_file: string, args: readonly string[] = []) => {
        execFileCommands.push([_file, ...args].join(' '))

        if (args[0] === 'status' && args[1] === '--porcelain') {
          return { stdout: ' M localization/english/test.yml\n', stderr: '' }
        }

        if (args[0] === 'ls-remote' && args[1] === '--tags') {
          return { stdout: '', stderr: '' }
        }

        if (args[0] === 'ls-remote' && args[1] === '--symref') {
          return { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' }
        }

        if (args[0] === 'describe' && args.includes('--exact-match')) {
          throw new Error('fatal: no tag exactly matches')
        }

        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
          return { stdout: 'develop\n', stderr: '' }
        }

        if (args[0] === 'clone') {
          await mkdir(join(repoPath, '.git', 'info'), { recursive: true })
        }

        return { stdout: '', stderr: '' }
      }

      const { updateUpstreamOptimized } = await import('./upstream')
      await updateUpstreamOptimized({
        url: 'https://github.com/test/repo.git',
        path: 'ck3/TestMod/upstream',
        localizationPaths: ['repo/localization/english'],
        versionStrategy: 'default'
      }, testDir)

      expect(execFileCommands.some(command => command.startsWith('git clone '))).toBe(true)
      expect(execFileCommands).toContain('git checkout HEAD')
      expect(execFileCommands.some(command => command.startsWith('git fetch --tags'))).toBe(false)
    })

    it('릴리스 조회 제한이면 로컬 변경이 있는 기존 체크아웃을 보존해야 함', async () => {
      const execFileCommands: string[] = []
      const repoPath = join(testDir, 'ck3/TestMod/upstream')
      const markerPath = join(repoPath, 'last-good.txt')
      await mkdir(join(repoPath, '.git'), { recursive: true })
      await writeFile(markerPath, '마지막 정상 체크아웃')

      execFileAsyncHandler = async (_file: string, args: readonly string[] = []) => {
        execFileCommands.push([_file, ...args].join(' '))
        if (args[0] === 'status' && args[1] === '--porcelain') {
          return { stdout: ' M localization/english/test.yml\n', stderr: '' }
        }
        return { stdout: '', stderr: '' }
      }
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => Array.from({ length: 100 }, (_, index) => ({
          tag_name: `v${index + 1}.0.0`
        }))
      })

      // resetModules 뒤 child_process와 fetch 모킹을 적용하려고 동적으로 불러옵니다.
      const { updateUpstreamOptimized } = await import('./upstream')
      await expect(updateUpstreamOptimized({
        url: 'https://github.com/test/repo.git',
        path: 'ck3/TestMod/upstream',
        localizationPaths: ['repo/localization/english'],
        versionStrategy: 'semantic'
      }, testDir)).rejects.toThrow(/test\/repo.*5페이지.*500건/)

      expect(await readFile(markerPath, 'utf-8')).toBe('마지막 정상 체크아웃')
      expect(fetchMock).toHaveBeenCalledTimes(5)
      expect(execFileCommands.some(command => command.startsWith('git clone '))).toBe(false)
    })

    it('동일한 참조명이면서 커밋도 동일하면 업데이트를 건너뛰어야 함', async () => {
      const execFileCommands: string[] = []
      const repoPath = join(testDir, 'ck3/TestMod/upstream')
      await mkdir(join(repoPath, '.git'), { recursive: true })

      execFileAsyncHandler = async (_file: string, args: readonly string[] = []) => {
        execFileCommands.push([_file, ...args].join(' '))

        if (args[0] === 'status' && args[1] === '--porcelain') {
          return { stdout: '', stderr: '' }
        }

        if (args[0] === 'ls-remote' && args[1] === '--tags') {
          return { stdout: 'tagobjhash\trefs/tags/v1.0.0\n', stderr: '' }
        }

        if (args[0] === 'ls-remote') {
          return { stdout: 'commit123\trefs/tags/v1.0.0^{}\ntagobjhash\trefs/tags/v1.0.0\n', stderr: '' }
        }

        if (args[0] === 'describe' && args.includes('--exact-match')) {
          return { stdout: 'v1.0.0\n', stderr: '' }
        }

        if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return { stdout: 'commit123\n', stderr: '' }
        }

        return { stdout: '', stderr: '' }
      }

      const { updateUpstreamOptimized } = await import('./upstream')
      await updateUpstreamOptimized({
        url: 'https://github.com/test/repo.git',
        path: 'ck3/TestMod/upstream',
        localizationPaths: ['repo/localization/english'],
        versionStrategy: 'natural'
      }, testDir)

      expect(execFileCommands.some(command => command.includes('refs/tags/v1.0.0^{}'))).toBe(true)
      expect(execFileCommands.some(command => command.startsWith('git fetch'))).toBe(false)
      expect(execFileCommands.some(command => command.startsWith('git checkout'))).toBe(false)
    })

    it('동일한 참조명이어도 커밋이 다르면 업데이트를 진행해야 함', async () => {
      const execFileCommands: string[] = []
      const repoPath = join(testDir, 'ck3/TestMod/upstream')
      await mkdir(join(repoPath, '.git'), { recursive: true })

      execFileAsyncHandler = async (_file: string, args: readonly string[] = []) => {
        execFileCommands.push([_file, ...args].join(' '))

        if (args[0] === 'status' && args[1] === '--porcelain') {
          return { stdout: '', stderr: '' }
        }

        if (args[0] === 'ls-remote' && args[1] === '--tags') {
          return { stdout: 'newtaghash\trefs/tags/v1.0.0\n', stderr: '' }
        }

        if (args[0] === 'ls-remote') {
          return { stdout: 'newcommit\trefs/tags/v1.0.0^{}\ntagobjhash\trefs/tags/v1.0.0\n', stderr: '' }
        }

        if (args[0] === 'describe' && args.includes('--exact-match')) {
          return { stdout: 'v1.0.0\n', stderr: '' }
        }

        if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return { stdout: 'oldcommit\n', stderr: '' }
        }

        return { stdout: '', stderr: '' }
      }

      const { updateUpstreamOptimized } = await import('./upstream')
      await updateUpstreamOptimized({
        url: 'https://github.com/test/repo.git',
        path: 'ck3/TestMod/upstream',
        localizationPaths: ['repo/localization/english'],
        versionStrategy: 'natural'
      }, testDir)

      expect(execFileCommands.some(command => command.includes('refs/tags/v1.0.0^{}'))).toBe(true)
      expect(execFileCommands).toContain('git fetch --tags')
      expect(execFileCommands.some(command => command === 'git checkout v1.0.0')).toBe(true)
    })

    it('설정에서 바뀐 컴포넌트 경로를 기존 sparse checkout에도 반영해야 함', async () => {
      const execFileCommands: string[] = []
      const repoPath = join(testDir, 'ck3/TestMod/upstream')
      await mkdir(join(repoPath, '.git'), { recursive: true })

      execFileAsyncHandler = async (_file: string, args: readonly string[] = []) => {
        execFileCommands.push([_file, ...args].join(' '))

        if (args[0] === 'status' && args[1] === '--porcelain') {
          return { stdout: '', stderr: '' }
        }

        if (args[0] === 'ls-remote' && args[1] === '--symref') {
          return { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' }
        }

        if (args[0] === 'describe' && args.includes('--exact-match')) {
          throw new Error('fatal: no tag exactly matches')
        }

        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
          return { stdout: 'main\n', stderr: '' }
        }

        if (args[0] === 'ls-remote') {
          return { stdout: 'commit123\trefs/heads/main\n', stderr: '' }
        }

        if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return { stdout: 'commit123\n', stderr: '' }
        }

        return { stdout: '', stderr: '' }
      }

      const { updateUpstreamOptimized } = await import('./upstream')
      await updateUpstreamOptimized({
        url: 'https://github.com/test/repo.git',
        path: 'ck3/TestMod/upstream',
        localizationPaths: [
          'First Mod/localization/english',
          'Second Mod/localization/english',
          'First Mod/localization/english'
        ],
        versionStrategy: 'default'
      }, testDir)

      expect(execFileCommands).toContain('git sparse-checkout init --cone')
      expect(execFileCommands).toContain(
        'git sparse-checkout set --cone --skip-checks -- First Mod/localization/english Second Mod/localization/english'
      )
      expect(execFileCommands.some(command => command.startsWith('git fetch'))).toBe(false)
    })
  })

  describe('태그 clone/fetch 폴백', () => {
    it('태그 clone 실패 시 실패한 디렉토리를 정리한 뒤 기본 브랜치 clone으로 폴백해야 함', async () => {
      const execFileCommands: string[] = []
      const repoPath = join(testDir, 'ck3/TestMod/upstream')
      execFileAsyncHandler = async (_file: string, args: readonly string[] = []) => {
        execFileCommands.push([_file, ...args].join(' '))

        if (args[0] === 'ls-remote' && args[1] === '--tags') {
          return { stdout: 'abc123\trefs/tags/v1.0.0\n', stderr: '' }
        }

        if (args[0] === 'ls-remote' && args[1] === '--symref') {
          return { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' }
        }

        if (args[0] === 'clone' && args.includes('--branch') && args.includes('v1.0.0')) {
          throw new Error('Remote branch v1.0.0 not found in upstream origin')
        }

        if (args[0] === 'clone') {
          await mkdir(join(repoPath, '.git', 'info'), { recursive: true })
        }

        return { stdout: '', stderr: '' }
      }

      const { updateUpstreamOptimized } = await import('./upstream')

      await updateUpstreamOptimized({
        url: 'https://github.com/test/repo.git',
        path: 'ck3/TestMod/upstream',
        localizationPaths: ['repo/localization/english'],
        versionStrategy: 'natural'
      }, testDir)

      const tagCloneIndex = execFileCommands.findIndex(command => command.includes('git clone') && command.includes('--branch v1.0.0'))
      const fallbackCloneIndex = execFileCommands.findIndex(command => command === `git clone --filter=blob:none --depth=1 --no-checkout https://github.com/test/repo.git ${repoPath}`)

      expect(tagCloneIndex).toBeGreaterThanOrEqual(0)
      expect(fallbackCloneIndex).toBeGreaterThan(tagCloneIndex)
    })

    it('shallow 저장소에서 태그 fetch가 ref-not-found면 기본 브랜치 fetch로 폴백해야 함', async () => {
      const execFileCommands: string[] = []
      execFileAsyncHandler = async (_file: string, args: readonly string[] = []) => {
        execFileCommands.push([_file, ...args].join(' '))

        if (args[0] === 'status' && args[1] === '--porcelain') {
          return { stdout: '', stderr: '' }
        }

        if (args[0] === 'ls-remote' && args[1] === '--tags') {
          return { stdout: 'abc123\trefs/tags/v2.0.0\n', stderr: '' }
        }

        if (args[0] === 'ls-remote' && args[1] === '--symref') {
          return { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' }
        }

        if (args[0] === 'describe' && args.includes('--exact-match')) {
          throw new Error('fatal: no tag exactly matches')
        }

        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
          return { stdout: 'main\n', stderr: '' }
        }

        if (args[0] === 'fetch' && args.includes('tag') && args.includes('v2.0.0')) {
          throw new Error('Remote branch v2.0.0 not found in upstream origin')
        }

        return { stdout: '', stderr: '' }
      }

      const repoPath = join(testDir, 'ck3/TestMod/upstream')
      await mkdir(join(repoPath, '.git'), { recursive: true })
      await writeFile(join(repoPath, '.git', 'shallow'), 'shallow')

      const { updateUpstreamOptimized } = await import('./upstream')
      await updateUpstreamOptimized({
        url: 'https://github.com/test/repo.git',
        path: 'ck3/TestMod/upstream',
        localizationPaths: ['repo/localization/english'],
        versionStrategy: 'natural'
      }, testDir)

      expect(execFileCommands).toContain('git fetch --depth=1 origin tag v2.0.0')
      expect(execFileCommands).toContain('git fetch --depth=1 origin main')
      expect(execFileCommands).toContain('git checkout main')
      expect(execFileCommands).toContain('git reset --hard origin/main')
    })
  })

  describe('한국어 upstream sparse checkout', () => {
    it('localization 경로에 korean이 있으면 sparse checkout 대상으로 그대로 포함해야 함', async () => {
      const repoPath = join(testDir, 'ck3/TestMod/upstream')
      const execFileCommands: string[] = []

      execFileAsyncHandler = async (_file: string, args: readonly string[] = []) => {
        execFileCommands.push([_file, ...args].join(' '))

        if (args[0] === 'ls-remote' && args[1] === '--tags') {
          return { stdout: '', stderr: '' }
        }

        if (args[0] === 'ls-remote' && args[1] === '--symref') {
          return { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' }
        }

        if (args[0] === 'clone') {
          await mkdir(join(repoPath, '.git', 'info'), { recursive: true })
          await mkdir(join(repoPath, 'localization', 'korean'), { recursive: true })
          await writeFile(join(repoPath, 'localization', 'korean', '___test_l_korean.yml'), 'l_korean:\n test:0 "테스트"\n')
        }

        return { stdout: '', stderr: '' }
      }

      const { updateUpstreamOptimized } = await import('./upstream')
      await updateUpstreamOptimized({
        url: 'https://github.com/test/repo.git',
        path: 'ck3/TestMod/upstream',
        localizationPaths: ['localization/korean'],
        versionStrategy: 'default'
      }, testDir)

      expect(execFileCommands).toContain('git sparse-checkout set --cone --skip-checks -- localization/korean')
      expect(await readFile(join(repoPath, 'localization', 'korean', '___test_l_korean.yml'), 'utf-8')).toContain('테스트')
      await access(join(repoPath, 'localization', 'korean', '___test_l_korean.yml'))
    })
  })

  describe('전체 저장소 업데이트', () => {
    it('한 저장소가 조회 제한에 걸려도 새 체크아웃만 건너뛰고 다른 저장소를 완료해야 함', async () => {
      const failedModPath = join(testDir, 'ck3', 'FailedMod')
      const healthyModPath = join(testDir, 'ck3', 'HealthyMod')
      const healthyRepoPath = join(healthyModPath, 'upstream')
      const execFileCommands: string[] = []
      await mkdir(failedModPath, { recursive: true })
      await mkdir(join(healthyRepoPath, '.git'), { recursive: true })
      await writeFile(join(failedModPath, 'meta.toml'), `
[upstream]
url = "https://github.com/test/failed.git"
localization = ["localization/english"]
language = "english"
version_strategy = "semantic"
`)
      await writeFile(join(healthyModPath, 'meta.toml'), `
[upstream]
url = "https://github.com/test/healthy.git"
localization = ["localization/english"]
language = "english"
version_strategy = "default"
`)

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => Array.from({ length: 100 }, (_, index) => ({
          tag_name: `v${index + 1}.0.0`
        }))
      })
      execFileAsyncHandler = async (_file: string, args: readonly string[] = []) => {
        execFileCommands.push([_file, ...args].join(' '))
        if (args[0] === 'status' && args[1] === '--porcelain') {
          return { stdout: '', stderr: '' }
        }
        if (args[0] === 'ls-remote' && args[1] === '--symref') {
          return { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' }
        }
        if (args[0] === 'describe' && args.includes('--exact-match')) {
          throw new Error('fatal: no tag exactly matches')
        }
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
          return { stdout: 'main\n', stderr: '' }
        }
        if (args[0] === 'ls-remote' && args.includes('refs/heads/main')) {
          return { stdout: 'commit123\trefs/heads/main\n', stderr: '' }
        }
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return { stdout: 'commit123\n', stderr: '' }
        }
        return { stdout: '', stderr: '' }
      }

      // resetModules 뒤 파일 시스템·네트워크 모킹을 적용하려고 동적으로 불러옵니다.
      const { updateAllUpstreams } = await import('./upstream')
      const { log } = await import('./logger')
      vi.mocked(log.warn).mockClear()

      await expect(updateAllUpstreams(testDir, 'ck3')).resolves.toBeUndefined()
      expect(execFileCommands).toContain('git ls-remote --symref https://github.com/test/healthy.git HEAD')
      await expect(access(join(failedModPath, 'upstream'))).rejects.toBeDefined()
      expect(vi.mocked(log.warn)).toHaveBeenCalledWith(expect.stringMatching(
        /ck3\/FailedMod\/upstream.*이 모드만 건너뜁니다.*5페이지.*500건/
      ))
    })
  })

  describe('getLatestRefFromRemote', () => {
    it('semantic 전략에서 1.18.1.b 같은 확장 태그를 최신 버전으로 선택해야 함', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ([
          { tag_name: '1.18.1.b' },
          { tag_name: '1.18.1.a' },
          { tag_name: '1.18.1' },
          { tag_name: '1.8.3' }
        ])
      })

      const { getLatestRefFromRemote } = await import('./upstream')
      const latestRef = await getLatestRefFromRemote(
        'https://github.com/cybrxkhan/RICE-for-CK3.git',
        'ck3/RICE/upstream',
        'semantic'
      )

      expect(latestRef).toEqual({
        type: 'tag',
        name: '1.18.1.b'
      })
    })

    it('semantic 전략에서 v 접두사가 있는 태그도 원본 이름으로 반환해야 함', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ([
          { tag_name: 'v1.9.1' },
          { tag_name: 'v1.10.0' }
        ])
      })

      const { getLatestRefFromRemote } = await import('./upstream')
      const latestRef = await getLatestRefFromRemote(
        'https://github.com/test/test.git',
        'ck3/Test/upstream',
        'semantic'
      )

      expect(latestRef).toEqual({
        type: 'tag',
        name: 'v1.10.0'
      })
    })

    it('semantic 전략에서 컴포넌트 프리릴리즈를 안정 버전으로 승격하지 않아야 함', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ([
          { tag_name: 'SEA-v2.0.0-beta' },
          { tag_name: 'SEA-v1.9.0' },
          { tag_name: 'SPA-v3.0.0' }
        ])
      })

      const { getLatestRefFromRemote } = await import('./upstream')
      await expect(getLatestRefFromRemote(
        'https://github.com/test/test.git',
        'vic3/Test/upstream',
        'semantic',
        '^SEA-v'
      )).resolves.toEqual({
        type: 'tag',
        name: 'SEA-v1.9.0'
      })
    })

    it('semantic 전략은 5페이지가 가득 차면 불완전한 후보를 사용하지 않아야 함', async () => {
      const fullPage = Array.from({ length: 100 }, (_, index) => ({
        tag_name: `v${index + 1}.0.0`
      }))

      for (let page = 0; page < 5; page++) {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => fullPage
        })
      }
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => []
      })

      const { getLatestRefFromRemote } = await import('./upstream')
      await expect(getLatestRefFromRemote(
        'https://github.com/test/test.git',
        'ck3/Test/upstream',
        'semantic'
      )).rejects.toThrow(/test\/test.*5페이지.*500건/)
      expect(fetchMock).toHaveBeenCalledTimes(5)
    })

    it('github 전략에서 Releases 최신 태그를 반환해야 함', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ tag_name: 'release-2.0.0' })
      })

      const { getLatestRefFromRemote } = await import('./upstream')
      const latestRef = await getLatestRefFromRemote(
        'https://github.com/test/test.git',
        'ck3/Test/upstream',
        'github'
      )

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/test/test/releases/latest',
        expect.anything()
      )
      expect(latestRef).toEqual({
        type: 'tag',
        name: 'release-2.0.0'
      })
    })

    it('GitHub Releases 요청은 10초 후 저장소를 식별하는 타임아웃 오류로 중단되어야 함', async () => {
      vi.useFakeTimers()
      const requestState: { signal: AbortSignal | null } = { signal: null }
      const pendingFetch = Promise.withResolvers<Response>()

      fetchMock.mockImplementation((_url, init?: RequestInit) => {
        requestState.signal = init?.signal ?? null
        requestState.signal?.addEventListener('abort', () => {
          const error = new Error('요청 중단')
          error.name = 'AbortError'
          pendingFetch.reject(error)
        }, { once: true })
        return pendingFetch.promise
      })

      // resetModules 뒤 전역 fetch 모킹을 적용하려고 동적으로 불러옵니다.
      const { getLatestRefFromRemote } = await import('./upstream')
      const request = getLatestRefFromRemote(
        'https://github.com/test/test.git',
        'ck3/Test/upstream',
        'github'
      )
      const expectation = expect(request).rejects.toThrow(/test\/test.*10초.*타임아웃/)

      await vi.advanceTimersByTimeAsync(10_000)
      if (!requestState.signal?.aborted) {
        pendingFetch.reject(new Error('요청이 10초 안에 중단되지 않음'))
      }
      await expectation
      expect(requestState.signal?.aborted).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('github 전략은 비-GitHub 저장소에서 오류를 발생시켜야 함', async () => {
      const { getLatestRefFromRemote } = await import('./upstream')
      await expect(() => getLatestRefFromRemote(
        'https://gitlab.com/test/test.git',
        'ck3/Test/upstream',
        'github'
      )).rejects.toThrow('GitHub')
    })

    it('natural 전략에서 컴포넌트 태그 패턴에 맞는 최신 태그만 선택해야 함', async () => {
      execFileAsyncHandler = async (_file: string, args: readonly string[] = []) => {
        if (args[0] === 'ls-remote' && args[1] === '--tags') {
          return {
            stdout: [
              'first\trefs/tags/SEA-v1.13.0',
              'second\trefs/tags/SPA-v1.12.2',
              'third\trefs/tags/SPA-v1.12.3',
              'fourth\trefs/tags/USU-v1.6.4c'
            ].join('\n'),
            stderr: ''
          }
        }

        return { stdout: '', stderr: '' }
      }

      const { getLatestRefFromRemote } = await import('./upstream')
      const latestRef = await getLatestRefFromRemote(
        'https://github.com/test/mod-pack.git',
        'vic3/ModPack/upstream',
        'natural',
        '^SPA-v'
      )

      expect(latestRef).toEqual({
        type: 'tag',
        name: 'SPA-v1.12.3'
      })
    })

    it('github 전략은 첫 유효 공개 릴리스를 찾은 페이지에서 즉시 종료해야 함', async () => {
      const publicRelease = (tagName: string) => ({
        tag_name: tagName,
        published_at: '2026-08-03T00:00:00Z',
        prerelease: false,
        draft: false
      })
      const secondPage = [
        { ...publicRelease('SPA-v2.0.0'), draft: true },
        { ...publicRelease('SPA-v2.0.0-beta.1'), prerelease: true },
        { ...publicRelease('SPA-v1.13.0'), published_at: null },
        publicRelease('SPA-v1.12.3'),
        ...Array.from({ length: 96 }, (_, index) => publicRelease(`SEA-v2.0.${index}`))
      ]

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => Array.from({ length: 100 }, (_, index) => publicRelease(`SEA-v1.0.${index}`))
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => secondPage
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => []
        })

      // resetModules 뒤 전역 fetch 모킹을 적용하려고 동적으로 불러옵니다.
      const { getLatestRefFromRemote } = await import('./upstream')
      await expect(getLatestRefFromRemote(
        'https://github.com/test/mod-pack.git',
        'vic3/ModPack/upstream',
        'github',
        '^SPA-v'
      )).resolves.toEqual({
        type: 'tag',
        name: 'SPA-v1.12.3'
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://api.github.com/repos/test/mod-pack/releases?per_page=100&page=2',
        expect.anything()
      )
    })
  })
})
