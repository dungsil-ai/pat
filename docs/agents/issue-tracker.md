# 이슈 트래커: GitHub

이 저장소의 작업 이슈와 PRD는 GitHub Issues에서 관리합니다. 모든 작업은 현재 저장소 안에서 `gh` CLI를 사용하며, 저장소는 Git 원격에서 자동 추론합니다.

## 기본 작업

- 생성: `gh issue create --title "..." --body "..."`
- 조회: `gh issue view <번호> --comments`
- 목록: `gh issue list --state open --json number,title,body,labels,comments`
- 댓글: `gh issue comment <번호> --body "..."`
- 라벨 추가·제거: `gh issue edit <번호> --add-label "..."` / `--remove-label "..."`
- 종료: `gh issue close <번호> --comment "..."`

여러 줄 본문과 댓글은 임시 파일 또는 안전한 다중 행 입력을 사용합니다.

## Pull Request 트리아지 표면

**외부 Pull Request를 요청 트리아지 표면으로 사용하지 않습니다.** 명시적으로 지목된 PR은 필요할 때 직접 검토할 수 있지만, 자동 트리아지 목록에는 포함하지 않습니다.

GitHub의 이슈와 PR은 번호 공간을 공유합니다. 번호만 주어졌다면 PR 여부를 먼저 확인하고, 아니면 이슈로 조회합니다.

## 스킬 동작

- 이슈 트래커에 게시하라는 지시는 GitHub 이슈 생성으로 해석합니다.
- 관련 티켓을 가져오라는 지시는 본문·댓글·라벨을 모두 조회하는 것으로 해석합니다.
- 스펙에서 파생된 구현 티켓은 가능한 경우 스펙 이슈의 하위 이슈로 연결합니다.

## 하위 이슈와 차단 관계

- 하위 이슈 연결은 GitHub sub-issues API를 사용합니다.
- 차단 관계는 GitHub 네이티브 issue dependencies를 사용합니다.
- API에는 `#번호`나 `node_id`가 아니라 이슈의 숫자형 데이터베이스 ID를 전달합니다.
- 하위 이슈나 의존성 기능을 사용할 수 없으면 부모 본문의 작업 목록과 자식 본문의 `Part of #<부모>` / `Blocked by: #<번호>` 표기로 대체합니다.
- 실행 가능한 프런티어는 열려 있는 모든 차단 이슈가 종료됐고 담당자가 없는 첫 번째 하위 이슈입니다.
