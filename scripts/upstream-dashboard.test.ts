import { describe, expect, it } from 'vitest'
import {
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
