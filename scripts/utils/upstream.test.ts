import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
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
  })

  describe('기존 저장소 업데이트', () => {
    it('로컬 변경사항이 있으면 기존 저장소를 지우고 재클론해야 함', async () => {
      const commands: string[] = []
      const repoPath = join(testDir, 'ck3/TestMod/upstream')
      await mkdir(join(repoPath, '.git'), { recursive: true })

      execAsyncHandler = async (command: string) => {
        commands.push(command)

        if (command === 'git status --porcelain') {
          return { stdout: ' M localization/english/test.yml\n', stderr: '' }
        }

        if (command.startsWith('git ls-remote --tags --refs')) {
          return { stdout: '', stderr: '' }
        }

        if (command.startsWith('git ls-remote --symref')) {
          return { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' }
        }

        if (command === 'git describe --tags --exact-match') {
          throw new Error('fatal: no tag exactly matches')
        }

        if (command === 'git rev-parse --abbrev-ref HEAD') {
          return { stdout: 'develop\n', stderr: '' }
        }

        if (command.startsWith('git clone ')) {
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

      expect(commands.some(command => command.startsWith('git clone '))).toBe(true)
      expect(commands).toContain('git checkout HEAD')
      expect(commands).not.toContain('git fetch --tags')
    })

    it('동일한 참조명이면서 커밋도 동일하면 업데이트를 건너뛰어야 함', async () => {
      const commands: string[] = []
      const execFileCommands: string[] = []
      const repoPath = join(testDir, 'ck3/TestMod/upstream')
      await mkdir(join(repoPath, '.git'), { recursive: true })

      execAsyncHandler = async (command: string) => {
        commands.push(command)

        if (command === 'git status --porcelain') {
          return { stdout: '', stderr: '' }
        }

        if (command.startsWith('git ls-remote --tags --refs')) {
          return { stdout: 'tagobjhash\trefs/tags/v1.0.0\n', stderr: '' }
        }

        if (command === 'git describe --tags --exact-match') {
          return { stdout: 'v1.0.0\n', stderr: '' }
        }

        if (command === 'git rev-parse HEAD') {
          return { stdout: 'commit123\n', stderr: '' }
        }

        return { stdout: '', stderr: '' }
      }

      execFileAsyncHandler = async (_file: string, args: readonly string[] = []) => {
        execFileCommands.push([_file, ...args].join(' '))

        if (args[0] === 'ls-remote') {
          return { stdout: 'commit123\trefs/tags/v1.0.0^{}\ntagobjhash\trefs/tags/v1.0.0\n', stderr: '' }
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
      expect(commands.some(command => command.startsWith('git fetch'))).toBe(false)
      expect(commands.some(command => command.startsWith('git checkout'))).toBe(false)
    })

    it('동일한 참조명이어도 커밋이 다르면 업데이트를 진행해야 함', async () => {
      const commands: string[] = []
      const execFileCommands: string[] = []
      const repoPath = join(testDir, 'ck3/TestMod/upstream')
      await mkdir(join(repoPath, '.git'), { recursive: true })

      execAsyncHandler = async (command: string) => {
        commands.push(command)

        if (command === 'git status --porcelain') {
          return { stdout: '', stderr: '' }
        }

        if (command.startsWith('git ls-remote --tags --refs')) {
          return { stdout: 'newtaghash\trefs/tags/v1.0.0\n', stderr: '' }
        }

        if (command === 'git describe --tags --exact-match') {
          return { stdout: 'v1.0.0\n', stderr: '' }
        }

        if (command === 'git rev-parse HEAD') {
          return { stdout: 'oldcommit\n', stderr: '' }
        }

        if (command === 'git fetch --tags') {
          return { stdout: '', stderr: '' }
        }

        if (command.startsWith('git checkout')) {
          return { stdout: '', stderr: '' }
        }

        return { stdout: '', stderr: '' }
      }

      execFileAsyncHandler = async (_file: string, args: readonly string[] = []) => {
        execFileCommands.push([_file, ...args].join(' '))

        if (args[0] === 'ls-remote') {
          return { stdout: 'newcommit\trefs/tags/v1.0.0^{}\ntagobjhash\trefs/tags/v1.0.0\n', stderr: '' }
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
      expect(commands).toContain('git fetch --tags')
      expect(commands.some(command => command.startsWith('git checkout "v1.0.0"'))).toBe(true)
    })
  })

  describe('태그 clone/fetch 폴백', () => {
    it('태그 clone 실패 시 실패한 디렉토리를 정리한 뒤 기본 브랜치 clone으로 폴백해야 함', async () => {
      const commands: string[] = []
      const repoPath = join(testDir, 'ck3/TestMod/upstream')
      execAsyncHandler = async (command: string) => {
        commands.push(command)
        if (command.startsWith('git ls-remote --tags --refs')) {
          return { stdout: 'abc123\trefs/tags/v1.0.0\n', stderr: '' }
        }

        if (command.includes('git clone') && command.includes('--branch "v1.0.0"')) {
          throw new Error('Remote branch v1.0.0 not found in upstream origin')
        }

        if (command.startsWith('git clone ')) {
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

      const tagCloneIndex = commands.findIndex(command => command.includes('git clone') && command.includes('--branch "v1.0.0"'))
      const fallbackCloneIndex = commands.findIndex(command => command === `git clone --filter=blob:none --depth=1 --no-checkout "https://github.com/test/repo.git" "${repoPath}"`)

      expect(tagCloneIndex).toBeGreaterThanOrEqual(0)
      expect(fallbackCloneIndex).toBeGreaterThan(tagCloneIndex)
    })

    it('shallow 저장소에서 태그 fetch가 ref-not-found면 기본 브랜치 fetch로 폴백해야 함', async () => {
      const commands: string[] = []
      execAsyncHandler = async (command: string) => {
        commands.push(command)
        if (command === 'git status --porcelain') {
          return { stdout: '', stderr: '' }
        }
        if (command.startsWith('git ls-remote --tags --refs')) {
          return { stdout: 'abc123\trefs/tags/v2.0.0\n', stderr: '' }
        }
        if (command === 'git describe --tags --exact-match') {
          throw new Error('fatal: no tag exactly matches')
        }
        if (command === 'git rev-parse --abbrev-ref HEAD') {
          return { stdout: 'main\n', stderr: '' }
        }
        if (command === 'git fetch --depth=1 origin tag "v2.0.0"') {
          throw new Error('Remote branch v2.0.0 not found in upstream origin')
        }
        if (command.startsWith('git ls-remote --symref')) {
          return { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' }
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

      expect(commands).toContain('git fetch --depth=1 origin tag "v2.0.0"')
      expect(commands).toContain('git fetch --depth=1 origin "main"')
      expect(commands).toContain('git checkout "main"')
      expect(commands).toContain('git reset --hard "origin/main"')
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
  })
})
