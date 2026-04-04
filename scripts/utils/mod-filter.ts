/**
 * 모드 필터링 유틸리티
 * 명령줄에서 지정된 모드를 필터링하고 검증합니다.
 */

/**
 * 사용 가능한 모드 목록에서 지정된 모드를 필터링합니다.
 * @param allMods 전체 모드 목록
 * @param targetMod 지정된 모드 (선택사항)
 * @returns 필터링된 모드 목록
 * @throws 지정된 모드가 존재하지 않으면 에러 발생
 */
export function filterMods(allMods: string[], targetMod?: string): string[] {
  const mod = targetMod?.trim()

  // 모드 이름이 없거나 CLI 옵션/구분자(--로 시작하는 값)인 경우 전체 모드 반환
  if (!mod || mod.startsWith('--')) {
    return allMods
  }

  const normalizedMod = mod.toLowerCase()
  const matchedMod = allMods.find(existingMod => existingMod.toLowerCase() === normalizedMod)

  if (!matchedMod) {
    throw new Error(`지정된 모드 '${mod}'가 존재하지 않습니다. 사용 가능한 모드: ${allMods.join(', ')}`)
  }

  return [matchedMod]
}
