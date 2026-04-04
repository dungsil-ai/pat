export function parseYaml (content: string): Record<string, Record<string, [string, string | null]>> {
  // 줄바꿈 정규화: Unix (LF) 및 Windows (CRLF) 줄바꿈 처리
  const lines = content.split(/\r?\n/)
  const parsedContent: Record<string, Record<string, [string, string | null]>> = {}
  let currentKey = ''

  for (const line of lines) {
    if (line.trim().startsWith('#')) continue // 주석 건너뛰기

    const keyMatch = line.match(/^(\s*)?(.+?):\s*(\d+)?\s*(.*)$/)

    if (keyMatch) {
      const [, , key, , value] = keyMatch

      if (!currentKey) {
        currentKey = key
        parsedContent[currentKey] = {}
      } else {
        const parsedValue = parseYamlValue(value)
        if (parsedValue !== null) {
          parsedContent[currentKey][key] = parsedValue
        }
      }
    }
  }

  return parsedContent
}

function parseYamlValue (value: string): [string, string | null] | null {
  // Paradox 게임의 커스텀 로케일 형식:
  // - 첫 번째 "부터 마지막 "까지가 문자열 값의 핵심 부분
  // - 내부의 ""는 리터럴 " 문자를 의미
  // - 마지막 " 이후의 텍스트도 값의 일부로 포함됨 (해시 코멘트 제외)
  //
  // 예시:
  // ""The text"\n\n-Source" -> 값: "The text"\n\n-Source (따옴표 밖 텍스트 포함)
  // ""The text" # hash" -> 값: "The text, 주석: hash
  // ""The text" # 123" -> 값: "The text, 주석: 123 (해시 주석 내 따옴표는 주석의 일부)
  // ""#italic text#" # hash" -> 값: "#italic text#", 주석: hash (문자열 내부의 #은 보존)
  
  // 패턴 1: 해시 주석이 있는 경우
  // 마지막 닫는 " 다음의 #만 해시 주석으로 인식 (문자열 내부의 #은 무시)
  // 탐욕적 매칭(.+)으로 마지막 "까지 가져온 다음, 그 뒤의 # 찾기
  const matchWithComment = /^"(.*)"(?:\s+)?#(?:\s+)?(.*)$/.exec(value)
  if (matchWithComment) {
    const [, rawText, comment] = matchWithComment
    const text = rawText.replace(/""/g, '"')
    return [text, comment || null]
  }
  
  // 패턴 2: 해시 주석 없이 마지막 " 이후에 텍스트가 더 있는 경우
  // 첫 번째 "부터 라인 끝까지 전부 값으로 취급 (마지막 "와 그 이후 텍스트 모두 포함)
  const matchWithTrailing = /^"(.*)"(.*)$/.exec(value)
  if (matchWithTrailing) {
    const [, quotedPart, trailingPart] = matchWithTrailing
    // quotedPart는 첫 " 다음부터 마지막 " 앞까지
    // trailingPart는 마지막 " 이후의 텍스트
    const processedQuotedPart = quotedPart.replace(/""/g, '"')
    // 마지막 "도 값의 일부로 포함 (Paradox 게임 형식)
    const text = trailingPart 
      ? processedQuotedPart + '"' + trailingPart
      : processedQuotedPart
    return [text, null]
  }
  
  // 매칭 실패 시 null 반환
  return null
}

export function stringifyYaml (data: Record<string, Record<string, [string, string | null]>>): string {
  let result = ''

  for (const [topKey, topValue] of Object.entries(data)) {
    result += `\uFEFF${topKey}:\n` // '\uFEFF' : UTF-8 BOM

    for (const [key, [translatedText, hash]] of Object.entries(topValue)) {
      if (translatedText == null) {
        result += '\n'
        continue
      }

      const encodedTranslatedText = translatedText.replaceAll(/((?<!\\)(\\\\)*)"/g, '$1\\"')
      const hashComment = hash ? ` # ${hash}` : ''
      result += `  ${key}: "${encodedTranslatedText}"${hashComment}\n`
    }

  }
  return result
}
