# Paradox Auto Translate 문서

Paradox Interactive 게임 모드 자동 번역 도구에 대한 종합 문서입니다.

이 문서는 프로젝트의 모든 측면을 다루며, 초보자부터 고급 개발자까지 모두를 위한 정보를 제공합니다.

## 🆕 최근 업데이트 (2026-04)

**주요 개선 사항 (지난 7일):**
- **업스트림 번역 미반영 대시보드 추가**: 12시간마다 upstream 태그/커밋을 조회해 미반영 모드를 집계하고 `[대시보드] 업스트림 변경 대비 번역 미반영 현황` 이슈로 자동 게시
- **기본 Gemini 모델 문서 정합성**: 코드 기본값에 맞춰 `GEMINI_MODEL` 기본 설명을 `gemini-flash-lite-latest`로 정정
- **태그 비교 안정성 보강**: annotated 태그를 커밋까지 펼쳐 비교하고 동일 참조명 업데이트 시 검증을 추가해 version_strategy 기반 체크아웃 신뢰도 향상
- **CK3 해시 붕괴 대응**: CK3 번역 파일 해시가 손상된 경우에도 해시 스킵/재계산이 깨지지 않도록 복구 로직 보완

자세한 내용은 [변경 로그](CHANGELOG.md), [아키텍처 문서](architecture.md), [검증 시스템 문서](validation.md), [사용 가이드](usage.md)를 참조하세요.

## 📚 문서 목록

### 핵심 문서 (시작하기)

| 문서 | 설명 | 대상 독자 |
|------|------|----------|
| **[프로젝트 개요](overview.md)** | 프로젝트의 목적, 주요 기능 및 지원하는 게임 (CK3, VIC3, Stellaris) | 모든 사용자 |
| **[사용 가이드](usage.md)** | 설치, 기본 명령어, 워크플로우 예제 | 최종 사용자 |
| **[설정 가이드](configuration.md)** | `meta.toml` 설정 파일 사양 및 예제 | 모드 관리자 |
| **[트러블슈팅](troubleshooting.md)** | 일반적인 문제 해결 방법 및 FAQ | 모든 사용자 |

### 기술 문서 (심화 학습)

| 문서 | 설명 | 대상 독자 |
|------|------|----------|
| **[아키텍처](architecture.md)** | 시스템 설계, 13개 핵심 컴포넌트 상세 설명, 데이터 흐름 | 개발자 |
| **[번역 파이프라인](translation-pipeline.md)** | 9단계 번역 처리 과정의 상세 설명 | 개발자 |
| **[API 레퍼런스](api-reference.md)** | 주요 함수 및 모듈 API 문서 | 개발자 |
| **[캐싱 시스템](caching.md)** | xxHash 기반 캐시 및 해시 관리 시스템 | 개발자 |
| **[검증 시스템](validation.md)** | 5가지 번역 품질 검증 규칙 상세 | 개발자 |
| **[사전 관리](dictionary.md)** | 게임별 번역 사전 및 용어 관리 시스템 | 번역 관리자 |

### 고급 문서 (개발 및 기여)

| 문서 | 설명 | 대상 독자 |
|------|------|----------|
| **[개발 가이드](development.md)** | 개발 환경 설정, 코딩 표준, 기여 가이드 | 기여자 |
| **[기능 요구사항 및 엣지 케이스](requirements.md)** | 8개 FR 카테고리, 10개 EC 카테고리, NFR | 개발자/아키텍트 |
| **[재구현 가이드](reimplementation-guide.md)** | 현재 사양 기반 깔끔한 재구현 방법 | 아키텍트/리드 개발자 |
| **[AI 에이전트 가이드](agents-guide.md)** | AI 작업 시 프로젝트 가이드 (AGENTS.md) | AI/자동화 도구 |
| **[변경 로그](CHANGELOG.md)** | 프로젝트 주요 변경 사항 및 개선 내역 | 모든 사용자 |

