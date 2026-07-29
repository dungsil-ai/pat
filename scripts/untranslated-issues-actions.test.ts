import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

interface UntranslatedItem {
  mod: string
  componentId?: string
  componentName?: string
  sourcePath?: string
  file: string
  key: string
  message: string
}

interface IssueScope {
  key: string
  mod: string
  componentId?: string
  componentName?: string
}

interface IssueLike {
  title: string
  body?: string
}

const require = createRequire(import.meta.url)
const createAction = require('../.github/actions/create-untranslated-issues/index.js') as {
  buildIssueBody: (options: {
    gameDisplayName: string
    scope: IssueScope
    items: UntranslatedItem[]
    timestamp: string
  }) => string
  createScope: (mod: string, componentId?: string, componentName?: string) => IssueScope
  getIssueScopeKey: (issue: IssueLike) => string | null
  getIssueTitle: (gameDisplayName: string, scope: IssueScope) => string
  groupItemsByScope: (
    items: UntranslatedItem[],
    onWarning?: (message: string) => void
  ) => Array<{ scope: IssueScope, items: UntranslatedItem[] }>
}
const closeAction = require('../.github/actions/close-translation-issues/index.js') as {
  buildResolutionComment: (options: {
    commit: { sha: string, shortSha: string, subject: string }
    context: { repo: { owner: string, repo: string } }
    gameType: string
    issueScope: IssueScope
  }) => string
  createScope: (mod: string, componentId?: string, componentName?: string) => IssueScope
  getIssueScope: (issue: IssueLike, gameDisplayName: string) => IssueScope | null
  getUnresolvedScopeKeys: (items: Array<Pick<UntranslatedItem, 'mod' | 'componentId' | 'componentName'>>) => Set<string>
  readUntranslatedItems: (
    filePath: string,
    logger?: { error: (message: string) => void }
  ) => { ok: boolean, items: UntranslatedItem[], reason?: string }
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    recursive: true,
    force: true
  })))
})

describe('번역 거부 항목 이슈 스코프', () => {
  it('같은 번역 묶음의 컴포넌트를 서로 다른 이슈 그룹으로 분리해야 한다', () => {
    const groups = createAction.groupItemsByScope([
      {
        mod: 'Grey\'s Little Reworks',
        componentId: 'sea',
        componentName: 'Soft Econ Adjustments',
        sourcePath: 'Soft Econ Adjustments/localization/english/shared.yml',
        file: 'shared.yml',
        key: 'shared_key',
        message: '첫 번째 원문'
      },
      {
        mod: 'Grey\'s Little Reworks',
        componentId: 'spa',
        componentName: 'Soft Pop Adjustments',
        sourcePath: 'Soft Pop Adjustments/localization/english/shared.yml',
        file: 'shared.yml',
        key: 'shared_key',
        message: '두 번째 원문'
      }
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map(group => group.scope.componentId)).toEqual(['sea', 'spa'])
  })

  it('같은 컴포넌트에서도 출처 경로가 다르면 같은 키를 별도 항목으로 유지해야 한다', () => {
    const baseItem = {
      mod: 'Bundle',
      componentId: 'component',
      componentName: 'Component',
      file: 'shared.yml',
      key: 'same_key',
      message: '원문'
    }
    const groups = createAction.groupItemsByScope([
      { ...baseItem, sourcePath: 'first/shared.yml' },
      { ...baseItem, sourcePath: 'second/shared.yml' },
      { ...baseItem, sourcePath: 'first/shared.yml' }
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(2)
  })

  it('안정적인 컴포넌트 ID로 이슈를 찾아 표시명 변경을 허용해야 한다', () => {
    const originalScope = createAction.createScope('Bundle', 'stable-id', '이전 이름')
    const body = createAction.buildIssueBody({
      gameDisplayName: 'VIC3',
      scope: originalScope,
      items: [{
        mod: 'Bundle',
        componentId: 'stable-id',
        componentName: '이전 이름',
        sourcePath: 'component/localization/english/file.yml',
        file: 'file.yml',
        key: 'key',
        message: 'message'
      }],
      timestamp: '2026-01-01T00:00:00Z'
    })
    const renamedScope = createAction.createScope('Bundle', 'stable-id', '새 이름')

    expect(createAction.getIssueScopeKey({
      title: createAction.getIssueTitle('VIC3', originalScope),
      body
    })).toBe(renamedScope.key)
    expect(createAction.getIssueTitle('VIC3', renamedScope)).toContain('Bundle / 새 이름')
  })

  it('legacy 이슈는 컴포넌트 없는 기존 모드 스코프로 읽어야 한다', () => {
    const issue = {
      title: '[CK3] 번역 거부 항목 발생: Legacy Mod',
      body: '**게임**: CK3\n**모드**: Legacy Mod\n'
    }

    expect(closeAction.getIssueScope(issue, 'CK3'))
      .toEqual(closeAction.createScope('Legacy Mod'))
  })
})

describe('번역 거부 이슈 종료 판단', () => {
  it('컴포넌트가 다른 미번역 항목을 별도 종료 스코프로 계산해야 한다', () => {
    const unresolved = closeAction.getUnresolvedScopeKeys([
      { mod: 'Bundle', componentId: 'sea', componentName: 'SEA' }
    ])

    expect(unresolved.has(closeAction.createScope('Bundle', 'sea').key)).toBe(true)
    expect(unresolved.has(closeAction.createScope('Bundle', 'spa').key)).toBe(false)
    expect(unresolved.has(closeAction.createScope('Bundle').key)).toBe(false)
  })

  it('스코프가 잘못된 JSON이면 모든 이슈 종료를 안전하게 건너뛰어야 한다', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pat-untranslated-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'vic3-untranslated-items.json')
    await writeFile(filePath, JSON.stringify({
      items: [{ mod: 'Bundle', componentId: 123 }]
    }))

    expect(closeAction.readUntranslatedItems(filePath)).toMatchObject({
      ok: false,
      reason: 'invalid-item-scope'
    })
  })

  it('종료 코멘트에 논리 모드 식별자를 포함해야 한다', () => {
    const body = closeAction.buildResolutionComment({
      commit: {
        sha: '1234567890abcdef',
        shortSha: '1234567',
        subject: '번역 반영'
      },
      context: {
        repo: {
          owner: 'dungsil-ai',
          repo: 'pat'
        }
      },
      gameType: 'vic3',
      issueScope: closeAction.createScope('Bundle', 'sea', 'Soft Econ Adjustments')
    })

    expect(body).toContain('- 모드: `Bundle`')
    expect(body).toContain('- 논리 모드: `Soft Econ Adjustments` (`sea`)')
  })
})
