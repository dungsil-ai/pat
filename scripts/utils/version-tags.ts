import * as semver from 'semver'

const PRERELEASE_KEYWORD_PATTERN = /(?:^|[._+\-]|\d)(alpha|beta|rc|preview|snapshot|test|dev)(?:[._+\-]|\d|$)/i
const SEMANTIC_VERSION_PATTERN = /(?:^|[^\d])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/i

export function isPrereleaseTag(tagName: string): boolean {
  return PRERELEASE_KEYWORD_PATTERN.test(tagName)
}

/**
 * 컴포넌트 접두사가 붙은 태그에서도 안정 버전만 추출합니다.
 * 실제 태그 이름은 유지하고, 비교에 사용할 SemVer만 반환합니다.
 */
export function parseStableSemanticVersion(tagName: string): semver.SemVer | null {
  if (isPrereleaseTag(tagName)) {
    return null
  }

  const candidate = tagName.match(SEMANTIC_VERSION_PATTERN)?.[1]
  if (!candidate) {
    return null
  }

  const parsed = semver.parse(candidate)
  if (parsed) {
    return semver.prerelease(parsed) === null ? parsed : null
  }

  // 올바르지 않은 prerelease 표기를 안정 버전으로 coerce하지 않습니다.
  if (candidate.includes('-')) {
    return null
  }

  return semver.coerce(candidate)
}
