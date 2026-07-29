const fs = require('fs');
const path = require('path');

const SCOPE_MARKER_REGEX = /<!--\s*pat-untranslated-scope:([A-Za-z0-9_-]+)\s*-->/;

function getGameDisplayName(game) {
  if (game === 'ck3') return 'CK3';
  if (game === 'vic3') return 'VIC3';
  if (game === 'stellaris') return 'Stellaris';
  return game;
}

function getOptionalString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

function getItemScope(item) {
  return createScope(item.mod, item.componentId, item.componentName);
}

function encodeMarkerValue(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeMarkerValue(value) {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function getScopeMarker(scope) {
  return `<!-- pat-untranslated-scope:${encodeMarkerValue(scope.key)} -->`;
}

function getIssueScopeKey(issue) {
  const body = issue.body || '';
  const markerMatch = body.match(SCOPE_MARKER_REGEX);
  if (markerMatch) {
    return decodeMarkerValue(markerMatch[1]);
  }

  const modMatch = body.match(/^\*\*모드\*\*:\s*(.+)$/m);
  if (!modMatch) return null;

  const componentIdMatch = body.match(/^\*\*컴포넌트 ID\*\*:\s*`([^`]+)`$/m);
  return createScope(modMatch[1].trim(), componentIdMatch?.[1]).key;
}

function getIssueTitle(gameDisplayName, scope) {
  const displayName = scope.componentName
    ? `${scope.mod} / ${scope.componentName}`
    : scope.mod;
  return `[${gameDisplayName}] 번역 거부 항목 발생: ${displayName}`;
}

function getItemSource(item) {
  return getOptionalString(item.sourcePath) || item.file;
}

function getItemIdentity(item) {
  return JSON.stringify([getItemSource(item), item.key]);
}

function escapeTableText(value) {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/`/g, '\\`');
}

/**
 * 항목을 테이블 행으로 포맷팅합니다.
 * @param {Object} item 파일, 키, 원문을 포함한 번역 거부 항목
 * @returns {string} 포맷된 테이블 행
 */
function formatItemAsTableRow(item) {
  const rawMessage = item.message;
  const escapedSource = escapeTableText(getItemSource(item));
  const escapedKey = item.key.replace(/`/g, '\\`').replace(/\n/g, ' ');
  const escapedMessage = escapeTableText(rawMessage);
  let displayMessage = escapedMessage;
  let detailsSection = '';

  if (rawMessage.length > 100 || rawMessage.includes('\n')) {
    displayMessage = `${escapedMessage.slice(0, 100)}...`;
    const detailsMessage = rawMessage.replace(/`/g, '\\`');
    detailsSection = `<details><summary>전체 메시지 보기</summary>\n\n\`\`\`\n${detailsMessage}\n\`\`\`\n\n</details>\n`;
  }

  let row = `| ${escapedSource} | \`${escapedKey}\` | ${displayMessage} |\n`;
  if (detailsSection) {
    row += detailsSection;
  }
  return row;
}

function isValidItem(item) {
  const componentId = getOptionalString(item?.componentId);
  const componentName = getOptionalString(item?.componentName);
  return Boolean(
    item &&
    typeof item.mod === 'string' &&
    item.mod.trim().length > 0 &&
    typeof item.file === 'string' &&
    typeof item.key === 'string' &&
    typeof item.message === 'string' &&
    (item.componentId === undefined || componentId !== undefined) &&
    (item.componentName === undefined || componentName !== undefined) &&
    (componentName === undefined || componentId !== undefined) &&
    (item.sourcePath === undefined || getOptionalString(item.sourcePath) !== undefined)
  );
}

function groupItemsByScope(items, onWarning = () => {}) {
  const groups = new Map();

  for (const item of items) {
    if (!isValidItem(item)) {
      onWarning(`필수 속성이 없거나 형식이 잘못된 항목을 건너뜁니다: ${JSON.stringify(item)}`);
      continue;
    }

    const scope = getItemScope(item);
    let group = groups.get(scope.key);
    if (!group) {
      group = { scope, items: new Map() };
      groups.set(scope.key, group);
    }

    const identity = getItemIdentity(item);
    if (!group.items.has(identity)) {
      group.items.set(identity, item);
    }
  }

  return [...groups.values()]
    .map(group => ({
      scope: group.scope,
      items: [...group.items.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, item]) => item)
    }))
    .sort((left, right) => left.scope.key.localeCompare(right.scope.key));
}

