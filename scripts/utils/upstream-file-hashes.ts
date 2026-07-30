import { constants as fsConstants } from 'node:fs'
import { lstat, open, readFile, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'pathe'
import { log } from './logger'

export type UpstreamFileHashMap = Record<string, string>

export const UPSTREAM_FILE_HASHES_FILENAME = '.pat-file-hashes.json'

export function getUpstreamFileHashesPath(modDir: string): string {
  return join(modDir, UPSTREAM_FILE_HASHES_FILENAME)
}

export function getLegacyUpstreamFileHashesPath(modDir: string): string {
  return join(modDir, 'upstream', UPSTREAM_FILE_HASHES_FILENAME)
}

function resolveLegacyHashFilePath(hashFilePath: string): string | null {
  if (basename(hashFilePath) !== UPSTREAM_FILE_HASHES_FILENAME) {
    return null
  }

  const parentDir = dirname(hashFilePath)
  if (basename(parentDir) === 'upstream') {
    return null
  }

  return getLegacyUpstreamFileHashesPath(parentDir)
}

interface HashFileReadResult {
  hashes: UpstreamFileHashMap
  missing: boolean
  valid: boolean
}

async function readHashFile(hashFilePath: string): Promise<HashFileReadResult> {
  try {
    const hashFileStat = await lstat(hashFilePath)
    if (!hashFileStat.isFile()) {
      log.warn(`업스트림 파일 해시 읽기를 건너뜁니다. 일반 파일이 아닙니다: ${hashFilePath}`)
      return { hashes: {}, missing: false, valid: false }
    }

    const content = await readFile(hashFilePath, 'utf-8')
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { hashes: {}, missing: false, valid: false }
    }
    return { hashes: parsed as UpstreamFileHashMap, missing: false, valid: true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { hashes: {}, missing: true, valid: false }
    }
    log.warn(`업스트림 파일 해시를 읽는 중 오류가 발생해 초기 상태로 진행합니다: ${hashFilePath}`)
    return { hashes: {}, missing: false, valid: false }
  }
}

export async function readUpstreamFileHashes(hashFilePath: string): Promise<UpstreamFileHashMap> {
  const primaryResult = await readHashFile(hashFilePath)
  if (!primaryResult.missing) {
    return primaryResult.hashes
  }

  const legacyHashFilePath = resolveLegacyHashFilePath(hashFilePath)
  if (!legacyHashFilePath) {
    return {}
  }

  return (await readHashFile(legacyHashFilePath)).hashes
}

/**
 * 업스트림 저장소를 검사하기 전에 기존 해시 상태를 저장소 밖으로 옮깁니다.
 * 새 경로가 이미 유효하면 중복된 기존 파일만 제거합니다.
 */
export async function migrateLegacyUpstreamFileHashes(modDir: string): Promise<boolean> {
  const hashFilePath = getUpstreamFileHashesPath(modDir)
  const legacyHashFilePath = getLegacyUpstreamFileHashesPath(modDir)
  const primaryResult = await readHashFile(hashFilePath)

  if (!primaryResult.missing) {
    if (primaryResult.valid) {
      await rm(legacyHashFilePath, { force: true })
    }
    return false
  }

  const legacyResult = await readHashFile(legacyHashFilePath)
  if (!legacyResult.valid) {
    return false
  }

  await writeUpstreamFileHashes(hashFilePath, legacyResult.hashes)
  return true
}

export async function writeUpstreamFileHashes(hashFilePath: string, hashes: UpstreamFileHashMap): Promise<void> {
  const hashContent = `${JSON.stringify(hashes, null, 2)}\n`

  try {
    const existingFileStat = await lstat(hashFilePath)
    if (!existingFileStat.isFile()) {
      log.warn(`업스트림 파일 해시 저장을 건너뜁니다. 일반 파일이 아닙니다: ${hashFilePath}`)
      return
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  try {
    const fileHandle = await open(
      hashFilePath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW,
      0o644
    )

    try {
      await fileHandle.writeFile(hashContent, 'utf-8')
    } finally {
      await fileHandle.close()
    }

    const legacyHashFilePath = resolveLegacyHashFilePath(hashFilePath)
    if (legacyHashFilePath) {
      await rm(legacyHashFilePath, { force: true })
    }
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code
    if (errorCode === 'ELOOP') {
      log.warn(`업스트림 파일 해시 저장을 건너뜁니다. 심볼릭 링크는 허용되지 않습니다: ${hashFilePath}`)
      return
    }
    throw error
  }
}

export function removeUpstreamFileHash(hashes: UpstreamFileHashMap, sourceRelativePath: string): boolean {
  if (!Object.hasOwn(hashes, sourceRelativePath)) {
    return false
  }

  delete hashes[sourceRelativePath]
  return true
}
