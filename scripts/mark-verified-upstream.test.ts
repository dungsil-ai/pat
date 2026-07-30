import { describe, expect, it } from 'vitest'
import { updateVerifiedMarker } from './mark-verified-upstream'

describe('updateVerifiedMarker', () => {
  it('검증 마커가 없으면 파일 첫 줄에 추가해야 한다', () => {
    expect(updateVerifiedMarker('l_korean:\n key:0 "번역"\n', 'abc1234')).toBe(
      '# PAT verified upstream: abc1234\nl_korean:\n key:0 "번역"\n'
    )
  })

  it('기존 검증 마커를 최신 리비전으로 교체해야 한다', () => {
    expect(updateVerifiedMarker(
      '# PAT verified upstream: old1234\nl_korean:\n key:0 "번역"\n',
      'new5678'
    )).toBe(
      '# PAT verified upstream: new5678\nl_korean:\n key:0 "번역"\n'
    )
  })

  it('같은 리비전이면 파일 내용을 변경하지 않아야 한다', () => {
    const content = '# PAT verified upstream: abc1234\nl_korean:\n key:0 "번역"\n'
    expect(updateVerifiedMarker(content, 'abc1234')).toBe(content)
  })
})
