import { readdir, readFile, access } from 'node:fs/promises'
import { join } from 'pathe'
import process from 'node:process'
import { parseToml } from './parser/toml'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type VersionStrategy = 'semantic' | 'natural' | 'default'

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
  status: '미반영' | '최신' | '번역 이력 없음'
  compareUrl?: string
}

interface GitHubTag {
  name: string
  commit: {
    sha: string
  }
}

interface GitHubCommit {
  sha: string
  commit: {
    committer?: {
      date?: string
    }
  }
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
        translationPath: await resolveTranslationPath(rootDir, game, modEntry.name)
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

async function githubApi<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    }
  })

  if (!response.ok) {
    throw new Error(`GitHub API 요청 실패 (${response.status}): ${path}`)
  }

  return await response.json() as T
}

function formatVersionWithLink(version: string, compareUrl?: string): string {
  if (!compareUrl) return `\`${version}\``
  return `[\`${version}\`](${compareUrl})`
}

async function resolveDashboardRow(meta: ModMeta, rootDir: string, token?: string): Promise<DashboardRow> {
  const lastTranslation = await getLastTranslationCommit(rootDir, meta.translationPath)
  const repoInfo = await githubApi<{ default_branch: string }>(`/repos/${meta.owner}/${meta.repo}`, token)
  const latestCommit = await githubApi<GitHubCommit>(`/repos/${meta.owner}/${meta.repo}/commits/${repoInfo.default_branch}`, token)
  const tags = await githubApi<GitHubTag[]>(`/repos/${meta.owner}/${meta.repo}/tags?per_page=100`, token)
  const useTagTracking = meta.strategy !== 'default' && tags.length > 0

  if (!lastTranslation) {
    if (useTagTracking) {
      const latestTag = tags[0].name
      return {
        game: meta.game,
        mod: meta.mod,
        strategy: meta.strategy,
        trackedBy: 'tag',
        baselineVersion: '번역 이력 없음',
        latestVersion: latestTag,
        status: '번역 이력 없음'
      }
    }

    return {
      game: meta.game,
      mod: meta.mod,
      strategy: meta.strategy,
      trackedBy: 'commit',
      baselineVersion: '번역 이력 없음',
      latestVersion: latestCommit.sha.slice(0, 7),
      status: '번역 이력 없음'
    }
  }

  if (useTagTracking) {
    const latestTag = tags[0]
    let baselineTag: GitHubTag | null = null

    for (const tag of tags) {
      const tagCommit = await githubApi<GitHubCommit>(`/repos/${meta.owner}/${meta.repo}/commits/${tag.commit.sha}`, token)
      const tagDate = tagCommit.commit.committer?.date
      if (!tagDate) continue

      if (new Date(tagDate).getTime() <= new Date(lastTranslation.committedAt).getTime()) {
        baselineTag = tag
        break
      }
    }

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

  const baselineCommitList = await githubApi<GitHubCommit[]>(
    `/repos/${meta.owner}/${meta.repo}/commits?sha=${repoInfo.default_branch}&until=${encodeURIComponent(lastTranslation.committedAt)}&per_page=1`,
    token
  )
  const baselineCommit = baselineCommitList[0]

  if (!baselineCommit) {
    return {
      game: meta.game,
      mod: meta.mod,
      strategy: meta.strategy,
      trackedBy: 'commit',
      baselineVersion: '기준 커밋 없음',
      latestVersion: latestCommit.sha.slice(0, 7),
      status: '미반영'
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

  const lines: string[] = []
  lines.push('# 업스트림 변경 대비 번역 미반영 대시보드')
  lines.push('')
  lines.push(`- 마지막 갱신: ${timestamp}`)
  lines.push(`- 미반영 모드 수: ${outdatedRows.length}`)
  lines.push(`- 확인 대상 모드 수: ${rows.length}`)
  lines.push('')
  lines.push('| 게임 | 모드 | 버전 기준 | 추적 방식 | 번역 기준 버전 | 최신 버전 | 상태 |')
  lines.push('|---|---|---|---|---|---|---|')

  for (const row of rows.sort((a, b) => `${a.game}/${a.mod}`.localeCompare(`${b.game}/${b.mod}`))) {
    const baselineText = formatVersionWithLink(row.baselineVersion, row.compareUrl)
    const latestText = row.compareUrl ? `[\`${row.latestVersion}\`](${row.compareUrl})` : `\`${row.latestVersion}\``
    lines.push(`| ${row.game.toUpperCase()} | ${row.mod} | ${row.strategy} | ${row.trackedBy} | ${baselineText} | ${latestText} | ${row.status} |`)
  }

  lines.push('')
  lines.push('> 규칙: `version_strategy`가 `default`가 아닌 업스트림은 tag 버전으로 비교하고, 그 외에는 기본 브랜치 커밋 ID로 비교합니다. git 저장소가 아닌 upstream은 제외합니다.')

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
        status: '미반영'
      })
      process.stderr.write(`[경고] ${meta.game}/${meta.mod}: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }

  process.stdout.write(buildIssueBody(rows))
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
