import { type GenerativeModel, GoogleGenerativeAI, FinishReason } from '@google/generative-ai'
import dotenv from 'dotenv'
import { type GameType, getSystemPrompt } from './prompts'
import { addQueue } from './queue'

dotenv.config()

/**
 * 번역이 AI에 의해 거부되었을 때 발생하는 오류
 * 안전 필터, 콘텐츠 정책 등의 이유로 번역을 수행할 수 없는 경우
 */
export class TranslationRefusedError extends Error {
  constructor(
    public readonly text: string,
    public readonly reason: string,
  ) {
    super(`번역 거부: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" (사유: ${reason})`)
    this.name = 'TranslationRefusedError'
  }
}

const ai = new GoogleGenerativeAI(process.env.GOOGLE_AI_STUDIO_TOKEN!)

const generationConfig = {
  temperature: 0.5,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
}

const gemini = (model: string, gameType: GameType, useTransliteration: boolean = false) => ai.getGenerativeModel({
  model,
  generationConfig,
  systemInstruction: getSystemPrompt(gameType, useTransliteration),
})

export interface RetranslationContext {
  previousTranslation: string
  failureReason: string
}

export async function translateAI (text: string, gameType: GameType = 'ck3', retranslationContext?: RetranslationContext, useTransliteration: boolean = false) {
  return new Promise<string>((resolve, reject) => {
    try {
      return translateAIByModel(resolve, reject, gemini('gemini-3-flash-preview', gameType, useTransliteration), text, retranslationContext)
    } catch (e) {
      try {
        return translateAIByModel(resolve, reject, gemini('gemini-flash-lite-latest', gameType, useTransliteration), text, retranslationContext)
      } catch (ee) {
        reject(ee)
      }
    }
  })
}

/**
 * 여러 텍스트를 한 번의 AI 요청으로 번역합니다.
 * 응답 형식은 JSON 배열(또는 translations 필드)을 기대합니다.
 */
export async function translateAIBulk (texts: string[], gameType: GameType = 'ck3', useTransliteration: boolean = false): Promise<string[]> {
  if (texts.length === 0) {
    return []
  }

  return new Promise<string[]>((resolve, reject) => {
    try {
      return translateAIBulkByModel(resolve, reject, gemini('gemini-3-flash-preview', gameType, useTransliteration), texts)
    } catch (e) {
      try {
        return translateAIBulkByModel(resolve, reject, gemini('gemini-flash-lite-latest', gameType, useTransliteration), texts)
      } catch (ee) {
        reject(ee)
      }
    }
  })
}

/**
 * 번역 거부 사유인지 확인
 */
function isRefusalReason(finishReason: FinishReason | undefined): boolean {
  if (!finishReason) return false
  return [
    FinishReason.SAFETY,
    FinishReason.BLOCKLIST,
    FinishReason.PROHIBITED_CONTENT,
    FinishReason.RECITATION,
    FinishReason.SPII,
  ].includes(finishReason)
}

