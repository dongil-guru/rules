# 문서관리 · 안전정보팀 업무 표준문서 관리

GitHub 저장소: **dongil-guru/rules**

한국상하수도협회와 상위기관의 지침, 매뉴얼, 가이드라인을 업무구분별로 관리하며 본인 Cloudflare의 Workers·D1·비공개 R2로 직접 배포합니다. 문서와 첨부파일은 Cloudflare에 저장하고 GitHub에는 프로그램 소스만 저장합니다.

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

- 문서 등록은 왼쪽 업무구분·오른쪽 기관구분 순서이며, 새 문서의 업무구분은 저장된 표시 순서의 첫 항목을 기본 선택
- 기관 구분은 고정이며, 업무구분은 하위분류 없는 1단계로 추가·수정·삭제
- 업무구분 관리의 위로·아래로 버튼으로 표시 순서를 저장하며, 문서가 등록된 업무구분의 삭제는 차단
- 최신 문서를 업무구분 / 협회 문서명·일자 / 상위기관 문서명·일자의 비교 표로 표시
- 연결된 문서는 한 행에, 연결되지 않은 문서는 자기 기관 칸에만 표시
- 상세화면은 클릭한 기관과 관계없이 왼쪽 협회, 오른쪽 상위기관으로 고정
- 각 기관 문서의 최초 제정과 전체 개정 이력·첨부파일을 나란히 조회·수정
- 동일 업무구분의 반대편 문서 1개와 1:1 연결, 중복 연결은 DB와 API에서 차단
- 문서 단위 연결은 새 개정을 추가하거나 개정 이력을 삭제해도 유지
- 문서 전체 삭제 시 해당 문서의 파일·이력을 정리하고 상대 문서는 보존하여 연결 해제
- 문서명 50자, 설명 300자, 참조 문서번호 10자 및 유효한 연월일 검사
- 문서명·담당자·업무구분과 제·개정 연도·월 검색: 연도만 입력하면 해당 연도 전체, 월까지 선택하면 해당 연월 전체를 검색
- 과거 이력 검색 시에도 최신 문서와 연결 상대를 함께 표시
- 검색 영역은 기본 접힘 상태이며 펼치거나 접기 가능
- 첨부파일 복수 등록·다운로드: 이력당 20개, 개당 20MB, 한 번에 합계 40MB
- 관리자 로그인·세션 보호·변경 출처 검사·로그인 실패 제한

로그인 후 **업무구분 관리**에서 업무를 등록하고 **문서 등록**을 사용합니다. 저장한 업무구분 순서는 메뉴·문서 표·등록 화면에 함께 적용됩니다. 양쪽 상세정보의 **개정본 추가**와 **수정·삭제**는 해당 기관의 문서 이력을 처리합니다. 제·개정 일자는 참조 문서번호 옆에 표시합니다. 기관 구분·업무구분·연관문서 변경은 문서 전체에 반영됩니다.

`0002_document_pairs.sql`은 기존 문서·이력·첨부파일을 유지하며 기관 구분을 고정 항목으로 전환합니다. 기존 다중 연결 중 같은 업무구분의 유효한 연결을 최근 이력 순으로 1:1 유지하고, 남은 문서는 미연결 행으로 표시합니다.

`0003_flat_work_categories.sql`은 업무구분 ID와 이름, 기존 문서·이력·첨부파일·문서 연결을 유지하면서 하위분류를 독립된 업무구분으로 전환하고 표시 순서를 저장합니다. 이전에 서로 다른 상위분류에 같은 이름으로 등록된 업무구분도 각각 보존합니다.

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
