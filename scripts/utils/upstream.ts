/**
 * upstream 리포지토리 관리 유틸리티
 * 
 * git submodule 대신 sparse checkout과 partial clone을 사용하여
 * 필요한 localization 파일만 효율적으로 다운로드합니다.
 * 
 * meta.toml 파일에서 모든 설정 정보 (URL, localization 경로)를 읽어옵니다.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'pathe'
import * as semver from 'semver'
import natsort from 'natsort'
import { log } from './logger'
import { delay } from './delay'
import { reportVersionStrategyError } from './version-strategy-reporter'
import { migrateLegacyUpstreamFileHashes } from './upstream-file-hashes'
import { isPrereleaseTag, parseStableSemanticVersion } from './version-tags'
import {
  ModMetaConfigError,
  readModMeta,
  type NormalizedUpstreamComponent,
  type VersionStrategy
} from '../config/mod-meta'

export type { VersionStrategy } from '../config/mod-meta'

const execFileAsync = promisify(execFile)

export class VersionStrategyError extends Error {
  constructor(
    message: string,
    public configPath: string,
    public invalidStrategy?: string,
    public gameType?: string
  ) {
    super(message)
    this.name = 'VersionStrategyError'
  }
}

export interface UpstreamConfig {
  url: string
  path: string
  localizationPaths: string[]
  versionStrategy?: VersionStrategy
  components?: NormalizedUpstreamComponent[]
}

/**
 * meta.toml 파일을 기반으로 upstream 설정을 추출합니다
 */
export async function parseUpstreamConfigs(rootPath: string, targetGameType?: string, targetMod?: string): Promise<UpstreamConfig[]> {
  const configs: UpstreamConfig[] = []
  
  // meta.toml 파일들을 찾아서 처리
  const metaConfigs = await findMetaTomlConfigs(rootPath, targetGameType, targetMod)
  configs.push(...metaConfigs)
  
  if (configs.length === 0) {
    const gameMessage = targetGameType ? `${targetGameType} 게임의 ` : ''
    const modMessage = targetMod ? `${targetMod} 모드의 ` : ''
    log.error(`${gameMessage}${modMessage}meta.toml 파일이 없습니다. 모든 모드 디렉토리에 meta.toml 파일이 필요합니다.`)
    throw new Error('meta.toml 파일이 없습니다')
  }
  
  return configs
}

/**
 * 모든 meta.toml 파일을 찾아서 upstream 설정을 추출합니다
 */
async function findMetaTomlConfigs(rootPath: string, targetGameType?: string, targetMod?: string): Promise<UpstreamConfig[]> {
  const configs: UpstreamConfig[] = []
  const gameDirectories = targetGameType ? [targetGameType] : ['ck3', 'vic3', 'stellaris']
  
  for (const gameDir of gameDirectories) {
    const gamePath = join(rootPath, gameDir)
    
    try {
      await access(gamePath)
      const modDirs = await readdir(gamePath, { withFileTypes: true })
      
      for (const modDir of modDirs) {
        if (modDir.isDirectory()) {
          // 특정 모드가 지정된 경우 해당 모드만 처리
          if (targetMod && modDir.name !== targetMod) {
            continue
          }
          
          const metaPath = join(gamePath, modDir.name, 'meta.toml')
          
          try {
            await access(metaPath)
            const config = await parseMetaTomlConfig(metaPath, gameDir, modDir.name)
            if (config) {
              configs.push(config)
            }
          } catch {
            log.info(`[${gameDir}/${modDir.name}] meta.toml 파일이 없음`)
          }
        }
      }
    } catch {
      log.info(`[${gameDir}] 게임 디렉토리가 존재하지 않음`)
    }
  }
  
  return configs
}

/**
 * 개별 meta.toml 파일을 파싱하여 upstream 설정을 생성합니다
 * @internal 테스트 목적으로 export됨
 */