### 이슈 해결 및 버그 수정 문서

| 문서 | 설명 | 대상 독자 |
|------|------|----------|
| **[크래시 분석](crash-analysis.md)** | CK3 RICE 모드 크래시 원인 분석 | 개발자/디버거 |
| **[크래시 수정](crash-fix-readme.md)** | 게임 크래시 수정 방법 | 개발자 |
| **[검증 오탐 수정](false-positive-fix.md)** | False Positive 감지 수정 | 개발자 |
| **[검증 오탐 상세](fix-validation-false-positive.md)** | 변수 검증 오탐 수정 상세 | 개발자 |
| **[이슈 해결 요약](issue-resolution-summary.md)** | 검증 시스템 오탐 이슈 해결 요약 | 모든 사용자 |
| **[수정 요약](summary-fix.md)** | 검증 오탐 수정 요약 | 개발자 |
| **[검증 결과](verification-results.md)** | 크래시 수정 검증 결과 | QA/테스터 |

## 🚀 빠른 시작

### 프로젝트를 처음 접하시는 경우

```
1. 개요 파악    → 2. 도구 설치    → 3. 첫 번역    → 4. 문제 해결
   overview.md     usage.md         usage.md        troubleshooting.md
```

**단계별 가이드:**

1. **[프로젝트 개요](overview.md)** - 프로젝트가 무엇이고 어떤 기능을 제공하는지 이해
   - 지원하는 게임 (CK3, VIC3, Stellaris)
   - 주요 기능 (AI 번역, 캐싱, 검증)
   - 기술 스택 및 아키텍처 개요

2. **[사용 가이드](usage.md)** - 실제로 도구를 설치하고 실행
   - 환경 설정 (Node.js, pnpm, API 키)
   - 기본 명령어 (`pnpm ck3`, `pnpm upstream` 등)
   - 워크플로우 예제

3. **[설정 가이드](configuration.md)** - 새 모드 추가 및 설정
   - `meta.toml` 파일 작성
   - Upstream 저장소 설정
   - 경로 및 언어 설정

4. **[트러블슈팅](troubleshooting.md)** - 문제 발생 시 해결 방법
   - 일반적인 오류 및 해결책
   - 디버깅 기법
   - FAQ

### 개발에 기여하고 싶으신 경우

```
1. 환경 설정      → 2. 구조 이해    → 3. 코드 작성    → 4. 요구사항 확인
   development.md     architecture.md   api-reference.md   requirements.md
```

**단계별 가이드:**

1. **[개발 가이드](development.md)** - 개발 환경을 설정하고 코딩 표준 이해
   - 필수 도구 설치
   - 프로젝트 구조 파악
   - 코드 스타일 및 컨벤션
   - 테스트 및 디버깅 방법

2. **[아키텍처](architecture.md)** - 시스템 설계와 컴포넌트 구조 이해
   - 13개 핵심 컴포넌트
   - 데이터 흐름 및 처리 과정
   - 설계 패턴 및 원칙

3. **[API 레퍼런스](api-reference.md)** - 함수 및 모듈 API 참조
   - Translation Factory
   - Parsers (YAML, TOML)
   - AI Integration
   - Caching, Hashing, Dictionary
   - Validation, Upstream Manager

4. **[기능 요구사항 및 엣지 케이스](requirements.md)** - 구현해야 할 기능과 처리해야 할 엣지 케이스
   - 8개 기능 요구사항 카테고리
   - 10개 엣지 케이스 카테고리
   - 비기능 요구사항 및 제한사항

### 특정 주제를 깊이 있게 이해하고 싶은 경우

#### 번역 프로세스 이해
- **[번역 파이프라인](translation-pipeline.md)** - 전체 번역 과정의 9단계
- **[검증 시스템](validation.md)** - 번역 품질을 보장하는 5가지 규칙
- **[사전 관리](dictionary.md)** - 용어 일관성을 유지하는 사전 시스템

