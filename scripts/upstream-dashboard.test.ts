import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  buildIssueBody,
  fetchGitHubReleases,
  filterTagsByPattern,
  filterTagsByStrategy,
  findBaselineTag,
  normalizeLocalizationPaths,
  pickLatestCommit,
  pickLatestTag,
  resolveComponentTranslationPaths,
  resolveComponentTranslationTrackingPaths,
  resolveDashboardRows,
  type GitHubCommit,
  type GitHubTreeResponse,
  type DashboardRow,
  type TagInfo,
  type TranslationCommit
} from './upstream-dashboard'

describe('filterTagsByPattern', () => {
  it('컴포넌트 태그 정규식에 맞는 태그만 남겨야 한다', () => {
    const tags: TagInfo[] = [
      { name: 'SEA-v1.2.0', committedAt: '2024-01-01T00:00:00Z' },
      { name: 'SPA-v1.3.0', committedAt: '2024-01-02T00:00:00Z' },
      { name: 'SEA-v1.10.0', committedAt: '2024-01-03T00:00:00Z' }
    ]

    expect(filterTagsByPattern(tags, '^SEA-v').map(tag => tag.name))
      .toEqual(['SEA-v1.2.0', 'SEA-v1.10.0'])
  })

  it('태그 정규식이 없으면 원래 태그 목록을 유지해야 한다', () => {
    const tags: TagInfo[] = [
      { name: 'v1.0.0', committedAt: '2024-01-01T00:00:00Z' }
    ]

    expect(filterTagsByPattern(tags)).toBe(tags)
  })
})

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
      { name: '2.0.0-rc.1', committedAt: '2024-01-03T00:00:00Z' },
      { name: 'SEA-v2.0.0beta', committedAt: '2024-01-04T00:00:00Z' },
      { name: 'SEA-v1.9.0', committedAt: '2024-01-05T00:00:00Z' }
    ]

    const filtered = filterTagsByStrategy(tags, 'semantic')
    expect(filtered.map(tag => tag.name)).toEqual(['v1.0.0', 'SEA-v1.9.0'])
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
      { name: '1.1.0', committedAt: '2024-01-04T00:00:00Z' },
      { name: 'SEA-v2.0.0beta', committedAt: '2024-01-05T00:00:00Z' },
      { name: 'SEA-v1.9.0', committedAt: '2024-01-06T00:00:00Z' }
    ]

    expect(pickLatestTag(tags, 'semantic')?.name).toBe('SEA-v1.9.0')
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

describe('resolveComponentTranslationPaths', () => {
  it('일반 및 replace 현지화 출력 경로를 모두 번역 이력 대상으로 계산해야 한다', () => {
    expect(resolveComponentTranslationPaths(
      'vic3/Bundle/mod/localization/korean',
      [
        'Component/localization/english',
        'Component/localization/replace/english'
      ],
      'component'
    )).toEqual([
      'vic3/Bundle/mod/localization/korean/component',
      'vic3/Bundle/mod/localization/korean/replace/component'
    ])
  })

  it('같은 출력 경로는 중복 제거해야 한다', () => {
    expect(resolveComponentTranslationPaths(
      'ck3/Bundle/mod/localization/korean',
      ['first/localization/english', 'second/localization/english']
    )).toEqual(['ck3/Bundle/mod/localization/korean'])
  })
})

