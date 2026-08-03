import { readdir, access } from 'node:fs/promises'
import { dirname, join } from 'pathe'
import process from 'node:process'
import { isReplaceLocalizationPath, readModMeta } from './config/mod-meta'
import { buildKoreanTargetFileName } from './utils/localization-file-name'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import natsort from 'natsort'
import semver from 'semver'
import { isPrereleaseTag, parseStableSemanticVersion } from './utils/version-tags'

const execFileAsync = promisify(execFile)

type VersionStrategy = 'semantic' | 'natural' | 'default' | 'github'

interface ModMeta {
  game: string
  mod: string
  componentId?: string
  componentName?: string
  owner: string
  repo: string
  language: string
  strategy: VersionStrategy
  tagPattern?: string
  outputSubdir?: string
  translationRootPath: string
  upstreamLocalization: string[]
}

interface TranslationCommit {
  shortSha: string
  committedAt: string
}

interface DashboardRow {
  game: string
  mod: string
  componentId?: string
  componentName?: string
  strategy: string
  trackedBy: 'tag' | 'commit'
  baselineVersion: string
  latestVersion: string
  status: '미반영' | '최신' | '번역 이력 없음' | '조회 실패' | '경로 커밋 없음'
  compareUrl?: string
}

interface DashboardCache {
  repositoryInfo: Map<string, Promise<{ default_branch: string }>>
  repositoryTrees: Map<string, Promise<GitHubTreeResponse>>
  tags: Map<string, Promise<TagInfo[]>>
  translationCommits: Map<string, Promise<TranslationCommit | null>>
}

interface GitHubCommit {
  sha: string
  commit: {
    committer?: {
      date?: string
    }
  }
}

interface GitHubTreeEntry {
  path?: string
  type?: string
}

interface GitHubTreeResponse {
  tree: GitHubTreeEntry[]
  truncated: boolean
}

type TagInfo = {
  name: string
  committedAt: string
}

type GitHubTagTarget =
  | {
    __typename: 'Commit'
    oid: string
    committedDate: string
  }
  | {
    __typename: 'Tag'
    target: GitHubTagTarget | null
  }
  | {
    __typename: string
    target?: GitHubTagTarget | null
  }
  | null

type GitHubTagResponse = {
  repository: {
    refs: {
      nodes: Array<{
        name: string
        target: GitHubTagTarget
      }>
      pageInfo: {
        hasNextPage: boolean
        endCursor: string | null
      }
    }
  } | null
}

type GitHubGraphqlResponse<T> = {
  data: T
  errors?: Array<{ message?: string }>
}

