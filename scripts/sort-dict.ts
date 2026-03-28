#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { consola } from 'consola'
import { parseTomlWithComments, sortBlocks, blocksToToml } from './utils/dict-sorter'

// 프로젝트 루트 디렉토리
const projectRoot = join(import.meta.dirname, '..')

/**
 * 딕셔너리 파일을 정렬합니다.
 * @param filename 파일명 (dictionaries/ 디렉토리 기준)
 * @param dryRun true일 경우 파일을 수정하지 않고 결과만 출력
 */
function sortDictionaryFile(filename: string, dryRun: boolean = false): void {
  const filePath = join(projectRoot, 'dictionaries', filename)
  
  try {
    consola.info(`파일 처리 중: ${filename}`)
    
    // 파일 읽기
    const content = readFileSync(filePath, 'utf-8')
    
    // 파싱
    const blocks = parseTomlWithComments(content)
    consola.info(`  - ${blocks.length}개의 주석 블록 발견`)
    
    // 정렬
    const sortedBlocks = sortBlocks(blocks)
    
    // TOML로 변환
    const sortedContent = blocksToToml(sortedBlocks)
    
    // 변경사항 확인
    if (content === sortedContent) {
      consola.success(`  - 이미 정렬되어 있음`)
      return
    }
    
    // 파일 쓰기
    if (dryRun) {
      consola.info(`  - [dry-run] 변경사항:`)
      consola.box(sortedContent.slice(0, 500) + (sortedContent.length > 500 ? '...' : ''))
    } else {
      writeFileSync(filePath, sortedContent, 'utf-8')
      consola.success(`  - 정렬 완료`)
    }
  } catch (error: unknown) {
    consola.error(`파일 처리 실패: ${filename}`)
    if (error instanceof Error) {
      consola.error(error.message)
    } else {
      consola.error(String(error))
    }
  }
}

// CLI 실행
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

// 처리할 딕셔너리 파일 목록
const dictionaryFiles = [
  'ck3-glossary.toml',
  'ck3-proper-nouns.toml',
  'stellaris.toml',
  'vic3.toml'
]

consola.start('딕셔너리 파일 정렬 시작')

if (dryRun) {
  consola.info('Dry-run 모드: 파일을 수정하지 않고 결과만 출력합니다.')
}

for (const file of dictionaryFiles) {
  sortDictionaryFile(file, dryRun)
}

consola.success('딕셔너리 파일 정렬 완료')
