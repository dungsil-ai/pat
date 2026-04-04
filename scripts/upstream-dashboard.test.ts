import { describe, expect, it } from 'vitest'
import {
  filterTagsByStrategy,
  findBaselineTag,
  pickLatestTag,
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
