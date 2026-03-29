/**
 * upstream 리포지토리 관리 유틸리티
 * 
 * git submodule 대신 sparse checkout과 partial clone을 사용하여
 * 필요한 localization 파일만 효율적으로 다운로드합니다.
 * 
 * meta.toml 파일에서 모든 설정 정보 (URL, localization 경로)를 읽어옵니다.
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join, dirname } from 'pathe'
import * as semver from 'semver'
import natsort from 'natsort'
import { log } from './logger'
import { delay } from './delay'
import { parseToml } from '../parser/toml'
import { reportVersionStrategyError } from './version-strategy-reporter'

const execAsync = promisify(exec)

export type VersionStrategy = 'semantic' | 'natural' | 'default'

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

interface UpstreamConfig {
  url: string
  path: string
  localizationPaths: string[]
  versionStrategy?: VersionStrategy
}

interface MetaTomlConfig {
  upstream: {
    url?: string
    localization: string[]
    language: string
    version_strategy?: VersionStrategy
  }
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
    const content = await readFile(metaPath, 'utf-8')
    const config = parseToml(content) as MetaTomlConfig
    
    if (!config.upstream?.localization || !Array.isArray(config.upstream.localization)) {
      return null
    }
    
    // version_strategy 유효성 검사
    if (config.upstream?.version_strategy) {
      const validStrategies: VersionStrategy[] = ['semantic', 'natural', 'default']
      if (!validStrategies.includes(config.upstream.version_strategy)) {
        const error = new VersionStrategyError(
          `유효하지 않은 version_strategy: ${config.upstream.version_strategy}`,
          `${gameDir}/${modName}/meta.toml`,
          config.upstream.version_strategy,
          gameDir
        )
        
        // GitHub Issues에 보고 (비동기, 에러로 인해 다른 작업 중단 방지)
        reportVersionStrategyError(error).catch((err) => {
          log.warn(`GitHub Issues 보고 실패:`, err)
        })
        
        // 해당 모드는 패스
        log.error(`[${gameDir}/${modName}] ${error.message}`)
        return null
      }
    }
    
    const upstreamPath = `${gameDir}/${modName}/upstream`
    
    // meta.toml에서 URL을 직접 읽어옴
    if (!config.upstream.url) {
      log.info(`[${upstreamPath}] meta.toml에 URL이 없음, 일반 파일 기반 upstream으로 처리`)
      return {
        url: '', // 빈 URL로 일반 파일 기반임을 표시
        path: upstreamPath,
        localizationPaths: config.upstream.localization,
        versionStrategy: config.upstream.version_strategy
      }
    }
    
    return {
      url: config.upstream.url,
      path: upstreamPath,
      localizationPaths: config.upstream.localization,
      versionStrategy: config.upstream.version_strategy
    }
  } catch (error) {
    log.warn(`Failed to parse meta.toml: ${metaPath}`, error)
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
  
  try {
    // 이미 존재하는지 확인
    await access(fullPath)
    log.info(`[${config.path}] 이미 존재함, 업데이트 확인 중...`)
    await updateExistingRepository(fullPath, config)
  } catch {
    log.info(`[${config.path}] 새로 클론 중...`)
    await cloneOptimizedRepository(fullPath, config)
  }
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

/**
 * GitHub Releases API를 사용하여 최신 릴리즈 태그를 가져옵니다
 * 비개발자가 만든 다양한 형식의 태그도 지원합니다.
 * @internal 테스트 목적으로 export됨
 */
