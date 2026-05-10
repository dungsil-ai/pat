import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchGitHubReleases,
  filterTagsByStrategy,
  findBaselineTag,
  normalizeLocalizationPaths,
  pickLatestCommit,
  pickLatestTag,
  type GitHubCommit,
  type TagInfo,
  type TranslationCommit
} from './upstream-dashboard'

describe('filterTagsByStrategy', () => {
  it('natural 전략은 프리릴리즈 태그를 제외해야 한다', () => {
    const tags: TagInfo[] = [
      { name: 'v1.0.0', committedAt: '2024-01-01T00:00:00Z' },
      { name: 'v1.0.0-beta', committedAt: '2024-01-02T00:00:00Z' },
      { name: 'alpha-drop', committedAt: '2024-01-03T00:00:00Z' }
    ]

    const filtered = filterTagsByStrategy(tags, 'natural')
    expect(filtered.map(tag => tag.name)).toEqual(['v1.0.0'])
  })

  it('semantic 전략은 시멘틱 버전만 남기고 프리릴리즈를 제외해야 한다', () => {
    const tags: TagInfo[] = [
      { name: 'v1.0.0', committedAt: '2024-01-01T00:00:00Z' },
      { name: 'release_candidate', committedAt: '2024-01-02T00:00:00Z' },
      { name: '2.0.0-rc.1', committedAt: '2024-01-03T00:00:00Z' }
    ]

    const filtered = filterTagsByStrategy(tags, 'semantic')
    expect(filtered.map(tag => tag.name)).toEqual(['v1.0.0'])
  })
  it('github 전략은 이미 필터링된 릴리즈를 그대로 통과시켜야 한다', () => {
    const tags: TagInfo[] = [
      { name: 'v2.0.0', committedAt: '2024-01-03T00:00:00Z' },
      { name: 'v1.0.0', committedAt: '2024-01-01T00:00:00Z' }
    ]

    const filtered = filterTagsByStrategy(tags, 'github')
    expect(filtered.map(tag => tag.name)).toEqual(['v2.0.0', 'v1.0.0'])
  })
})

describe('pickLatestTag', () => {
  it('natural 전략은 자연 정렬로 가장 최신 태그를 선택해야 한다', () => {
    const tags: TagInfo[] = [
      { name: 'v1.2', committedAt: '2024-01-02T00:00:00Z' },
      { name: 'v1.10', committedAt: '2024-01-03T00:00:00Z' },
      { name: 'v1.3', committedAt: '2024-01-04T00:00:00Z' }
    ]

    expect(pickLatestTag(tags, 'natural')?.name).toBe('v1.10')
  })

  it('semantic 전략은 시멘틱 버전 기준으로 최신 태그를 선택해야 한다', () => {
    const tags: TagInfo[] = [
      { name: 'v1.0.0-beta', committedAt: '2024-01-03T00:00:00Z' },
      { name: '1.0.0', committedAt: '2024-01-02T00:00:00Z' },
      { name: '1.1.0', committedAt: '2024-01-04T00:00:00Z' }
    ]

    expect(pickLatestTag(tags, 'semantic')?.name).toBe('1.1.0')
  })

  it('github 전략은 가장 최근 published_at 기준으로 태그를 선택해야 한다', () => {
    const tags: TagInfo[] = [
      { name: 'v1.0.0', committedAt: '2024-01-01T00:00:00Z' },
      { name: 'v2.0.0', committedAt: '2024-01-04T00:00:00Z' },
      { name: 'v1.1.0', committedAt: '2024-01-02T00:00:00Z' }
    ]

    expect(pickLatestTag(tags, 'github')?.name).toBe('v2.0.0')
  })
})

describe('findBaselineTag', () => {
  it('번역 시점 이전의 가장 최근 태그를 찾아야 한다', () => {
    const tags: TagInfo[] = [
      { name: 'v1.2.0', committedAt: '2024-01-06T00:00:00Z' },
      { name: 'v1.1.0', committedAt: '2024-01-04T00:00:00Z' },
      { name: 'v1.0.0', committedAt: '2024-01-02T00:00:00Z' }
    ]
    const translationCommit: TranslationCommit = {
      shortSha: 'abc1234',
      committedAt: '2024-01-05T00:00:00Z'
    }

    expect(findBaselineTag(tags, translationCommit)?.name).toBe('v1.1.0')
  })
})