function parseGitHubUrl(url: string): { owner: string, repo: string } | null {
  const match = url.match(/(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

async function resolveTranslationPath(rootDir: string, game: string, mod: string): Promise<string> {
  const candidates = [
    join(game, mod, 'mod', 'localization', 'korean'),
    join(game, mod, 'mod', 'localisation', 'korean')
  ]

  for (const candidate of candidates) {
    try {
      await access(join(rootDir, candidate))
      return candidate
    } catch {
      continue
    }
  }

  return candidates[0]
}

function resolveComponentTranslationPaths(
  translationRootPath: string,
  localizationPaths: string[],
  outputSubdir?: string
): string[] {
  return [...new Set(localizationPaths.map(localizationPath => {
    const languageRootPath = isReplaceLocalizationPath(localizationPath)
      ? join(translationRootPath, 'replace')
      : translationRootPath
    return outputSubdir
      ? join(languageRootPath, outputSubdir)
      : languageRootPath
  }))]
}

function getRelativeLocalizationFilePath(
  repositoryPath: string,
  localizationPath: string
): string | null {
  if (localizationPath === '.') {
    return repositoryPath
  }

  const prefix = `${localizationPath}/`
  return repositoryPath.startsWith(prefix)
    ? repositoryPath.slice(prefix.length)
    : null
}

function resolveComponentTranslationTrackingPaths(
  translationRootPath: string,
  localizationPaths: string[],
  sourceLanguage: string,
  outputSubdir: string | undefined,
  repositoryTree?: GitHubTreeResponse | null,
  allowRootFallback = true
): string[] {
  const fallbackPaths = resolveComponentTranslationPaths(
    translationRootPath,
    localizationPaths,
    outputSubdir
  )
  if (!repositoryTree || repositoryTree.truncated || !Array.isArray(repositoryTree.tree)) {
    return allowRootFallback ? fallbackPaths : []
  }

  const translationFilePaths = new Set<string>()
  for (const localizationPath of localizationPaths) {
    const languageRootPath = isReplaceLocalizationPath(localizationPath)
      ? join(translationRootPath, 'replace')
      : translationRootPath
    const targetRootPath = outputSubdir
      ? join(languageRootPath, outputSubdir)
      : languageRootPath

    for (const entry of repositoryTree.tree) {
      if (entry.type !== 'blob' || !entry.path) continue

      const relativeFilePath = getRelativeLocalizationFilePath(entry.path, localizationPath)
      if (
        !relativeFilePath ||
        !relativeFilePath.endsWith('.yml') ||
        !relativeFilePath.includes(`_l_${sourceLanguage}`)
      ) {
        continue
      }

      translationFilePaths.add(join(
        targetRootPath,
        dirname(relativeFilePath),
        buildKoreanTargetFileName(relativeFilePath, sourceLanguage)
      ))
    }
  }

  return translationFilePaths.size > 0
    ? [...translationFilePaths].sort()
    : (allowRootFallback ? fallbackPaths : [])
}

async function findModMetas(rootDir: string): Promise<ModMeta[]> {
  const metas: ModMeta[] = []
  for (const game of ['ck3', 'vic3', 'stellaris']) {
    const gameDir = join(rootDir, game)
    let modEntries
    try {
      modEntries = await readdir(gameDir, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      continue
    }

    for (const modEntry of modEntries) {
      if (!modEntry.isDirectory()) continue
      const metaPath = join(gameDir, modEntry.name, 'meta.toml')
      try {
        await access(metaPath)
      } catch {
        continue
      }

      const config = await readModMeta(metaPath)
      const upstream = config.upstream
      const url = upstream?.url
      if (!url) continue

      const repo = parseGitHubUrl(url)
      if (!repo) continue

      const translationRootPath = await resolveTranslationPath(rootDir, game, modEntry.name)
      for (const component of upstream.components) {
        metas.push({
          game,
          mod: modEntry.name,
          componentId: component.implicit ? undefined : component.id,
          componentName: component.implicit ? undefined : component.name,
          owner: repo.owner,
          repo: repo.repo,
          language: upstream.language,
          strategy: component.versionStrategy,
          tagPattern: component.tagPattern,
          outputSubdir: component.outputSubdir,
          translationRootPath,
          upstreamLocalization: component.localizationPaths
        })
      }
    }
  }

  return metas
}

async function getLastTranslationCommit(rootDir: string, translationPaths: string[]): Promise<TranslationCommit | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      [
        'log',
        '-1',
        '--format=%h|%cI',
        '--',
        ...translationPaths.map(translationPath => `:(literal)${translationPath}`)
      ],
      { cwd: rootDir }
    )
    const line = stdout.trim()
    if (!line) return null
    const [shortSha, committedAt] = line.split('|')
    if (!shortSha || !committedAt) return null
    return { shortSha, committedAt }
  } catch {
    return null
  }
}

function createDashboardCache(): DashboardCache {
  return {
    repositoryInfo: new Map(),
    repositoryTrees: new Map(),
    tags: new Map(),
    translationCommits: new Map()
  }
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

function shouldRetryGitHubResponse(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

interface GitHubRequestTimeout {
  ms: number
  message: string
}

function getGitHubRetryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) {
    const retryAfterSeconds = Number(retryAfter)
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
      return retryAfterSeconds * 1000
    }

    const retryAt = Date.parse(retryAfter)
    if (!Number.isNaN(retryAt)) {
      return Math.max(0, retryAt - Date.now())
    }
  }

  const rateLimitReset = response.headers.get('x-ratelimit-reset')
  if (response.status === 429 && rateLimitReset) {
    const resetAtSeconds = Number(rateLimitReset)
    if (Number.isFinite(resetAtSeconds) && resetAtSeconds > 0) {
      return Math.max(0, resetAtSeconds * 1000 - Date.now())
    }
  }

  return Math.min(1000 * 2 ** attempt, 8000)
}

