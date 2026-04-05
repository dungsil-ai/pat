import { translateAI, translateAIBulk, TranslationRefusedError, type RetranslationContext } from './ai'
import { getCache, hasCache, removeCache, setCache } from './cache'
import { getDictionary, hasDictionary } from './dictionary'
import { log } from './logger.js'
import { type GameType } from './prompts'
import { validateTranslation } from './translation-validator'

export class TranslationRetryExceededError extends Error {
  constructor (text: string) {
    super(`번역 재시도 횟수 초과 (대상 텍스트: "${text}")`)
    this.name = 'TranslationRetryExceededError'
  }
}

export { TranslationRefusedError }

export interface BulkTranslateResult {
  translatedText: string
  error?: TranslationRefusedError | TranslationRetryExceededError
}

interface BulkTranslateContext {
  modName?: string
}

const MAX_BULK_ITEMS_PER_REQUEST = 24
const MAX_BULK_CHARS_PER_REQUEST = 6000

interface UnresolvedBulkItem {
  index: number
  text: string
  cacheKey: string
}

function splitBulkRequests(items: UnresolvedBulkItem[]): UnresolvedBulkItem[][] {
  const batches: UnresolvedBulkItem[][] = []
  let currentBatch: UnresolvedBulkItem[] = []
  let currentChars = 0

  for (const item of items) {
    const itemChars = item.text.length
    const shouldSplit =
      currentBatch.length > 0 &&
      (currentBatch.length >= MAX_BULK_ITEMS_PER_REQUEST || currentChars + itemChars > MAX_BULK_CHARS_PER_REQUEST)

    if (shouldSplit) {
      batches.push(currentBatch)
      currentBatch = []
      currentChars = 0
    }

    currentBatch.push(item)
    currentChars += itemChars
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
}

/**
 * Regex patterns for detecting variable-only text that should be returned immediately without AI translation.
 * 
 * These patterns match game variables and formatting markers that must be preserved exactly as-is.
 * When text matches any of these patterns, it's returned immediately without calling the AI API.
 * 
 * Supported patterns:
 * - $variable$: Dollar-wrapped variables (e.g., $k_france$, $country_name$)
 * - £variable£: Pound-wrapped variables for currency/resources (e.g., £gold£, £money£)
 * - @variable@ or @variable!: At-wrapped variables for icons (e.g., @crown_icon@, @red_cross!, @information!)
 * - <variable>: Angle bracket variables for Stellaris (e.g., <democratic_gen>)
 * - [function]: Square bracket functions/variables (e.g., [GetTitle], [culture|E], [owner.GetName])
 * - #format#: Hash-wrapped formatting markers (e.g., #bold#, #italic#!)
 * - §X$variable$§!: Section sign color code with dollar variable (e.g., §E$r_zro_crystal$§!, §Y$name$§!)
 */
const DOLLAR_VARIABLE_REGEX = /^\$[a-zA-Z0-9_\-.]+\$$/           // $variable$
const POUND_VARIABLE_REGEX = /^£[a-zA-Z0-9_\-.]+£$/              // £variable£ (currency/resources)
const AT_VARIABLE_REGEX = /^@[a-zA-Z0-9_\-.]+[@!]$/              // @variable@ or @variable! (icons)
const ANGLE_VARIABLE_REGEX = /^<[a-zA-Z0-9_\-.]+>$/              // <variable> (Stellaris)
const SQUARE_BRACKET_REGEX = /^\[(?:[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*|\w+\|\w+)\]$/ // [Function], [object.Method], [variable|E]
const HASH_FORMAT_REGEX = /^#[a-zA-Z_]+#!?$/                     // #formatting# or #formatting#!
// 색상 코드 + 달러 변수 조합 (예: §E$r_zro_crystal$§!, §Y$name$§!)
// 변수 이름에 @ 접두사 지원 (예: §G$@matrioshka$§!), 형식 지정자(|...) 지원
// 지원되는 색상 코드: E, Y, G, R, H, L, T, S, P, W, B, M, A (단일 또는 조합, 예: §BA)
const SECTION_SIGN_VARIABLE_REGEX = /^§[EYGRHLTSPWBMA]{1,2}\$[@]?[a-zA-Z0-9_\-.]+(?:\|[^$§\r\n]+)?\$§!$/

/**
 * 텍스트가 게임 변수로만 구성되어 있는지 검사합니다 (번역 가능한 내용이 없는 경우).
 * 여러 변수가 조합된 경우도 감지합니다 (예: $var$[Function(...)])
 * 
 * @param text 검사할 텍스트
 * @returns 텍스트가 게임 변수로만 구성되어 있으면 true
 */
function isVariableOnlyText(text: string): boolean {
  if (!text || text.trim() === '') {
    return false
  }

  let remaining = text

  // 1. 색상 코드 + 달러/파운드 변수 조합 제거 (예: §Y$name$§!, §H£energy£§!)
  // 패턴: §<색상코드> + $<변수명>$ + §! (색상코드는 대문자 1~2글자)
  // 변수명에 @ 접두사, 공백, 형식 지정자(|...) 지원
  remaining = remaining.replace(/§[A-Z]{1,2}\$[@]?[a-zA-Z0-9_\-.@]+(?:\s+[a-zA-Z0-9_\-.@]+)*(?:\|[^$§\r\n]+)?\$§!/g, '')
  remaining = remaining.replace(/§[A-Z]{1,2}£[a-zA-Z0-9_\-.]+£§!/g, '')

  // 2. 달러 변수 제거: $...$
  // 패턴: $<변수명>$ (변수명에 @ 접두사, 공백, 형식 지정자 지원)
  // 예: $k_france$, $@variable|format$, $Open Daoyu Cheat$
  remaining = remaining.replace(/\$[@]?[a-zA-Z0-9_\-.@]+(?:\s+[a-zA-Z0-9_\-.@]+)*(?:\|[^$\r\n]+)?\$/g, '')

  // 3. 파운드 변수 제거: £...£
  remaining = remaining.replace(/£[a-zA-Z0-9_\-.]+£/g, '')

  // 4. @ 아이콘 변수 제거: @...@, @...! (콜론 포함 지원)
  // 예: @icon!, @aptitude:4:color_green!
  remaining = remaining.replace(/@[a-zA-Z0-9_\-.:]+[@!]/g, '')

  // 5. 앵글 브래킷 변수 제거: <...>
  remaining = remaining.replace(/<[a-zA-Z0-9_\-.]+>/g, '')

  // 6. 해시 포맷 마커 제거: #...# 또는 #...#!
  remaining = remaining.replace(/#[a-zA-Z_]+#!?/g, '')

  // 7. 대괄호 변수 제거: [...] (중첩된 괄호 처리 필요)
  // 함수 호출, 파이프 형식자 등 복잡한 내용 포함
  remaining = removeBracketVariables(remaining)

  // 남은 텍스트가 공백만 있으면 변수로만 구성된 것
  return remaining.trim() === ''
}

/**
 * 대괄호로 둘러싸인 게임 변수를 제거합니다 (중첩 괄호 처리).
 * 예: [Multiply_float(FixedPointToFloat(GetPlayer.MakeScope.Var('value').GetValue), '0.01')]
 * 
 * 주의: 괄호가 균형이 맞지 않는 경우 (예: [가 더 많은 경우) 원본 텍스트를 그대로 반환합니다.
 * 이는 번역이 필요한 텍스트로 간주되어 AI 번역이 호출됩니다.
 */
function removeBracketVariables(text: string): string {
  let result = ''
  let depth = 0
  let startIdx = 0

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[') {
      if (depth === 0) {
        result += text.substring(startIdx, i)
      }
      depth++
    } else if (text[i] === ']') {
      depth--
      if (depth === 0) {
        startIdx = i + 1
      }
      // 음수 depth는 잘못된 형식 - 원본 반환
      if (depth < 0) {
        return text
      }
    }
  }

  // 괄호가 균형이 맞지 않으면 (열린 괄호가 더 많으면) 원본 반환
  // 이 경우 번역이 필요한 텍스트로 간주됨
  if (depth !== 0) {
    return text
  }

  // 마지막 괄호 이후 남은 텍스트 추가
  if (startIdx < text.length) {
    result += text.substring(startIdx)
  }

  return result
}

function sanitizeTranslationText (text: string): string {
  if (!text) {
    return text
  }

  // 닫는 변수 마커와 뒤따르는 대괄호 사이에 공백을 확보하여 $[ 패턴 방지
  const addSpaceAfterClosingVariable = /([$£][a-zA-Z0-9_\-.]+(?:\|[^$£\r\n]+)?[$£]|@[a-zA-Z0-9_\-.]+[@!])(?=\[)/g
  return text.replace(addSpaceAfterClosingVariable, '$1 ')
}

export async function translate (text: string, gameType: GameType = 'ck3', retry: number = 0, retranslationContext?: RetranslationContext, useTransliteration: boolean = false): Promise<string> {

  if (retry > 5) {
    log.debug(`번역 재시도 횟수 초과: "${text}" (사유: ${retranslationContext?.failureReason || '알 수 없음'})`)
    throw new TranslationRetryExceededError(text)
  }

  // 잘못된 형식인 경우 빈 텍스트 반환
  if (text.trim() === '') {
    log.debug('빈 텍스트 번역 요청 감지, 원문 유지 처리')
    return text
  }

  const normalizedText = text

  // 변수만 있는 경우 그대로 반환 (AI 호출 없이 즉시 리턴)
  // 지원: $var$, £var£, @var@, <var>, [function], #format#, §X$var$§!
  if (
    DOLLAR_VARIABLE_REGEX.test(normalizedText) ||
    POUND_VARIABLE_REGEX.test(normalizedText) ||
    AT_VARIABLE_REGEX.test(normalizedText) ||
    ANGLE_VARIABLE_REGEX.test(normalizedText) ||
    SQUARE_BRACKET_REGEX.test(normalizedText) ||
    HASH_FORMAT_REGEX.test(normalizedText) ||
    SECTION_SIGN_VARIABLE_REGEX.test(normalizedText)
  ) {
    log.debug(`변수만 포함된 텍스트 감지, AI 번역 없이 원본 반환: ${normalizedText}`)
    return normalizedText
  }

  // 변수 조합만 있는 경우 그대로 반환 (예: $var$[Function(...)])
  // 번역 가능한 텍스트가 없는 경우 AI 호출 없이 즉시 리턴
  if (isVariableOnlyText(normalizedText)) {
    log.debug(`변수 조합만 포함된 텍스트 감지, AI 번역 없이 원본 반환: ${normalizedText}`)
    return normalizedText
  }

  // 음역 모드에서는 단어 사전 응답을 사용하지 않음
  // 고유명사 컨텍스트에서 의미 번역으로 고착되는 문제를 방지하기 위함
  if (!useTransliteration && hasDictionary(normalizedText, gameType)) {
    const dictText = sanitizeTranslationText(getDictionary(normalizedText, gameType)!)
    log.debug(`단어 사전에서 번역된 텍스트 반환: ${normalizedText} -> ${dictText}`)

    return dictText
  }

  // 캐시에 이미 번역된 텍스트가 있는 경우 캐시에서 반환
  // 음역 모드가 활성화된 경우 캐시 키에 음역 prefix 추가하여 별도로 관리
  // 캐시 키 구조 (모든 게임 통일, 실제 캐시 키는 cache.ts의 getCacheKey()에서 gameType: prefix가 추가됨):
  // - 번역: "gameType:text" (예: "ck3:Hello World")
  // - 음역: "gameType:transliteration:text" (예: "ck3:transliteration:Afar")
  const transliterationPrefix = useTransliteration ? 'transliteration:' : ''
  const cacheKey = `${transliterationPrefix}${normalizedText}`
  
  if (await hasCache(cacheKey, gameType)) {
    const cached = await getCache(cacheKey, gameType)

    if (cached) {
      const sanitizedCached = sanitizeTranslationText(cached)

      // 캐시 내용이 sanitize되었으면 같은 cacheKey로 업데이트
      if (sanitizedCached !== cached) {
        await setCache(cacheKey, sanitizedCached, gameType)
      }

      const { isValid } =  validateTranslation(normalizedText, sanitizedCached, gameType)
      if (isValid) {
        log.debug(`캐시에서 번역된 텍스트 반환: ${normalizedText} -> ${sanitizedCached}${useTransliteration ? ' (음역 모드)' : ''}`)
        return sanitizedCached
      }

      // 잘못 저장된 캐시는 제거
      await removeCache(cacheKey, gameType)
    }
  }

  // 실제 AI 번역 요청
  let translatedText: string
  try {
    translatedText = sanitizeTranslationText(await translateAI(text, gameType, retranslationContext, useTransliteration))
  } catch (error) {
    // TranslationRefusedError는 재throw하여 상위 호출자가 처리하도록 함
    if (error instanceof TranslationRefusedError) {
      throw error
    }
    // 기타 오류도 재throw
    throw error
  }

  log.debug(`AI 번역 결과: ${normalizedText} -> ${translatedText}${useTransliteration ? ' (음역 모드)' : ''}`)

  // 잘못된 결과 재 번역 시도
  if (translatedText.toLowerCase().includes('language model')) {
    log.debug('잘못 번역된 문자열: "', normalizedText, '" -> "', translatedText, '"')
    const newContext: RetranslationContext = {
      previousTranslation: translatedText,
      failureReason: 'It appears that a meta-response was returned without performing the translation.'
    }
    return await translate(text, gameType, retry + 1, newContext, useTransliteration)
  }

  // 번역 유효성 검증 (translation-validator.ts의 통합 로직 사용)
  const validation = validateTranslation(normalizedText, translatedText, gameType)

  if (!validation.isValid) {
    log.debug(`번역 검증 실패 (재번역): "${normalizedText}" -> "${translatedText}" (사유: ${validation.reason})`)
    const newContext: RetranslationContext = {
      previousTranslation: translatedText,
      failureReason: validation.reason || 'Validation failed - The translation failed validation. Please ensure you follow all guidelines in the system instruction, especially regarding variable preservation, technical identifiers, and formatting rules.'
    }
    return await translate(text, gameType, retry + 1, newContext, useTransliteration)
  }

  await setCache(cacheKey, translatedText, gameType)
  return translatedText
}

/**
 * 여러 텍스트를 한 번에 처리하여 가능한 경우 AI 벌크 번역을 사용합니다.
 * 실패 시 개별 번역으로 폴백하여 안정성을 보장합니다.
 */
export async function translateBulk (
  texts: string[],
  gameType: GameType = 'ck3',
  useTransliteration: boolean = false,
  context?: BulkTranslateContext,
): Promise<BulkTranslateResult[]> {
  if (texts.length === 0) {
    return []
  }

  const results: BulkTranslateResult[] = Array.from({ length: texts.length }, () => ({ translatedText: '' }))
  const unresolved: UnresolvedBulkItem[] = []
  const transliterationPrefix = useTransliteration ? 'transliteration:' : ''
  const modLogPrefix = context?.modName ? `[모드:${context.modName}] ` : ''

  for (const [index, text] of texts.entries()) {
    if (text.trim() === '') {
      results[index] = { translatedText: text }
      continue
    }

    const normalizedText = text

    if (
      DOLLAR_VARIABLE_REGEX.test(normalizedText) ||
      POUND_VARIABLE_REGEX.test(normalizedText) ||
      AT_VARIABLE_REGEX.test(normalizedText) ||
      ANGLE_VARIABLE_REGEX.test(normalizedText) ||
      SQUARE_BRACKET_REGEX.test(normalizedText) ||
      HASH_FORMAT_REGEX.test(normalizedText) ||
      SECTION_SIGN_VARIABLE_REGEX.test(normalizedText) ||
      isVariableOnlyText(normalizedText)
    ) {
      results[index] = { translatedText: normalizedText }
      continue
    }

    if (!useTransliteration && hasDictionary(normalizedText, gameType)) {
      const dictionaryTranslatedText = sanitizeTranslationText(getDictionary(normalizedText, gameType)!)
      results[index] = { translatedText: dictionaryTranslatedText }
      log.info(`${modLogPrefix}[벌크/${index}] 사전 응답 사용: ${normalizedText} -> ${dictionaryTranslatedText}${useTransliteration ? ' (음역 모드)' : ''}`)
      continue
    }

    const cacheKey = `${transliterationPrefix}${normalizedText}`
    if (await hasCache(cacheKey, gameType)) {
      const cached = await getCache(cacheKey, gameType)
      if (cached) {
        const sanitizedCached = sanitizeTranslationText(cached)
        if (sanitizedCached !== cached) {
          await setCache(cacheKey, sanitizedCached, gameType)
        }

        const { isValid } = validateTranslation(normalizedText, sanitizedCached, gameType)
        if (isValid) {
          results[index] = { translatedText: sanitizedCached }
          log.info(`${modLogPrefix}[벌크/${index}] 캐시 응답 사용: ${normalizedText} -> ${sanitizedCached}${useTransliteration ? ' (음역 모드)' : ''}`)
          continue
        }

        await removeCache(cacheKey, gameType)
      }
    }

    unresolved.push({ index, text: normalizedText, cacheKey })
  }

  if (unresolved.length === 0) {
    return results
  }

  const batches = splitBulkRequests(unresolved)

  for (const [batchIndex, batch] of batches.entries()) {
    try {
      log.info(
        `${modLogPrefix}[벌크] AI 벌크 요청 전송: batch=${batchIndex + 1}/${batches.length}, items=${batch.length}, gameType=${gameType}${useTransliteration ? ' (음역 모드)' : ''}`
      )

      for (const unresolvedItem of batch) {
        log.info(`${modLogPrefix}[벌크/${unresolvedItem.index}] AI 벌크 요청에 포함: ${unresolvedItem.text}${useTransliteration ? ' (음역 모드)' : ''}`)
      }

      const aiTranslated = await translateAIBulk(batch.map(item => item.text), gameType, useTransliteration)

      for (const [bulkIndex, unresolvedItem] of batch.entries()) {
        const translatedText = sanitizeTranslationText(aiTranslated[bulkIndex] || unresolvedItem.text)
        const validation = validateTranslation(unresolvedItem.text, translatedText, gameType)

        if (validation.isValid) {
          await setCache(unresolvedItem.cacheKey, translatedText, gameType)
          results[unresolvedItem.index] = { translatedText }
          log.info(`${modLogPrefix}[벌크/${unresolvedItem.index}] AI 응답 처리: ${unresolvedItem.text} -> ${translatedText}${useTransliteration ? ' (음역 모드)' : ''}`)
        } else {
          log.warn(`${modLogPrefix}[벌크/${unresolvedItem.index}] AI 응답 검증 실패, 개별 번역으로 재시도: ${unresolvedItem.text} -> ${translatedText} (사유: ${validation.reason})`)
          // 검증 실패 시 개별 번역으로 재시도
          const fallback = await translate(unresolvedItem.text, gameType, 0, undefined, useTransliteration)
          results[unresolvedItem.index] = { translatedText: fallback }
          log.info(`${modLogPrefix}[벌크/${unresolvedItem.index}] 개별 재시도 응답 처리: ${unresolvedItem.text} -> ${fallback}${useTransliteration ? ' (음역 모드)' : ''}`)
        }
      }
    } catch (error) {
      const errorInfo = error instanceof Error ? error : String(error)
      log.warn(
        `${modLogPrefix}[벌크] AI 벌크 요청 실패, 개별 번역으로 폴백: batch=${batchIndex + 1}/${batches.length}${useTransliteration ? ' (음역 모드)' : ''}`,
        errorInfo
      )
      // 벌크 요청 실패 시 해당 배치만 개별 번역으로 폴백
      for (const unresolvedItem of batch) {
        try {
          log.info(`${modLogPrefix}[벌크/${unresolvedItem.index}] 개별 폴백 요청: ${unresolvedItem.text}${useTransliteration ? ' (음역 모드)' : ''}`)
          const translatedText = await translate(unresolvedItem.text, gameType, 0, undefined, useTransliteration)
          results[unresolvedItem.index] = { translatedText }
          log.info(`${modLogPrefix}[벌크/${unresolvedItem.index}] 개별 폴백 응답 처리: ${unresolvedItem.text} -> ${translatedText}${useTransliteration ? ' (음역 모드)' : ''}`)
        } catch (error) {
          if (error instanceof TranslationRefusedError || error instanceof TranslationRetryExceededError) {
            results[unresolvedItem.index] = { translatedText: unresolvedItem.text, error }
            log.warn(`${modLogPrefix}[벌크/${unresolvedItem.index}] 개별 폴백 실패, 원문 유지: ${unresolvedItem.text} (사유: ${(error as Error).message})`)
          } else {
            throw error
          }
        }
      }
    }
  }

  return results
}
