import { Octokit } from '@octokit/rest'
import { VersionStrategyError } from './upstream'
import { log } from './logger'

/**
 * VersionStrategyError를 GitHub Issues에 보고합니다.
 * 
 * @param error VersionStrategyError 인스턴스
 */
export async function reportVersionStrategyError(
  error: VersionStrategyError
): Promise<void> {
  try {
    // GITHUB_TOKEN이 없으면 보고하지 않음
    if (!process.env.GITHUB_TOKEN) {
      log.warn(`GitHub Issues 보고 건너뜀: GITHUB_TOKEN 환경 변수 없음`)
      return
    }

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
    
    const issueTitle = `[Configuration Error] Invalid version_strategy in ${error.configPath}`
    const issueBody = `
## 버전 전략 설정 오류

**파일 경로**: \`${error.configPath}\`
**게임**: ${error.gameType ? error.gameType.toUpperCase() : '알 수 없음'}
${error.invalidStrategy ? `**잘못된 값**: \`${error.invalidStrategy}\`` : ''}

### 🚨 문제 설명
${error.message}

### ✅ 해결 방법
유효한 값 중 하나로 수정하세요:
- \`semantic\`: 시멘틱 버전 정렬 (v1.2.3, v2.0.0 등)
- \`natural\`: 자연 정렬 (1.10.0 > 1.2.0)  
- \`github\`: GitHub Releases 최신 태그 사용
- \`default\`: 기본 브랜치 사용

### 📝 수정 예제
\`\`\`toml
[upstream]
url = "https://github.com/user/repo.git"
localization = ["Mod/localization/english"]
language = "english"
version_strategy = "semantic"  # 이 줄을 수정하세요
\`\`\`

### 🔗 관련 파일
- 설정 가이드: [Configuration](docs/configuration.md)
- 아키텍처: [Architecture](docs/architecture.md)

---

> **자동 생성된 이슈** - 시스템이 감지한 설정 오류입니다.
`

    await octokit.rest.issues.create({
      owner: 'dungsil',
      repo: 'paradox-auto-translate',
      title: issueTitle,
      body: issueBody,
      labels: ['configuration-error', error.gameType || 'unknown', 'version-strategy'],
      assignees: ['dungsil']
    })
    
    log.info(`[${error.configPath}] GitHub Issues 등록 완료: ${issueTitle}`)
  } catch (unknownError) {
    const errorMessage = unknownError instanceof Error ? unknownError.message : String(unknownError)
    log.error(`[${error.configPath}] GitHub Issues 등록 실패: ${errorMessage}`)
  }
}
