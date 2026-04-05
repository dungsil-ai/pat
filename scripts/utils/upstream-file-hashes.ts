import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'pathe'
import { log } from './logger'

export type UpstreamFileHashMap = Record<string, string>

export const UPSTREAM_FILE_HASHES_FILENAME = '.pat-file-hashes.json'

export function getUpstreamFileHashesPath(modDir: string): string {
  return join(modDir, 'upstream', UPSTREAM_FILE_HASHES_FILENAME)
}

export async function readUpstreamFileHashes(hashFilePath: string): Promise<UpstreamFileHashMap> {
  try {
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
  await writeFile(hashFilePath, `${JSON.stringify(hashes, null, 2)}\n`, 'utf-8')
}

export function removeUpstreamFileHash(hashes: UpstreamFileHashMap, sourceRelativePath: string): boolean {
  if (!Object.hasOwn(hashes, sourceRelativePath)) {
    return false
  }

  delete hashes[sourceRelativePath]
  return true
}
