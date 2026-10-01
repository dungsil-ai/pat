# 프로젝트 개요

## 📖 소개

**Paradox Auto Translate**는 Paradox Interactive 게임 모드의 현지화(localization) 파일을 영어에서 한국어로 자동 번역하는 도구입니다. OpenAI 호환 Chat Completions API를 활용하여 게임별 맥락을 고려한 고품질 번역을 제공합니다.

## 🎮 지원 게임

현재 다음 게임의 모드 번역을 지원합니다:

### Crusader Kings III (CK3)
- 중세 시대 배경
- 역사적 인물, 지명, 직함 등에 대한 맥락 인식 번역
- 게임 메커니즘 및 이벤트 텍스트 번역

**주요 모드:**
- RICE (Rajas of Asia in CK3 Events)
- VIET (Variety, Immersion Enhancement Tweaks)
- CFP (Community Flavor Pack)
- ETC (기타 모드)

### Victoria 3 (VIC3)
- 19-20세기 산업화 시대 배경
- 정치, 경제 용어의 정확한 번역
- 역사적 사건 및 기술 번역

**주요 모드:**
- Community Mod Framework
- Better Politics Mod
- Tech & Res
- 기타 모드

### Stellaris
- SF/우주 배경
- 외계 종족, 기술, 이벤트 번역
- 게임 메커니즘 용어 번역

**주요 모드:**
- Pouchkinn's Gigastructures

## ✨ 주요 기능

### 1. AI 기반 맥락 인식 번역
- **OpenAI 호환 Chat Completions API** 통합
- 게임별 커스텀 프롬프트로 정확한 번역
- 역사적/게임 맥락을 고려한 용어 선택

### 2. 게임 문법 보존
번역 중 다음 요소들을 정확히 보존:
- 게임 변수: `$variable$`, `[GetTitle]`, `@icon@`
- 특수 마크업: `#bold#`, `#weak#`, `£currency£`
- 기술 식별자: `snake_case` 형태의 키 값
- 문자열 리터럴: 큰따옴표 이스케이프 처리

### 3. 스마트 캐싱 시스템
- **컨텐츠 기반 해싱**: 소스 변경 자동 감지
- **번역 메모리**: 이전 번역 재사용으로 API 비용 절감
- **사전 오버라이드**: 수동 번역으로 AI 번역 우선순위 조정
- **영구 저장소**: SQLite 기반 번역 캐시

### 4. 효율적인 저장소 관리
- **Sparse Checkout**: 필요한 localization 파일만 다운로드
- **자동 업데이트**: 번역 전 upstream 저장소 자동 동기화
- **버전 추적**: 최신 태그 또는 기본 브랜치 추적

### 5. 품질 검증
- **변수 보존 검증**: 게임 변수 누락/손상 감지
- **한글 포함 검증**: 변수 내부 한글 번역 방지
- **잘못된 형식 감지**: 혼합된 변수 구문 탐지
- **불필요한 응답 필터링**: LLM의 메타 응답 제거

### 6. 배치 처리
- **병렬 처리**: 여러 모드 동시 처리
- **진행 상황 로깅**: 상세한 처리 로그
- **선택적 모드**: 해시 업데이트 전용, 재번역 등

## 🏗️ 프로젝트 구조

```
paradox-auto-translate/
├── docs/              # 프로젝트 문서
├── scripts/           # 번역 스크립트
│   ├── factory/      # 번역 처리 로직
│   ├── parser/       # 파일 파싱 (YAML, TOML)
│   └── utils/        # 유틸리티 (AI, 캐싱, 로깅)
├── ck3/              # CK3 모드
├── vic3/             # VIC3 모드
├── stellaris/        # Stellaris 모드
└── translate-cache.db # 번역 캐시 데이터베이스
```

## 🔄 워크플로우 개요

1. **Upstream 업데이트**: 원본 영어 파일을 최신 버전으로 동기화
2. **파일 발견**: `meta.toml` 설정 기반 처리 대상 파일 탐색
3. **파싱**: YAML 형식의 localization 파일 파싱
4. **해싱**: 컨텐츠 해시로 변경 사항 감지
5. **번역**: 캐시 확인 → 사전 확인 → AI 번역 요청
6. **검증**: 번역 품질 검증 (변수 보존 등)
7. **출력**: 한국어 파일 생성 (`___*_l_korean.yml`)

## 🎯 사용 사례

### 게임 모더를 위한
- 자동화된 모드 번역으로 다국어 지원 확대
- 번역 품질 유지 및 업데이트 관리 간소화

### 플레이어를 위한
- 영어 모드의 한국어 번역 제공
- 정기적인 모드 업데이트에 맞춘 번역 동기화

### 개발자를 위한
- AI 기반 번역 파이프라인 학습
- 게임 현지화 자동화 예제

## 📊 기술 스택

- **언어**: TypeScript
- **런타임**: Node.js with jiti (JIT TypeScript execution)
- **AI**: OpenAI 호환 Chat Completions API (`@ai-sdk/openai-compatible`)
- **데이터베이스**: LibSQL (SQLite)
- **캐싱**: unstorage + db0
- **빌드 도구**: pnpm

## 🌟 특징

### 맥락 인식 번역
게임별 커스텀 시스템 프롬프트를 사용하여:
- 역사적 정확성 유지 (CK3: 중세, VIC3: 산업화 시대)
- 게임 고유 용어 일관성 유지
- 문화적 뉘앙스 보존

### 비용 효율성
- 번역 캐싱으로 중복 API 호출 방지
- 변경된 텍스트만 재번역
- 사전 기반 즉시 번역

### 확장성
- 새로운 게임 추가 용이
- 모드별 독립적 설정 (`meta.toml`)
- 플러그인 가능한 파서 및 검증기

## 📄 라이선스

이 프로젝트는 오픈소스이며, 기여를 환영합니다.

---

다음 단계: [아키텍처](architecture.md) 문서를 읽고 시스템 설계를 이해하세요.