describe('pickLatestCommit', () => {
  it('여러 커밋 중 가장 최신 날짜의 커밋을 선택해야 한다', () => {
    const commits: GitHubCommit[] = [
      { sha: 'aaa1111', commit: { committer: { date: '2024-01-01T00:00:00Z' } } },
      { sha: 'bbb2222', commit: { committer: { date: '2024-03-01T00:00:00Z' } } },
      { sha: 'ccc3333', commit: { committer: { date: '2024-02-01T00:00:00Z' } } }
    ]

    const result = pickLatestCommit(commits)
    expect(result?.sha).toBe('bbb2222')
  })

  it('빈 배열이면 null을 반환해야 한다', () => {
    expect(pickLatestCommit([])).toBeNull()
  })

  it('커밋 날짜가 없거나 빈 문자열이면 0으로 폴백하여 비결정적 정렬을 방지해야 한다', () => {
    const commits: GitHubCommit[] = [
      { sha: 'aaa1111', commit: { committer: { date: '2024-06-01T00:00:00Z' } } },
      { sha: 'bbb2222', commit: { committer: {} } },
      { sha: 'ccc3333', commit: {} },
      { sha: 'ddd4444', commit: { committer: { date: '' } } }
    ]

    const result = pickLatestCommit(commits)
    expect(result?.sha).toBe('aaa1111')
  })

  it('커밋이 하나만 있으면 해당 커밋을 반환해야 한다', () => {
    const commits: GitHubCommit[] = [
      { sha: 'aaa1111', commit: { committer: { date: '2024-01-01T00:00:00Z' } } }
    ]

    expect(pickLatestCommit(commits)?.sha).toBe('aaa1111')
  })
})

describe('normalizeLocalizationPaths', () => {
  it('"." 경로가 포함되면 빈 배열을 반환하여 경로 필터링을 비활성화해야 한다', () => {
    expect(normalizeLocalizationPaths(['.'])).toEqual([])
    expect(normalizeLocalizationPaths(['.', 'localization/english'])).toEqual([])
  })

  it('공백 문자열과 빈 문자열을 제거해야 한다', () => {
    expect(normalizeLocalizationPaths(['', '  ', 'localization/english'])).toEqual(['localization/english'])
  })

  it('경로 앞뒤 공백을 제거해야 한다', () => {
    expect(normalizeLocalizationPaths(['  localization/english  '])).toEqual(['localization/english'])
  })

  it('중복 경로를 제거해야 한다', () => {
    expect(normalizeLocalizationPaths(['localization/english', 'localization/english'])).toEqual(['localization/english'])
  })

  it('빈 배열이면 빈 배열을 반환해야 한다', () => {
    expect(normalizeLocalizationPaths([])).toEqual([])
  })

  it('유효한 경로만 있으면 그대로 반환해야 한다', () => {
    expect(normalizeLocalizationPaths(['localization/english', 'localization/replace/english']))
      .toEqual(['localization/english', 'localization/replace/english'])
  })
})

describe('fetchGitHubReleases', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('드래프트/프리릴리즈/미공개 릴리즈를 제외하고 published_at 내림차순으로 반환해야 한다', async () => {
    const releases = [
      {
        tag_name: 'v1.0.0',
        published_at: '2024-01-01T00:00:00Z',
        prerelease: false,
        draft: false
      },
      {
        tag_name: 'v2.0.0-beta.1',
        published_at: '2024-03-01T00:00:00Z',
        prerelease: true,
        draft: false
      },
      {
        tag_name: 'v3.0.0',
        published_at: '2024-04-01T00:00:00Z',
        prerelease: false,
        draft: true
      },
      {
        tag_name: 'v1.5.0',
        published_at: null,
        prerelease: false,
        draft: false
      },
      {
        tag_name: 'v2.0.0',
        published_at: '2024-02-01T00:00:00Z',
        prerelease: false,
        draft: false
      }
    ]

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => releases,
      headers: new Headers()
    } as Response)

    const result = await fetchGitHubReleases('owner', 'repo')

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(result).toEqual([
      {
        name: 'v2.0.0',
        committedAt: '2024-02-01T00:00:00Z'
      },
      {
        name: 'v1.0.0',
        committedAt: '2024-01-01T00:00:00Z'
      }
    ])
  })

  it('여러 페이지의 릴리즈를 합쳐서 필터링 및 정렬해야 한다', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      tag_name: `v1.0.${i}`,
      published_at: new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString(),
      prerelease: i === 50,
      draft: false
    }))

    const page2 = [
      {
        tag_name: 'v0.9.0',
        published_at: '2023-12-01T00:00:00Z',
        prerelease: false,
        draft: false
      },
      {
        tag_name: 'v0.8.0-rc.1',
        published_at: '2023-11-01T00:00:00Z',
        prerelease: true,
        draft: false
      }
    ]

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => page1,
        headers: new Headers()
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => page2,
        headers: new Headers()
      } as Response)

    const result = await fetchGitHubReleases('owner', 'repo')

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    // page1의 프리릴리즈(v1.0.50) 제외 = 99개 + page2의 v0.9.0 = 100개
    expect(result).toHaveLength(100)
    // published_at 내림차순: 가장 최신이 첫 번째 (i=99 → 2024-04-09)
    expect(result[0]?.name).toBe('v1.0.99')
    // 가장 오래된 것이 마지막
    expect(result[result.length - 1]).toEqual({
      name: 'v0.9.0',
      committedAt: '2023-12-01T00:00:00Z'
    })
    // 프리릴리즈가 제외되었는지 확인
    expect(result.find(r => r.name === 'v1.0.50')).toBeUndefined()
    expect(result.find(r => r.name === 'v0.8.0-rc.1')).toBeUndefined()
  })
})