async function translateAIByModel (resolve: (value: string | PromiseLike<string>) => void, reject: (reason?: any) => void, model: GenerativeModel, text: string, retranslationContext?: RetranslationContext): Promise<void> {
  return addQueue(
    text,
    async () => {
      let prompt = text
      
      // 재번역 시, 이전 번역과 실패 사유를 프롬프트에 포함
      if (retranslationContext) {
        prompt = `## Retranslation Request

### Original Text
${text}

### Previous Translation (INCORRECT)
${retranslationContext.previousTranslation}

### Reason for Retranslation
${retranslationContext.failureReason}

### Instructions
Please provide a corrected translation that addresses the issue mentioned above. Remember to strictly follow all translation guidelines from the system instruction.`
      }

      try {
        const { response } = await model.generateContent({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            ...generationConfig,
            responseMimeType: 'application/json',
          },
        })

        // 프롬프트 차단 확인
        const promptFeedback = response.promptFeedback
        if (promptFeedback?.blockReason) {
          throw new TranslationRefusedError(
            text,
            `프롬프트 차단됨: ${promptFeedback.blockReason}${promptFeedback.blockReasonMessage ? ` - ${promptFeedback.blockReasonMessage}` : ''}`
          )
        }

        // 응답 완료 사유 확인 (안전 필터, 콘텐츠 정책 등)
        const candidate = response.candidates?.[0]
        if (candidate && isRefusalReason(candidate.finishReason)) {
          throw new TranslationRefusedError(
            text,
            `응답 거부됨: ${candidate.finishReason}${candidate.finishMessage ? ` - ${candidate.finishMessage}` : ''}`
          )
        }

        const translated = response.text()
          .replaceAll(/\n/g, '\\n')
          .replaceAll(/[^\\]"/g, '\\"')
          .replaceAll(/#약(하게|화된|[화한])/g, '#weak')
          .replaceAll(/#강조/g, '#bold')

        resolve(translated)
      } catch (error) {
        // TranslationRefusedError나 다른 에러를 promise의 reject로 전달
        // reject를 호출하면 외부 Promise가 거부되고, 에러는 호출자에게 전파됨
        // throw하지 않음으로써 큐 작업은 정상 완료되고 unhandled promise rejection 방지
        reject(error)
      }
    },
  )
}

interface JsonCandidate {
  text: string
  allowArray: boolean
}

function collectBalancedSegments (source: string, openChar: '{' | '[', closeChar: '}' | ']'): string[] {
  const segments: string[] = []
  let depth = 0
  let startIndex = -1

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (ch === openChar) {
      if (depth === 0) {
        startIndex = i
      }
      depth++
      continue
    }

    if (ch === closeChar && depth > 0) {
      depth--
      if (depth === 0 && startIndex !== -1) {
        const segment = source.slice(startIndex, i + 1).trim()
        if (segment.length > 0) {
          segments.push(segment)
        }
        startIndex = -1
      }
    }
  }

  return segments
}

function extractJsonCandidates (text: string): JsonCandidate[] {
  const candidates = new Map<string, JsonCandidate>()
  const base = text.trim()
  if (base.length > 0) {
    candidates.set(base, { text: base, allowArray: false })
  }

  const addCandidate = (candidateText: string, allowArray: boolean): void => {
    if (!candidateText) {
      return
    }
    const normalized = candidateText.trim()
    if (!normalized) {
      return
    }

    const existing = candidates.get(normalized)
    if (existing) {
      existing.allowArray = existing.allowArray || allowArray
      return
    }
    candidates.set(normalized, { text: normalized, allowArray })
  }

  // 코드블록 내부는 신뢰 구간으로 간주하여 배열 응답도 허용
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi
  let blockMatch: RegExpExecArray | null
  while ((blockMatch = codeBlockRegex.exec(text)) !== null) {
    addCandidate(blockMatch[1] || '', true)

    for (const objectSegment of collectBalancedSegments(blockMatch[1] || '', '{', '}')) {
      addCandidate(objectSegment, true)
    }
    for (const arraySegment of collectBalancedSegments(blockMatch[1] || '', '[', ']')) {
      addCandidate(arraySegment, true)
    }
  }

  // 객체는 전역 텍스트에서도 수집하되, 배열은 신뢰 구간(코드블록)에서만 허용
  for (const objectSegment of collectBalancedSegments(text, '{', '}')) {
    addCandidate(objectSegment, false)
  }

  return [...candidates.values()]
}

export function parseBulkResponse (rawText: string, expectedLength: number): string[] {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let parsed: unknown
  let lastError: unknown

  for (const candidate of extractJsonCandidates(cleaned)) {
    try {
      const candidateParsed = JSON.parse(candidate.text)
      if (Array.isArray(candidateParsed) && !candidate.allowArray) {
        continue
      }
      parsed = candidateParsed
      lastError = undefined
      break
    } catch (error) {
      lastError = error
    }
  }

  if (parsed === undefined) {
    const errorMessage = lastError instanceof Error ? lastError.message : String(lastError)
    const compactRawText = rawText.replace(/\s+/g, ' ').trim()
    const previewLimit = 500
    const rawTextPreview = compactRawText.length > previewLimit
      ? `${compactRawText.slice(0, previewLimit)}...`
      : compactRawText
    throw new Error(`벌크 번역 JSON 파싱에 실패했습니다: ${errorMessage} | AI 응답 원문: ${rawTextPreview}`)
  }

  const translations = Array.isArray(parsed) ? parsed : (parsed as { translations?: unknown[] })?.translations

  if (!Array.isArray(translations)) {
    throw new Error('벌크 번역 응답에 translations 배열이 없습니다.')
  }

  if (translations.length !== expectedLength) {
    throw new Error(`벌크 번역 응답 길이가 일치하지 않습니다. expected=${expectedLength}, actual=${translations.length}`)
  }

  return translations.map((item) => String(item))
}

async function translateAIBulkByModel (
  resolve: (value: string[] | PromiseLike<string[]>) => void,
  reject: (reason?: any) => void,
  model: GenerativeModel,
  texts: string[],
): Promise<void> {
  const queueKey = `bulk:${texts[0]?.slice(0, 30) || 'empty'}:${texts.length}`

  return addQueue(
    queueKey,
    async () => {
      const prompt = [
        'Translate all items into Korean and return ONLY valid JSON.',
        'Output format must be exactly: {"translations":["..."]}',
        'Keep the same order and item count.',
        'Do not include markdown, explanations, or extra keys.',
        '',
        JSON.stringify({ texts }),
      ].join('\n')

      try {
        const { response } = await model.generateContent(prompt)

        const promptFeedback = response.promptFeedback
        if (promptFeedback?.blockReason) {
          throw new TranslationRefusedError(
            texts.join(' | ').slice(0, 200),
            `프롬프트 차단됨: ${promptFeedback.blockReason}${promptFeedback.blockReasonMessage ? ` - ${promptFeedback.blockReasonMessage}` : ''}`
          )
        }

        const candidate = response.candidates?.[0]
        if (candidate && isRefusalReason(candidate.finishReason)) {
          throw new TranslationRefusedError(
            texts.join(' | ').slice(0, 200),
            `응답 거부됨: ${candidate.finishReason}${candidate.finishMessage ? ` - ${candidate.finishMessage}` : ''}`
          )
        }

        const translatedItems = parseBulkResponse(response.text(), texts.length)
          .map(item => item
            .replaceAll(/\n/g, '\\n')
            .replaceAll(/[^\\]"/g, '\\"')
            .replaceAll(/#약(하게|화된|[화한])/g, '#weak')
            .replaceAll(/#강조/g, '#bold'))

        resolve(translatedItems)
      } catch (error) {
        reject(error)
      }
    },
  )
}