export async function parseMetaTomlConfig(metaPath: string, gameDir: string, modName: string): Promise<UpstreamConfig | null> {
  try {
    const config = await readModMeta(metaPath)
    
    const upstreamPath = `${gameDir}/${modName}/upstream`
    
    // meta.toml에서 URL을 직접 읽어옴
    if (!config.upstream.url) {
      log.info(`[${upstreamPath}] meta.toml에 URL이 없음, 일반 파일 기반 upstream으로 처리`)
      return {
        url: '', // 빈 URL로 일반 파일 기반임을 표시
        path: upstreamPath,
        localizationPaths: config.upstream.localizationPaths,
        versionStrategy: config.upstream.versionStrategy,
        components: config.upstream.components
      }
    }
    
    return {
      url: config.upstream.url,
      path: upstreamPath,
      localizationPaths: config.upstream.localizationPaths,
      versionStrategy: config.upstream.versionStrategy,
      components: config.upstream.components
    }
  } catch (error) {
    if (
      error instanceof ModMetaConfigError
      && error.field?.endsWith('version_strategy')
      && error.message.includes('지원 값:')
    ) {
      const strategyError = new VersionStrategyError(
        error.message,
        `${gameDir}/${modName}/meta.toml`,
        undefined,
        gameDir
      )

      reportVersionStrategyError(strategyError).catch((reportError) => {
        log.warn('GitHub Issues 보고 실패:', reportError)
      })
    }

    log.warn(`meta.toml 파싱 실패: ${metaPath}`, error)
    return null
  }
}


/**
 * 효율적인 방식으로 upstream 리포지토리를 클론하고 localization 파일만 체크아웃합니다
 */
export async function updateUpstreamOptimized(config: UpstreamConfig, rootPath: string): Promise<void> {
  const fullPath = join(rootPath, config.path)

  // git 기반이 아닌 일반 파일 업스트림인 경우 건너뛰기
  if (!config.url) {
    log.info(`[${config.path}] 일반 파일 기반 upstream, git 업데이트 건너뛰기`)
    return
  }

  let repositoryExists = true
  try {
    await access(fullPath)
  } catch {
    repositoryExists = false
  }

  if (!repositoryExists) {
    log.info(`[${config.path}] 새로 클론 중...`)
    await cloneOptimizedRepository(fullPath, config)
    return
  }

  log.info(`[${config.path}] 이미 존재함, 업데이트 확인 중...`)
  await updateExistingRepository(fullPath, config)
}

/**
 * GitHub URL에서 owner/repo를 추출합니다
 * HTTPS (https://github.com/owner/repo) 및 SSH (git@github.com:owner/repo) 형식을 지원합니다.
 * @internal 테스트 목적으로 export됨
 */
export function parseGitHubUrl(url: string): { owner: string, repo: string } | null {
  // GitHub URL 패턴: HTTPS 또는 SSH 형식만 매칭
  const match = url.match(/(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

/**
 * GitHub API 요청에 사용할 헤더를 생성합니다.
 * GITHUB_TOKEN 환경변수가 있으면 인증 헤더를 추가합니다 (API 요청 제한 완화).
 */
function getGitHubApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'paradox-auto-translate'
  }
  
  // GITHUB_TOKEN이 있으면 인증 헤더 추가 (시간당 60회 -> 1000회로 제한 증가)
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`
  }
  
  return headers
}

interface GitHubReleaseTag {
  tag_name: string
  published_at?: string | null
  prerelease?: boolean
  draft?: boolean
}

const GITHUB_RELEASES_PER_PAGE = 100
const GITHUB_RELEASES_MAX_PAGES = 5
const GITHUB_RELEASES_MAX_ITEMS = GITHUB_RELEASES_PER_PAGE * GITHUB_RELEASES_MAX_PAGES
const GITHUB_RELEASE_TIMEOUT_MS = 10_000

async function fetchGitHubReleaseJson<T>(
  apiUrl: string,
  owner: string,
  repo: string,
  configPath: string
): Promise<{ response: Response, data: T | null }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GITHUB_RELEASE_TIMEOUT_MS)

  try {
    const response = await fetch(apiUrl, {
      headers: getGitHubApiHeaders(),
      signal: controller.signal
    })
    const data = response.ok ? await response.json() as T : null
    return { response, data }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `[${owner}/${repo}] GitHub Releases HTTP 시도 ${GITHUB_RELEASE_TIMEOUT_MS / 1000}초 타임아웃: 응답이 완료되지 않아 중단했습니다 (${configPath})`,
        { cause: error }
      )
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function* fetchGitHubReleasePages(
  owner: string,
  repo: string,
  configPath: string
): AsyncGenerator<GitHubReleaseTag[]> {
  for (let page = 1; page <= GITHUB_RELEASES_MAX_PAGES; page++) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${GITHUB_RELEASES_PER_PAGE}&page=${page}`
    const { response, data } = await fetchGitHubReleaseJson<GitHubReleaseTag[]>(apiUrl, owner, repo, configPath)
    if (!response.ok) {
      throw new Error(`GitHub API 실패: ${response.status} ${response.statusText} (${configPath})`)
    }

    const pageReleases = data ?? []
    yield pageReleases

    if (pageReleases.length < GITHUB_RELEASES_PER_PAGE) {
      return
    }

    if (page === GITHUB_RELEASES_MAX_PAGES) {
      throw new Error(
        `[${owner}/${repo}] GitHub Releases 목록 조회 제한: ${GITHUB_RELEASES_MAX_PAGES}페이지·${GITHUB_RELEASES_MAX_ITEMS}건을 모두 사용하여 이후 이력을 확인할 수 없습니다 (${configPath})`
      )
    }
  }
}

