# Close Translation Issues Action

이 액션은 번역되지 않은 항목이 없을 때 `translation-refused` 레이블이 붙은 이슈를 자동으로 닫습니다. legacy 설정은 모드 단위로, 컴포넌트 설정은 `모드 + componentId` 단위로 종료 여부를 판단하므로 같은 저장소의 다른 논리 모드에 미번역 항목이 남아 있어도 서로 영향을 주지 않습니다.

미번역 JSON이 없거나 손상됐거나 스코프 형식이 잘못된 경우에는 잘못된 자동 종료를 막기 위해 모든 이슈 닫기를 건너뜁니다.

## Setup

이 액션을 사용하기 전에 의존성을 설치해야 합니다:

```bash
cd .github/actions/close-translation-issues
npm install
```

## Usage

```yaml
- name: Close translation-refused issues if all items translated
  if: always()
  uses: ./.github/actions/close-translation-issues
  with:
    game: 'ck3'  # or 'vic3', 'stellaris'
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Development

의존성 설치:
```bash
npm install
```

코드를 수정한 후 변경사항을 커밋하면 됩니다. `node_modules`는 `.gitignore`에 포함되어 있으므로 GitHub Actions에서 자동으로 설치됩니다.