async function githubApi<T>(path: string, token?: string, timeout?: GitHubRequestTimeout): Promise<T> {
  const maxAttempts = 4

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const abortController = timeout ? new AbortController() : undefined
    const timeoutId = abortController
      ? setTimeout(() => abortController.abort(new Error(timeout!.message)), timeout!.ms)
      : undefined

    try {
      const response = await fetch(`https://api.github.com${path}`, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        ...(abortController ? { signal: abortController.signal } : {})
      })

      if (response.ok) {
        return await response.json() as T
      }

      if (shouldRetryGitHubResponse(response.status) && attempt < maxAttempts - 1) {
        await sleep(getGitHubRetryDelayMs(response, attempt))
        continue
      }

      throw new Error(`GitHub API 요청 실패 (${response.status}): ${path}`)
    } catch (error) {
      if (attempt >= maxAttempts - 1) {
        throw error
      }

      await sleep(Math.min(1000 * 2 ** attempt, 8000))
    } finally {
      clearTimeout(timeoutId)
    }
  }

  throw new Error(`GitHub API 요청 실패: ${path}`)
}

async function githubGraphql<T>(query: string, variables: Record<string, unknown>, token?: string): Promise<T> {
  const maxAttempts = 4

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ query, variables })
      })

      if (response.ok) {
        const body = await response.json() as GitHubGraphqlResponse<T>
        if (body.errors?.length) {
          throw new Error(`GitHub GraphQL 오류: ${body.errors.map(error => error.message ?? '').filter(Boolean).join(', ')}`)
        }
        return body.data
      }

      if (shouldRetryGitHubResponse(response.status) && attempt < maxAttempts - 1) {
        await sleep(getGitHubRetryDelayMs(response, attempt))
        continue
      }

      throw new Error(`GitHub GraphQL 요청 실패 (${response.status})`)
    } catch (error) {
      if (attempt >= maxAttempts - 1) {
        throw error
      }

      await sleep(Math.min(1000 * 2 ** attempt, 8000))
    }
  }

  throw new Error('GitHub GraphQL 요청 실패')
}

function formatVersionWithLink(version: string, compareUrl?: string): string {
  if (!compareUrl) return `\`${version}\``
  return `[\`${version}\`](${compareUrl})`
}

function isCommitTarget(target: GitHubTagTarget): target is { __typename: 'Commit', oid: string, committedDate: string } {
  return Boolean(target && target.__typename === 'Commit' && 'committedDate' in target && 'oid' in target)
}

function extractCommitFromTagTarget(target: GitHubTagTarget): { committedAt: string, sha: string } | null {
  let current: GitHubTagTarget | null = target

  while (current && current.__typename === 'Tag') {
    current = current.target ?? null
  }

  if (!isCommitTarget(current)) {
    return null
  }

  return {
    committedAt: current.committedDate,
    sha: current.oid
  }
}

