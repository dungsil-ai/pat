import { constants as fsConstants } from 'node:fs'
import { access, lstat, open, readFile, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import process from 'node:process'
import { dirname, join } from 'pathe'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isReplaceLocalizationPath, readModMeta } from './config/mod-meta'
import { buildKoreanTargetFileName } from './utils/localization-file-name'
import { getUpstreamFileHashesPath, readUpstreamFileHashes } from './utils/upstream-file-hashes'
import { log } from './utils/logger'

const execFileAsync = promisify(execFile)
const VERIFIED_MARKER_PREFIX = '# PAT verified upstream: '
const NOFOLLOW_FLAG = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW

type UntranslatedItem = {
  mod?: string
  sourcePath?: string
}

type UntranslatedResult = {
  items?: UntranslatedItem[]
}

export function updateVerifiedMarker(content: string, revision: string): string {
  const marker = `${VERIFIED_MARKER_PREFIX}${revision}`
  const markerPattern = /^(\uFEFF?l_korean:(\r?\n))?# PAT verified upstream:.*(\r?\n|$)/
  const legacyMarkerPattern = /^# PAT verified upstream:.*(?:\r?\n)(\uFEFF?l_korean:(\r?\n|$))/
  const legacyMarker = content.match(legacyMarkerPattern)

  if (legacyMarker) {
    return `${legacyMarker[1]}${marker}${legacyMarker[2] || '\n'}${content.slice(legacyMarker[0].length)}`
  }

  if (markerPattern.test(content)) {
    return content.replace(markerPattern, (_match, header = '', headerEol = '', markerEol = '') => (
      `${header}${marker}${headerEol || markerEol}`
    ))
  }

  return content.replace(/^(\uFEFF?l_korean:(?:\r?\n|$))/, `$1${marker}\n`)
}

async function readUntranslatedSourcePaths(rootDir: string, game: string): Promise<Set<string>> {
  try {
    const content = await readFile(join(rootDir, `${game}-untranslated-items.json`), 'utf-8')
    const parsed = JSON.parse(content) as UntranslatedResult
    return new Set((parsed.items ?? []).map(item => item.sourcePath).filter((path): path is string => Boolean(path)))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Set()
    }
    throw error
  }
}

