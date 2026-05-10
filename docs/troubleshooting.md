# 트러블슈팅

## 일반적인 문제

### 환경 설정 문제

#### API 키 오류

**증상:**
```
Error: GOOGLE_AI_STUDIO_TOKEN is not set
TypeError: Cannot read property 'generateContent' of undefined
```

**원인:** Google AI API 키가 설정되지 않음

**해결:**

1. `.env` 파일 확인:
```bash
cat .env
```

2. 파일이 없으면 생성:
```bash
cp .env.sample .env
```

3. API 키 입력:
```env
GOOGLE_AI_STUDIO_TOKEN=your_api_key_here
```

4. API 키 발급: [Google AI Studio](https://aistudio.google.com/app/apikey)

#### Node.js 버전 오류

**증상:**
```
SyntaxError: Unexpected token '?'
Error: import.meta is not defined
```

**원인:** Node.js 버전이 18 미만

**해결:**

```bash
# 현재 버전 확인
node --version

# Node.js 18+ 설치
# nvm 사용
nvm install 18
nvm use 18

# 또는 공식 사이트에서 다운로드
# https://nodejs.org/
```

#### pnpm 오류

**증상:**
```
command not found: pnpm
```

**원인:** pnpm이 설치되지 않음

**해결:**

```bash
# pnpm 설치
npm install -g pnpm

# 버전 확인
pnpm --version  # 10.18.2+
```

### 번역 실행 문제

#### Upstream 다운로드 실패

**증상:**
```
fatal: repository 'https://github.com/user/repo.git' not found
```

**원인:**
1. `meta.toml`의 URL 오타
2. 저장소가 존재하지 않음
3. 네트워크 연결 문제

**해결:**

1. URL 확인:
```bash
cat ck3/RICE/meta.toml
```

2. 브라우저에서 URL 접근 테스트

3. 수동 클론 테스트:
```bash
git clone --depth=1 https://github.com/user/repo.git /tmp/test
```

#### 파일을 찾을 수 없음

**증상:**
```
[RICE] 소스 디렉토리 없음: ck3/RICE/upstream/RICE/localization/english
```

**원인:**
1. `meta.toml`의 경로 오타
2. Upstream 업데이트 실패
3. 저장소 구조 변경

**해결:**

1. 저장소 구조 확인:
```bash
ls -R ck3/RICE/upstream/
```

2. `meta.toml` 경로 수정:
```toml
[upstream]
# 정확한 경로로 수정
localization = ["올바른/경로"]
```

3. Upstream 재다운로드:
```bash
rm -rf ck3/RICE/upstream/
pnpm upstream
```

#### Git Corruption (Self-hosted Runner)

**증상:**
```
fatal: loose object ... is corrupt
error: Could not read ...
```

**원인:**
- Self-hosted runner에서 `git fetch --unshallow` 실행 시 발생
- 불완전한 Git 객체로 인한 corruption

**해결:**

**워크플로우 수준 (권장):**
```yaml
# .github/workflows/your-workflow.yml
- uses: actions/checkout@v6
  with:
    clean: true          # 깨끗한 체크아웃
    fetch-depth: 0       # 전체 히스토리 가져오기 (unshallow 대신)
```

**로컬 수준:**
```bash
# 1. 로컬 저장소 재클론
cd /path/to/runner/work
rm -rf paradox-auto-translate
git clone https://github.com/user/paradox-auto-translate.git

# 2. Runner 재시작
sudo systemctl restart actions.runner.*
```

**예방:**
- `clean: true` 옵션 사용으로 항상 깨끗한 상태 유지
- `fetch-depth: 0`으로 처음부터 전체 히스토리 가져오기
- `unshallow` 작업 피하기

#### 번역이 실행되지 않음

**증상:**
번역 명령이 실행되지만 파일이 생성되지 않음

**원인:**
1. 해시가 일치하여 변경 사항 없음
2. 오류가 발생했지만 로그에 표시되지 않음
3. 파일 권한 문제

**해결:**

1. 해시 강제 무효화:
```bash
# 모든 항목 재번역
rm -rf ck3/*/mod/
pnpm ck3
```

2. 상세 로그 확인:
```bash
# 로그 레벨 증가 (코드 수정 필요)
# scripts/utils/logger.ts에서 level: 5로 설정
```

3. 권한 확인:
```bash
ls -l ck3/RICE/mod/
chmod -R u+w ck3/RICE/mod/
```

### AI 번역 문제

#### API 제한 초과

**증상:**
```
Error: 429 Too Many Requests
Error: Quota exceeded
```

**원인:** Google AI API 할당량 초과

**해결:**

1. API 사용량 확인: [Google Cloud Console](https://console.cloud.google.com/)

2. 대기 후 재시도:
```bash
# 1시간 대기
sleep 3600
pnpm ck3
```

3. 배치 크기 줄이기 (향후 기능)

#### 번역 품질 문제

**증상:**
- 부자연스러운 번역
- 게임 변수 손상
- 일관성 없는 용어

**해결:**

1. 사전에 용어 추가:
```typescript
// scripts/utils/dictionary.ts
const ck3Dictionaries = {
  '문제_용어': '올바른_번역',
}
```

2. 사전 기반 무효화 및 재번역:
```bash
pnpm ck3:update-dict
pnpm ck3
```

3. 시스템 프롬프트 개선 (코드 수정):
```typescript
// scripts/utils/prompts.ts
const CK3_SYSTEM_PROMPT = `
...
추가 가이드라인:
- 특정 맥락 고려
...
`
```

#### 타임아웃 오류

**증상:**
```
Error: Request timeout
Error: ETIMEDOUT
```

**원인:** 네트워크 불안정 또는 API 응답 지연

**해결:**

1. 재시도 (자동 재시도 로직 포함):
```bash
pnpm ck3
```

2. 네트워크 확인:
```bash
ping google.com
curl https://generativelanguage.googleapis.com/
```

3. 프록시 설정 (필요시):
```bash
export HTTP_PROXY=http://proxy:port
export HTTPS_PROXY=http://proxy:port
```

### 캐시 문제

#### 캐시가 작동하지 않음

**증상:**
동일한 텍스트가 계속 재번역됨

**원인:**
1. 캐시 키 불일치
2. 데이터베이스 손상
3. 권한 문제

**해결:**

1. 캐시 파일 확인:
```bash
ls -lh translate-cache.db*
```

2. 캐시 무결성 검사:
```bash
sqlite3 translate-cache.db "PRAGMA integrity_check;"
```

3. 캐시 재생성:
```bash
rm translate-cache.db*
pnpm ck3
```

#### Database Locked 오류

**증상:**
```
Error: database is locked
```

**원인:** 다른 프로세스가 데이터베이스 사용 중

**해결:**

1. 다른 번역 프로세스 종료:
```bash
ps aux | grep jiti
kill <PID>
```

2. WAL 파일 정리:
```bash
sqlite3 translate-cache.db "PRAGMA wal_checkpoint(FULL);"
```

3. 재시도:
```bash
pnpm ck3
```

### 검증 문제

#### 검증 실패 오류

**증상:**
```
[RICE/events.yml:key] 검증 실패: 누락된 게임 변수: [GetTitle]
```

**원인:** AI가 게임 변수를 잘못 번역

**해결:**

1. 재번역 실행:
```bash
pnpm ck3:retranslate  # 무효화
pnpm ck3              # 재번역
```

2. 반복되는 경우 사전 추가:
```typescript
// 변수를 포함한 전체 문장을 사전에 추가
'The [GetTitle] is strong': '[GetTitle]은(는) 강력합니다'
```

3. 검증 규칙 확인:
```typescript
// scripts/utils/translation-validator.ts
// 필요시 규칙 조정
```

#### 거짓 양성 (False Positive)

**증상:**
올바른 번역이 검증 실패로 표시됨

**원인:** 검증 규칙이 너무 엄격

**해결:**

1. 수동으로 사전에 추가:
```typescript
// 해당 번역을 올바른 것으로 고정
const ck3Dictionaries = {
  '원본_텍스트': '올바른_번역',
}
```

2. 검증 규칙 개선 (이슈 제보):
```
GitHub Issues에 사례 보고
```

### 파일 시스템 문제

#### 디스크 공간 부족

**증상:**
```
Error: ENOSPC: no space left on device
```

**원인:** 디스크 공간 부족

**해결:**

1. 디스크 사용량 확인:
```bash
df -h
```

2. 불필요한 파일 삭제:
```bash
# Node modules 재설치
rm -rf node_modules
pnpm install

# Git 정리
git gc --aggressive
```

3. 캐시 정리:
```bash
sqlite3 translate-cache.db "VACUUM;"
```

#### 파일 권한 오류

**증상:**
```
Error: EACCES: permission denied
```

**원인:** 파일 쓰기 권한 없음

**해결:**

```bash
# 권한 확인
ls -l ck3/RICE/mod/

# 권한 부여
chmod -R u+w ck3/
chmod -R u+w translate-cache.db*
```

### TypeScript 오류

#### 타입 오류

**증상:**
```
error TS2345: Argument of type 'string' is not assignable to parameter of type 'GameType'
```

**원인:** 타입 불일치

**해결:**

1. 타입 체크:
```bash
pnpm exec tsc --noEmit
```

2. 코드 수정:
```typescript
// 잘못된 타입
const gameType = 'ck3'  // string

// 올바른 타입
const gameType: GameType = 'ck3'  // GameType
```

#### 모듈 없음 오류

**증상:**
```
Cannot find module '@ai-sdk/google'
```

**원인:** 의존성 설치 안 됨

**해결:**

```bash
# 의존성 재설치
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

## 디버깅 기법

### 로그 레벨 증가

```typescript
// scripts/utils/logger.ts
export const log = createConsola({
  level: 5,  // 0: silent, 5: verbose
})
```

### 중단점 사용

VS Code `launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug CK3",
  "skipFiles": ["<node_internals>/**"],
  "program": "${workspaceFolder}/node_modules/.bin/jiti",
  "args": ["scripts/ck3.ts"],
  "console": "integratedTerminal"
}
```

### 단계별 테스트

```typescript
// 개별 함수 테스트
import { translateAI } from './scripts/utils/ai.js'

const result = await translateAI('test text', 'ck3')
console.log(result)
```

### 로그 파일 생성

```bash
# 로그를 파일로 저장
pnpm ck3 2>&1 | tee translation.log

# 나중에 분석
grep "ERROR" translation.log
grep "번역 완료" translation.log
```

## 성능 문제

### 번역 속도가 느림

**원인:**
1. API 응답 지연
2. 캐시 미스율 높음
3. 네트워크 불안정

**해결:**

1. 캐시 히트율 확인:
```bash
grep "캐시에서 번역 로드" translation.log | wc -l
grep "AI 번역 요청" translation.log | wc -l
```

2. 사전 확장:
```typescript
// 자주 사용되는 용어를 사전에 추가
```

3. 네트워크 최적화:
```bash
# DNS 캐시 플러시
sudo systemd-resolve --flush-caches

# 프록시 설정 확인
echo $HTTP_PROXY
```

### 메모리 부족

**증상:**
```
JavaScript heap out of memory
```

**원인:** 대량의 파일을 동시에 처리

**해결:**

```bash
# Node.js 힙 크기 증가
NODE_OPTIONS="--max-old-space-size=4096" pnpm ck3

# 또는 환경 변수 설정
export NODE_OPTIONS="--max-old-space-size=4096"
```

## 긴급 복구

### 캐시 손상 시

```bash
# 1. 백업이 있으면 복구
cp translate-cache.db.backup translate-cache.db

# 2. 백업이 없으면 재생성
rm translate-cache.db*
pnpm ck3  # 모든 항목 재번역 (시간 소요)
```

### 모든 번역 재설정

```bash
# 경고: 모든 번역이 삭제되고 재생성됩니다!
rm -rf ck3/*/mod/
rm translate-cache.db*
pnpm ck3
```

### Git 상태 초기화

```bash
# 로컬 변경 사항 모두 제거
git reset --hard HEAD
git clean -fdx

# 의존성 재설치
pnpm install

# 재시작
pnpm ck3
```

## 지원 받기

### 이슈 제보

GitHub Issues에 다음 정보를 포함하여 제보:

```
1. 문제 설명
2. 재현 단계
3. 예상 결과 vs 실제 결과
4. 환경 정보:
   - OS: (예: Ubuntu 22.04)
   - Node.js: (node --version)
   - pnpm: (pnpm --version)
5. 에러 로그 (전체)
6. meta.toml 설정 (민감 정보 제외)
```

### 로그 수집

```bash
# 전체 로그 저장
pnpm ck3 2>&1 | tee debug.log

# 시스템 정보
uname -a > system-info.txt
node --version >> system-info.txt
pnpm --version >> system-info.txt
```

### 테스트 케이스 생성

```bash
# 최소 재현 가능한 예제
mkdir -p ck3/TestMod/upstream/localization/english

cat > ck3/TestMod/meta.toml << EOF
[upstream]
localization = ["localization/english"]
language = "english"
EOF

cat > ck3/TestMod/upstream/localization/english/test_l_english.yml << EOF
l_english:
  test_key: "Test translation"
EOF

pnpm ck3
```

## 자주 묻는 질문 (FAQ)

### Q: 번역 거부 항목이 발생했어요

**A:** AI가 안전성 필터나 콘텐츠 정책으로 인해 일부 항목의 번역을 거부할 수 있습니다.

**확인 방법:**
```bash
# 번역 거부 리포트 파일 확인
cat ck3-untranslated-items.json
cat vic3-untranslated-items.json
cat stellaris-untranslated-items.json
```

**자동 처리:**
- GitHub Actions 워크플로우가 자동으로 Issues 생성
- `translation-refused` 레이블로 쉽게 찾을 수 있음
- 모드별로 그룹화되어 있음

**수동 해결:**
1. GitHub Issues에서 번역 거부 항목 확인
2. `scripts/utils/dictionary.ts`에 수동 번역 추가
3. 해당 파일의 해시 초기화 또는 `pnpm {game}:retranslate` 실행

**예제:**
```typescript
// scripts/utils/dictionary.ts에 추가
const ck3Glossary = {
  // ... 기존 항목들
  "problematic_text": "수동으로_작성한_번역",
}
```

### Q: 번역이 너무 오래 걸려요

**A:** 초기 실행은 모든 항목을 번역하므로 오래 걸립니다. 이후 실행은 변경된 항목만 번역하므로 빠릅니다.

### Q: 번역을 다시 실행하고 싶어요

**A:**
```bash
# 특정 모드만
rm -rf ck3/RICE/mod/
pnpm ck3

# 모든 모드
pnpm ck3:retranslate
pnpm ck3
```

### Q: API 비용이 얼마나 드나요?

**A:** Google Gemini Flash는 매우 저렴합니다 (약 $0.0001/요청). 캐시 사용으로 대부분의 요청을 절감할 수 있습니다.

### Q: 오프라인에서 사용할 수 있나요?

**A:** 일부 가능합니다:
- Upstream 업데이트: 네트워크 필요
- 캐시된 번역: 오프라인 가능
- 새 번역: AI API 필요 (온라인)

### Q: 다른 AI 모델을 사용할 수 있나요?

**A:** 코드 수정이 필요합니다. `scripts/utils/ai.ts`를 참조하여 다른 AI 서비스를 통합할 수 있습니다.

## 다음 단계

- [사용 가이드](usage.md) - 기본 사용법
- [개발 가이드](development.md) - 코드 수정
- [API 레퍼런스](api-reference.md) - 함수 참조

---

**도움이 필요하신가요?** GitHub Issues에 질문을 올려주세요!