describe('resolveComponentTranslationTrackingPaths', () => {
  it('출력 루트를 공유하는 컴포넌트도 서로의 대상 파일 이력을 섞지 않아야 한다', () => {
    const repositoryTree: GitHubTreeResponse = {
      truncated: false,
      tree: [
        {
          type: 'blob',
          path: 'First/localization/english/first_l_english.yml'
        },
        {
          type: 'blob',
          path: 'Second/localization/english/second_l_english.yml'
        }
      ]
    }

    const firstPaths = resolveComponentTranslationTrackingPaths(
      'vic3/Bundle/mod/localization/korean',
      ['First/localization/english'],
      'english',
      undefined,
      repositoryTree,
      false
    )
    const secondPaths = resolveComponentTranslationTrackingPaths(
      'vic3/Bundle/mod/localization/korean',
      ['Second/localization/english'],
      'english',
      undefined,
      repositoryTree,
      false
    )

    expect(firstPaths).toEqual([
      'vic3/Bundle/mod/localization/korean/___first_l_korean.yml'
    ])
    expect(secondPaths).toEqual([
      'vic3/Bundle/mod/localization/korean/___second_l_korean.yml'
    ])
  })

  it('업스트림 트리의 파일을 normal/replace 및 중첩 대상 파일 경로로 정확히 매핑해야 한다', () => {
    const repositoryTree: GitHubTreeResponse = {
      truncated: false,
      tree: [
        {
          type: 'blob',
          path: 'Component/localization/english/root_l_english.yml'
        },
        {
          type: 'blob',
          path: 'Component/localization/english/events/deep/event_l_english.yml'
        },
        {
          type: 'blob',
          path: 'Component/localization/replace/english/nested/replace_l_english.yml'
        },
        {
          type: 'blob',
          path: 'Component/localization/english/ignored_l_french.yml'
        },
        {
          type: 'tree',
          path: 'Component/localization/english/directory_l_english.yml'
        },
        {
          type: 'blob',
          path: 'Component Extra/localization/english/sibling_l_english.yml'
        }
      ]
    }

    expect(resolveComponentTranslationTrackingPaths(
      'vic3/Bundle/mod/localization/korean',
      [
        'Component/localization/english',
        'Component/localization/replace/english'
      ],
      'english',
      'component-output',
      repositoryTree
    )).toEqual([
      'vic3/Bundle/mod/localization/korean/component-output/___root_l_korean.yml',
      'vic3/Bundle/mod/localization/korean/component-output/events/deep/___event_l_korean.yml',
      'vic3/Bundle/mod/localization/korean/replace/component-output/nested/___replace_l_korean.yml'
    ].sort())
  })

  it.each([
    {
      name: '트리 조회 실패',
      tree: null
    },
    {
      name: '잘린 트리',
      tree: {
        truncated: true,
        tree: [{
          type: 'blob',
          path: 'Component/localization/english/file_l_english.yml'
        }]
      }
    },
    {
      name: '현지화 파일이 없는 트리',
      tree: {
        truncated: false,
        tree: [{
          type: 'blob',
          path: 'README.md'
        }]
      }
    }
  ])('$name이면 기존 출력 루트로 폴백해야 한다', ({ tree }) => {
    expect(resolveComponentTranslationTrackingPaths(
      'ck3/Bundle/mod/localization/korean',
      ['Component/localization/english'],
      'english',
      undefined,
      tree
    )).toEqual(['ck3/Bundle/mod/localization/korean'])
  })

  it.each([
    {
      name: '트리 조회 실패',
      tree: null
    },
    {
      name: '잘린 트리',
      tree: {
        truncated: true,
        tree: [{
          type: 'blob',
          path: 'Component/localization/english/file_l_english.yml'
        }]
      }
    },
    {
      name: '현지화 파일이 없는 트리',
      tree: {
        truncated: false,
        tree: [{
          type: 'blob',
          path: 'README.md'
        }]
      }
    }
  ])('공용 출력 컴포넌트는 $name 시 루트 이력으로 폴백하지 않아야 한다', ({ tree }) => {
    expect(resolveComponentTranslationTrackingPaths(
      'vic3/Bundle/mod/localization/korean',
      ['Component/localization/english'],
      'english',
      undefined,
      tree,
      false
    )).toEqual([])
  })

  it('output_subdir가 있는 명시적 컴포넌트도 트리 실패 시 추정 폴백하지 않아야 한다', () => {
    expect(resolveComponentTranslationTrackingPaths(
      'vic3/Bundle/mod/localization/korean',
      ['Component/localization/english'],
      'english',
      'component',
      null,
      false
    )).toEqual([])
  })

  it('한국어 원본의 기존 오버라이드 접두사를 중복하지 않아야 한다', () => {
    expect(resolveComponentTranslationTrackingPaths(
      'stellaris/Bundle/mod/localisation/korean',
      ['localisation/korean'],
      'korean',
      undefined,
      {
        truncated: false,
        tree: [{
          type: 'blob',
          path: 'localisation/korean/___names_l_korean.yml'
        }]
      }
    )).toEqual([
      'stellaris/Bundle/mod/localisation/korean/___names_l_korean.yml'
    ])
  })
})