async function getShortUpstreamRevision(upstreamRoot: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: upstreamRoot })
  return stdout.trim()
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(resolve(rootPath), resolve(targetPath))
  return relativePath === ''
    || (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`))
}

async function isSafeMarkerTarget(modDir: string, outputRoot: string, targetPath: string): Promise<boolean> {
  if (!isPathInside(outputRoot, targetPath) || !isPathInside(modDir, targetPath)) {
    log.warn(`검증 마커 기록을 건너뜁니다. 출력 경로를 벗어났습니다: ${targetPath}`)
    return false
  }

  const pathSegments = relative(resolve(modDir), resolve(targetPath)).split(sep).filter(Boolean)
  let currentPath = resolve(modDir)

  for (const [index, pathSegment] of pathSegments.entries()) {
    currentPath = join(currentPath, pathSegment)

    let targetStat
    try {
      targetStat = await lstat(currentPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }
      throw error
    }

    if (targetStat.isSymbolicLink()) {
      log.warn(`검증 마커 기록을 건너뜁니다. 심볼릭 링크는 허용되지 않습니다: ${currentPath}`)
      return false
    }

    const isTarget = index === pathSegments.length - 1
    if ((isTarget && !targetStat.isFile()) || (!isTarget && !targetStat.isDirectory())) {
      log.warn(`검증 마커 기록을 건너뜁니다. 일반 파일 경로가 아닙니다: ${currentPath}`)
      return false
    }
  }

  return pathSegments.length > 0
}

async function markVerifiedFile(
  modDir: string,
  outputRoot: string,
  targetPath: string,
  revision: string
): Promise<boolean> {
  if (!await isSafeMarkerTarget(modDir, outputRoot, targetPath)) {
    return false
  }

  try {
    const readHandle = await open(targetPath, fsConstants.O_RDONLY | NOFOLLOW_FLAG)
    let content: string
    try {
      content = await readHandle.readFile('utf-8')
    } finally {
      await readHandle.close()
    }

    const updatedContent = updateVerifiedMarker(content, revision)
    if (updatedContent === content) {
      return false
    }

    const writeHandle = await open(
      targetPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | NOFOLLOW_FLAG,
      0o644
    )
    try {
      await writeHandle.writeFile(updatedContent, 'utf-8')
    } finally {
      await writeHandle.close()
    }
    return true
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code
    if (errorCode === 'ENOENT') {
      return false
    }
    if (errorCode === 'ELOOP') {
      log.warn(`검증 마커 기록을 건너뜁니다. 심볼릭 링크는 허용되지 않습니다: ${targetPath}`)
      return false
    }
    throw error
  }
}

export async function markVerifiedMod(rootDir: string, game: string, mod: string, untranslatedSourcePaths: Set<string>): Promise<number> {
  const modDir = join(rootDir, game, mod)
  const metaPath = join(modDir, 'meta.toml')
  const upstreamRoot = join(modDir, 'upstream')

  try {
    await access(metaPath)
    await access(upstreamRoot)
  } catch {
    return 0
  }

  const meta = await readModMeta(metaPath)
  if (!meta.upstream.url) {
    return 0
  }

  const savedFileHashes = await readUpstreamFileHashes(getUpstreamFileHashesPath(modDir))
  const revision = await getShortUpstreamRevision(upstreamRoot)
  const localizationFolder = game === 'stellaris' ? 'localisation' : 'localization'
  let updatedFiles = 0

  for (const component of meta.upstream.components) {
    const files: Array<{ sourcePath: string, targetPath: string, outputRoot: string }> = []

    for (const localizationPath of component.localizationPaths) {
      const sourceDir = join(upstreamRoot, localizationPath)
      let sourceFiles: string[]
      try {
        sourceFiles = await readdir(sourceDir, { recursive: true })
      } catch {
        files.length = 0
        break
      }

      const koreanBaseDir = join(
        modDir,
        'mod',
        localizationFolder,
        isReplaceLocalizationPath(localizationPath) ? 'korean/replace' : 'korean'
      )
      const targetDir = component.outputSubdir ? join(koreanBaseDir, component.outputSubdir) : koreanBaseDir

      for (const file of sourceFiles) {
        const normalizedFile = file.replace(/\\/g, '/')
        if (!normalizedFile.endsWith('.yml') || !normalizedFile.includes(`_l_${meta.upstream.language}`)) {
          continue
        }

        const sourcePath = join(localizationPath, normalizedFile).replace(/\\/g, '/')
        files.push({
          sourcePath,
          targetPath: join(targetDir, dirname(normalizedFile), buildKoreanTargetFileName(normalizedFile, meta.upstream.language)),
          outputRoot: targetDir
        })
      }
    }

    const componentVerified = files.length > 0 && files.every(({ sourcePath }) => (
      Object.hasOwn(savedFileHashes, sourcePath) && !untranslatedSourcePaths.has(sourcePath)
    ))
    if (!componentVerified) {
      continue
    }

    for (const { targetPath, outputRoot } of files) {
      if (await markVerifiedFile(modDir, outputRoot, targetPath, revision)) {
        updatedFiles++
      }
    }
  }

  return updatedFiles
}

async function main(): Promise<void> {
  const game = process.argv[2]
  if (!game || !['ck3', 'vic3', 'stellaris'].includes(game)) {
    throw new Error('사용법: pnpm mark-verified-upstream <ck3|vic3|stellaris>')
  }

  const rootDir = join(import.meta.dirname, '..')
  const untranslatedSourcePaths = await readUntranslatedSourcePaths(rootDir, game)
  const gameDir = join(rootDir, game)
  const modEntries = await readdir(gameDir, { withFileTypes: true })
  let updatedFiles = 0

  for (const modEntry of modEntries) {
    if (!modEntry.isDirectory()) continue
    updatedFiles += await markVerifiedMod(rootDir, game, modEntry.name, untranslatedSourcePaths)
  }

  process.stdout.write(`검증 완료 업스트림 메타데이터 갱신: ${updatedFiles}개 파일\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exit(1)
  })
}