async function fetchRepositoryTags(owner: string, repo: string, token?: string): Promise<TagInfo[]> {
  const tags: TagInfo[] = []
  let cursor: string | null = null
  const query = `
    query ($owner: String!, $repo: String!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        refs(refPrefix: "refs/tags/", first: 100, after: $cursor, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
          nodes {
            name
            target {
              __typename
              ... on Commit {
                oid
                committedDate
              }
              ... on Tag {
                target {
                  __typename
                  ... on Commit {
                    oid
                    committedDate
                  }
                  ... on Tag {
                    target {
                      __typename
                      ... on Commit {
                        oid
                        committedDate
                      }
                    }
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `

  while (true) {
    const data: GitHubTagResponse = await githubGraphql<GitHubTagResponse>(query, { owner, repo, cursor }, token)
    const refs = data.repository?.refs
    if (!refs) break

    for (const node of refs.nodes) {
      const commit = extractCommitFromTagTarget(node.target)
      if (!commit) continue
      tags.push({ name: node.name, committedAt: commit.committedAt })
    }

    if (!refs.pageInfo.hasNextPage || !refs.pageInfo.endCursor) break
    cursor = refs.pageInfo.endCursor
  }

  return tags
}

interface GitHubReleaseResponse {
  tag_name: string
  published_at: string | null
  prerelease: boolean
  draft: boolean
}


async function fetchGitHubReleases(
  owner: string,
  repo: string,
  token?: string,
  lastTranslation?: TranslationCommit | null,
  tagPattern?: string
): Promise<TagInfo[]> {
  const releases: GitHubReleaseResponse[] = []
  let tags: TagInfo[] = []
  const perPage = 100
  const maxPages = 5

  for (let page = 1; page <= maxPages; page++) {
    const pageReleases = await githubApi<GitHubReleaseResponse[]>(
      `/repos/${owner}/${repo}/releases?per_page=${perPage}&page=${page}`,
      token,
      {
        ms: 10_000,
        message: `GitHub Releases 요청 시간 초과 (${owner}/${repo}): 10초`
      }
    )

    if (pageReleases.length === 0) break
    releases.push(...pageReleases)

    if (page === maxPages && pageReleases.length === perPage) {
      throw new Error(`GitHub Releases 조회 제한 초과 (${owner}/${repo}): 최대 500건`)
    }

    tags = releases
      .filter(release => !release.prerelease && !release.draft && release.published_at)
      .sort((a, b) => new Date(b.published_at!).getTime() - new Date(a.published_at!).getTime())
      .map(release => ({
        name: release.tag_name,
        committedAt: release.published_at!
      }))
    const matchingTags = filterTagsByPattern(tags, tagPattern)
    if (lastTranslation !== undefined && matchingTags.length > 0 && (
      !lastTranslation || findBaselineTag(matchingTags, lastTranslation)
    )) {
      return tags
    }

    if (pageReleases.length < perPage) break
  }

  return tags
}

function filterTagsByStrategy(tags: TagInfo[], strategy: VersionStrategy): TagInfo[] {
  if (strategy === 'github') {
    return tags
  }

  if (strategy === 'natural') {
    return tags.filter(tag => !isPrereleaseTag(tag.name))
  }

  if (strategy === 'semantic') {
    return tags.filter(tag => parseStableSemanticVersion(tag.name) !== null)
  }

  return tags
}

function filterTagsByPattern(tags: TagInfo[], tagPattern?: string): TagInfo[] {
  if (!tagPattern) return tags

  const pattern = new RegExp(tagPattern)
  return tags.filter(tag => {
    pattern.lastIndex = 0
    return pattern.test(tag.name)
  })
}

function pickLatestTag(tags: TagInfo[], strategy: VersionStrategy): TagInfo | null {
  if (!tags.length) return null

  if (strategy === 'github') {
    return tags.reduce((latest, tag) => {
      const latestTime = Date.parse(latest.committedAt)
      const tagTime = Date.parse(tag.committedAt)

      if (Number.isNaN(latestTime)) return tag
      if (Number.isNaN(tagTime)) return latest

      return tagTime > latestTime ? tag : latest
    })
  }

  if (strategy === 'natural') {
    const naturalSorter = natsort({ desc: true })
    const sorted = [...tags].sort((a, b) => naturalSorter(a.name, b.name))
    return sorted[0]
  }

  if (strategy === 'semantic') {
    const naturalSorter = natsort({ desc: true })
    const parsed = tags
      .map(tag => {
        const parsedVersion = parseStableSemanticVersion(tag.name)
        if (!parsedVersion) return null
        return { ...tag, parsedVersion }
      })
      .filter((tag): tag is TagInfo & { parsedVersion: semver.SemVer } => tag !== null)

    if (parsed.length === 0) {
      return null
    }

    const sorted = parsed.sort((a, b) => {
      const versionCompare = semver.rcompare(a.parsedVersion.version, b.parsedVersion.version)
      if (versionCompare !== 0) {
        return versionCompare
      }

      return naturalSorter(a.name, b.name)
    })

    return sorted[0]
  }

  return tags[0]
}

