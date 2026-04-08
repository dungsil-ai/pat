import { readdir, readFile, access } from 'node:fs/promises'
import { join } from 'pathe'
import process from 'node:process'
import { parseToml } from './parser/toml'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import natsort from 'natsort'
import semver from 'semver'

const execFileAsync = promisify(execFile)

type VersionStrategy = 'semantic' | 'natural' | 'default' | 'github'

interface MetaTomlConfig {
  upstream?: {
    url?: string
    localization?: string[]
    language?: string
    version_strategy?: VersionStrategy
  }
}

interface ModMeta {
  game: string
  mod: string
  owner: string
  repo: string
  strategy: VersionStrategy
  translationPath: string
  upstreamLocalization: string[]
}

interface TranslationCommit {
  shortSha: string
  committedAt: string
}

interface DashboardRow {
  game: string
  mod: string
  strategy: string
  trackedBy: 'tag' | 'commit'
  baselineVersion: string
  latestVersion: string
  status: '미반영' | '최신' | '번역 이력 없음' | '조회 실패' | '경로 커밋 없음'
  compareUrl?: string
}

interface GitHubCommit {
  sha: string
  commit: {
    committer?: {
      date?: string
    }
  }
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

      const content = await readFile(metaPath, 'utf-8')
      const config = parseToml(content) as MetaTomlConfig
      const url = config.upstream?.url
      if (!url) continue

      const repo = parseGitHubUrl(url)
      if (!repo) continue

      metas.push({
        game,
        mod: modEntry.name,
        owner: repo.owner,
        repo: repo.repo,
        strategy: config.upstream?.version_strategy ?? 'default',
        translationPath: await resolveTranslationPath(rootDir, game, modEntry.name),
        upstreamLocalization: config.upstream?.localization ?? []
      })
    }
  }

  return metas
}

