import { constants as fsConstants } from 'node:fs'
import { lstat, open, readFile } from 'node:fs/promises'
import { join } from 'pathe'
import { log } from './logger'

export type UpstreamFileHashMap = Record<string, string>

export const UPSTREAM_FILE_HASHES_FILENAME = '.pat-file-hashes.json'

export function getUpstreamFileHashesPath(modDir: string): string {
  return join(modDir, 'upstream', UPSTREAM_FILE_HASHES_FILENAME)
}

export async function readUpstreamFileHashes(hashFilePath: string): Promise<UpstreamFileHashMap> {
  try {
    const hashFileStat = await lstat(hashFilePath)
    if (!hashFileStat.isFile()) {
      log.warn(`업스트림 파일 해시 읽기를 건너뜁니다. 일반 파일이 아닙니다: ${hashFilePath}`)
      return {}
    }

    const content = await readFile(hashFilePath, 'utf-8')
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as UpstreamFileHashMap
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    log.warn(`업스트림 파일 해시를 읽는 중 오류가 발생해 초기 상태로 진행합니다: ${hashFilePath}`)
    return {}
  }
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
