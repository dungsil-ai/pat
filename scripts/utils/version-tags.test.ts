import { describe, expect, it } from 'vitest'
import { parseStableSemanticVersion } from './version-tags'

describe('컴포넌트 시멘틱 태그 파싱', () => {
  it('컴포넌트 접두사가 붙은 안정 버전을 파싱해야 함', () => {
    expect(parseStableSemanticVersion('SEA-v2.1.0')?.version).toBe('2.1.0')
  })

  it.each([
    'SEA-v2.0.0-beta',
    'SEA-v2.0.0beta',
    'SEA-v2.0.0rc1',
    'SEA-v2.0.0-rc.1',
    'SEA-v2.0.0-preview.2'
  ])('프리릴리즈 태그를 안정 버전으로 승격하지 않아야 함: %s', tagName => {
    expect(parseStableSemanticVersion(tagName)).toBeNull()
  })

  it('기존 확장 태그는 기본 시멘틱 버전으로 비교할 수 있어야 함', () => {
    expect(parseStableSemanticVersion('1.18.1.b')?.version).toBe('1.18.1')
  })
})