#### 성능 최적화 이해
- **[캐싱 시스템](caching.md)** - 중복 API 호출을 방지하는 캐싱 전략
- **[아키텍처](architecture.md)** - 병렬 처리 및 최적화 기법

#### 새 기능 추가
- **[개발 가이드](development.md)** - 새 게임/모드 추가 방법
- **[API 레퍼런스](api-reference.md)** - 확장 포인트 및 인터페이스

#### 버그 수정 및 이슈 해결
- **[크래시 분석](crash-analysis.md)** - 게임 크래시 원인 분석 방법
- **[이슈 해결 요약](issue-resolution-summary.md)** - 발생한 이슈 및 해결 과정
- **[검증 결과](verification-results.md)** - 수정 사항 검증 방법

## 📖 문서 읽기 가이드

### 학습 경로별 추천 문서

#### 🎮 **게임 플레이어** (모드 번역 사용)
```
overview.md → usage.md → troubleshooting.md
```
- 목표: 영어 모드를 한국어로 번역하여 플레이
- 시간: 30분

#### 🔧 **모드 관리자** (여러 모드 관리)
```
overview.md → usage.md → configuration.md → dictionary.md → troubleshooting.md
```
- 목표: 여러 모드를 효율적으로 관리하고 번역 품질 개선
- 시간: 1-2시간

#### 💻 **개발자** (코드 이해 및 기여)
```
overview.md → architecture.md → translation-pipeline.md → 
api-reference.md → development.md → requirements.md
```
- 목표: 시스템 이해 및 기능 추가/개선
- 시간: 3-4시간

#### 🏗️ **아키텍트** (시스템 설계 이해)
```
overview.md → architecture.md → requirements.md → 
translation-pipeline.md → caching.md → validation.md
```
- 목표: 전체 시스템 설계 및 기술 스택 이해
- 시간: 4-5시간

## 📊 문서 통계

- **총 문서 수**: 23개
- **총 줄 수**: 12,000+ 줄
- **총 단어 수**: 26,000+ 개
- **코드 예제**: 200+ 개
- **다이어그램**: 15+ 개

### 문서별 상세 정보

#### 핵심 및 기술 문서

| 문서 | 줄 수 | 주요 내용 |
|------|-------|----------|
| overview.md | 144 | 프로젝트 소개, 지원 게임, 주요 기능 |
| architecture.md | 499 | 13개 컴포넌트, 데이터 흐름, 설계 패턴 |
| usage.md | 350 | 설치, 명령어, 워크플로우 |
| development.md | 603 | 개발 환경, 코딩 표준, 기여 가이드 |
| translation-pipeline.md | 631 | 9단계 파이프라인, 처리 흐름 |
| configuration.md | 276 | meta.toml 사양, 예제 |
| api-reference.md | 552 | 함수 API, 모듈 인터페이스 |
| caching.md | 517 | 캐시 아키텍처, 관리 전략 |
| requirements.md | 449 | FR, EC, NFR, 제한사항 |
| validation.md | 465 | 5가지 검증 규칙, 재번역 |
| dictionary.md | 434 | 게임별 사전, 관리 방법 |
| troubleshooting.md | 367 | 문제 해결, FAQ |
| reimplementation-guide.md | 852 | 재구현 전략, 설계 패턴, 마이그레이션 |
| agents-guide.md | 166 | AI 에이전트 작업 가이드 |
| CHANGELOG.md | 200+ | 프로젝트 변경 이력 (2025-11 업데이트 포함) |

#### 이슈 해결 문서

| 문서 | 줄 수 | 주요 내용 |
|------|-------|----------|
| crash-analysis.md | 120+ | CK3 RICE 모드 크래시 원인 분석 |
| crash-fix-readme.md | 80+ | 게임 크래시 수정 가이드 |
| false-positive-fix.md | 90+ | 검증 False Positive 수정 |
| fix-validation-false-positive.md | 150+ | 변수 검증 오탐 상세 수정 |
| issue-resolution-summary.md | 200+ | 검증 시스템 이슈 해결 요약 |
| summary-fix.md | 100+ | 검증 오탐 수정 요약 |
| verification-results.md | 180+ | 크래시 수정 검증 결과 |

