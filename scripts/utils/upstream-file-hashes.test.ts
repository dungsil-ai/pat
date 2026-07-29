import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import {
  getLegacyUpstreamFileHashesPath,
  getUpstreamFileHashesPath,
  migrateLegacyUpstreamFileHashes,
  readUpstreamFileHashes
} from './upstream-file-hashes'

describe('업스트림 파일 해시 상태 경로', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'upstream-file-hashes-test-'))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('해시 상태를 upstream 체크아웃 밖에 저장해야 함', () => {
    expect(getUpstreamFileHashesPath(testDir)).toBe(join(testDir, '.pat-file-hashes.json'))
    expect(getLegacyUpstreamFileHashesPath(testDir)).toBe(join(testDir, 'upstream', '.pat-file-hashes.json'))
  })

  it('기존 해시 상태를 읽고 새 경로로 마이그레이션해야 함', async () => {
    const legacyPath = getLegacyUpstreamFileHashesPath(testDir)
    const newPath = getUpstreamFileHashesPath(testDir)
    const hashes = { 'localization/example_l_english.yml': 'hash-value' }

    await mkdir(join(testDir, 'upstream'), { recursive: true })
    await writeFile(legacyPath, JSON.stringify(hashes), 'utf-8')

    expect(await readUpstreamFileHashes(newPath)).toEqual(hashes)
    await expect(migrateLegacyUpstreamFileHashes(testDir)).resolves.toBe(true)
    expect(JSON.parse(await readFile(newPath, 'utf-8'))).toEqual(hashes)
    expect(existsSync(legacyPath)).toBe(false)
  })

  it('새 해시 상태가 있으면 유지하고 중복된 기존 상태만 제거해야 함', async () => {
    const legacyPath = getLegacyUpstreamFileHashesPath(testDir)
    const newPath = getUpstreamFileHashesPath(testDir)

    await mkdir(join(testDir, 'upstream'), { recursive: true })
    await writeFile(newPath, JSON.stringify({ source: 'new' }), 'utf-8')
    await writeFile(legacyPath, JSON.stringify({ source: 'old' }), 'utf-8')

    await expect(migrateLegacyUpstreamFileHashes(testDir)).resolves.toBe(false)
    expect(await readUpstreamFileHashes(newPath)).toEqual({ source: 'new' })
    expect(existsSync(legacyPath)).toBe(false)
  })
})
