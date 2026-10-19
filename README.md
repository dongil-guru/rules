# 문서이음 · 업무 문서 관리

GitHub 저장소: **dongil-guru/rules**

기관·업무구분에 따라 지침, 매뉴얼, 가이드라인을 관리하며 본인 Cloudflare의 Workers·D1·비공개 R2로 직접 배포합니다. 문서와 첨부파일은 Cloudflare에 저장하고 GitHub에는 프로그램 소스만 저장합니다.

## 최초 배포에 필요한 설정

이 저장소에서 **Settings → Secrets and variables → Actions → New repository secret**으로 다음 3개를 등록합니다. 값은 소스·이슈·대화에 입력하지 않습니다.

| Secret 이름 | 입력할 값 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 본인 Cloudflare Account ID, 32자리 |
| `CLOUDFLARE_API_TOKEN` | 본인 Cloudflare 계정의 배포용 API 토큰 |
| `ADMIN_PASSWORD` | 이 문서관리 사이트에서 사용할 관리자 비밀번호, 12~256자 |

Cloudflare API 토큰은 **Edit Cloudflare Workers** 템플릿을 사용하고 **D1 편집**, **Workers R2 Storage 편집** 권한을 포함합니다. 대상 자원은 배포할 본인 계정으로 한정합니다. R2가 활성화되어 있어야 합니다. Global API Key 대신 API Token을 사용합니다.

등록 후 **Actions → Deploy Document Hub to Cloudflare → Run workflow**를 실행합니다. 이미 설정 누락으로 실패한 작업이 있다면 다시 실행해도 됩니다.

배포 작업은 다음을 수행합니다.

1. 소스 구문 및 실제 Workers·D1·R2 기능 검사
2. 전용 D1 `rules-db`와 비공개 R2 `rules-files` 준비
3. 데이터베이스 스키마 적용
4. Cloudflare Worker `rules` 배포
5. 관리자 비밀번호의 PBKDF2 해시를 Cloudflare Secret으로 등록
6. 운영 주소에서 로그인·분류 조회·데이터베이스 검사
7. 작업 Summary에 실제 외부 접속 주소 표시

관리자 아이디는 **admin**, 비밀번호는 본인이 `ADMIN_PASSWORD`에 등록한 값입니다. 이 직접 배포판은 자체 관리자 로그인을 사용합니다.

## 기능

- 기관 1단계, 업무구분 2단계 추가·수정·삭제
- 최초 제정과 여러 차례 개정을 동일한 문서의 이력으로 보관
- 초기 트리에 문서별 최신 이력만 표시, 상세 화면에 전체 이력 표시
- 모든 문서 정보·첨부파일·연관문서·분류 수정
- 문서명 50자, 주요내용 300자, 참조 결재번호 10자 제한
- 날짜를 연월일 형식으로 검사
- 문서명·담당자·날짜 검색과 기관·업무 분류 필터, 과거 이력 검색
- 첨부파일 복수 등록·다운로드: 이력당 20개, 개당 20MB, 한 번에 합계 40MB
- 다른 기관의 특정 제·개정 이력을 여러 건 선택하여 연결, 역참조 표시
- 최신 개정 삭제 시 직전 이력 표시, 문서 전체 삭제 시 이력·첨부·참조 정리
- 로그인 및 세션 보호, 변경 요청 출처 검사, 로그인 실패 횟수 제한

로그인 후 **분류 관리**에서 기관과 업무를 먼저 등록하고 **문서 등록**을 사용합니다. 개정은 상세 화면의 **개정 이력 추가**를 사용합니다. **이력 수정**은 선택한 이력을 정정합니다. 기관·업무구분 변경은 문서의 모든 이력에 반영됩니다.

연관문서는 선택한 특정 이력에 고정됩니다. 상대 문서에 새 개정이 생겨도 과거 참조가 바뀌지 않습니다. 검색은 과거 이력도 찾지만 목록에는 최신 이력을 표시합니다.

## 로컬 개발

Node.js 22 이상에서 실행합니다.

```bash
npm install
npm run check
npm test
```

`.dev.vars.example`을 `.dev.vars`로 복사하여 로컬용 비밀번호를 입력한 뒤 실행합니다.

```bash
npx wrangler d1 migrations apply DB --local
npm run dev
```

로컬 저장소와 운영 저장소는 분리됩니다. 최초 직접 배포는 `deploy-windows.cmd` 또는 `npm run setup`으로도 실행할 수 있습니다. CI가 생성한 D1 ID는 해당 작업의 임시 설정에 반영하며 비밀값과 운영 데이터를 GitHub 소스에 커밋하지 않습니다.

## 참고

- [GitHub Actions 비밀값 등록](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
- [Cloudflare의 GitHub Actions 배포 안내](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
