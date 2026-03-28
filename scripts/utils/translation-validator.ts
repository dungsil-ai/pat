import { type GameType, shouldUseTransliterationForKey, isRegularTranslationContext } from './prompts'

/**
 * 번역 검증 규칙:
 * 1. 불필요한 응답 (예: "네, 알겠습니다", "Yes, I understand" 등)
 * 2. 기술 식별자 (snake_case) 보존
 * 3. 게임 변수 (대괄호 내부) 보존 및 한글 포함 여부
 */

/**
 * Maximum length of text style markers in Paradox games.
 * Common markers: #v, #p, #bold, #weak, #italic, etc.
 * Set to 19 to cover all known style markers with reasonable buffer.
 */
const MAX_TEXT_STYLE_MARKER_LENGTH = 19

/**
 * Regular expression for matching string literals with proper escape handling.
 * Matches both single-quoted and double-quoted strings, including escaped quotes.
 * Pattern explanation:
 * - (['"]): Capture opening quote (group 1)
 * - ((?:\\.|(?!\1)[^\\])*?): Capture string content (group 2)
 *   - \\.: Match escaped character
 *   - (?!\1)[^\\]: Match non-backslash character that's not the opening quote
 *   - *?: Non-greedy repetition
 * - \1: Match the same quote type that opened the string (backreference)
 */
