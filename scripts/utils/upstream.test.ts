import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'pathe'
import { tmpdir } from 'node:os'

let fetchMock: ReturnType<typeof vi.fn>

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
