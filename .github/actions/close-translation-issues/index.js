const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SCOPE_MARKER_REGEX = /<!--\s*pat-untranslated-scope:([A-Za-z0-9_-]+)\s*-->/;

function getOptionalString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getIssueBodyField(body, fieldName) {
  if (typeof body !== 'string') return null;

  const prefix = `**${fieldName}**:`;
  let lineStart = 0;

  while (lineStart <= body.length) {
    const newlineIndex = body.indexOf('\n', lineStart);
    const lineEnd = newlineIndex === -1 ? body.length : newlineIndex;
    const rawLine = body.slice(lineStart, lineEnd);
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (line.startsWith(prefix)) {
      return getOptionalString(line.slice(prefix.length)) || null;
    }

    if (newlineIndex === -1) break;
    lineStart = newlineIndex + 1;
  }

  return null;
}

function getIssueBodyCodeField(body, fieldName) {
  const value = getIssueBodyField(body, fieldName);
  if (
    value === null ||
    value.length < 3 ||
    value[0] !== '`' ||
    value[value.length - 1] !== '`'
  ) {
    return null;
  }

  const unwrapped = value.slice(1, -1);
  return unwrapped.includes('`') ? null : unwrapped;
}

function createScope(mod, componentId, componentName) {
  const normalizedMod = mod.trim();
  const normalizedComponentId = getOptionalString(componentId);
  const normalizedComponentName = getOptionalString(componentName) || normalizedComponentId;
  return {
    key: JSON.stringify([normalizedMod, normalizedComponentId || null]),
    mod: normalizedMod,
    componentId: normalizedComponentId,
    componentName: normalizedComponentName
  };
}

function decodeScopeMarker(value) {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      (parsed[1] !== null && typeof parsed[1] !== 'string')
    ) {
      return null;
    }
    return createScope(parsed[0], parsed[1] || undefined);
  } catch {
    return null;
  }
}

function readUntranslatedItems(filePath, logger = console) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, items: [], reason: 'missing' };
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(data.items)) {
      return { ok: false, items: [], reason: 'invalid-items' };
    }

    const hasInvalidScope = data.items.some(item => (
      !item ||
      typeof item.mod !== 'string' ||
      item.mod.trim().length === 0 ||
      (item.componentId !== undefined && getOptionalString(item.componentId) === undefined) ||
      (item.componentName !== undefined && getOptionalString(item.componentName) === undefined) ||
      (getOptionalString(item.componentName) !== undefined && getOptionalString(item.componentId) === undefined)
    ));
    if (hasInvalidScope) {
      return { ok: false, items: [], reason: 'invalid-item-scope' };
    }

    return { ok: true, items: data.items };
  } catch (error) {
    logger.error(`Failed to parse untranslated items file: ${error.message}`);
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
  const bodyMod = getIssueBodyField(issue.body || '', '모드');
  if (bodyMod !== null) {
    return bodyMod;
  }

  const prefix = `[${gameDisplayName}] 번역 거부 항목 발생: `;
  if (issue.title.startsWith(prefix)) {
    return issue.title.slice(prefix.length);
  }

  return null;
}

function getIssueScope(issue, gameDisplayName) {
  const body = issue.body || '';
  const markerMatch = body.match(SCOPE_MARKER_REGEX);
  if (markerMatch) {
    const markerScope = decodeScopeMarker(markerMatch[1]);
    if (markerScope) {
      const componentName = getIssueBodyField(body, '논리 모드');
      return {
        ...markerScope,
        componentName: componentName || markerScope.componentName
      };
    }
  }

  const mod = getIssueMod(issue, gameDisplayName);
  if (mod === null) return null;

  const componentId = getIssueBodyCodeField(body, '컴포넌트 ID');
  const componentName = getIssueBodyField(body, '논리 모드');
  return createScope(mod, componentId || undefined, componentName || undefined);
}

function getUnresolvedScopeKeys(items) {
  return new Set(items.map(item => createScope(item.mod, item.componentId, item.componentName).key));
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

function buildResolutionComment({ commit, context, gameType, issueScope }) {
  const timestamp = new Date().toISOString();
  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const commitUrl = `${serverUrl}/${context.repo.owner}/${context.repo.repo}/commit/${commit.sha}`;
  const marker = getResolutionMarker({ gameType, commit });

  let body = `${marker}\n`;
  body += `✅ 해결된 번역이 다음 커밋에 반영되어 이슈를 닫습니다.\n\n`;
  body += `- 모드: \`${issueScope.mod}\`\n`;
  if (issueScope.componentId) {
    body += `- 논리 모드: \`${issueScope.componentName}\` (\`${issueScope.componentId}\`)\n`;
  }
  body += `- 반영 커밋: [\`${commit.shortSha}\`](${commitUrl}) ${commit.subject}\n`;
  body += `- 확인 시각: ${timestamp}\n`;
  return body;
}

async function hasResolutionComment({ octokit, context, issue, gameType, commit, githubApiRetry }) {
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
  const core = require('@actions/core');
  const github = require('@actions/github');
  const { githubApiRetry } = require('@pat-actions/shared');

  try {
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
    const untranslatedResult = readUntranslatedItems(filePath, core);

    if (!untranslatedResult.ok) {
      core.warning(`번역되지 않은 항목 파일을 신뢰할 수 없어 이슈 닫기를 건너뜁니다. reason=${untranslatedResult.reason}`);
      return;
    }

    const unresolvedScopes = getUnresolvedScopeKeys(untranslatedResult.items);
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
      if (issue.pull_request) {
        core.info(`풀 리퀘스트 #${issue.number}는 번역 거부 이슈 종료 대상에서 제외합니다.`);
        continue;
      }

      const issueScope = getIssueScope(issue, gameDisplayName);
      if (issueScope === null) {
        core.info(`이슈 #${issue.number}에서 모드 범위를 확인할 수 없어 건너뜁니다.`);
        continue;
      }

      const scopeDisplayName = issueScope.componentName
        ? `${issueScope.mod} / ${issueScope.componentName}`
        : issueScope.mod;
      if (unresolvedScopes.has(issueScope.key)) {
        core.info(`이슈 #${issue.number}(${scopeDisplayName})는 아직 미번역 항목이 남아 있어 유지합니다.`);
        continue;
      }

      const alreadyCommented = await hasResolutionComment({
        octokit,
        context,
        issue,
        gameType,
        commit: currentCommit,
        githubApiRetry
      });

      if (!alreadyCommented) {
        await githubApiRetry(() => octokit.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issue.number,
          body: buildResolutionComment({
            commit: currentCommit,
            context,
            gameType,
            issueScope
          })
        }), '이슈 해결 코멘트 작성');
      }

      await githubApiRetry(() => octokit.rest.issues.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issue.number,
        state: 'closed'
      }), '이슈 닫기');

      core.info(`이슈 #${issue.number}(${scopeDisplayName})에 해결 커밋 코멘트를 남기고 닫았습니다.`);
    }
  } catch (error) {
    core.setFailed(error.message);
    if (error.stack) {
      core.debug(error.stack);
    }
  }
}

if (require.main === module) {
  void run();
}

module.exports = {
  buildResolutionComment,
  createScope,
  getGameDisplayName,
  getIssueMod,
  getIssueScope,
  getResolutionMarker,
  getUnresolvedScopeKeys,
  readUntranslatedItems
};
