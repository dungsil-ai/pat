import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getChangedDictionaryKeys } from './dictionary-changes'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

vi.mock('node:child_process')

const execFileAsync = vi.mocked(promisify(execFile))

describe('dictionary-changes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getChangedDictionaryKeys', () => {
    it('옵션이 없으면 빈 배열을 반환해야 함', async () => {
      const keys = await getChangedDictionaryKeys('ck3', {})
      expect(keys).toEqual([])
    })

    it('변경사항이 없으면 빈 배열을 반환해야 함', async () => {
      vi.mocked(execFileAsync).mockResolvedValue({ stdout: '', stderr: '' } as any)
      
      const keys = await getChangedDictionaryKeys('ck3', { sinceCommit: 'abc1234' })
      expect(keys).toEqual([])
    })

    it('sinceCommit 옵션으로 변경된 키를 추출해야 함', async () => {
      const mockDiff = `
diff --git a/scripts/utils/dictionary.ts b/scripts/utils/dictionary.ts
index 123..456 789
--- a/scripts/utils/dictionary.ts
+++ b/scripts/utils/dictionary.ts
@@ -10,6 +10,7 @@ const ck3Glossary: Record<string, string> = {
   king: '왕',
   landless: '비지주',
+  newterm: '새로운 용어',
   senate: '원로원',
`
      vi.mocked(execFileAsync).mockResolvedValue({ stdout: mockDiff, stderr: '' } as any)
      
      const keys = await getChangedDictionaryKeys('ck3', { sinceCommit: 'abc1234' })
      expect(keys).toContain('newterm')
    })

    it('commitRange 옵션으로 변경된 키를 추출해야 함', async () => {
      const mockDiff = `
diff --git a/scripts/utils/dictionary.ts b/scripts/utils/dictionary.ts
index 123..456 789
--- a/scripts/utils/dictionary.ts
+++ b/scripts/utils/dictionary.ts
@@ -10,6 +10,8 @@ const ck3Glossary: Record<string, string> = {
   king: '왕',
+  term1: '용어1',
+  term2: '용어2',
   landless: '비지주',
`
      vi.mocked(execFileAsync).mockResolvedValue({ stdout: mockDiff, stderr: '' } as any)
      
      const keys = await getChangedDictionaryKeys('ck3', { commitRange: 'abc1234..def5678' })
      expect(keys).toEqual(expect.arrayContaining(['term1', 'term2']))
      expect(keys.length).toBe(2)
    })

    it('sinceDate 옵션으로 변경된 키를 추출해야 함', async () => {
      const mockDiff = `
diff --git a/scripts/utils/dictionary.ts b/scripts/utils/dictionary.ts
index 123..456 789
--- a/scripts/utils/dictionary.ts
+++ b/scripts/utils/dictionary.ts
@@ -10,6 +10,7 @@ const ck3Glossary: Record<string, string> = {
   king: '왕',
+  recentterm: '최근 용어',
   landless: '비지주',
`
      vi.mocked(execFileAsync).mockResolvedValue({ stdout: mockDiff, stderr: '' } as any)
      
      const keys = await getChangedDictionaryKeys('ck3', { sinceDate: '2024-01-01' })
      expect(keys).toContain('recentterm')
    })

    it('따옴표로 감싼 키도 추출해야 함', async () => {
      const mockDiff = `
diff --git a/scripts/utils/dictionary.ts b/scripts/utils/dictionary.ts
index 123..456 789
--- a/scripts/utils/dictionary.ts
+++ b/scripts/utils/dictionary.ts
@@ -10,6 +10,8 @@ const ck3Glossary: Record<string, string> = {
   king: '왕',
+  'key with spaces': '공백이 있는 키',
+  'special-key': '특수문자 키',
   landless: '비지주',
`
      vi.mocked(execFileAsync).mockResolvedValue({ stdout: mockDiff, stderr: '' } as any)
      
      const keys = await getChangedDictionaryKeys('ck3', { sinceCommit: 'abc1234' })
      expect(keys).toEqual(expect.arrayContaining(['key with spaces', 'special-key']))
    })

    it('게임 타입별로 올바른 딕셔너리 섹션을 찾아야 함', async () => {
      const mockDiff = `
diff --git a/scripts/utils/dictionary.ts b/scripts/utils/dictionary.ts
index 123..456 789
--- a/scripts/utils/dictionary.ts
+++ b/scripts/utils/dictionary.ts
@@ -800,6 +800,7 @@ const stellarisDictionaries: Record<string, string> = {
   empire: '제국',
+  newstellaristerm: '새 스텔라리스 용어',
   federation: '연방',
`
      vi.mocked(execFileAsync).mockResolvedValue({ stdout: mockDiff, stderr: '' } as any)
      
      const keys = await getChangedDictionaryKeys('stellaris', { sinceCommit: 'abc1234' })
      expect(keys).toContain('newstellaristerm')
    })

    it('CK3 고유명사 섹션의 변경사항도 추출해야 함', async () => {
      const mockDiff = `
diff --git a/scripts/utils/dictionary.ts b/scripts/utils/dictionary.ts
index 123..456 789
--- a/scripts/utils/dictionary.ts
+++ b/scripts/utils/dictionary.ts
@@ -40,6 +40,7 @@ const ck3ProperNouns: Record<string, string> = {
   'af Möre': '아프 뫼레',
+  'NewPerson': '새로운 인물',
   'af Fasge': '아프 파스게',
`
      vi.mocked(execFileAsync).mockResolvedValue({ stdout: mockDiff, stderr: '' } as any)
      
      const keys = await getChangedDictionaryKeys('ck3', { sinceCommit: 'abc1234' })
      expect(keys).toContain('NewPerson')
    })

    it('중복된 키는 한 번만 포함되어야 함', async () => {
      const mockDiff = `
diff --git a/scripts/utils/dictionary.ts b/scripts/utils/dictionary.ts
index 123..456 789
--- a/scripts/utils/dictionary.ts
+++ b/scripts/utils/dictionary.ts
@@ -10,6 +10,7 @@ const ck3Glossary: Record<string, string> = {
   king: '왕',
+  duplicatekey: '중복 키',
   landless: '비지주',
@@ -20,6 +21,7 @@ const ck3Glossary: Record<string, string> = {
   senate: '원로원',
+  duplicatekey: '중복 키 다시',
   stewardship: '관리력',
`
      vi.mocked(execFileAsync).mockResolvedValue({ stdout: mockDiff, stderr: '' } as any)
      
      const keys = await getChangedDictionaryKeys('ck3', { sinceCommit: 'abc1234' })
      expect(keys.filter(k => k === 'duplicatekey').length).toBe(1)
    })
    
    it('유효하지 않은 커밋 ID 형식이면 오류를 발생시켜야 함', async () => {
      await expect(getChangedDictionaryKeys('ck3', { sinceCommit: 'invalid' }))
        .rejects.toThrow('유효하지 않은 커밋 ID 형식')
    })
    
    it('유효하지 않은 커밋 범위 형식이면 오류를 발생시켜야 함', async () => {
      await expect(getChangedDictionaryKeys('ck3', { commitRange: 'abc..def' }))
        .rejects.toThrow('유효하지 않은 커밋 범위 형식')
    })
  })
})