const STRING_LITERAL_REGEX = /(['"])((?:\\.|(?!\1)[^\\])*?)\1/g

interface ValidationResult {
  isValid: boolean
  reason?: string
}

/**
 * 게임 변수에서 문자열 리터럴을 제거하여 구조만 비교할 수 있도록 합니다.
 * 문자열 리터럴은 번역이 허용되므로 (예: ' or ' -> ' 혹은 '),
 * 구조적 일치만 검증하기 위해 모든 문자열 리터럴을 플레이스홀더로 치환합니다.
 * 
 * 예: [Concatenate(' or ', GetName)] -> [Concatenate('__STRING__', GetName)]
 *     [Concatenate(' 혹은 ', GetName)] -> [Concatenate('__STRING__', GetName)]
 */
function normalizeGameVariableStructure(variable: string): string {
  // 작은따옴표 또는 큰따옴표로 감싸진 문자열 리터럴을 플레이스홀더로 치환 (이스케이프된 따옴표도 처리)
  return variable.replace(STRING_LITERAL_REGEX, "'__STRING__'")
}

/**
 * 잘못된 형식의 변수 패턴을 감지합니다.
 * AI가 서로 다른 변수 구문을 혼합하여 생성할 수 있는 치명적인 버그를 방지합니다.
 * 
 * 감지되는 잘못된 패턴:
 * - $[culture|E] - Dollar sign과 square bracket 혼합
 * - £[variable]£ - Pound sign과 square bracket 혼합
 * - @<variable>@ - At sign과 angle bracket 혼합
 * - [$variable$] - Square bracket 내부에 다른 변수 구문
 * - 등등
 * 
 * @param text 검증할 텍스트
 * @returns 잘못된 패턴 배열 (빈 배열이면 문제 없음)
 */
function detectMalformedVariables(text: string): string[] {
  const malformedPatterns: string[] = []

  const isEscapedSequence = (pattern: string, position?: number): boolean => {
    // 위치가 제공되면 해당 특정 인스턴스만 확인
    if (position !== undefined) {
      const precedingChar = position > 0 ? text[position - 1] : ''
      return precedingChar === '\\'
    }
    
    // 그렇지 않으면 모든 인스턴스가 이스케이프되었는지 확인 (원래 동작)
    const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escapedPattern, 'g')
    let match: RegExpExecArray | null
    let foundUnescaped = false

    while ((match = regex.exec(text)) !== null) {
      const index = match.index ?? 0
      const precedingChar = index > 0 ? text[index - 1] : ''

      if (precedingChar !== '\\') {
        foundUnescaped = true
        break
      }

      // 점프하지 않으면 무한 루프 가능
      if (regex.lastIndex === match.index) {
        regex.lastIndex++
      }
    }

    return !foundUnescaped
  }
  
  // 모든 매치와 그 위치를 찾는 헬퍼 함수
  const findMatchesWithPositions = (regex: RegExp): Array<{match: string, start: number, end: number}> => {
    const results: Array<{match: string, start: number, end: number}> = []
    const pattern = new RegExp(regex.source, regex.flags)
    let match: RegExpExecArray | null
    
    while ((match = pattern.exec(text)) !== null) {
      results.push({
        match: match[0],
        start: match.index,
        end: match.index + match[0].length
      })
      
      // 너비가 0인 매치로 인한 무한 루프 방지
      if (pattern.lastIndex === match.index) {
        pattern.lastIndex++
      }
    }
    
    return results
  }

  // 문자열 리터럴의 위치를 찾는 헬퍼 함수
  const findStringLiteralPositions = (): Array<{start: number, end: number}> => {
    const positions: Array<{start: number, end: number}> = []
    // Use the global STRING_LITERAL_REGEX directly, resetting lastIndex to 0 before use
    STRING_LITERAL_REGEX.lastIndex = 0
    let match: RegExpExecArray | null
    
    while ((match = STRING_LITERAL_REGEX.exec(text)) !== null) {
      positions.push({
        start: match.index,
        end: match.index + match[0].length
      })
      
      // 무한 루프 방지
      if (STRING_LITERAL_REGEX.lastIndex === match.index) {
        STRING_LITERAL_REGEX.lastIndex++
      }
    }
    
    return positions
  }

  // 특정 위치가 문자열 리터럴 내부에 있는지 확인하는 헬퍼 함수
  // literal.end는 닫는 따옴표 다음 위치를 가리키므로, < 연산자를 사용하여
  // 닫는 따옴표를 포함한 문자열 리터럴 내부만 체크
  const isInsideStringLiteral = (position: number, stringLiterals: Array<{start: number, end: number}>): boolean => {
    return stringLiterals.some(literal => position >= literal.start && position < literal.end)
  }

  // 모든 문자열 리터럴 위치를 먼저 찾음
  const stringLiteralPositions = findStringLiteralPositions()

  // 1. Dollar sign과 다른 구문 혼합 감지
  // $[...], $<...>
  // 참고: Paradox 게임은 변수 이름에 공백을 허용하므로 $ ... $ (공백) 검사를 더 이상 하지 않음
  const dollarMixedPatterns = [
    /\$\[/g,  // $[
    /\$</g,   // $<
  ]
  
  for (const pattern of dollarMixedPatterns) {
    const matches = findMatchesWithPositions(pattern)
    for (const matchInfo of matches) {
      if (!isEscapedSequence(matchInfo.match, matchInfo.start) && 
          !isInsideStringLiteral(matchInfo.start, stringLiteralPositions)) {
        malformedPatterns.push(matchInfo.match)
      }
    }
  }
  
  // 2. Pound sign과 다른 구문 혼합 감지
  // £[...], £<...>
  const poundMixedPatterns = [
    /£\[/g,  // £[
    /£</g,   // £<
  ]
  
  for (const pattern of poundMixedPatterns) {
    const matches = findMatchesWithPositions(pattern)
    for (const matchInfo of matches) {
      if (!isEscapedSequence(matchInfo.match, matchInfo.start) && 
          !isInsideStringLiteral(matchInfo.start, stringLiteralPositions)) {
        malformedPatterns.push(matchInfo.match)
      }
    }
  }
  
  // 3. At sign과 다른 구문 혼합 감지
  // @[...], @<...>
  const atMixedPatterns = [
    /@\[/g,  // @[
    /@</g,   // @<
  ]
  
  for (const pattern of atMixedPatterns) {
    const matches = findMatchesWithPositions(pattern)
    for (const matchInfo of matches) {
      if (!isEscapedSequence(matchInfo.match, matchInfo.start) && 
          !isInsideStringLiteral(matchInfo.start, stringLiteralPositions)) {
        malformedPatterns.push(matchInfo.match)
      }
    }
  }
  
  // 4. Square bracket 내부에 다른 변수 구문 감지
  // [$...], [£...], [@...], [<...>]
  const bracketWithInnerPatterns = [
    /\[\$/g,  // [$
    /\[£/g,   // [£
    /\[@/g,   // [@
    /\[</g,   // [< (단, 일반 부등호가 아닌 경우만)
  ]
  
  for (const pattern of bracketWithInnerPatterns) {
    const matches = findMatchesWithPositions(pattern)
    for (const matchInfo of matches) {
      if (!isEscapedSequence(matchInfo.match, matchInfo.start) && 
          !isInsideStringLiteral(matchInfo.start, stringLiteralPositions)) {
        malformedPatterns.push(matchInfo.match)
      }
    }
  }
  
  // 5. Angle bracket 내부에 다른 변수 구문 감지
  // <$...>, <[...], <£...>
  const angleBracketWithInnerPatterns = [
    /<\$/g,   // <$
    /<\[/g,   // <[
    /<£/g,    // <£
  ]
  
  for (const pattern of angleBracketWithInnerPatterns) {
    const matches = findMatchesWithPositions(pattern)
    for (const matchInfo of matches) {
      if (!isEscapedSequence(matchInfo.match, matchInfo.start) && 
          !isInsideStringLiteral(matchInfo.start, stringLiteralPositions)) {
        malformedPatterns.push(matchInfo.match)
      }
    }
  }
  
  // 6. 닫히지 않은 변수 구문 감지
  // 완전한 변수 패턴이 있는지 먼저 확인하고, 없으면 불완전한 패턴을 찾음
  
  const completeVariables = {
    // $VALUE|=+0$ 형식 지원 (이슈: 이스케이프 형식 지정자)
    // 변수 이름에 공백 지원 (예: $Open Daoyu Cheat$)
    // 변수 이름에 @ 문자 지원 (예: $@shroud_seal_decrease|0$)
    // 패턴: 영숫자/밑줄/대시/점/@, 선택적으로 (공백 + 영숫자) 반복
    // 합리적인 변수 이름을 넘어서는 일치를 방지
    dollar: findMatchesWithPositions(/\$[a-zA-Z0-9_\-.@]+(?:[ ][a-zA-Z0-9_\-.@]+)*(?:\|[^$\r\n]+)?\$/g),
    pound: findMatchesWithPositions(/£[a-zA-Z0-9_\-.]+£/g),
    at: findMatchesWithPositions(/@[a-zA-Z0-9_\-.]+@/g),
    // @icon! 형식도 완전한 변수로 인식 (게임에서 사용되는 유효한 구문)
    // @aptitude:4:color_green!과 같은 패턴에 대해 콜론 지원
    atWithExclamation: findMatchesWithPositions(/@[a-zA-Z0-9_\-.:]+!/g),
    // 텍스트 스타일 마커 + 달러 변수 조합 (예: #v$variable$, #bold$value$)
    // 이 패턴들은 완전한 변수로 인식되어야 함
    // 변수 이름에 @ 문자 지원 (일반 달러 변수와 일관성 유지)
    // 형식 지정자 지원 (|...) 추가
    textStyleWithDollar: findMatchesWithPositions(new RegExp(`#[a-z]{1,${MAX_TEXT_STYLE_MARKER_LENGTH}}\\$[a-zA-Z0-9_\\-.@]+(?:[ ][a-zA-Z0-9_\\-.@]+)*(?:\\|[^$\\r\\n]+)?\\$`, 'g')),
    // 섹션 기호 색상 코드 + 달러 변수 조합 (예: §Y$variable$, §G$value$)
    // Paradox 게임 (특히 Stellaris)에서 사용되는 색상 코드 패턴
    // 단일 문자 (§Y) 및 다중 문자 (§BA, §BDATABANK) 색상 코드 지원
    // 달러 변수 이름에 @ 문자 지원 (예: §G$@matrioshka_brain_uplink_anti_deviancy_reduction|0%$§!)
    // 형식 지정자 지원 (|...) 및 공백을 포함한 변수 이름 지원
    sectionSignWithDollar: findMatchesWithPositions(/§[A-Z]+\$[a-zA-Z0-9_\-.@]+(?:[ ][a-zA-Z0-9_\-.@]+)*(?:\|[^$\r\n]+)?\$/g),
    // 섹션 기호 색상 코드 + 파운드 변수 조합 (예: §H£energy£, §Y£prestige£)
    // 단일 문자 (§H) 및 다중 문자 (§BA, §BDATABANK) 색상 코드 지원
    sectionSignWithPound: findMatchesWithPositions(/§[A-Z]+£[a-zA-Z0-9_\-.]+£/g),
  }
  
  // 완전하지 않은 변수 시작/끝 찾기
  // 단, 이미 완전한 변수의 일부가 아닌 경우만
  // 
  // 거짓 탐지 방지: 반드시 영숫자로 시작해야 함 (예: [a-zA-Z0-9])
  // 단순 구두점(., -, _만으로 구성)을 제외하기 위함
  // 예: "있습니다.$VAR$"에서 ".$"가 잘못 감지되는 것을 방지
  // 달러 변수에 공백 지원 (예: $Open Daoyu Cheat$)
  // 패턴: 영숫자/밑줄/대시/점, 선택적으로 (공백 + 영숫자) 반복
  // 참고: 매치 앞에 #<문자>가 있는 패턴도 제외 (텍스트 스타일 마커)
  // "#v$variable$" 또는 "#bold$variable$"과 같은 거짓 양성이 잘못된 형식으로 플래그되는 것을 방지하기 위함
  // 섹션 기호 색상 코드 (§Y, §G, §R, §BA, §BDATABANK 등)도 제외 (Paradox 게임에서 사용)
  const potentialUnbalanced = {
    dollarStart: findMatchesWithPositions(/\$[a-zA-Z0-9_\-.]+(?:[ ][a-zA-Z0-9_\-.]+)*(?!\$)/g),
    dollarEnd: findMatchesWithPositions(
      new RegExp(`(?<!\\$)(?<!#[a-z]{1,${MAX_TEXT_STYLE_MARKER_LENGTH}})(?<!§[A-Z]+)[a-zA-Z0-9][a-zA-Z0-9_\\-.]*(?:[ ][a-zA-Z0-9_\\-.]+)*\\$`, 'g')
    ),
    poundStart: findMatchesWithPositions(/£[a-zA-Z0-9_\-.]+(?!£)/g),
    // 참고: 섹션 기호 색상 코드 + 파운드 변수는 sectionSignWithPound에서 완전한 변수로 인식됨
    poundEnd: findMatchesWithPositions(/(?<!£)(?<!§)[a-zA-Z0-9][a-zA-Z0-9_\-.]*£/g),
    // @icon:number:color! 구문을 위해 @ 패턴에서 콜론 지원
    atStart: findMatchesWithPositions(/@[a-zA-Z0-9_\-.:]+(?![@!])/g),
    atEnd: findMatchesWithPositions(/(?<!@)[a-zA-Z0-9_\-.:][a-zA-Z0-9_\-.:]*@/g),
  }
  
  // 7. 서로 다른 구분자로 시작하고 끝나는 혼합 패턴 감지
  // 예: @variable$, @variable£, $variable@, $variable£, £variable$, £variable@
  // 이러한 패턴은 하나의 변수처럼 보이지만 실제로는 잘못된 형식
  // 단, 완전한 달러 변수 내부에 있는 경우는 제외 (예: §G$@variable$§!)
  const crossDelimiterPatterns = [
    // @ 시작, 다른 구분자 종료
    // 참고: @ 패턴은 콜론을 지원 (예: @aptitude:4:color_green!)
    /@[a-zA-Z0-9_\-.:]+\$/g,  // @...$
    /@[a-zA-Z0-9_\-.:]+£/g,   // @...£
    // $ 시작, 다른 구분자 종료
    /\$[a-zA-Z0-9_\-.]+@/g,   // $...@
    /\$[a-zA-Z0-9_\-.]+£/g,   // $...£
    // £ 시작, 다른 구분자 종료
    /£[a-zA-Z0-9_\-.]+\$/g,   // £...$
    /£[a-zA-Z0-9_\-.]+@/g,    // £...@
  ]
  
  // 교차 구분자 패턴을 먼저 수집 (이후 중복 감지에 사용)
  const crossDelimiterMatches: Array<{match: string, start: number, end: number}> = []
  for (const pattern of crossDelimiterPatterns) {
    const matches = findMatchesWithPositions(pattern)
    for (const matchInfo of matches) {
      if (!isEscapedSequence(matchInfo.match, matchInfo.start) && 
          !isInsideStringLiteral(matchInfo.start, stringLiteralPositions)) {
        // 교차 구분자 패턴이 완전한 달러 변수 내부에 있는지 확인
        // 예: §G$@variable$§!에서 @variable$는 완전한 달러 변수의 일부
        const isPartOfDollarVariable = 
          completeVariables.dollar.some(complete => 
            matchInfo.start >= complete.start && matchInfo.end <= complete.end
          ) ||
          completeVariables.textStyleWithDollar.some(complete => 
            matchInfo.start >= complete.start && matchInfo.end <= complete.end
          ) ||
          completeVariables.sectionSignWithDollar.some(complete => 
            matchInfo.start >= complete.start && matchInfo.end <= complete.end
          )
        
        if (!isPartOfDollarVariable) {
          malformedPatterns.push(matchInfo.match)
          crossDelimiterMatches.push(matchInfo)
        }
      }
    }
  }

  // 패턴이 완전한 변수와 겹치는지 확인하는 헬퍼 함수
  const overlapsWithComplete = (patternInfo: {start: number, end: number}, complete: {start: number, end: number}): boolean => {
    // 경우 1: 패턴이 완전한 변수 내부에 완전히 포함됨
    if (patternInfo.start >= complete.start && patternInfo.end <= complete.end) {
      return true
    }
    // 경우 2: 패턴이 닫는 구분자 위치에서 시작
    // "$gold$12"에서 "$12"는 닫는 $가 있는 위치 5에서 시작
    if (patternInfo.start === complete.end - 1) {
      return true
    }
    // 경우 3: 패턴이 여는 구분자 위치에서 끝남
    // "DLC$giga_var$"에서 "DLC$"의 $가 "$giga_var$"의 여는 $와 같은 위치
    // patternInfo.end는 exclusive이고 complete.start는 inclusive이므로 -1로 보정
    if (patternInfo.end - 1 === complete.start) {
      return true
    }
    return false
  }
  
  // 각 불완전한 패턴이 완전한 변수의 일부인지 위치 기반으로 확인
  for (const [type, patterns] of Object.entries(potentialUnbalanced)) {
    for (const patternInfo of patterns) {
      let isPartOfComplete = false
      
      // 해당 패턴이 완전한 변수와 위치상 겹치는지 확인
      if (type.startsWith('dollar')) {
        isPartOfComplete = completeVariables.dollar.some(complete => 
          overlapsWithComplete(patternInfo, complete)
        ) || completeVariables.textStyleWithDollar.some(complete =>
          overlapsWithComplete(patternInfo, complete)
        ) || completeVariables.sectionSignWithDollar.some(complete =>
          overlapsWithComplete(patternInfo, complete)
        )
      } else if (type.startsWith('pound')) {
        isPartOfComplete = completeVariables.pound.some(complete => 
          overlapsWithComplete(patternInfo, complete)
        ) || completeVariables.sectionSignWithPound.some(complete =>
          // 섹션 기호 색상 코드 + 파운드 변수 내부에 있을 수 있음 (예: §H£energy£, §BA£variable£)
          overlapsWithComplete(patternInfo, complete)
        )
      } else if (type.startsWith('at')) {
        isPartOfComplete = completeVariables.at.some(complete => 
          overlapsWithComplete(patternInfo, complete)
        ) || completeVariables.atWithExclamation.some(complete => 
          overlapsWithComplete(patternInfo, complete)
        ) || completeVariables.dollar.some(complete =>
          // @ 문자가 달러 변수 내부에 있을 수 있음 (예: $@variable$)
          overlapsWithComplete(patternInfo, complete)
        ) || completeVariables.textStyleWithDollar.some(complete =>
          overlapsWithComplete(patternInfo, complete)
        ) || completeVariables.sectionSignWithDollar.some(complete =>
          // @ 문자가 색상 코드 + 달러 변수 내부에 있을 수 있음 (예: §G$@variable$§!)
          overlapsWithComplete(patternInfo, complete)
        )
      }
      
      // 교차 구분자 패턴의 일부인지도 확인
      const isPartOfCrossDelimiter = crossDelimiterMatches.some(crossDelimiter =>
        overlapsWithComplete(patternInfo, crossDelimiter)
      )
      
      // 완전한 변수나 cross-delimiter 패턴의 일부가 아니면 malformed로 간주
      if (!isPartOfComplete && !isPartOfCrossDelimiter && 
          !isEscapedSequence(patternInfo.match, patternInfo.start) && 
          !isInsideStringLiteral(patternInfo.start, stringLiteralPositions)) {
        malformedPatterns.push(patternInfo.match)
      }
    }
  }
  
  // 8. 변수 구문이 혼합된 복잡한 패턴 감지
  // 예: [$variable$], [£gold£], [@icon@]
  const complexMixedPatterns = [
    /\[\$[^\]]*\$\]/g,  // [$...$]
    /\[£[^\]]*£\]/g,    // [£...£]
    /\[@[^\]]*@\]/g,    // [@...@]
  ]
  
  for (const pattern of complexMixedPatterns) {
    const matches = findMatchesWithPositions(pattern)
    for (const matchInfo of matches) {
      if (!isEscapedSequence(matchInfo.match, matchInfo.start) && 
          !isInsideStringLiteral(matchInfo.start, stringLiteralPositions)) {
        malformedPatterns.push(matchInfo.match)
      }
    }
  }
  
  return [...new Set(malformedPatterns)]  // 중복 제거
}

/**
 * 번역이 유효한지 검증합니다.
 * issue #64에서 추가된 검증 로직을 기반으로 합니다.
 */
export function validateTranslation(
  sourceText: string,
  translatedText: string,
  gameType: GameType = 'ck3'
): ValidationResult {
  const normalizedSource = sourceText
  const normalizedTranslation = translatedText

  // 잘못된 형식의 변수 패턴 감지 (게임 크래시를 일으킬 수 있는 치명적 버그)
  const malformedVariables = detectMalformedVariables(normalizedTranslation)
  if (malformedVariables.length > 0) {
    return {
      isValid: false,
      reason: `잘못된 형식의 변수 패턴 감지 (게임 크래시 위험): ${malformedVariables.join(', ')}`
    }
  }

  // 대괄호 불균형 감지 (게임 변수의 괄호 누락 또는 추가)
  // AI가 게임 변수를 잘못 수정하는 다양한 오류 패턴을 감지:
  // - [variable] 의 ] 를 제거: [variable"
  // - [variable] 의 [ 를 제거: variable]
  // - 여는 괄호나 닫는 괄호를 추가하는 경우
  // 단순히 여는/닫는 대괄호의 개수를 비교하여 모든 불균형을 감지
  let openBrackets = 0
  let closeBrackets = 0
  for (let i = 0; i < normalizedTranslation.length; i++) {
    if (normalizedTranslation[i] === '[') openBrackets++
    else if (normalizedTranslation[i] === ']') closeBrackets++
  }
  
  if (openBrackets !== closeBrackets) {
    return {
      isValid: false,
      reason: `대괄호 불균형: [ 개수(${openBrackets})와 ] 개수(${closeBrackets})가 일치하지 않음`
    }
  }

  // LLM이 불필요한 응답을 포함했는지 검사
  // 참고: "요청하신 대로"는 "As requested"의 유효한 번역이므로 제외됨
  // "요청하신 번역" 패턴만 잘못된 응답으로 감지 (예: "요청하신 번역입니다", "요청하신 번역을 보내드립니다")
  const unwantedPhrases = [
    '네, 알겠습니다',
    '네 알겠습니다',
    '요청하신 번역',
    '번역입니다',
    'yes, i understand',
    'here is the translation',
    'here\'s the translation'
  ]

  const hasUnwantedPhrase = unwantedPhrases.some(phrase =>
    normalizedTranslation.toLowerCase().includes(phrase.toLowerCase())
  )

  if (hasUnwantedPhrase) {
    return {
      isValid: false,
      reason: '불필요한 응답 포함'
    }
  }

  // 텍스트 스타일 구문이 올바르게 보존되었는지 검사
  // 유효한 형식: #weak ...#, #bold ...#, #italic ...# 등
  // 스타일 키워드는 영문으로 유지되어야 함
  const stylePatterns = normalizedSource.match(/#[a-z]+\s/gi) || []
  if (stylePatterns.length > 0) {
    for (const stylePattern of stylePatterns) {
      // 번역에서 동일한 스타일 패턴이 있는지 확인
      if (!normalizedTranslation.includes(stylePattern)) {
        // 스타일 키워드가 번역되었는지 확인 (한글이 포함되어 있는지)
        // 패턴: #<한글2글자이상><공백> (단일 조사는 제외, 실제 단어만 매칭)
        // 예: #약하게 (잘못됨 - 스타일 키워드가 번역된 경우. 번역 자체가 틀린 것이 아니라, 스타일 키워드는 영문으로 유지되어야 하므로 오류로 간주됨), 하지만 #를 같은 단일 조사는 허용
        const translatedStylePattern = /#[가-힣]{2,}\s/g
        if (translatedStylePattern.test(normalizedTranslation)) {
          return {
            isValid: false,
            reason: `텍스트 스타일 키워드가 번역됨 (예: #weak → #약하게)`
          }
        }
      }
    }
  }

  // 기술 식별자(snake_case)가 번역되었는지 검사
  // 소문자로 시작하는 snake_case 식별자만 검사 (예: mod_icon_*, com_icon_*)
  // 대문자로 시작하는 이름 (예: A_Chi, A_Mo_Nuo_Ju)은 번역 가능한 문자열로 취급
  // @icon_name! 같은 게임 아이콘 참조는 제외 (이미 게임 syntax의 일부)
  const technicalIdentifiers = normalizedSource.match(/(?<![@$£])\b[a-z][a-z]*(?:_[a-z]+)+\b(?![!])/g) || []
  if (technicalIdentifiers.length > 0) {
    // 게임 변수 내부의 문자열 리터럴에만 있는 식별자는 제외
    // 예: [GetLawGroup('lawgroup_migration').GetName]에서 'lawgroup_migration'은 문자열 리터럴이므로 제외
    // 단, 식별자가 문자열 리터럴 외부에도 나타나면 보존 필요
    const gameVariables = normalizedSource.match(/\[[^\]]+\]/g) || []
    const identifiersInStringLiterals = new Set<string>()
    
    for (const gameVar of gameVariables) {
      // 게임 변수 내부의 문자열 리터럴 추출 (작은따옴표 또는 큰따옴표)
      const stringLiterals = gameVar.match(/(['"])(.*?)\1/g) || []
      for (const literal of stringLiterals) {
        // 문자열 리터럴 내부의 기술 식별자 찾기
        const literalContent = literal.slice(1, -1) // 따옴표 제거
        const identifiersInLiteral = literalContent.match(/\b[a-z][a-z]*(?:_[a-z]+)+\b/g) || []
        identifiersInLiteral.forEach(id => identifiersInStringLiterals.add(id))
      }
    }
    
    // 각 식별자에 대해 문자열 리터럴 외부에도 나타나는지 확인
    // 문자열 리터럴을 제거한 텍스트에서 식별자를 찾음
    let sourceWithoutStringLiterals = normalizedSource
    for (const gameVar of gameVariables) {
      const stringLiterals = gameVar.match(/(['"])(.*?)\1/g) || []
      for (const literal of stringLiterals) {
        // 문자열 리터럴을 플레이스홀더로 대체하여 제거
        sourceWithoutStringLiterals = sourceWithoutStringLiterals.replace(literal, '__STRING__')
      }
    }
    
    // 문자열 리터럴에만 있는 식별자를 제외하고 검증
    // (문자열 리터럴에 있으면서 외부에도 있는 식별자는 보존 필요)
    const requiredIdentifiers = technicalIdentifiers.filter(id => {
      // 식별자가 문자열 리터럴에 있는 경우
      if (identifiersInStringLiterals.has(id)) {
        // 문자열 리터럴 외부에도 나타나는지 확인
        const outsideRegex = new RegExp(`(?<![@$£])\\b${id}\\b(?![!])`, 'g')
        return outsideRegex.test(sourceWithoutStringLiterals)
      }
      // 문자열 리터럴에 없으면 보존 필요
      return true
    })
    
    if (requiredIdentifiers.length > 0) {
      const allIdentifiersPreserved = requiredIdentifiers.every(identifier =>
        normalizedTranslation.includes(identifier)
      )

      if (!allIdentifiersPreserved) {
        const missingIdentifiers = requiredIdentifiers.filter(id => !normalizedTranslation.includes(id))
        return {
          isValid: false,
          reason: `기술 식별자 누락 또는 번역됨: ${missingIdentifiers.join(', ')}`
        }
      }
    }
  }

  // 대괄호 내부의 게임 변수가 번역되었는지 검사 (|E 또는 함수 호출 패턴이 있는 경우만)
  // 공백, 점(namespace), 괄호 등을 포함할 수 있음
  // 예: [GetActivityType( 'activity_RICE_aachen_pilgrimage' ).GetName], [owner.GetName], [dynasty|E]
  // 공백은 여러 개 있을 수 있으므로 normalize (연속 공백을 단일 공백으로)
  const normalizeGameVar = (text: string) => text.replace(/\s+/g, ' ')
  const gameVariablePattern = /\[([^\]]*(?:\|[A-Z]|Get[A-Z]|[a-z_]+\.[A-Z]|[a-z_]+_i))[^\]]*\]/g
  const sourceGameVariables = (normalizedSource.match(gameVariablePattern) || []).map(normalizeGameVar)
  const translationGameVariables = (normalizedTranslation.match(gameVariablePattern) || []).map(normalizeGameVar)

  // 원본에 게임 변수가 있는 경우에만 검증
  if (sourceGameVariables.length > 0) {
    // 원본의 모든 고유 게임 변수가 번역에도 있는지 확인
    // (번역에서 변수를 반복하는 것은 허용 - 문법적 필요에 따라)
    const uniqueSourceVars = [...new Set(sourceGameVariables)]
    const uniqueTransVars = [...new Set(translationGameVariables)]

    // GetHerHis, GetHerHim, GetSheHe 함수는 한국어에서 성별 구분 없이 "그"로 통일하므로 누락 허용
    // namespace가 포함된 경우도 처리 (예: [character.GetHerHis], [monk.GetHerHim], [ROOT.Char.GetSheHe])
    // 다중 네임스페이스 지원을 위해 점(.)으로 구분된 여러 레벨 허용 (대소문자 모두 허용)
    const genderFunctionPattern = /\[(?:[a-zA-Z_]+\.)*Get(?:HerHis|HerHim|SheHe|WomanMan|HerselfHimself)(?:\|[A-Z])?\]/i
    const filteredSourceVars = uniqueSourceVars.filter(v => !genderFunctionPattern.test(v))

    // 원본에 있는 변수가 번역에 없으면 오류 (단, 성별 함수는 제외)
    // 문자열 리터럴은 번역될 수 있으므로, 구조만 비교 (issue #68)
    const missingVars = filteredSourceVars.filter(sourceVar => {
      const normalizedSourceVar = normalizeGameVariableStructure(sourceVar)
      // 번역된 변수 중에서 구조가 동일한 것이 있는지 확인
      return !uniqueTransVars.some(transVar => 
        normalizeGameVariableStructure(transVar) === normalizedSourceVar
      )
    })
    if (missingVars.length > 0) {
      return {
        isValid: false,
        reason: `누락된 게임 변수: ${missingVars.join(', ')}`
      }
    }

    // 게임 변수 내부에 한글이 있으면 잘못 번역된 것
    // 단, 문자열 리터럴 내부('...' 또는 "...")의 한글은 허용
    const hasKoreanInGameVariables = translationGameVariables.some(variable => {
      // 문자열 리터럴을 제거한 후 한글 체크
      const withoutStringLiterals = variable.replace(/(['"])(?:(?!\1).)*?\1/g, '')
      return /[가-힣]/.test(withoutStringLiterals)
    })

    if (hasKoreanInGameVariables) {
      const koreanVariables = translationGameVariables.filter(v => {
        const withoutStringLiterals = v.replace(/(['"])(?:(?!\1).)*?\1/g, '')
        return /[가-힣]/.test(withoutStringLiterals)
      })
      return {
        isValid: false,
        reason: `게임 변수 내부에 한글 포함: ${koreanVariables.join(', ')}`
      }
    }
  }

  return { isValid: true }
}

// 음역 검증 임계값 상수
const SHORT_SOURCE_LENGTH_THRESHOLD = 10 // 짧은 원본 텍스트로 간주하는 최대 길이
const MAX_TRANSLITERATION_LENGTH_RATIO = 3 // 음역으로 허용되는 최대 길이 비율

/**
 * 음역 검증: 번역이 의미 번역이 아닌 음역인지 확인합니다.
 * 고유명사(문화명, 왕조명, 인물명)는 발음 기반 음역이어야 하며, 의미 번역이면 안 됩니다.
 * 
 * 휴리스틱 기반 감지:
 * - 원본 문자 수와 한국어 음절 수가 크게 차이나면 의미 번역 가능성
 *   (짧은 원본이 3배 이상 길어지면 설명적 번역으로 판단)
 */
function validateTransliteration(
  sourceText: string,
  translatedText: string
): ValidationResult {
  // 문자 수 차이 검증
  // 원본 영어의 문자 수와 한국어 음절 수가 크게 차이나면 의미 번역일 가능성
  const sourceLength = sourceText.replace(/[^a-zA-Z]/g, '').length
  const translationLength = (translatedText.match(/[가-힣]/g) || []).length
  
  // sourceLength가 0이면 음역 검증을 건너뜁니다 (숫자/기호만 있을 때 false positive 방지)
  if (sourceLength === 0) {
    return { isValid: true }
  }
  
  // 영어 단어가 짧은데 한국어가 너무 길면 의미 번역 가능성
  if (sourceLength <= SHORT_SOURCE_LENGTH_THRESHOLD && 
      translationLength > sourceLength * MAX_TRANSLITERATION_LENGTH_RATIO) {
    return {
      isValid: false,
      reason: `의미 번역 가능성: 문자 수 불균형 (원본: ${sourceLength}문자, 번역: ${translationLength}음절)`
    }
  }

  return { isValid: true }
}

/**
 * 번역 파일을 검증하고 잘못 번역된 항목들을 찾습니다.
 * @param sourceEntries 원본 항목들
 * @param translationEntries 번역된 항목들
 * @param gameType 게임 타입
 * @param useTransliteration 음역 모드 여부 (true면 음역 검증 추가)
 */
export function validateTranslationEntries(
  sourceEntries: Record<string, [string, string] | string[]>,
  translationEntries: Record<string, [string, string] | string[]>,
  gameType: GameType = 'ck3',
  useTransliteration: boolean = false
): { key: string; sourceValue: string; translatedValue: string; reason: string }[] {
  const invalidEntries: { key: string; sourceValue: string; translatedValue: string; reason: string }[] = []

  for (const [key, [sourceValue]] of Object.entries(sourceEntries)) {
    // 번역이 없으면 건너뜀
    if (!translationEntries[key]) {
      continue
    }

    const [translatedValue] = translationEntries[key]

    // 번역이 비어있거나 원본과 동일하면 건너뜀
    if (!translatedValue || translatedValue === sourceValue) {
      continue
    }

    const validation = validateTranslation(sourceValue, translatedValue, gameType)

    if (!validation.isValid) {
      invalidEntries.push({
        key,
        sourceValue,
        translatedValue,
        reason: validation.reason || '알 수 없는 오류'
      })
    }

    // 음역 모드인 경우 의미 번역 여부 추가 검증
    // decisions, desc, event 키는 일반 번역 컨텍스트이므로 음역 검증 제외
    // 파일 레벨 음역 모드가 아니더라도 키 레벨에서 음역이 필요한 경우 검증
    const shouldTransliterate = useTransliteration || shouldUseTransliterationForKey(key)
    
    if (shouldTransliterate && validation.isValid) {
      // 키가 decision, desc, event로 끝나는 경우 제외 (예: heritage_desc, culture_event, decision)
      if (!isRegularTranslationContext(key)) {
        const transliterationValidation = validateTransliteration(sourceValue, translatedValue)
        if (!transliterationValidation.isValid) {
          invalidEntries.push({
            key,
            sourceValue,
            translatedValue,
            reason: transliterationValidation.reason || '의미 번역 감지 (음역 필요)'
          })
        }
      }
    }
  }

  return invalidEntries
}
