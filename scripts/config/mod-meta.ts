import { readFile } from 'node:fs/promises'
import { parseToml } from '../parser/toml'

export const VERSION_STRATEGIES = ['semantic', 'natural', 'default', 'github'] as const

export type VersionStrategy = typeof VERSION_STRATEGIES[number]

export interface NormalizedUpstreamComponent {
  id: string
  name: string
  localizationPaths: string[]
  versionStrategy: VersionStrategy
  tagPattern?: string
  outputSubdir?: string
  implicit: boolean
}

export interface NormalizedUpstreamConfig {
  url?: string
  language: string
  transliterationFiles: string[]
  versionStrategy: VersionStrategy
  localizationPaths: string[]
  components: NormalizedUpstreamComponent[]
}

export interface NormalizedModMetaConfig {
  upstream: NormalizedUpstreamConfig
}

export class ModMetaConfigError extends Error {
  constructor(
    message: string,
    public configPath: string,
    public field?: string
  ) {
    super(`${configPath}: ${message}`)
    this.name = 'ModMetaConfigError'
  }
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isReplaceLocalizationPath(localizationPath: string): boolean {
  const segments = localizationPath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(segment => segment.toLowerCase())

  return segments.some((segment, index) => (
    (segment === 'localization' || segment === 'localisation')
    && segments[index + 1] === 'replace'
  ))
}

function throwConfigError(configPath: string, field: string, message: string): never {
  throw new ModMetaConfigError(`${field} ${message}`, configPath, field)
}

function normalizeVersionStrategy(
  value: unknown,
  fallback: VersionStrategy,
  configPath: string,
  field: string
): VersionStrategy {
  if (value === undefined) {
    return fallback
  }

  if (typeof value !== 'string' || !VERSION_STRATEGIES.includes(value as VersionStrategy)) {
    throwConfigError(
      configPath,
      field,
      `값이 올바르지 않습니다. 지원 값: ${VERSION_STRATEGIES.join(', ')}`
    )
  }

  return value as VersionStrategy
}

function normalizeRepositoryPath(value: string, configPath: string, field: string): string {
  const normalizedSeparators = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/')

  if (!normalizedSeparators || /[\0\r\n]/.test(normalizedSeparators)) {
    throwConfigError(configPath, field, '항목은 비어 있지 않은 경로여야 합니다.')
  }

  if (normalizedSeparators.startsWith('/') || /^[A-Za-z]:\//.test(normalizedSeparators)) {
    throwConfigError(configPath, field, '항목은 저장소 기준 상대 경로여야 합니다.')
  }

  const normalizedPath = normalizedSeparators.replace(/\/+$/, '')
  const segments = normalizedPath.split('/')
  if (segments.includes('..')) {
    throwConfigError(configPath, field, '항목에는 상위 디렉터리 이동(..)을 사용할 수 없습니다.')
  }

  const normalizedSegments = segments.filter(segment => segment !== '.')
  return normalizedSegments.length === 0 ? '.' : normalizedSegments.join('/')
}

function normalizePathArray(value: unknown, configPath: string, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throwConfigError(configPath, field, '값은 하나 이상의 경로를 가진 배열이어야 합니다.')
  }

  const normalized = value.map((path, index) => {
    if (typeof path !== 'string') {
      throwConfigError(configPath, `${field}[${index}]`, '값은 문자열이어야 합니다.')
    }

    return normalizeRepositoryPath(path, configPath, `${field}[${index}]`)
  })

  return [...new Set(normalized)]
}

function normalizeOptionalPatternArray(value: unknown, configPath: string, field: string): string[] {
  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value)) {
    throwConfigError(configPath, field, '값은 문자열 패턴 배열이어야 합니다.')
  }

  const patterns = value.map((pattern, index) => {
    if (typeof pattern !== 'string') {
      throwConfigError(configPath, `${field}[${index}]`, '값은 문자열이어야 합니다.')
    }

    const trimmed = pattern.trim()
    if (!trimmed || /[\0\r\n]/.test(trimmed)) {
      throwConfigError(configPath, `${field}[${index}]`, '값은 제어 문자가 없는 비어 있지 않은 패턴이어야 합니다.')
    }
    return trimmed
  })

  return [...new Set(patterns)]
}

function normalizeTagPattern(value: unknown, configPath: string, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throwConfigError(configPath, field, '값은 비어 있지 않은 정규식 문자열이어야 합니다.')
  }

  const tagPattern = value.trim()
  try {
    new RegExp(tagPattern)
  } catch {
    throwConfigError(configPath, field, '값은 유효한 정규식이어야 합니다.')
  }

  return tagPattern
}

function normalizeOutputSubdir(value: unknown, configPath: string, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throwConfigError(configPath, field, '값은 상대 경로 문자열이어야 합니다.')
  }

  const outputSubdir = normalizeRepositoryPath(value, configPath, field)
  if (outputSubdir === '.') {
    return undefined
  }

  if (outputSubdir.split('/')[0].toLowerCase() === 'replace') {
    throwConfigError(configPath, field, '값의 첫 경로로 예약 디렉터리 replace를 사용할 수 없습니다.')
  }

  return outputSubdir
}

