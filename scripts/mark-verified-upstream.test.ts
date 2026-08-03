import { describe, expect, it } from 'vitest'
import { updateVerifiedMarker } from './mark-verified-upstream'

describe('updateVerifiedMarker', () => {
  it('검증 마커가 없으면 BOM과 언어 헤더 다음에 추가해야 한다', () => {
    expect(updateVerifiedMarker('\uFEFFl_korean:\n key:0 "번역"\n', 'abc1234')).toBe(
      '\uFEFFl_korean:\n# PAT verified upstream: abc1234\n key:0 "번역"\n'
    )
  })

  it('언어 헤더 다음의 기존 검증 마커를 최신 리비전으로 교체해야 한다', () => {
    expect(updateVerifiedMarker(
      '\uFEFFl_korean:\n# PAT verified upstream: old1234\n key:0 "번역"\n',
      'new5678'
    )).toBe(
      '\uFEFFl_korean:\n# PAT verified upstream: new5678\n key:0 "번역"\n'
    )
  })

  it('같은 리비전의 레거시 마커도 BOM과 언어 헤더 다음으로 이동해야 한다', () => {
    expect(updateVerifiedMarker(
      '# PAT verified upstream: abc1234\n\uFEFFl_korean:\n key:0 "번역"\n',
      'abc1234'
    )).toBe(
      '\uFEFFl_korean:\n# PAT verified upstream: abc1234\n key:0 "번역"\n'
    )
  })

  it('정상 순서의 같은 리비전은 바이트 단위로 변경하지 않아야 한다', () => {
    const content = '\uFEFFl_korean:\r\n# PAT verified upstream: abc1234\r\n key:0 "번역"\r\n'
    expect(updateVerifiedMarker(content, 'abc1234')).toBe(content)
  })
})
