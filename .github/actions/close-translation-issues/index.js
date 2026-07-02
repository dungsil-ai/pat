const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { githubApiRetry } = require('@pat-actions/shared');

function readUntranslatedItems(filePath) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, items: [], reason: 'missing' };
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(data.items)) {
      return { ok: false, items: [], reason: 'invalid-items' };
    }
    return {
      ok: true,
      items: data.items.filter(item => item && typeof item.mod === 'string')
    };
  } catch (e) {
    core.error(`Failed to parse untranslated items file: ${e.message}`);
    return { ok: false, items: [], reason: 'parse-error' };
  }
}

function getGameDisplayName(game) {
  if (game === 'ck3') return 'CK3';
  if (game === 'vic3') return 'VIC3';
  if (game === 'stellaris') return 'Stellaris';
  return game;
}

function getIssueMod(issue, gameDisplayName) {
  const prefix = `[${gameDisplayName}] 번역 거부 항목 발생: `;
  if (issue.title.startsWith(prefix)) {
    return issue.title.slice(prefix.length);
  }

  const bodyModMatch = (issue.body || '').match(/^\*\*모드\*\*:\s*(.+)$/m);
  if (bodyModMatch) {
    return bodyModMatch[1].trim();
  }

  return null;
}

function getCurrentCommit() {
  const sha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  const shortSha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  const subject = execSync('git log -1 --pretty=%s', { encoding: 'utf-8' }).trim();
  return { sha, shortSha, subject };
}

function getResolutionMarker({ gameType, commit }) {
  return `<!-- pat-translation-resolved:${gameType}:${commit.sha} -->`;
}

function buildResolutionComment({ commit, context, gameType, issueMod }) {
  const timestamp = new Date().toISOString();
  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const commitUrl = `${serverUrl}/${context.repo.owner}/${context.repo.repo}/commit/${commit.sha}`;
  const marker = getResolutionMarker({ gameType, commit });

  let body = `${marker}\n`;
  body += `✅ 해결된 번역이 다음 커밋에 반영되어 이슈를 닫습니다.\n\n`;
  body += `- 모드: \`${issueMod}\`\n`;
  body += `- 반영 커밋: [\`${commit.shortSha}\`](${commitUrl}) ${commit.subject}\n`;
  body += `- 확인 시각: ${timestamp}\n`;
  return body;
}

async function hasResolutionComment({ octokit, context, issue, gameType, commit }) {
  const marker = getResolutionMarker({ gameType, commit });
  const comments = await githubApiRetry(() => octokit.paginate(octokit.rest.issues.listComments, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issue.number,
    per_page: 100
  }), '이슈 코멘트 목록 조회');

  return comments.some(comment => typeof comment.body === 'string' && comment.body.includes(marker));
}

async function run() {
  try {
    // 복합 액션에서는 INPUT_ 환경 변수를 직접 읽어야 함
    const gameType = process.env.INPUT_GAME;
    const token = process.env.INPUT_GITHUB_TOKEN;

    if (!gameType) {
      core.setFailed('game input is required');
      return;
    }
    if (!token) {
      core.setFailed('github-token input is required');
      return;
    }

    const octokit = github.getOctokit(token);
    const { context } = github;
    const gameDisplayName = getGameDisplayName(gameType);

    const filePath = path.join(process.cwd(), `${gameType}-untranslated-items.json`);
    const untranslatedResult = readUntranslatedItems(filePath);
    if (!untranslatedResult.ok) {
      core.warning(`번역되지 않은 항목 파일을 신뢰할 수 없어 이슈 닫기를 건너뜁니다. reason=${untranslatedResult.reason}`);
      return;
    }

    const unresolvedMods = new Set(untranslatedResult.items.map(item => item.mod));
    const currentCommit = getCurrentCommit();

    const existingIssues = await githubApiRetry(() => octokit.paginate(octokit.rest.issues.listForRepo, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      state: 'open',
      labels: `translation-refused,${gameType}`,
      per_page: 100
    }), '이슈 목록 조회');

    if (existingIssues.length === 0) {
      core.info('닫을 번역 거부 이슈가 없습니다.');
      return;
    }

    for (const issue of existingIssues) {
      const issueMod = getIssueMod(issue, gameDisplayName);
      if (issueMod === null) {
        core.info(`이슈 #${issue.number}에서 모드명을 확인할 수 없어 건너뜁니다.`);
        continue;
      }

      if (unresolvedMods.has(issueMod)) {
        core.info(`이슈 #${issue.number}(${issueMod})는 아직 미번역 항목이 남아 있어 유지합니다.`);
        continue;
      }

      const alreadyCommented = await hasResolutionComment({
        octokit,
        context,
        issue,
        gameType,
        commit: currentCommit
      });

      if (!alreadyCommented) {
        await githubApiRetry(() => octokit.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issue.number,
          body: buildResolutionComment({ commit: currentCommit, context, gameType, issueMod })
        }), '이슈 해결 코멘트 작성');
      }

      await githubApiRetry(() => octokit.rest.issues.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issue.number,
        state: 'closed'
      }), '이슈 닫기');

      core.info(`이슈 #${issue.number}(${issueMod})에 해결 커밋 코멘트를 남기고 닫았습니다.`);
    }
  } catch (error) {
    core.setFailed(error.message);
    if (error.stack) {
      core.debug(error.stack);
    }
  }
}

run();
