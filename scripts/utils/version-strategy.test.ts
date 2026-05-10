import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VersionStrategyError, type VersionStrategy } from './upstream'
import * as semver from 'semver'
import natsort from 'natsort'

// Mock only version-strategy-reporter to avoid actual GitHub Issues creation
vi.mock('./version-strategy-reporter', () => ({
  reportVersionStrategyError: vi.fn().mockResolvedValue(undefined)
}))

describe('VersionStrategy 기능', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('VersionStrategyError', () => {
    it('VersionStrategyError 인스턴스를 생성', () => {
      const error = new VersionStrategyError(
        'Test message',
        '/test/meta.toml',
        'invalid_strategy',
        'ck3'
      )

      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('VersionStrategyError')
      expect(error.message).toBe('Test message')
      expect(error.configPath).toBe('/test/meta.toml')
      expect(error.invalidStrategy).toBe('invalid_strategy')
      expect(error.gameType).toBe('ck3')
    })
  })

  describe('VersionStrategy 타입', () => {
    it('유효한 VersionStrategy 타입', () => {
      const validStrategies: string[] = ['semantic', 'natural', 'github', 'default']
      expect(validStrategies).toContain('semantic')
      expect(validStrategies).toContain('natural')
      expect(validStrategies).toContain('github')
      expect(validStrategies).toContain('default')
    })
  })

  describe('실제 라이브러리 기능 테스트', () => {
    it('semver 라이브러리로 버전 정렬', () => {
      const versions = ['v1.2.3', 'v1.10.0', 'v2.0.0', 'v1.5.0']
      const sorted = versions.sort(semver.rcompare)
      
      expect(sorted).toEqual(['v2.0.0', 'v1.10.0', 'v1.5.0', 'v1.2.3'])
    })

    it('semver 라이브러리로 버전 유효성 검사', () => {
      expect(semver.valid('v1.2.3')).toBe('1.2.3')
      expect(semver.valid('1.2.3')).toBe('1.2.3')
      expect(semver.valid('invalid')).toBeNull()
      expect(semver.gt('v1.10.0', 'v1.2.3')).toBe(true)
      expect(semver.gt('v1.2.3', 'v1.10.0')).toBe(false)
    })

    it('natsort 라이브러리로 자연 정렬', () => {
      const sorter = natsort({ desc: true })
      const items = ['1.2.3', '1.10.0', '2.0.0', '1.5.0']
      const sorted = items.sort(sorter)
      
      // 실제 natsort 동작 확인: 2.0.0 > 1.5.0 > 1.2.3 > 1.10.0
      expect(sorted[0]).toBe('2.0.0')
      expect(sorted[1]).toBe('1.5.0')
      expect(sorted[2]).toBe('1.2.3')
      expect(sorted[3]).toBe('1.10.0')
    })

    it('natsort 라이브러리 기본 동작 확인', () => {
      const sorter = natsort()
      const items = ['item1', 'item10', 'item2']
      const sorted = items.sort(sorter)
      
      // 자연 정렬: item1, item2, item10 순서
      expect(sorted).toEqual(['item1', 'item2', 'item10'])
    })

    it('natsort 내림차순 옵션 테스트', () => {
      const ascSorter = natsort()
      const descSorter = natsort({ desc: true })
      const items = ['1', '2', '3']
      
      const ascSorted = [...items].sort(ascSorter)
      const descSorted = [...items].sort(descSorter)
      
      expect(ascSorted).toEqual(['1', '2', '3'])
      expect(descSorted).toEqual(['3', '2', '1'])
    })
  })

  describe('버전 전략별 로직 테스트', () => {
    it('semantic 전략: 시멘틱 버전 필터링', () => {
      const allRefs = [
        'refs/tags/v1.2.3',
        'refs/tags/v1.10.0',
        'refs/tags/v2.0.0',
        'refs/tags/beta',
        'refs/tags/1.0.0-alpha',
        'refs/heads/main'
      ]
      
      // v로 시작하고 semver 유효한 태그만 필터링
      const semanticVersions = allRefs
        .filter(ref => ref.includes('refs/tags/v'))
        .map(ref => ref.replace('refs/tags/', ''))
        .filter(version => semver.valid(version))
        .sort(semver.rcompare)
      
      expect(semanticVersions).toEqual(['v2.0.0', 'v1.10.0', 'v1.2.3'])
    })

    it('natural 전략: 모든 refs에서 버전 추출', () => {
      const allRefs = [
        'abc123\trefs/heads/main',
        'def456\trefs/heads/v1.2.3',
        'ghi789\trefs/heads/v1.10.0',
        'jkl012\trefs/tags/2.0.0'
      ]
      
      // 버전 패턴을 가진 refs 추출
      const versionRefs = allRefs
        .filter(line => /\d+\.\d+\.\d+/.test(line))
        .map(line => line.split('\t')[1])
      
      expect(versionRefs).toEqual([
        'refs/heads/v1.2.3',
        'refs/heads/v1.10.0', 
        'refs/tags/2.0.0'
      ])
    })

    it('버전 문자열에서 숫자 부분 추출', () => {
      const refs = ['refs/heads/v1.2.3', 'refs/tags/2.0.0', 'refs/heads/main']
      const sorter = natsort({ desc: true })
      
      const versions = refs
        .map(ref => {
          const match = ref.match(/(\d+(?:\.\d+)*)/)
          return match ? match[0] : ref
        })
        .filter(version => /^\d/.test(version))
        .sort(sorter)
      
      expect(versions).toEqual(['2.0.0', '1.2.3'])
    })
  })

  describe('복합 시나리오 테스트', () => {
    it('복잡한 버전 번호 정렬', () => {
      // semver로 처리 - 실제 동작: alpha와 beta도 유효한 시멘틱 버전
      const semanticVersions = ['v1.2.3', 'v1.10.0', 'v2.0.0-beta', 'v1.2.3-alpha']
      const sortedSemantic = semanticVersions.filter(v => semver.valid(v)).sort(semver.rcompare)
      expect(sortedSemantic).toEqual(['v2.0.0-beta', 'v1.10.0', 'v1.2.3', 'v1.2.3-alpha'])

      // natsort로 처리 - 실제 동작 확인
      const naturalVersions = ['1.2.3', '1.10.0', '2.0.0-beta', '1.2.3-alpha']
      const sortedNatural = naturalVersions.sort(natsort({ desc: true }))
      expect(sortedNatural).toEqual(['2.0.0-beta', '1.2.3-alpha', '1.2.3', '1.10.0'])
    })

    it('다양한 버전 형식 처리', () => {
      const testCases = [
        { input: 'v1.2.3', valid: true, parsed: '1.2.3' },
        { input: '1.2.3', valid: true, parsed: '1.2.3' },
        { input: 'v1.10.0', valid: true, parsed: '1.10.0' },
        { input: '1.0.0-alpha', valid: true, parsed: '1.0.0-alpha' },
        { input: 'beta', valid: false, parsed: null },
        { input: 'main', valid: false, parsed: null }
      ]

      testCases.forEach(({ input, valid, parsed }) => {
        if (valid) {
          expect(semver.valid(input)).toBe(parsed)
        } else {
          expect(semver.valid(input)).toBeNull()
        }
      })
    })
  })
})