function buildIssueBody({ gameDisplayName, scope, items, timestamp }) {
  let body = `${getScopeMarker(scope)}\n`;
  body += `## 번역 거부 항목\n\n`;
  body += `**게임**: ${gameDisplayName}\n`;
  body += `**모드**: ${scope.mod}\n`;
  if (scope.componentId) {
    body += `**논리 모드**: ${scope.componentName}\n`;
    body += `**컴포넌트 ID**: \`${scope.componentId}\`\n`;
  }
  body += `**발생 시간**: ${timestamp}\n\n`;
  body += `### 현재 미번역 항목\n\n`;
  body += `| 업스트림 출처 | 키 | 원문 |\n`;
  body += `|---|---|---|\n`;

  for (const item of items) {
    body += formatItemAsTableRow(item);
  }

  body += `\n---\n`;
  body += `이 이슈는 자동으로 생성되며, 현재 수집된 수동 번역 필요 항목과 동기화됩니다.\n`;
  return body;
}

async function run() {
  const core = require('@actions/core');
  const github = require('@actions/github');
  const { githubApiRetry } = require('@pat-actions/shared');

  try {
    const game = process.env.INPUT_GAME;
    const token = process.env.INPUT_GITHUB_TOKEN;

    if (!game) {
      core.setFailed('game input is required');
      return;
    }
    if (!token) {
      core.setFailed('github-token input is required');
      return;
    }

    const gameDisplayName = getGameDisplayName(game);
    const octokit = github.getOctokit(token);
    const { context } = github;
    const filePath = path.join(process.cwd(), `${game}-untranslated-items.json`);

    if (!fs.existsSync(filePath)) {
      core.info('번역되지 않은 항목이 없습니다.');
      return;
    }

    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (error) {
      core.setFailed(`Failed to parse ${filePath}: ${error.message}. The file may contain invalid JSON.`);
      return;
    }

    if (!Array.isArray(data.items) || data.items.length === 0) {
      core.info('번역되지 않은 항목이 없습니다.');
      return;
    }

    const groups = groupItemsByScope(data.items, message => core.warning(message));
    if (groups.length === 0) {
      core.info('유효한 번역 거부 항목이 없습니다.');
      return;
    }

    const timestamp = data.timestamp || '알 수 없음';
    const existingIssues = await githubApiRetry(() => octokit.paginate(octokit.rest.issues.listForRepo, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      state: 'open',
      labels: `translation-refused,${game}`,
      per_page: 100
    }), '이슈 목록 조회');

    for (const group of groups) {
      const title = getIssueTitle(gameDisplayName, group.scope);
      const body = buildIssueBody({
        gameDisplayName,
        scope: group.scope,
        items: group.items,
        timestamp
      });
      const matchingIssues = existingIssues
        .filter(issue => !issue.pull_request)
        .filter(issue => {
          const issueScopeKey = getIssueScopeKey(issue);
          return issueScopeKey === null
            ? issue.title === title
            : issueScopeKey === group.scope.key;
        })
        .sort((left, right) => left.number - right.number);
      const existingIssue = matchingIssues[0];

      for (const duplicateIssue of matchingIssues.slice(1)) {
        await githubApiRetry(() => octokit.rest.issues.update({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: duplicateIssue.number,
          state: 'closed'
        }), '중복 이슈 닫기');
        core.info(`중복 이슈 #${duplicateIssue.number}를 닫았습니다.`);
      }

      if (existingIssue) {
        await githubApiRetry(() => octokit.rest.issues.update({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: existingIssue.number,
          title,
          body
        }), '이슈 업데이트');
        core.info(`기존 이슈 #${existingIssue.number}를 현재 미번역 항목 ${group.items.length}개와 동기화했습니다.`);
        continue;
      }

      const newIssue = await githubApiRetry(() => octokit.rest.issues.create({
        owner: context.repo.owner,
        repo: context.repo.repo,
        title,
        body,
        labels: ['translation-refused', game]
      }), '이슈 생성');
      core.info(`새 이슈 #${newIssue.data.number}를 생성했습니다.`);
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
  buildIssueBody,
  createScope,
  formatItemAsTableRow,
  getIssueScopeKey,
  getIssueTitle,
  getItemIdentity,
  getScopeMarker,
  groupItemsByScope
};