function normalizeExplicitComponents(
  value: unknown,
  inheritedVersionStrategy: VersionStrategy,
  configPath: string
): NormalizedUpstreamComponent[] {
  if (!Array.isArray(value) || value.length === 0) {
    throwConfigError(configPath, 'upstream.components', '값은 하나 이상의 컴포넌트를 가진 배열이어야 합니다.')
  }

  const componentIds = new Set<string>()

  const components = value.map((component, index) => {
    const field = `upstream.components[${index}]`
    if (!isRecord(component)) {
      throwConfigError(configPath, field, '값은 테이블이어야 합니다.')
    }

    if (typeof component.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(component.id)) {
      throwConfigError(
        configPath,
        `${field}.id`,
        '값은 소문자 영숫자로 시작하고 소문자 영숫자, 밑줄, 하이픈만 포함해야 합니다.'
      )
    }

    if (componentIds.has(component.id)) {
      throwConfigError(configPath, `${field}.id`, `값이 중복되었습니다: ${component.id}`)
    }
    componentIds.add(component.id)

    if (
      component.name !== undefined
      && (
        typeof component.name !== 'string'
        || component.name.trim().length === 0
        || /[\u0000-\u001f\u007f]/.test(component.name)
      )
    ) {
      throwConfigError(configPath, `${field}.name`, '값은 제어 문자가 없는 비어 있지 않은 문자열이어야 합니다.')
    }

    const versionStrategy = normalizeVersionStrategy(
      component.version_strategy,
      inheritedVersionStrategy,
      configPath,
      `${field}.version_strategy`
    )
    const tagPattern = normalizeTagPattern(component.tag_pattern, configPath, `${field}.tag_pattern`)

    if (versionStrategy === 'default' && tagPattern) {
      throwConfigError(
        configPath,
        `${field}.tag_pattern`,
        '값은 default 버전 전략과 함께 사용할 수 없습니다.'
      )
    }

    if (versionStrategy !== 'default' && !tagPattern) {
      throwConfigError(
        configPath,
        `${field}.tag_pattern`,
        `${versionStrategy} 버전 전략에는 컴포넌트 태그를 구분할 정규식이 필요합니다.`
      )
    }

    return {
      id: component.id,
      name: typeof component.name === 'string' ? component.name.trim() : component.id,
      localizationPaths: normalizePathArray(component.localization, configPath, `${field}.localization`),
      versionStrategy,
      tagPattern,
      outputSubdir: normalizeOutputSubdir(component.output_subdir, configPath, `${field}.output_subdir`),
      implicit: false
    }
  })

  const pathOwners = new Map<string, string>()
  for (const component of components) {
    for (const localizationPath of component.localizationPaths) {
      const existingOwner = pathOwners.get(localizationPath)
      if (existingOwner) {
        throwConfigError(
          configPath,
          'upstream.components',
          `현지화 경로를 여러 컴포넌트가 공유할 수 없습니다: ${localizationPath} (${existingOwner}, ${component.id})`
        )
      }
      pathOwners.set(localizationPath, component.id)
    }
  }

  return components
}

/**
 * 파싱된 meta.toml 값을 모든 소비자가 공유할 수 있는 형태로 정규화합니다.
 */
export function normalizeModMetaConfig(
  value: unknown,
  configPath = 'meta.toml'
): NormalizedModMetaConfig {
  if (!isRecord(value) || !isRecord(value.upstream)) {
    throwConfigError(configPath, 'upstream', '테이블이 필요합니다.')
  }

  const upstream = value.upstream

  if (upstream.url !== undefined && (typeof upstream.url !== 'string' || upstream.url.trim().length === 0)) {
    throwConfigError(configPath, 'upstream.url', '값은 비어 있지 않은 문자열이어야 합니다.')
  }

  if (typeof upstream.language !== 'string' || upstream.language.trim().length === 0) {
    throwConfigError(configPath, 'upstream.language', '값은 비어 있지 않은 문자열이어야 합니다.')
  }

  const versionStrategy = normalizeVersionStrategy(
    upstream.version_strategy,
    'default',
    configPath,
    'upstream.version_strategy'
  )

  const hasLegacyLocalization = upstream.localization !== undefined
  const hasExplicitComponents = upstream.components !== undefined

  if (hasLegacyLocalization && hasExplicitComponents) {
    throwConfigError(
      configPath,
      'upstream',
      'localization과 components를 동시에 사용할 수 없습니다.'
    )
  }

  if (hasExplicitComponents && versionStrategy !== 'default') {
    throwConfigError(
      configPath,
      'upstream.version_strategy',
      '값은 components 사용 시 물리 저장소의 기본 브랜치를 추적하도록 default여야 합니다.'
    )
  }

  let components: NormalizedUpstreamComponent[]
  if (hasExplicitComponents) {
    components = normalizeExplicitComponents(upstream.components, versionStrategy, configPath)
  } else {
    components = [{
      id: 'default',
      name: 'default',
      localizationPaths: normalizePathArray(
        upstream.localization,
        configPath,
        'upstream.localization'
      ),
      versionStrategy,
      implicit: true
    }]
  }

  return {
    upstream: {
      url: typeof upstream.url === 'string' ? upstream.url.trim() : undefined,
      language: upstream.language.trim(),
      transliterationFiles: normalizeOptionalPatternArray(
        upstream.transliteration_files,
        configPath,
        'upstream.transliteration_files'
      ),
      versionStrategy,
      localizationPaths: [...new Set(components.flatMap(component => component.localizationPaths))],
      components
    }
  }
}

/**
 * TOML 문자열을 파싱하고 정규화합니다.
 */
export function parseModMeta(content: string, configPath = 'meta.toml'): NormalizedModMetaConfig {
  return normalizeModMetaConfig(parseToml(content), configPath)
}

/**
 * meta.toml 파일을 읽고 정규화합니다.
 */
export async function readModMeta(metaPath: string): Promise<NormalizedModMetaConfig> {
  const content = await readFile(metaPath, 'utf-8')
  return parseModMeta(content, metaPath)
}