describe('buildIssueBody', () => {
  it('한 번역 묶음의 컴포넌트를 각각 논리 모드 행으로 표시해야 한다', () => {
    const rows: DashboardRow[] = [
      {
        game: 'vic3',
        mod: 'Grey\'s Little Reworks',
        componentId: 'sea',
        componentName: 'Soft Econ Adjustments',
        strategy: 'natural',
        trackedBy: 'tag',
        baselineVersion: 'SEA-v1.0.0',
        latestVersion: 'SEA-v1.1.0',
        status: '미반영'
      },
      {
        game: 'vic3',
        mod: 'Grey\'s Little Reworks',
        componentId: 'spa',
        componentName: 'Soft Pop Adjustments',
        strategy: 'natural',
        trackedBy: 'tag',
        baselineVersion: 'SPA-v2.0.0',
        latestVersion: 'SPA-v2.0.0',
        status: '최신'
      }
    ]

    const body = buildIssueBody(rows)

    expect(body).toContain('- 미반영 논리 모드 수: 1')
    expect(body).toContain('- 확인 대상 논리 모드 수: 2')
    expect(body).toContain('| VIC3 | Grey\'s Little Reworks | Soft Econ Adjustments (`sea`) | natural | tag |')
    expect(body).toContain('| VIC3 | Grey\'s Little Reworks | Soft Pop Adjustments (`spa`) | natural | tag |')
  })

  it('legacy 설정은 컴포넌트 없이 기존 모드 한 행으로 표시해야 한다', () => {
    const rows: DashboardRow[] = [
      {
        game: 'ck3',
        mod: 'Legacy Mod',
        strategy: 'default',
        trackedBy: 'commit',
        baselineVersion: 'abc1234',
        latestVersion: 'abc1234',
        status: '최신'
      }
    ]

    expect(buildIssueBody(rows))
      .toContain('| CK3 | Legacy Mod | - | default | commit | `abc1234` | `abc1234` | 최신 |')
  })

  it('컴포넌트 이름의 파이프를 Markdown 표에서 이스케이프해야 한다', () => {
    const rows: DashboardRow[] = [{
      game: 'vic3',
      mod: 'Bundle',
      componentId: 'one',
      componentName: 'One | Two',
      strategy: 'default',
      trackedBy: 'commit',
      baselineVersion: 'abc1234',
      latestVersion: 'abc1234',
      status: '최신'
    }]

    expect(buildIssueBody(rows))
      .toContain('| VIC3 | Bundle | One \\| Two (`one`) | default |')
  })

  it('파이프 앞의 기존 백슬래시도 먼저 이스케이프하여 셀 구분 우회를 막아야 한다', () => {
    const rows: DashboardRow[] = [{
      game: 'vic3',
      mod: 'Bundle',
      componentId: 'one',
      componentName: String.raw`One \| Two`,
      strategy: 'default',
      trackedBy: 'commit',
      baselineVersion: 'abc1234',
      latestVersion: 'abc1234',
      status: '최신'
    }]

    const escapedComponent = String.raw`One \\\| Two`
    expect(buildIssueBody(rows))
      .toContain(`| VIC3 | Bundle | ${escapedComponent} (\`one\`) | default |`)
  })
  it('조회 실패 행을 미반영 집계에서 제외하고 정상 행을 유지해야 한다', () => {
    const body = buildIssueBody([
      {
        game: 'ck3',
        mod: '정상 모드',
        strategy: 'github',
        trackedBy: 'tag',
        baselineVersion: 'v1.0.0',
        latestVersion: 'v2.0.0',
        status: '미반영'
      },
      {
        game: 'vic3',
        mod: '실패 모드',
        strategy: 'github',
        trackedBy: 'tag',
        baselineVersion: '조회 실패',
        latestVersion: '조회 실패',
        status: '조회 실패'
      }
    ])

    expect(body).toContain('- 미반영 논리 모드 수: 1')
    expect(body).toContain('- 확인 대상 논리 모드 수: 2')
    expect(body).toContain('- 조회 실패 논리 모드 수(집계 제외): 1')
    expect(body).toContain('| CK3 | 정상 모드 | - | github | tag |')
    expect(body).toContain('| VIC3 | 실패 모드 | - | github | tag | `조회 실패` | `조회 실패` | 조회 실패 |')
  })
})

