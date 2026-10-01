const { appendFileSync } = require('node:fs')

const baseURL = process.env.GOOGLE_AI_BASE_URL?.trim() || 'https://api.openai.com/v1'
const endpoint = new URL(baseURL)
const useProxy = endpoint.hostname !== 'api.openai.com'

appendFileSync(process.env.GITHUB_OUTPUT, `use-proxy=${useProxy}\nhostname=${endpoint.hostname}\n`)
console.log(useProxy ? '프록시 API를 사용하므로 Tailscale에 연결합니다.' : '공식 OpenAI API를 사용하므로 Tailscale 연결을 건너뜁니다.')
