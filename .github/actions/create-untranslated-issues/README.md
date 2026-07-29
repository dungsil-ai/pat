# Create Untranslated Items Issues Action

번역되지 않은 항목이 있을 때 자동으로 GitHub 이슈를 생성하거나 업데이트하는 GitHub Action입니다.

## Setup

이 액션을 사용하기 전에 의존성을 설치해야 합니다:

```bash
cd .github/actions/create-untranslated-issues
npm install
```

## Usage

```yaml
- name: Create issue for untranslated items
  if: always()
  uses: ./.github/actions/create-untranslated-issues
  with:
    game: 'ck3'  # or 'vic3', 'stellaris'
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

## 입력

- `game` (필수): 게임 식별자 (`ck3`, `vic3`, `stellaris`)
- `github-token` (필수): GitHub API 접근을 위한 토큰

## 동작 방식

1. `{game}-untranslated-items.json` 파일을 읽습니다.
2. 파일이 존재하고 번역되지 않은 항목이 있으면:
   - legacy 항목은 모드별로, 컴포넌트 항목은 `모드 + componentId`별로 그룹화합니다.
   - 각 논리 모드에 대해 기존 이슈가 있는지 안정적인 본문 마커로 확인합니다.
   - 기존 이슈가 있으면 현재 미번역 항목 목록과 본문을 동기화합니다.
   - 기존 이슈가 없으면 새 이슈를 생성합니다.
3. 이슈는 `translation-refused` 및 게임별 레이블이 자동으로 추가됩니다.

## 특징

- `sourcePath + key` 기준 중복 항목 자동 감지 및 제거
- 같은 저장소에 여러 논리 모드가 있어도 컴포넌트별 이슈를 독립적으로 생성 및 갱신
- 컴포넌트 표시명이 바뀌어도 `componentId`로 기존 이슈를 이어서 사용
- 긴 메시지는 접을 수 있는 섹션으로 표시
- 이슈 본문의 테이블 형식으로 깔끔하게 정리
- 현재 미번역 항목과 이슈 본문을 정확히 동기화

## Development

의존성 설치:
```bash
npm install
```

코드를 수정한 후 변경사항을 커밋하면 됩니다. `node_modules`는 `.gitignore`에 포함되어 있으므로 커밋되지 않으며, GitHub Actions 실행 시 `npm ci --production`으로 설치됩니다.