describe('resolveDashboardRows', () => {
  it('실패한 저장소의 행만 조회 실패로 만들고 다음 행을 유지해야 한다', async () => {
    const metas: Parameters<typeof resolveDashboardRows>[0] = [
      {
        game: 'ck3',
        mod: '실패 모드',
        owner: 'owner',
        repo: 'failed-repo',
        language: 'korean',
        strategy: 'github',
        translationRootPath: 'ck3/실패 모드',
        upstreamLocalization: ['localization']
      },
      {
        game: 'vic3',
        mod: '정상 모드',
        owner: 'owner',
        repo: 'normal-repo',
        language: 'korean',
        strategy: 'github',
        translationRootPath: 'vic3/정상 모드',
        upstreamLocalization: ['localization']
      }
    ]
    const normalRow: DashboardRow = {
      game: 'vic3',
      mod: '정상 모드',
      strategy: 'github',
      trackedBy: 'tag',
      baselineVersion: 'v1.0.0',
      latestVersion: 'v2.0.0',
      status: '미반영'
    }
    const resolveRow = vi.fn()
      .mockRejectedValueOnce(new Error('GitHub Releases 조회 제한 초과 (owner/failed-repo): 최대 500건'))
      .mockResolvedValueOnce(normalRow)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      const rows = await resolveDashboardRows(metas, '.', undefined, resolveRow)

      expect(rows).toEqual([
        {
          game: 'ck3',
          mod: '실패 모드',
          strategy: 'github',
          trackedBy: 'commit',
          baselineVersion: '조회 실패',
          latestVersion: '조회 실패',
          status: '조회 실패'
        },
        normalRow
      ])
      expect(resolveRow).toHaveBeenCalledTimes(2)
    } finally {
      stderr.mockRestore()
    }
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
  it('최신 공개 릴리스와 번역 기준 릴리스가 결정된 페이지 뒤 요청을 중단해야 한다', async () => {
    const lastTranslation: TranslationCommit = {
      shortSha: 'abc1234',
      committedAt: '2024-02-15T00:00:00Z'
    }
    const page = [
      {
        tag_name: 'v3.0.0',
        published_at: '2024-03-01T00:00:00Z',
        prerelease: false,
        draft: false
      },
      {
        tag_name: 'v2.0.0',
        published_at: '2024-02-01T00:00:00Z',
        prerelease: false,
        draft: false
      },
      ...Array.from({ length: 98 }, (_, index) => ({
        tag_name: `draft-${index}`,
        published_at: '2024-01-01T00:00:00Z',
        prerelease: false,
        draft: true
      }))
    ]

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page, headers: new Headers() } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [], headers: new Headers() } as Response)

    const result = await fetchGitHubReleases('owner', 'repo', undefined, lastTranslation)

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(pickLatestTag(result, 'github')).toEqual({ name: 'v3.0.0', committedAt: '2024-03-01T00:00:00Z' })
    expect(findBaselineTag(result, lastTranslation)).toEqual({ name: 'v2.0.0', committedAt: '2024-02-01T00:00:00Z' })
  })

  it('태그 패턴의 최신·기준 릴리스가 결정될 때까지 다음 페이지를 조회해야 한다', async () => {
    const lastTranslation: TranslationCommit = {
      shortSha: 'abc1234',
      committedAt: '2024-02-15T00:00:00Z'
    }
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      tag_name: `other-${index}`,
      published_at: index === 1 ? '2024-02-01T00:00:00Z' : '2024-03-01T00:00:00Z',
      prerelease: false,
      draft: false
    }))
    const secondPage = [
      { tag_name: 'component-v3.0.0', published_at: '2024-03-01T00:00:00Z', prerelease: false, draft: false },
      { tag_name: 'component-v2.0.0', published_at: '2024-02-01T00:00:00Z', prerelease: false, draft: false }
    ]

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => firstPage, headers: new Headers() } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => secondPage, headers: new Headers() } as Response)

    const result = await fetchGitHubReleases('owner', 'repo', undefined, lastTranslation, '^component-')
    const componentTags = filterTagsByPattern(result, '^component-')

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(pickLatestTag(componentTags, 'github')).toEqual({ name: 'component-v3.0.0', committedAt: '2024-03-01T00:00:00Z' })
    expect(findBaselineTag(componentTags, lastTranslation)).toEqual({ name: 'component-v2.0.0', committedAt: '2024-02-01T00:00:00Z' })
  })
  it('다섯 번째 페이지가 가득 차면 불완전한 릴리스 이력을 거부해야 한다', async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({
      tag_name: `draft-${index}`,
      published_at: '2024-01-01T00:00:00Z',
      prerelease: false,
      draft: true
    }))

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page, headers: new Headers() } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page, headers: new Headers() } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page, headers: new Headers() } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page, headers: new Headers() } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page, headers: new Headers() } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [], headers: new Headers() } as Response)

    await expect(fetchGitHubReleases('owner', 'repo')).rejects.toThrow('GitHub Releases 조회 제한 초과 (owner/repo): 최대 500건')
    expect(globalThis.fetch).toHaveBeenCalledTimes(5)
  })

  it('각 릴리스 요청을 10초 안에 중단하고 저장소를 포함한 오류를 반환해야 한다', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(globalThis.fetch).mockImplementation((_url, init) => {
        const { promise, reject } = Promise.withResolvers<Response>()
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        return promise
      })

      const result = expect(fetchGitHubReleases('owner', 'repo')).rejects.toThrow('GitHub Releases 요청 시간 초과 (owner/repo): 10초')
      await vi.advanceTimersByTimeAsync(47_000)
      await result

      expect(globalThis.fetch).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })
})