async function fetchAllGitHubReleaseTags(
  owner: string,
  repo: string,
  configPath: string
): Promise<GitHubReleaseTag[]> {
  const releases: GitHubReleaseTag[] = []
  for await (const pageReleases of fetchGitHubReleasePages(owner, repo, configPath)) {
    releases.push(...pageReleases)
  }
  return releases
}

function isPublicGitHubRelease(release: GitHubReleaseTag): boolean {
  return Boolean(release.tag_name && release.published_at && !release.prerelease && !release.draft)
}

async function findFirstPublicGitHubReleaseTag(
  owner: string,
  repo: string,
  configPath: string,
  tagMatcher: RegExp | null
): Promise<string | null> {
  for await (const pageReleases of fetchGitHubReleasePages(owner, repo, configPath)) {
    const release = pageReleases.find(candidate => (
      isPublicGitHubRelease(candidate)
      && (!tagMatcher || tagMatcher.test(candidate.tag_name))
    ))
    if (release) {
      return release.tag_name
    }
  }

  return null
}

/**
 * GitHub Releases API를 사용하여 최신 릴리즈 태그를 가져옵니다
 * 비개발자가 만든 다양한 형식의 태그도 지원합니다.
 * @internal 테스트 목적으로 export됨
 */
export async function getLatestReleaseFromGitHub(
  owner: string,
  repo: string,
  configPath: string,
  tagPattern?: string
): Promise<string | null> {
  try {
    const tagMatcher = compileTagPattern(tagPattern, configPath)

    if (!tagMatcher) {
      // 패턴이 없을 때는 기존 동작과 API 호출 수를 유지합니다.
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`
      log.info(`[${configPath}] GitHub Releases API 확인 중...`)
      const { response, data } = await fetchGitHubReleaseJson<{ tag_name: string }>(apiUrl, owner, repo, configPath)

      if (response.ok && data?.tag_name) {
        log.info(`[${configPath}] GitHub 최신 릴리즈 발견: ${data.tag_name}`)
        return data.tag_name
      }
    }
    
    // 패턴이 있거나 최신 릴리즈가 없으면 첫 유효 공개 릴리스를 찾은 페이지에서 종료합니다.
    const releaseTag = await findFirstPublicGitHubReleaseTag(owner, repo, configPath, tagMatcher)
    if (releaseTag) {
      log.info(`[${configPath}] GitHub 릴리즈 발견: ${releaseTag}`)
      return releaseTag
    }
    
    return null
  } catch (error) {
    // 에러 유형에 따라 상세한 로깅
    if (error instanceof Error) {
      log.debug(`[${configPath}] GitHub Releases API 실패: ${error.message}`, error)
    } else {
      log.debug(`[${configPath}] GitHub Releases API 실패:`, error)
    }
    throw error
  }
}

/**
 * GitHub Releases의 최신 태그를 기준으로 버전을 선택합니다.
 */
async function getGitHubReleaseVersion(
  repoUrl: string,
  configPath: string,
  tagPattern?: string
): Promise<{ type: 'tag', name: string }> {
  const githubInfo = parseGitHubUrl(repoUrl)
  if (!githubInfo) {
    throw new VersionStrategyError(`GitHub 릴리스 전략은 GitHub 저장소만 지원합니다: ${repoUrl}`, configPath)
  }

  return await upstreamRetry(
    async () => {
      const latestReleaseTag = await getLatestReleaseFromGitHub(
        githubInfo.owner,
        githubInfo.repo,
        configPath,
        tagPattern
      )
      if (!latestReleaseTag) {
        throw new Error('GitHub 릴리스 태그를 찾을 수 없음')
      }

      return { type: 'tag', name: latestReleaseTag }
    },
    `${configPath}-github-release`
  )
}

/**
 * 버전 전략에 따라 원격 리포지토리의 최신 참조를 가져옵니다.
 * 
 * @param repoUrl Git 저장소 URL
 * @param configPath 로깅을 위한 경로
 * @param versionStrategy 버전 전략 (semantic, natural, default)
 * @returns 최신 참조 정보
 * @internal 테스트 목적으로 export됨
 */
export async function getLatestRefFromRemote(
  repoUrl: string, 
  configPath: string,
  versionStrategy: VersionStrategy = 'default',
  tagPattern?: string
): Promise<{ type: 'tag' | 'branch', name: string }> {
  
  log.info(`[${configPath}] 버전 전략(${versionStrategy})으로 최신 버전 확인 중...`)
  
  switch (versionStrategy) {
    case 'semantic':
      return await getSemanticVersion(repoUrl, configPath, tagPattern)
    case 'natural':
      return await getNaturalVersion(repoUrl, configPath, tagPattern)
    case 'default':
      return await getDefaultBranch(repoUrl, configPath)
    case 'github':
      return await getGitHubReleaseVersion(repoUrl, configPath, tagPattern)
  }
}

function compileTagPattern(tagPattern: string | undefined, configPath: string): RegExp | null {
  if (!tagPattern) {
    return null
  }

  try {
    return new RegExp(tagPattern)
  } catch {
    throw new VersionStrategyError(`유효하지 않은 tag_pattern: ${tagPattern}`, configPath)
  }
}

/**
 * 업스트림 전용 재시도 함수
 */
async function upstreamRetry<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  const MAX_RETRIES = 3
  const RETRY_DELAYS = [1_000, 2_000, 4_000] // 밀리초 단위
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation()
    } catch (error) {
      const message = (error as Error).message
      const isRetryable = message.includes('429 Too Many Requests')
        || /(?:GitHub API 실패:|HTTP(?:\/\d(?:\.\d)?)?)\s*5\d\d\b/i.test(message)

      // 429, 5xx 오류만 재시도
      if (!isRetryable) {
        throw error
      }
      
      if (attempt === MAX_RETRIES) {
        throw new Error(`${operationName} 실패 (최대 재시도 초과): ${message}`)
      }
      
      log.info(`[${operationName}] 재시도 ${attempt}/${MAX_RETRIES}: ${message}`)
      await delay(RETRY_DELAYS[attempt - 1])
    }
  }
  
  throw new Error(`${operationName} 실패: 예외 상황`)
}

/**
 * GitHub Releases API를 통한 시멘틱 버전 전략
 */
async function getSemanticVersion(
  repoUrl: string,
  configPath: string,
  tagPattern?: string
): Promise<{ type: 'tag', name: string }> {
  const githubInfo = parseGitHubUrl(repoUrl)
  if (!githubInfo) {
    throw new VersionStrategyError(`Semantic 전략은 GitHub 저장소만 지원합니다: ${repoUrl}`, configPath)
  }
  
  return await upstreamRetry(
    async () => {
      const releases = await fetchAllGitHubReleaseTags(
        githubInfo.owner,
        githubInfo.repo,
        configPath
      )
      const tagMatcher = compileTagPattern(tagPattern, configPath)

      // semver 정렬을 위해 태그를 파싱하되, 실제 체크아웃에는 원본 태그명을 사용
      const parsedReleases = releases
        .filter(({ tag_name }) => !tagMatcher || tagMatcher.test(tag_name))
        .map(({ tag_name }) => {
          const normalizedTag = tag_name.replace(/^v/, '')
          const parsed = parseStableSemanticVersion(tag_name)
          if (!parsed) {
            return null
          }

          return {
            originalTag: tag_name,
            normalizedTag,
            normalizedVersion: parsed.version
          }
        })
        .filter((release): release is { originalTag: string, normalizedTag: string, normalizedVersion: string } => release !== null)

      if (parsedReleases.length === 0) {
        throw new Error(`유효한 시멘틱 버전 태그를 찾을 수 없음`)
      }

      // semver 정렬 (오름차순) 후 가장 마지막 값 선택
      const naturalSorter = natsort({ desc: true })
      const sorted = parsedReleases.sort((a, b) => {
        const versionCompare = semver.compare(a.normalizedVersion, b.normalizedVersion)
        if (versionCompare !== 0) {
          return versionCompare
        }

        // 같은 시멘틱 버전(예: 1.18.1, 1.18.1.a, 1.18.1.b)에서는 자연 정렬로 최신 태그 선택
        return -naturalSorter(a.normalizedTag, b.normalizedTag)
      })
      return { type: 'tag', name: sorted[sorted.length - 1].originalTag }
    },
    `${configPath}-semantic`
  )
}

/**
 * git ls-remote를 통한 자연 정렬 버전 전략
 */
async function getNaturalVersion(
  repoUrl: string,
  configPath: string,
  tagPattern?: string
): Promise<{ type: 'tag', name: string }> {
  return await upstreamRetry(
    async () => {
      const { stdout: tagsOutput } = await execFileAsync('git', ['ls-remote', '--tags', '--refs', repoUrl], {
        timeout: 30000
      })
      
      if (!tagsOutput.trim()) {
        throw new Error(`태그를 찾을 수 없음`)
      }

      const tagMatcher = compileTagPattern(tagPattern, configPath)
      
      // 태그 필터링 및 자연 정렬
      const tags = tagsOutput.trim().split('\n')
        .map(line => {
          const match = line.match(/refs\/tags\/(.+)$/)
          return match ? match[1] : null
        })
        .filter((tag): tag is string => tag !== null && tag.length > 0)
        .filter(tag => !tagMatcher || tagMatcher.test(tag))
        .filter(tag => {
          // 프리릴리즈 제외
          return !isPrereleaseTag(tag)
        })
      
      if (tags.length === 0) {
        throw new Error(`유효한 태그를 찾을 수 없음`)
      }
      
      // 자연 정렬 (내림차순)
      const naturalSorter = natsort({ desc: true })
      const sorted = tags.sort(naturalSorter)
      
      return { type: 'tag', name: sorted[0] }
    },
    `${configPath}-natural`
  )
}

/**
 * 기본 브랜치 전략
 */
async function getDefaultBranch(repoUrl: string, configPath: string): Promise<{ type: 'branch', name: string }> {
  return await upstreamRetry(
    async () => {
      const { stdout: headOutput } = await execFileAsync('git', ['ls-remote', '--symref', repoUrl, 'HEAD'], {
        timeout: 10000
      })
      
      // 출력 형식: ref: refs/heads/<branch-name>\tHEAD
      const match = headOutput.match(/ref: refs\/heads\/([^\s]+)/)
      const branchName = match?.[1] || 'main'
      
      return { type: 'branch', name: branchName }
    },
    `${configPath}-default`
  )
}

/**
 * 원격 참조(태그/브랜치)의 커밋 해시를 조회합니다.
 */
async function getRemoteRefCommitHash(
  repoUrl: string,
  ref: { type: 'tag' | 'branch', name: string }
): Promise<string | null> {
  const refPath = ref.type === 'tag'
    ? `refs/tags/${ref.name}`
    : `refs/heads/${ref.name}`

  try {
    const args = ref.type === 'tag'
      ? ['ls-remote', repoUrl, `${refPath}^{}`, refPath]
      : ['ls-remote', repoUrl, refPath]

    const { stdout } = await execFileAsync('git', args, { timeout: 10000 })
    const lines = stdout.trim().split('\n').filter(Boolean)
    if (lines.length === 0) {
      return null
    }

    if (ref.type === 'tag') {
      const peeledLine = lines.find(line => line.includes(`${refPath}^{}`))
      const directLine = lines.find(line => line.includes(refPath))
      const targetLine = peeledLine ?? directLine

      if (!targetLine) {
        return null
      }

      const [commitHash] = targetLine.split(/\s+/)
      return commitHash || null
    }

    const [commitHash] = lines[0].split(/\s+/)
    return commitHash || null
  } catch {
    return null
  }
}

/** @internal 테스트 목적으로 export됨 */
export async function configureSparseCheckout(
  repositoryPath: string,
  config: UpstreamConfig
): Promise<void> {
  const localizationPaths = [...new Set(config.localizationPaths)]
  await execFileAsync('git', ['sparse-checkout', 'init', '--cone'], { cwd: repositoryPath })
  // 각 경로를 별도 argv로 전달해 공백과 gitignore 패턴 문자를 literal 디렉터리명으로 처리합니다.
  await execFileAsync(
    'git',
    ['sparse-checkout', 'set', '--cone', '--skip-checks', '--', ...localizationPaths],
    { cwd: repositoryPath }
  )
}

/**
 * 새 리포지토리를 효율적으로 클론합니다
 */
async function cloneOptimizedRepository(
  targetPath: string,
  config: UpstreamConfig,
  latestRef?: { type: 'tag' | 'branch', name: string }
): Promise<void> {
  const startTime = Date.now()

  // 디렉토리 생성
  await mkdir(dirname(targetPath), { recursive: true })

  try {
    // 1. 먼저 태그 정보만 가져와서 최신 태그를 확인
    log.start(`[${config.path}] 리포지토리 정보 확인 중...`)
    const resolvedLatestRef = latestRef
      ?? await getLatestRefFromRemote(config.url, config.path, config.versionStrategy)

    // 2. Partial clone (blob 없이 메타데이터만) + shallow clone으로 디스크 공간 최소화
    // 최신 태그나 기본 브랜치를 명시적으로 지정하여 클론
    log.start(`[${config.path}] Partial clone 시작 (${resolvedLatestRef.type}: ${resolvedLatestRef.name})...`)
    await cloneWithFallback(targetPath, config, resolvedLatestRef)

    // 3. Sparse checkout 설정
    log.start(`[${config.path}] Sparse checkout 설정 중...`)
    await configureSparseCheckout(targetPath, config)

    // 4. 파일 체크아웃
    log.start(`[${config.path}] 파일 체크아웃 중...`)
    await checkoutLatestVersionForShallowClone(targetPath, config.path)

    const duration = Date.now() - startTime
    log.success(`[${config.path}] 클론 완료 (${duration}ms)`)

  } catch (error) {
    log.error(`[${config.path}] 클론 실패:`, error)
    throw error
  }
}

/**
 * 최신 참조로 클론을 시도하고, 태그 불일치 시 기본 브랜치로 폴백합니다.
 */
async function cloneWithFallback(
  targetPath: string,
  config: UpstreamConfig,
  latestRef: { type: 'tag' | 'branch', name: string }
): Promise<void> {
  if (latestRef.type === 'branch') {
    await execFileAsync('git', ['clone', '--filter=blob:none', '--depth=1', '--single-branch', '--branch', latestRef.name, '--no-checkout', config.url, targetPath])
    return
  }

  try {
    // 태그가 있는 경우, 해당 태그를 기준으로 shallow clone
    await execFileAsync('git', ['clone', '--filter=blob:none', '--depth=1', '--branch', latestRef.name, '--no-checkout', config.url, targetPath])
  } catch (error) {
    if (!isRemoteRefNotFoundError(error)) {
      throw error
    }

    log.warn(`[${config.path}] 태그(${latestRef.name})를 찾을 수 없어 기본 브랜치로 폴백합니다`)
    await rm(targetPath, { recursive: true, force: true })
    await execFileAsync('git', ['clone', '--filter=blob:none', '--depth=1', '--no-checkout', config.url, targetPath])
  }
}

/**
 * 원격 참조가 존재하지 않아 발생한 clone 오류인지 판별합니다.
 */
function isRemoteRefNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return /Remote branch .+ not found/i.test(error.message)
}

/**
 * 리포지토리가 shallow clone인지 확인합니다
 * @internal 테스트 목적으로 export됨
 */
export async function isShallowRepository(repositoryPath: string): Promise<boolean> {
  try {
    // .git/shallow 파일이 존재하면 shallow clone입니다
    await access(join(repositoryPath, '.git', 'shallow'))
    return true
  } catch {
    return false
  }
}

/**
 * 기존 리포지토리를 업데이트합니다
 */
async function updateExistingRepository(repositoryPath: string, config: UpstreamConfig): Promise<void> {
  try {
    // 과거 상태 파일이 nested upstream 저장소를 dirty 상태로 만들기 전에 바깥으로 옮깁니다.
    await migrateLegacyUpstreamFileHashes(dirname(repositoryPath))

    // Git 상태 확인
    const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: repositoryPath })
    
    if (status.trim()) {
      // 릴리스 조회 실패 시 마지막 정상 체크아웃을 잃지 않도록 삭제 전에 참조를 확정합니다.
      log.start(`[${config.path}] 원격 최신 버전 확인 중...`)
      const latestRef = await getLatestRefFromRemote(config.url, config.path, config.versionStrategy)
      log.warn(`[${config.path}] 로컬 변경사항이 있어 upstream 저장소를 재클론합니다`)
      // upstream은 캐시 성격의 읽기 전용 데이터이므로, 더 안전하게 전체 재클론합니다
      await rm(repositoryPath, { recursive: true, force: true })
      await cloneOptimizedRepository(repositoryPath, config, latestRef)
      return
    }

    // meta.toml에서 컴포넌트나 현지화 경로가 바뀐 경우 기존 clone에도 반영합니다.
    await configureSparseCheckout(repositoryPath, config)
    
    // shallow clone 여부 확인
    const isShallow = await isShallowRepository(repositoryPath)
    
    // 원격 최신 참조 확인
    log.start(`[${config.path}] 원격 최신 버전 확인 중...`)
    const latestRef = await getLatestRefFromRemote(config.url, config.path, config.versionStrategy)
    
    // 현재 체크아웃된 참조 확인
    let current: string
    let currentType: 'tag' | 'branch'
    try {
      // 먼저 태그인지 확인
      const { stdout } = await execFileAsync('git', ['describe', '--tags', '--exact-match'], { cwd: repositoryPath })
      current = stdout.trim()
      currentType = 'tag'
    } catch {
      // 태그가 아니면 브랜치 이름 가져오기
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repositoryPath })
      current = stdout.trim()
      currentType = 'branch'
    }
    
    if (current === latestRef.name && currentType === latestRef.type) {
      const remoteCommitHash = await getRemoteRefCommitHash(config.url, latestRef)

      if (remoteCommitHash) {
        const { stdout: localCommitHashOutput } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryPath })
        const localCommitHash = localCommitHashOutput.trim()

        if (localCommitHash === remoteCommitHash) {
          log.info(`[${config.path}] 이미 최신 버전입니다 (${latestRef.type}: ${latestRef.name})`)
          return
        }

        log.info(`[${config.path}] 동일한 참조명이지만 커밋이 변경되어 업데이트를 진행합니다 (${localCommitHash.slice(0, 7)} -> ${remoteCommitHash.slice(0, 7)})`)
      } else {
        log.info(`[${config.path}] 원격 커밋 해시 확인에 실패하여 보수적으로 업데이트를 진행합니다 (${latestRef.type}: ${latestRef.name})`)
      }
    }
    
    // 원격 변경사항 가져오기
    log.start(`[${config.path}] 원격 변경사항 가져오는 중...`)
    let updateRef = latestRef
    if (isShallow) {
      if (latestRef.type === 'tag') {
        // shallow clone에서 특정 태그로 업데이트하려면 해당 태그를 fetch
        try {
          await execFileAsync('git', ['fetch', '--depth=1', 'origin', 'tag', latestRef.name], { cwd: repositoryPath })
        } catch (error) {
          if (!isRemoteRefNotFoundError(error)) {
            throw error
          }

          // 태그가 사라진 경우 기본 브랜치로 폴백하여 이후 업데이트도 안정적으로 유지
          const defaultBranchRef = await getDefaultBranch(config.url, config.path)
          log.warn(`[${config.path}] 태그(${latestRef.name}) fetch 실패로 기본 브랜치(${defaultBranchRef.name})로 폴백합니다`)
          await execFileAsync('git', ['fetch', '--depth=1', 'origin', defaultBranchRef.name], { cwd: repositoryPath })
          updateRef = defaultBranchRef
        }
      } else {
        // 브랜치의 경우 기존 방식대로
        await execFileAsync('git', ['fetch', '--depth=1', 'origin', latestRef.name], { cwd: repositoryPath })
      }
    } else {
      // 일반 clone의 경우 모든 변경사항 가져오기
      await execFileAsync('git', ['fetch', '--tags'], { cwd: repositoryPath })
    }
    
    // 최신 버전으로 체크아웃
    log.start(`[${config.path}] ${updateRef.type} ${updateRef.name}(으)로 업데이트 중...`)
    await execFileAsync('git', ['checkout', updateRef.name], { cwd: repositoryPath })
    
    if (updateRef.type === 'branch') {
      // 브랜치의 경우 원격 상태로 강제 리셋 (브랜치는 변경 가능하므로)
      // 태그는 불변이므로 checkout만으로 충분함
      // upstream 리포지토리는 읽기 전용이므로 로컬 변경사항은 무시하고 원격 상태로 리셋
      await execFileAsync('git', ['reset', '--hard', `origin/${updateRef.name}`], { cwd: repositoryPath })
    }
    log.success(`[${config.path}] 업데이트 완료 (${updateRef.type}: ${updateRef.name})`)
    
  } catch (error) {
    log.error(`[${config.path}] 업데이트 실패:`, error)
    throw error
  }
}

/**
 * shallow clone에서 파일을 체크아웃합니다
 * shallow clone은 이미 최신 커밋을 가져왔으므로 단순히 체크아웃만 수행합니다
 * @internal 테스트 목적으로 export됨
 */
export async function checkoutLatestVersionForShallowClone(repositoryPath: string, configPath: string): Promise<void> {
  try {
    // shallow clone은 --depth=1로 이미 최신 커밋을 가져왔으므로
    // 현재 브랜치(HEAD)를 체크아웃하면 됩니다
    // git sparse-checkout reapply는 --no-checkout 이후 파일을 체크아웃하지 않으므로
    // git checkout HEAD를 사용하여 sparse-checkout 패턴에 맞는 파일을 실제로 체크아웃합니다
    await execFileAsync('git', ['checkout', 'HEAD'], { cwd: repositoryPath })
    log.info(`[${configPath}] 최신 버전 체크아웃 완료`)
  } catch (error) {
    log.error(`[${configPath}] 체크아웃 실패:`, error)
    throw error
  }
}

/**
 * 모든 upstream 리포지토리를 병렬로 업데이트합니다
 */
export async function updateAllUpstreams(rootPath: string, targetGameType?: string, targetMod?: string): Promise<void> {
  const configs = await parseUpstreamConfigs(rootPath, targetGameType, targetMod)
  
  if (configs.length === 0) {
    const gameMessage = targetGameType ? `${targetGameType} 게임의 ` : ''
    const modMessage = targetMod ? `${targetMod} 모드의 ` : ''
    log.warn(`업데이트할 ${gameMessage}${modMessage}upstream 설정을 찾을 수 없습니다`)
    return
  }
  
  let scopeMessage = '모든 게임'
  if (targetGameType && targetMod) {
    scopeMessage = `${targetGameType.toUpperCase()} 게임의 ${targetMod} 모드`
  } else if (targetGameType) {
    scopeMessage = `${targetGameType.toUpperCase()} 게임`
  } else if (targetMod) {
    // 게임 타입 없이 모드만 지정된 경우, 모든 게임에서 해당 모드를 찾습니다
    scopeMessage = `모든 게임의 ${targetMod} 모드`
    log.warn(`게임 타입이 지정되지 않아 모든 게임에서 "${targetMod}" 모드를 검색합니다`)
  }
  
  log.box(`
    Upstream 최적화 업데이트 시작
    - 범위: ${scopeMessage}
    - 대상: ${configs.length}개 리포지토리
    - 모드: 병렬 처리 (sparse checkout)
    - 설정 소스: meta.toml 전용
  `)
  
  const startTime = Date.now()
  
  // 저장소별 실패를 격리해 정상 저장소와 이후 번역 작업을 계속 진행합니다.
  let failedCount = 0
  await Promise.all(configs.map(async config => {
    try {
      await updateUpstreamOptimized(config, rootPath)
    } catch (error) {
      failedCount += 1
      const message = error instanceof Error ? error.message : String(error)
      log.warn(`[${config.path}] upstream 갱신 실패로 이 모드만 건너뜁니다: ${message}`)
    }
  }))
  
  const duration = Date.now() - startTime
  let scopeMessageComplete = '모든 '
  if (targetGameType && targetMod) {
    scopeMessageComplete = `${targetGameType.toUpperCase()} 게임의 ${targetMod} 모드 `
  } else if (targetGameType) {
    scopeMessageComplete = `${targetGameType.toUpperCase()} `
  } else if (targetMod) {
    scopeMessageComplete = `모든 게임의 ${targetMod} 모드 `
  }
  
  if (failedCount > 0) {
    log.warn(`${scopeMessageComplete}upstream 업데이트 완료: ${configs.length - failedCount}개 성공, ${failedCount}개 건너뜀 (${duration}ms)`)
  } else {
    log.success(`${scopeMessageComplete}upstream 업데이트 완료! (${duration}ms)`)
  }
}