#### 기타

| 문서 | 줄 수 | 주요 내용 |
|------|-------|----------|
| README.md | 320+ | 문서 인덱스 및 네비게이션 |

## 🔗 외부 리소스

### 관련 기술 문서
- [TypeScript 공식 문서](https://www.typescriptlang.org/docs/)
- [Google Gemini API 문서](https://ai.google.dev/docs)
- [Node.js 문서](https://nodejs.org/docs/)
- [pnpm 문서](https://pnpm.io/)

### 게임 모딩 리소스
- [CK3 모딩 위키](https://ck3.paradoxwikis.com/Modding)
- [VIC3 모딩 위키](https://vic3.paradoxwikis.com/Modding)
- [Stellaris 모딩 위키](https://stellaris.paradoxwikis.com/Modding)

### 커뮤니티
- GitHub Discussions - 질문 및 토론

## 🤝 문서 기여

문서를 개선하고 싶으신가요? 기여를 환영합니다!

### 기여 방법

1. **오타 및 문법 수정**: 작은 수정도 큰 도움이 됩니다
2. **예제 추가**: 실제 사용 사례나 코드 예제 추가
3. **섹션 확장**: 더 상세한 설명이 필요한 부분 보완
4. **새 문서 추가**: 누락된 주제에 대한 새 문서 작성
5. **번역**: 다른 언어로 문서 번역 (향후 계획)

### 기여 절차

1. Fork 및 브랜치 생성
2. 변경 사항 작성 및 커밋
3. Pull Request 제출
4. 리뷰 및 병합

자세한 내용은 [개발 가이드](development.md)를 참조하세요.

## ⚠️ 중요 공지

### 최신 업데이트
- **2026-01-05**: 주간 문서 현행화 (GitHub Actions 공유 패키지 반영)
- **2026-01-02**: GitHub Actions 공유 패키지 생성, Node.js 모듈 해석 개선
- **2025-12-22**: 주간 문서 현행화 (버전 전략, GitHub Actions 재시도, YAML 파서 최적화 등 반영)
- **2025-12-21**: 버전 전략 기능 추가 (semantic/natural/default), GitHub Actions 재시도 로직
- **2025-12-18**: YAML 파서 최적화, 번역 거부 처리 개선, 대문자 포맷팅 태그 지원
- **2025-12-17**: GitHub MCP 서버 도구 우선순위 가이드라인 추가
- **2025-12-15**: 키 단위 음역 모드 추가, Paradox 형식 후행 텍스트 지원
- **2025-12-08**: 번역 거부 자동 이슈 등록, 캐시 시스템 개선
- **2025-12-01**: 주간 문서 자동화 워크플로우, 검증 시스템 대폭 개선

### 알려진 제한사항
- 현재 영어 → 한국어 번역만 지원
- Google Gemini AI만 지원 (다른 AI 모델은 향후 추가 예정)
- CLI 인터페이스만 제공 (GUI는 향후 개발 예정)

자세한 내용은 [기능 요구사항](requirements.md#제한사항-limitations) 문서를 참조하세요.

### 해결된 주요 이슈
- **CK3 RICE 모드 크래시** - 잘못된 변수 패턴 수정 ([크래시 분석](crash-analysis.md))
- **검증 시스템 오탐** - False Positive 감지 로직 개선 ([이슈 해결](issue-resolution-summary.md))
- **변수 검증 개선** - 게임 변수 패턴 정확도 향상 ([검증 오탐 수정](false-positive-fix.md))

## 📞 지원 및 문의

프로젝트에 대한 질문이나 도움이 필요하신 경우 GitHub Discussions를 활용해 주세요.

---

**최종 업데이트:** 2026-01-05 | **문서 버전:** 1.4.0