async function getLastTranslationCommit(rootDir: string, translationPath: string): Promise<TranslationCommit | null> {
  try {
    const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%h|%cI', '--', translationPath], { cwd: rootDir })
    const line = stdout.trim()
    if (!line) return null
    const [shortSha, committedAt] = line.split('|')
    if (!shortSha || !committedAt) return null
    return { shortSha, committedAt }
  } catch {
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function shouldRetryGitHubResponse(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
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

async function githubApi<T>(path: string, token?: string): Promise<T> {
  const maxAttempts = 4

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`https://api.github.com${path}`, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
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

async function fetchGitHubReleases(owner: string, repo: string, token?: string): Promise<TagInfo[]> {
  const releases = await githubApi<GitHubReleaseResponse[]>(
    `/repos/${owner}/${repo}/releases?per_page=100`,
    token
  )

  return releases
    .filter(release => !release.prerelease && !release.draft && release.published_at)
    .map(release => ({
      name: release.tag_name,
      committedAt: release.published_at!
    }))
}

function filterTagsByStrategy(tags: TagInfo[], strategy: VersionStrategy): TagInfo[] {
  if (strategy === 'natural') {
    const preReleaseKeywords = ['beta', 'alpha', 'rc', 'snapshot', 'test', 'dev']
    return tags.filter(tag => {
      const lower = tag.name.toLowerCase()
      return !preReleaseKeywords.some(keyword => lower.includes(keyword))
    })
  }

  if (strategy === 'semantic') {
    return tags.filter(tag => {
      const normalizedTag = tag.name.replace(/^v/, '')
      const parsed = semver.parse(normalizedTag) ?? semver.coerce(normalizedTag)
      if (!parsed) return false
      return semver.prerelease(parsed) === null
    })
  }

  return tags
}

function pickLatestTag(tags: TagInfo[], strategy: VersionStrategy): TagInfo | null {
  if (!tags.length) return null

  if (strategy === 'natural') {
    const naturalSorter = natsort({ desc: true })
    const sorted = [...tags].sort((a, b) => naturalSorter(a.name, b.name))
    return sorted[0]
  }

  if (strategy === 'semantic') {
    const naturalSorter = natsort({ desc: true })
    const parsed = tags
      .map(tag => {
        const normalizedTag = tag.name.replace(/^v/, '')
        const parsedVersion = semver.parse(normalizedTag) ?? semver.coerce(normalizedTag)
        if (!parsedVersion) return null
        if (semver.prerelease(parsedVersion)) return null
        return { ...tag, normalizedTag, parsedVersion }
      })
      .filter((tag): tag is TagInfo & { normalizedTag: string, parsedVersion: semver.SemVer } => tag !== null)

    if (parsed.length === 0) {
      return null
    }

    const sorted = parsed.sort((a, b) => {
      const versionCompare = semver.rcompare(a.parsedVersion.version, b.parsedVersion.version)
      if (versionCompare !== 0) {
        return versionCompare
      }

      return naturalSorter(a.normalizedTag, b.normalizedTag)
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

async function resolveDashboardRow(meta: ModMeta, rootDir: string, token?: string): Promise<DashboardRow> {
  const lastTranslation = await getLastTranslationCommit(rootDir, meta.translationPath)
  const repoInfo = await githubApi<{ default_branch: string }>(`/repos/${meta.owner}/${meta.repo}`, token)
  const preferTagTracking = meta.strategy !== 'default'
  const tags = preferTagTracking
    ? (meta.strategy === 'github'
      ? await fetchGitHubReleases(meta.owner, meta.repo, token)
      : await fetchRepositoryTags(meta.owner, meta.repo, token))
    : []
  const filteredTags = preferTagTracking ? filterTagsByStrategy(tags, meta.strategy) : []
  const latestTag = preferTagTracking ? pickLatestTag(filteredTags, meta.strategy) : null
  const useTagTracking = preferTagTracking && latestTag !== null

  const localizationPaths = meta.strategy === 'default' ? normalizeLocalizationPaths(meta.upstreamLocalization) : []
  const hasLocalizationPaths = localizationPaths.length > 0
  const latestCommit = hasLocalizationPaths
    ? await fetchLatestCommitForPaths(meta.owner, meta.repo, repoInfo.default_branch, localizationPaths, token)
    : await githubApi<GitHubCommit>(`/repos/${meta.owner}/${meta.repo}/commits/${repoInfo.default_branch}`, token)

  if (!lastTranslation) {
    if (useTagTracking && latestTag) {
      return {
        game: meta.game,
        mod: meta.mod,
        strategy: meta.strategy,
        trackedBy: 'tag',
        baselineVersion: '번역 이력 없음',
        latestVersion: latestTag.name,
        status: '번역 이력 없음'
      }
    }

    return {
      game: meta.game,
      mod: meta.mod,
      strategy: meta.strategy,
      trackedBy: 'commit',
      baselineVersion: '번역 이력 없음',
      latestVersion: latestCommit?.sha.slice(0, 7) ?? '경로 커밋 없음',
      status: '번역 이력 없음'
    }
  }

  if (useTagTracking && latestTag) {
    const baselineTag = findBaselineTag(filteredTags, lastTranslation)
    const isOutdated = baselineTag ? baselineTag.name !== latestTag.name : true
    return {
      game: meta.game,
      mod: meta.mod,
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

  const baselineCommit = hasLocalizationPaths
    ? await fetchLatestCommitForPaths(meta.owner, meta.repo, repoInfo.default_branch, localizationPaths, token, lastTranslation.committedAt)
    : (await githubApi<GitHubCommit[]>(
        `/repos/${meta.owner}/${meta.repo}/commits?sha=${repoInfo.default_branch}&until=${encodeURIComponent(lastTranslation.committedAt)}&per_page=1`,
        token
      ))[0]

  if (hasLocalizationPaths && !latestCommit) {
    return {
      game: meta.game,
      mod: meta.mod,
      strategy: meta.strategy,
      trackedBy: 'commit',
      baselineVersion: baselineCommit?.sha.slice(0, 7) ?? '경로 커밋 없음',
      latestVersion: '경로 커밋 없음',
      status: '경로 커밋 없음'
    }
  }

  if (hasLocalizationPaths && !baselineCommit && latestCommit) {
    return {
      game: meta.game,
      mod: meta.mod,
      strategy: meta.strategy,
      trackedBy: 'commit',
      baselineVersion: '번역 이전 경로 커밋 없음',
      latestVersion: latestCommit.sha.slice(0, 7),
      status: '미반영'
    }
  }

  if (!baselineCommit || !latestCommit) {
    return {
      game: meta.game,
      mod: meta.mod,
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
    game: meta.game,
    mod: meta.mod,
    strategy: meta.strategy,
    trackedBy: 'commit',
    baselineVersion: baselineSha,
    latestVersion: latestSha,
    status: isOutdated ? '미반영' : '최신',
    compareUrl: isOutdated ? `https://github.com/${meta.owner}/${meta.repo}/compare/${baselineCommit.sha}...${latestCommit.sha}` : undefined
  }
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
  lines.push(`- 미반영 모드 수: ${outdatedRows.length}`)
  lines.push(`- 확인 대상 모드 수: ${rows.length}`)
  if (failedRows.length > 0) {
    lines.push(`- 조회 실패 모드 수(집계 제외): ${failedRows.length}`)
  }
  if (noPathCommitRows.length > 0) {
    lines.push(`- 경로 커밋 없음 모드 수(집계 제외): ${noPathCommitRows.length}`)
  }
  lines.push('')
  lines.push('| 게임 | 모드 | 버전 기준 | 추적 방식 | 번역 기준 버전 | 최신 버전 | 상태 |')
  lines.push('|---|---|---|---|---|---|---|')

  for (const row of rows.sort((a, b) => `${a.game}/${a.mod}`.localeCompare(`${b.game}/${b.mod}`))) {
    const baselineText = formatVersionWithLink(row.baselineVersion, row.compareUrl)
    const latestText = row.compareUrl ? `[\`${row.latestVersion}\`](${row.compareUrl})` : `\`${row.latestVersion}\``
    lines.push(`| ${row.game.toUpperCase()} | ${row.mod} | ${row.strategy} | ${row.trackedBy} | ${baselineText} | ${latestText} | ${row.status} |`)
  }

  lines.push('')
  lines.push('> 규칙: `version_strategy`가 `default`가 아닌 업스트림은 tag 버전으로 비교하며(유효한 태그가 없으면 커밋으로 폴백), 그 외에는 현지화 파일을 변경한 커밋 기준으로 비교합니다(`upstream.localization` 경로가 없으면 기본 브랜치 전체 커밋으로 폴백). git 저장소가 아닌 upstream은 제외합니다.')

  return `${lines.join('\n')}\n`
}

async function main() {
  const rootDir = join(import.meta.dirname, '..')
  const token = process.env.GITHUB_TOKEN

  const metas = await findModMetas(rootDir)
  const rows: DashboardRow[] = []

  for (const meta of metas) {
    try {
      rows.push(await resolveDashboardRow(meta, rootDir, token))
    } catch (error) {
      rows.push({
        game: meta.game,
        mod: meta.mod,
        strategy: meta.strategy,
        trackedBy: 'commit',
        baselineVersion: '조회 실패',
        latestVersion: '조회 실패',
        status: '조회 실패'
      })
      process.stderr.write(`[경고] ${meta.game}/${meta.mod}: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }

  process.stdout.write(buildIssueBody(rows))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exit(1)
  })
}

export {
  fetchGitHubReleases,
  fetchLatestCommitForPaths,
  findBaselineTag,
  filterTagsByStrategy,
  normalizeLocalizationPaths,
  parseGitHubUrl,
  pickLatestCommit,
  pickLatestTag
}

export type {
  GitHubCommit,
  TagInfo,
  TranslationCommit
}