export async function getLatestReleaseFromGitHub(owner: string, repo: string, configPath: string): Promise<string | null> {
  try {
    // GitHub API로 최신 릴리즈 가져오기
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`
    log.info(`[${configPath}] GitHub Releases API 확인 중...`)
    
    const headers = getGitHubApiHeaders()
    const response = await fetch(apiUrl, { headers })
    
    if (response.ok) {
      const data = await response.json() as { tag_name: string }
      if (data.tag_name) {
        log.info(`[${configPath}] GitHub 최신 릴리즈 발견: ${data.tag_name}`)
        return data.tag_name
      }
    }
    
    // 최신 릴리즈가 없으면 모든 릴리즈 목록에서 첫 번째 가져오기
    const allReleasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases`
    const allResponse = await fetch(allReleasesUrl, { headers })
    
    if (allResponse.ok) {
      const releases = await allResponse.json() as Array<{ tag_name: string }>
      if (releases.length > 0 && releases[0].tag_name) {
        log.info(`[${configPath}] GitHub 릴리즈 발견: ${releases[0].tag_name}`)
        return releases[0].tag_name
      }
    } else {
      log.debug(`[${configPath}] GitHub Releases 목록 API 실패 (HTTP ${allResponse.status}): ${allResponse.statusText}`)
    }
    
    return null
  } catch (error) {
    // 에러 유형에 따라 상세한 로깅
    if (error instanceof Error) {
      log.debug(`[${configPath}] GitHub Releases API 실패: ${error.message}`, error)
    } else {
      log.debug(`[${configPath}] GitHub Releases API 실패:`, error)
    }
    return null
  }
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
  versionStrategy: VersionStrategy = 'default'
): Promise<{ type: 'tag' | 'branch', name: string }> {
  
  log.info(`[${configPath}] 버전 전략(${versionStrategy})으로 최신 버전 확인 중...`)
  
  switch (versionStrategy) {
    case 'semantic':
      return await getSemanticVersion(repoUrl, configPath)
    case 'natural':
      return await getNaturalVersion(repoUrl, configPath)
    case 'default':
      return await getDefaultBranch(repoUrl, configPath)
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
      
      // 429, 5xx 오류만 재시도
      if (!message.includes('429 Too Many Requests') && 
          !message.match(/5[0-9][0-9]/)) {
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
async function getSemanticVersion(repoUrl: string, configPath: string): Promise<{ type: 'tag', name: string }> {
  const githubInfo = parseGitHubUrl(repoUrl)
  if (!githubInfo) {
    throw new VersionStrategyError(`Semantic 전략은 GitHub 저장소만 지원합니다: ${repoUrl}`, configPath)
  }
  
  return await upstreamRetry(
    async () => {
      const apiUrl = `https://api.github.com/repos/${githubInfo.owner}/${githubInfo.repo}/releases`
      const response = await fetch(apiUrl, getGitHubApiHeaders())
      
      if (!response.ok) {
        throw new Error(`GitHub API 실패: ${response.status} ${response.statusText}`)
      }
      
      const releases = await response.json() as Array<{ tag_name: string }>

      // semver 정렬을 위해 태그를 파싱하되, 실제 체크아웃에는 원본 태그명을 사용
      const parsedReleases = releases
        .map(({ tag_name }) => {
          const normalizedTag = tag_name.replace(/^v/, '')
          const parsed = semver.parse(normalizedTag) ?? semver.coerce(normalizedTag)
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
async function getNaturalVersion(repoUrl: string, configPath: string): Promise<{ type: 'tag', name: string }> {
  return await upstreamRetry(
    async () => {
      const { stdout: tagsOutput } = await execAsync(`git ls-remote --tags --refs "${repoUrl}"`, {
        timeout: 30000
      })
      
      if (!tagsOutput.trim()) {
        throw new Error(`태그를 찾을 수 없음`)
      }
      
      // 태그 필터링 및 자연 정렬
      const tags = tagsOutput.trim().split('\n')
        .map(line => {
          const match = line.match(/refs\/tags\/(.+)$/)
          return match ? match[1] : null
        })
        .filter((tag): tag is string => tag !== null && tag.length > 0)
        .filter(tag => {
          // 프리릴리즈 제외
          const preReleaseKeywords = ['beta', 'alpha', 'rc', 'snapshot', 'test', 'dev']
          const lowerTag = tag.toLowerCase()
          return !preReleaseKeywords.some(keyword => lowerTag.includes(keyword))
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
      const { stdout: headOutput } = await execAsync(`git ls-remote --symref "${repoUrl}" HEAD`, {
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
 * 새 리포지토리를 효율적으로 클론합니다
 */
async function cloneOptimizedRepository(targetPath: string, config: UpstreamConfig): Promise<void> {
  const startTime = Date.now()
  
  // 디렉토리 생성
  await mkdir(dirname(targetPath), { recursive: true })
  
  try {
    // 1. 먼저 태그 정보만 가져와서 최신 태그를 확인
    log.start(`[${config.path}] 리포지토리 정보 확인 중...`)
    const latestRef = await getLatestRefFromRemote(config.url, config.path, config.versionStrategy)
    
    // 2. Partial clone (blob 없이 메타데이터만) + shallow clone으로 디스크 공간 최소화
    // 최신 태그나 기본 브랜치를 명시적으로 지정하여 클론
    log.start(`[${config.path}] Partial clone 시작 (${latestRef.type}: ${latestRef.name})...`)
    await cloneWithFallback(targetPath, config, latestRef)
    
    // 3. Sparse checkout 설정
    log.start(`[${config.path}] Sparse checkout 설정 중...`)
    await execAsync('git sparse-checkout init', { cwd: targetPath })
    
    // 4. Localization 경로만 설정 (파일에 직접 작성)
    const sparseCheckoutPath = join(targetPath, '.git', 'info', 'sparse-checkout')
    const sparseCheckoutContent = config.localizationPaths.join('\n')
    await writeFile(sparseCheckoutPath, sparseCheckoutContent)
    
    // 5. 파일 체크아웃
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
    await execAsync(`git clone --filter=blob:none --depth=1 --single-branch --branch "${latestRef.name}" --no-checkout "${config.url}" "${targetPath}"`)
    return
  }

  try {
    // 태그가 있는 경우, 해당 태그를 기준으로 shallow clone
    await execAsync(`git clone --filter=blob:none --depth=1 --branch "${latestRef.name}" --no-checkout "${config.url}" "${targetPath}"`)
  } catch (error) {
    if (!isRemoteRefNotFoundError(error)) {
      throw error
    }

    log.warn(`[${config.path}] 태그(${latestRef.name})를 찾을 수 없어 기본 브랜치로 폴백합니다`)
    await rm(targetPath, { recursive: true, force: true })
    await execAsync(`git clone --filter=blob:none --depth=1 --no-checkout "${config.url}" "${targetPath}"`)
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
    // Git 상태 확인
    const { stdout: status } = await execAsync('git status --porcelain', { cwd: repositoryPath })
    
    if (status.trim()) {
      log.warn(`[${config.path}] 로컬 변경사항이 있어 upstream 저장소를 재클론합니다`)
      // upstream은 캐시 성격의 읽기 전용 데이터이므로, 더 안전하게 전체 재클론합니다
      await rm(repositoryPath, { recursive: true, force: true })
      await cloneOptimizedRepository(repositoryPath, config)
      return
    }
    
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
      const { stdout } = await execAsync('git describe --tags --exact-match', { cwd: repositoryPath })
      current = stdout.trim()
      currentType = 'tag'
    } catch {
      // 태그가 아니면 브랜치 이름 가져오기
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repositoryPath })
      current = stdout.trim()
      currentType = 'branch'
    }
    
    if (current === latestRef.name && currentType === latestRef.type) {
      log.info(`[${config.path}] 이미 최신 버전입니다 (${latestRef.type}: ${latestRef.name})`)
      return
    }
    
    // 원격 변경사항 가져오기
    log.start(`[${config.path}] 원격 변경사항 가져오는 중...`)
    let updateRef = latestRef
    if (isShallow) {
      if (latestRef.type === 'tag') {
        // shallow clone에서 특정 태그로 업데이트하려면 해당 태그를 fetch
        try {
          await execAsync(`git fetch --depth=1 origin tag "${latestRef.name}"`, { cwd: repositoryPath })
        } catch (error) {
          if (!isRemoteRefNotFoundError(error)) {
            throw error
          }

          // 태그가 사라진 경우 기본 브랜치로 폴백하여 이후 업데이트도 안정적으로 유지
          const defaultBranchRef = await getDefaultBranch(config.url, config.path)
          log.warn(`[${config.path}] 태그(${latestRef.name}) fetch 실패로 기본 브랜치(${defaultBranchRef.name})로 폴백합니다`)
          await execAsync(`git fetch --depth=1 origin "${defaultBranchRef.name}"`, { cwd: repositoryPath })
          updateRef = defaultBranchRef
        }
      } else {
        // 브랜치의 경우 기존 방식대로
        await execAsync(`git fetch --depth=1 origin "${latestRef.name}"`, { cwd: repositoryPath })
      }
    } else {
      // 일반 clone의 경우 모든 변경사항 가져오기
      await execAsync('git fetch --tags', { cwd: repositoryPath })
    }
    
    // 최신 버전으로 체크아웃
    log.start(`[${config.path}] ${updateRef.type} ${updateRef.name}(으)로 업데이트 중...`)
    await execAsync(`git checkout "${updateRef.name}"`, { cwd: repositoryPath })
    
    if (updateRef.type === 'branch') {
      // 브랜치의 경우 원격 상태로 강제 리셋 (브랜치는 변경 가능하므로)
      // 태그는 불변이므로 checkout만으로 충분함
      // upstream 리포지토리는 읽기 전용이므로 로컬 변경사항은 무시하고 원격 상태로 리셋
      await execAsync(`git reset --hard "origin/${updateRef.name}"`, { cwd: repositoryPath })
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
    await execAsync('git checkout HEAD', { cwd: repositoryPath })
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
  
  // 병렬 처리
  const promises = configs.map(config => updateUpstreamOptimized(config, rootPath))
  await Promise.all(promises)
  
  const duration = Date.now() - startTime
  let scopeMessageComplete = '모든 '
  if (targetGameType && targetMod) {
    scopeMessageComplete = `${targetGameType.toUpperCase()} 게임의 ${targetMod} 모드 `
  } else if (targetGameType) {
    scopeMessageComplete = `${targetGameType.toUpperCase()} `
  } else if (targetMod) {
    scopeMessageComplete = `모든 게임의 ${targetMod} 모드 `
  }
  
  log.success(`${scopeMessageComplete}upstream 업데이트 완료! (${duration}ms)`)
}