function findBaselineTag(tags: TagInfo[], lastTranslation: TranslationCommit | null): TagInfo | null {
  if (!lastTranslation) return null
  const translationTime = new Date(lastTranslation.committedAt).getTime()

  return [...tags]
    .sort((a, b) => new Date(b.committedAt).getTime() - new Date(a.committedAt).getTime())
    .find(tag => new Date(tag.committedAt).getTime() <= translationTime) ?? null
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
}

function normalizeLocalizationPaths(paths: string[]): string[] {
  const trimmed = paths.map(p => p.trim()).filter(p => p.length > 0)
  if (trimmed.some(p => p === '.')) return []
  return [...new Set(trimmed)]
}

function parseCommitDate(commit: GitHubCommit): number {
  const dateStr = commit.commit.committer?.date
  if (!dateStr) return 0
  const ms = new Date(dateStr).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

function pickLatestCommit(commits: GitHubCommit[]): GitHubCommit | null {
  if (commits.length === 0) return null

  return commits.reduce((latest, commit) => {
    return parseCommitDate(commit) > parseCommitDate(latest) ? commit : latest
  })
}

async function fetchLatestCommitForPaths(
  owner: string,
  repo: string,
  branch: string,
  paths: string[],
  token?: string,
  until?: string
): Promise<GitHubCommit | null> {
  const uniquePaths = [...new Set(paths)]
  const commits: GitHubCommit[] = []

  for (const path of uniquePaths) {
    const params = new URLSearchParams({ sha: branch, path, per_page: '1' })
    if (until) params.set('until', until)

    const commitList = await githubApi<GitHubCommit[]>(
      `/repos/${owner}/${repo}/commits?${params.toString()}`,
      token
    )

    const commit = commitList[0]
    if (commit) commits.push(commit)
  }
  return pickLatestCommit(commits)
}

async function resolveDashboardRow(
  meta: ModMeta,
  rootDir: string,
  token?: string,
  cache?: DashboardCache
): Promise<DashboardRow> {
  const rowIdentity = {
    game: meta.game,
    mod: meta.mod,
    componentId: meta.componentId,
    componentName: meta.componentName
  }
  const repositoryCacheKey = `${meta.owner}/${meta.repo}`
  let repoInfoPromise = cache?.repositoryInfo.get(repositoryCacheKey)
  if (!repoInfoPromise) {
    repoInfoPromise = githubApi<{ default_branch: string }>(`/repos/${meta.owner}/${meta.repo}`, token)
    cache?.repositoryInfo.set(repositoryCacheKey, repoInfoPromise)
  }

  let repoInfo: { default_branch: string } | undefined
  try {
    repoInfo = await repoInfoPromise
  } catch {
    // 태그 추적은 저장소 정보 조회 실패 시에도 기존 번역 루트 폴백으로 계속할 수 있습니다.
  }

  // 명시적 컴포넌트는 output_subdir이 있어도 다른 컴포넌트와 실제 출력 루트를
  // 공유할 수 있으므로, 트리를 확인하지 못한 상태에서 루트 이력으로 추정하지 않는다.
  const allowTranslationRootFallback = meta.componentId === undefined
  let translationPaths = resolveComponentTranslationTrackingPaths(
    meta.translationRootPath,
    meta.upstreamLocalization,
    meta.language,
    meta.outputSubdir,
    null,
    allowTranslationRootFallback
  )
  if (repoInfo) {
    const treeCacheKey = `${repositoryCacheKey}/${repoInfo.default_branch}`
    let treePromise = cache?.repositoryTrees.get(treeCacheKey)
    if (!treePromise) {
      treePromise = githubApi<GitHubTreeResponse>(
        `/repos/${meta.owner}/${meta.repo}/git/trees/${encodeURIComponent(repoInfo.default_branch)}?recursive=1`,
        token
      ).catch(() => ({ tree: [], truncated: true }))
      cache?.repositoryTrees.set(treeCacheKey, treePromise)
    }

    const repositoryTree = await treePromise
    translationPaths = resolveComponentTranslationTrackingPaths(
      meta.translationRootPath,
      meta.upstreamLocalization,
      meta.language,
      meta.outputSubdir,
      repositoryTree,
      allowTranslationRootFallback
    )
  }

  if (translationPaths.length === 0) {
    return {
      ...rowIdentity,
      strategy: meta.strategy,
      trackedBy: meta.strategy === 'default' ? 'commit' : 'tag',
      baselineVersion: '번역 파일 매핑 실패',
      latestVersion: '조회 생략',
      status: '조회 실패'
    }
  }

  const translationCacheKey = [...translationPaths].sort().join('\0')
  let lastTranslationPromise = cache?.translationCommits.get(translationCacheKey)
  if (!lastTranslationPromise) {
    lastTranslationPromise = getLastTranslationCommit(rootDir, translationPaths)
    cache?.translationCommits.set(translationCacheKey, lastTranslationPromise)
  }
  const lastTranslation = await lastTranslationPromise
  const preferTagTracking = meta.strategy !== 'default'
  let tags: TagInfo[] = []
  if (preferTagTracking) {
    const tagSource = meta.strategy === 'github' ? 'releases' : 'tags'
    const tagsCacheKey = meta.strategy === 'github'
      ? `${meta.owner}/${meta.repo}/${tagSource}/${lastTranslation?.committedAt ?? 'none'}/${meta.tagPattern ?? 'none'}`
      : `${meta.owner}/${meta.repo}/${tagSource}`
    let tagsPromise = cache?.tags.get(tagsCacheKey)
    if (!tagsPromise) {
      tagsPromise = meta.strategy === 'github'
        ? fetchGitHubReleases(meta.owner, meta.repo, token, lastTranslation, meta.tagPattern)
        : fetchRepositoryTags(meta.owner, meta.repo, token)
      cache?.tags.set(tagsCacheKey, tagsPromise)
    }
    tags = await tagsPromise
  }
  const filteredTags = preferTagTracking
    ? filterTagsByStrategy(filterTagsByPattern(tags, meta.tagPattern), meta.strategy)
    : []
  const latestTag = preferTagTracking ? pickLatestTag(filteredTags, meta.strategy) : null
  const useTagTracking = preferTagTracking && latestTag !== null

  const localizationPaths = normalizeLocalizationPaths(meta.upstreamLocalization)
  const hasLocalizationPaths = localizationPaths.length > 0

  if (!lastTranslation) {
    if (useTagTracking && latestTag) {
      return {
        ...rowIdentity,
        strategy: meta.strategy,
        trackedBy: 'tag',
        baselineVersion: '번역 이력 없음',
        latestVersion: latestTag.name,
        status: '번역 이력 없음'
      }
    }
  }

  if (useTagTracking && latestTag) {
    const baselineTag = findBaselineTag(filteredTags, lastTranslation)
    const isOutdated = baselineTag ? baselineTag.name !== latestTag.name : true
    return {
      ...rowIdentity,
      strategy: meta.strategy,
      trackedBy: 'tag',
      baselineVersion: baselineTag?.name ?? '기준 태그 없음',
      latestVersion: latestTag.name,
      status: isOutdated ? '미반영' : '최신',
      compareUrl: isOutdated && baselineTag
        ? `https://github.com/${meta.owner}/${meta.repo}/compare/${encodeURIComponent(baselineTag.name)}...${encodeURIComponent(latestTag.name)}`
        : undefined
    }
  }

  repoInfo ??= await repoInfoPromise
  const latestCommit = hasLocalizationPaths
    ? await fetchLatestCommitForPaths(meta.owner, meta.repo, repoInfo.default_branch, localizationPaths, token)
    : await githubApi<GitHubCommit>(`/repos/${meta.owner}/${meta.repo}/commits/${repoInfo.default_branch}`, token)

  if (!lastTranslation) {
    return {
      ...rowIdentity,
      strategy: meta.strategy,
      trackedBy: 'commit',
      baselineVersion: '번역 이력 없음',
      latestVersion: latestCommit?.sha.slice(0, 7) ?? '경로 커밋 없음',
      status: '번역 이력 없음'
    }
  }

  const baselineCommit = hasLocalizationPaths
    ? await fetchLatestCommitForPaths(meta.owner, meta.repo, repoInfo.default_branch, localizationPaths, token, lastTranslation.committedAt)
    : (await githubApi<GitHubCommit[]>(
        `/repos/${meta.owner}/${meta.repo}/commits?sha=${repoInfo.default_branch}&until=${encodeURIComponent(lastTranslation.committedAt)}&per_page=1`,
        token
      ))[0]

  if (hasLocalizationPaths && !latestCommit) {
    return {
      ...rowIdentity,
      strategy: meta.strategy,
      trackedBy: 'commit',
      baselineVersion: baselineCommit?.sha.slice(0, 7) ?? '경로 커밋 없음',
      latestVersion: '경로 커밋 없음',
      status: '경로 커밋 없음'
    }
  }

  if (hasLocalizationPaths && !baselineCommit && latestCommit) {
    return {
      ...rowIdentity,
      strategy: meta.strategy,
      trackedBy: 'commit',
      baselineVersion: '번역 이전 경로 커밋 없음',
      latestVersion: latestCommit.sha.slice(0, 7),
      status: '미반영'
    }
  }

  if (!baselineCommit || !latestCommit) {
    return {
      ...rowIdentity,
      strategy: meta.strategy,
      trackedBy: 'commit',
      baselineVersion: baselineCommit?.sha.slice(0, 7) ?? '기준 커밋 조회 실패',
      latestVersion: latestCommit?.sha.slice(0, 7) ?? '최신 커밋 조회 실패',
      status: '조회 실패'
    }
  }

  const baselineSha = baselineCommit.sha.slice(0, 7)
  const latestSha = latestCommit.sha.slice(0, 7)
  const isOutdated = baselineSha !== latestSha

  return {
    ...rowIdentity,
    strategy: meta.strategy,
    trackedBy: 'commit',
    baselineVersion: baselineSha,
    latestVersion: latestSha,
    status: isOutdated ? '미반영' : '최신',
    compareUrl: isOutdated ? `https://github.com/${meta.owner}/${meta.repo}/compare/${baselineCommit.sha}...${latestCommit.sha}` : undefined
  }
}

async function resolveDashboardRows(
  metas: ModMeta[],
  rootDir: string,
  token?: string,
  resolveRow: typeof resolveDashboardRow = resolveDashboardRow
): Promise<DashboardRow[]> {
  const rows: DashboardRow[] = []
  const cache = createDashboardCache()

  for (const meta of metas) {
    try {
      rows.push(await resolveRow(meta, rootDir, token, cache))
    } catch (error) {
      rows.push({
        game: meta.game,
        mod: meta.mod,
        componentId: meta.componentId,
        componentName: meta.componentName,
        strategy: meta.strategy,
        trackedBy: 'commit',
        baselineVersion: '조회 실패',
        latestVersion: '조회 실패',
        status: '조회 실패'
      })
      process.stderr.write(`[경고] ${meta.game}/${meta.mod}: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }

  return rows
}

function buildIssueBody(rows: DashboardRow[]): string {
  const timestamp = new Date().toISOString()
  const outdatedRows = rows.filter(row => row.status === '미반영')
  const failedRows = rows.filter(row => row.status === '조회 실패')
  const noPathCommitRows = rows.filter(row => row.status === '경로 커밋 없음')

  const lines: string[] = []
  lines.push('# 업스트림 변경 대비 번역 미반영 대시보드')
  lines.push('')
  lines.push(`- 마지막 갱신: ${timestamp}`)
  lines.push(`- 미반영 논리 모드 수: ${outdatedRows.length}`)
  lines.push(`- 확인 대상 논리 모드 수: ${rows.length}`)
  if (failedRows.length > 0) {
    lines.push(`- 조회 실패 논리 모드 수(집계 제외): ${failedRows.length}`)
  }
  if (noPathCommitRows.length > 0) {
    lines.push(`- 경로 커밋 없음 논리 모드 수(집계 제외): ${noPathCommitRows.length}`)
  }
  lines.push('')
  lines.push('| 게임 | 번역 묶음 | 논리 모드 | 버전 기준 | 추적 방식 | 번역 기준 버전 | 최신 버전 | 상태 |')
  lines.push('|---|---|---|---|---|---|---|---|')

  for (const row of rows.sort((a, b) => `${a.game}/${a.mod}/${a.componentId ?? ''}`.localeCompare(`${b.game}/${b.mod}/${b.componentId ?? ''}`))) {
    const baselineText = formatVersionWithLink(row.baselineVersion, row.compareUrl)
    const latestText = row.compareUrl ? `[\`${row.latestVersion}\`](${row.compareUrl})` : `\`${row.latestVersion}\``
    const componentText = row.componentName
      ? `${escapeMarkdownTableCell(row.componentName)} (\`${row.componentId}\`)`
      : '-'
    lines.push(`| ${escapeMarkdownTableCell(row.game.toUpperCase())} | ${escapeMarkdownTableCell(row.mod)} | ${componentText} | ${row.strategy} | ${row.trackedBy} | ${baselineText} | ${latestText} | ${row.status} |`)
  }

  lines.push('')
  lines.push('> 규칙: 각 논리 모드의 `version_strategy`가 `default`가 아니면 `tag_pattern`과 일치하는 tag 버전으로 비교하며(유효한 태그가 없으면 커밋으로 폴백), 그 외에는 해당 논리 모드의 현지화 파일을 변경한 커밋 기준으로 비교합니다. 번역 기준 시점은 기본 브랜치 트리에서 계산한 실제 한국어 대상 파일 이력으로 판정합니다. 트리 조회 실패·잘림·대상 파일 없음 시 legacy 설정만 기존 출력 루트 이력으로 폴백하고, 명시적 컴포넌트는 다른 컴포넌트 이력이 섞이는 최신 오판을 막기 위해 조회 실패로 표시합니다. git 저장소가 아닌 upstream은 제외합니다.')

  return `${lines.join('\n')}\n`
}

async function main() {
  const rootDir = join(import.meta.dirname, '..')
  const token = process.env.GITHUB_TOKEN

  const metas = await findModMetas(rootDir)
  const rows = await resolveDashboardRows(metas, rootDir, token)

  process.stdout.write(buildIssueBody(rows))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exit(1)
  })
}

export {
  buildIssueBody,
  fetchGitHubReleases,
  fetchLatestCommitForPaths,
  findBaselineTag,
  filterTagsByPattern,
  filterTagsByStrategy,
  normalizeLocalizationPaths,
  parseGitHubUrl,
  pickLatestCommit,
  pickLatestTag,
  resolveComponentTranslationPaths,
  resolveComponentTranslationTrackingPaths,
  resolveDashboardRows
}

export type {
  DashboardRow,
  GitHubCommit,
  GitHubTreeResponse,
  TagInfo,
  TranslationCommit
}
