# FindNearby 개발 실행

`Dev`는 FindNearby의 프런트엔드, API 서버, 테스트, 데이터 양식을 보관하는 개발 폴더다. 6단계 원본 소스와 ZIP이 현재 저장소에 없어 요구사항과 단계 기록을 바탕으로 이 기준본을 재구현했다. [요구사항 정의서](../Document/REQUIREMENTS_DEFINITION_SRS_v1.0.md), [후속 개발 계획](../Document/계획_FindNearby_기존검토및후속개발.md)

## 설치와 실행

검증에 사용한 버전은 Node.js 24.22.1, pnpm 11.25.0, Python 3.12.14다. 처음 설치할 때 공식 npm 및 PyPI 패키지 저장소 접속이 필요하다. 다음 명령은 Windows PowerShell에서 `Dev`를 연 상태로 실행한다.

```powershell
pnpm install --frozen-lockfile
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

첫 번째 터미널에서 API 서버를 시작한다.

```powershell
.\.venv\Scripts\python.exe -m uvicorn server.FindNearbyApi:app --host 127.0.0.1 --port 8000 --no-access-log
```

두 번째 터미널에서 웹을 시작한다.

```powershell
pnpm dev
```

[실행기](../FindNearbyLauncher.cmd)로 시작한 API 서버는 [API 종료 파일](../FindNearbyApiStop.cmd)을 실행해 종료할 수 있다. 종료 후 실행기를 다시 열면 설정을 다시 읽는다. 시작 시 적용된 일일·최근 60초 호출 한도는 API 로그의 `FindNearby REST daily limit` 항목에서 확인할 수 있다.

브라우저에서 [개발 화면](http://127.0.0.1:5173/)을 연다. 서울시청을 기본 출발지로 제공한다. 지도를 클릭하거나 우클릭하면 해당 지점이 출발지가 된다. 모바일에서는 지도를 탭한다. **현재 위치**, 좌표 직접 입력, 예시 장소 검색으로도 출발지를 바꿀 수 있다. **주변 시설 추천**을 누르면 최대 3곳의 거리와 예상 시간이 목록에 나오고, 지도에 순위별 색으로 경로가 함께 표시된다. 지도 범례의 색은 목록과 지도 핀의 순위 번호 색과 일치한다. 데모의 가상 경로는 점선으로 표시된다. 배경 타일을 받지 못해도 지도 조작과 가상 경로 확인은 가능하다.

모바일에서는 **목록 보기**와 **지도 보기**로 전환한다. 카드의 경로 상세에서 **선택 경로 지도에서 보기**를 누르고, 지도에서 **경로 상세 보기**로 돌아올 수 있다. 위치 권한을 사용할 수 없으면 주소 검색이나 좌표 직접 입력을 이용한다. 카카오 지도가 연결되지 않아도 실제 검색 서버가 연결된 상태에서는 주소 검색, 시설 추천, 텍스트 경로 상세를 이용할 수 있다. [모바일·키보드 검증 기록](../Document/검증_FindNearby_재개6모바일접근성.md)

## 실제 API 설정

`.env.example`을 같은 폴더의 `.env`로 복사한다. 카카오 앱에 등록한 JavaScript 키를 `VITE_KAKAO_JS_KEY`에, 서버용 키를 `KAKAO_REST_API_KEY`에 넣고 두 서버를 다시 시작한다. 자동차용 키가 별도라면 `KAKAO_MOBILITY_REST_API_KEY`에 설정한다. 실제 지도 사용에는 개발 주소 `http://127.0.0.1:5173`을 앱에 등록해야 한다. 주소 검색, 시설 검색, 경로 요청은 API 서버에서 처리한다. [환경변수 예시](.env.example), [카카오맵 JavaScript SDK 가이드](https://apis.map.kakao.com/web/guide/)

개발 서버에 연결한 카카오 앱의 기본 REST 호출 한도는 최근 60초 50회와 UTC 기준 일일 300회다. 일일 집계는 한국 시간 오전 9시에 갱신된다. 기본 장부는 `Dev/api-usage.sqlite3`이며 재시작 후에도 사용량이 유지된다. 같은 카카오 앱을 사용하는 서버는 `FIND_NEARBY_USAGE_DB`를 같은 SQLite 파일 경로로 설정한다. `api_calls`의 `operation`과 `attempted_at`을 기준으로 API별 시도 수를 집계할 수 있다.

`FIND_NEARBY_MINUTE_LIMIT`과 `FIND_NEARBY_DAILY_LIMIT`으로 서버 한도를 조정한다. 추천별 `FIND_NEARBY_SEARCH_CALLS`와 `FIND_NEARBY_SEARCH_SECONDS`의 기본값은 12회와 8초다. 자동차 추천은 상위 3곳의 상세 경로 조회에 사용할 수 있도록 서버 호출 한도에서 3건을 남겨 둔다. 실제 앱 권한과 제공자 쿼터는 재개 2단계 기록을 참고한다. [키 설정과 실연동](../Document/검증_FindNearby_재개2공개자료.md), [추천 탐색 검증](../Document/검증_FindNearby_재개4추천탐색.md)

## 공공시설 CSV 가져오기

화장실은 시설명, 도로명 또는 지번주소, 위도·경도를 사용한다. UTF-8과 CP949를 지원한다. `--review`를 사용하면 가져오지 않은 행의 번호와 이유를 확인할 수 있다. [화장실 CSV 양식](server/양식_FindNearby_화장실.csv), [접근점 CSV 양식](server/양식_FindNearby_접근점.csv)

```powershell
.\.venv\Scripts\python.exe -m server.FacilityImport --facilities "..\Resource\자료_공중화장실_인천미추홀구20260731.csv" --source-label "인천광역시 미추홀구 공중·개방화장실" --hold-facility public:2cb45b28638f017768976a05 --review
.\.venv\Scripts\python.exe -m server.FacilityImport --facilities "..\Resource\자료_공중화장실_인천서해구.csv" --source-label "인천광역시 서해구 공중화장실 자료" --hold-facility public:340597ecfbab6fae5db96d8d --review
.\.venv\Scripts\python.exe -m server.FacilityImport --access "..\Resource\자료_FindNearby_확인된인천역출입구.csv"
```

기본 저장소는 `Dev`의 `facilities.sqlite3`이다. `FIND_NEARBY_DB`로 위치를 지정할 수 있다. 개발 서버에서 [API 상태](http://127.0.0.1:5173/api/status)를 열어 건수를 확인한다.

같은 파일을 다시 가져오면 해당 키를 갱신한다. 시설명이나 주소를 수정할 때는 기존 `facility_id`를 지정해 접근점 연결을 유지한다. `--hold-facility`는 이번 파일에서 해당 ID를 건너뛴다. 기존 시설을 삭제하려면 `--delete-facility PUBLIC_ID`로 정확한 시설 ID를 지정한다. 이 작업은 같은 ID를 참조하는 접근점도 함께 삭제한다.

접근점의 `kind`는 `restroom`, `subway`, `convenience` 중 하나이고, `mode`는 `walk`, `transit`, `car` 중 하나이다. `source`와 `verified_on`(YYYY-MM-DD)을 기록한다. 시설 ID를 우선 사용한다. ID가 없으면 시설명과 주소(`facility_address`)를 함께 입력한다. 시설 대표점에서 350m 안에 있는 해당 이동수단 접근점을 선택한다. [실제 데이터 적용 범위와 검증 결과](../Document/검증_FindNearby_재개5시설데이터.md)

## 검증 명령

시험 배포본은 `Dev`에서 `.\.venv\Scripts\python.exe DeploymentPackage.py 0.1.0-stage8`로 만든다. 배포 버전을 바꾸면 `Build`에 별도 ZIP이 생성된다. [시험 배포 안내](../Build/안내_FindNearby_시험배포.md)

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "*Tests.py" -v
pnpm typecheck
pnpm build
```

빌드 결과는 개발 검증용 `Dev/dist`에 생성된다. 배포용 결과물은 9단계에서 `Build`에 정리한다.

## 파일명과 구성

- [화면 폴더](src/안내_FindNearby_화면.md)에 React 화면, 지도, 서버 응답 형식을 둔다.
- [서버 폴더](server/안내_FindNearby_서버.md)에 API, 카카오 연동, 추천 정책, SQLite 및 가져오기 코드를 둔다.
- [테스트 폴더](tests/안내_FindNearby_테스트.md)에 실행 경로와 모의 응답을 검증하는 테스트를 둔다.
- 클래스 및 React 컴포넌트는 클래스명·컴포넌트명을 파일명에 사용한다. 여러 응답 형식을 공유하는 모듈과 서버 진입점은 역할이 드러나는 이름을 사용한다. 패키지·프레임워크 지정 파일은 해당 도구가 찾는 파일명을 사용한다.

## 재개 1단계 검증 기록

2026년 11월 8일 기준이다.

| 확인 항목 | 결과 |
| --- | --- |
| 프런트엔드 의존성 설치 및 전체 타입 검사·빌드 | 통과. 잠금 파일 기준 Vite 7.3.7 |
| Python 의존성 및 서버 시작 | 통과. FastAPI 0.128.8, Uvicorn 0.40.0 |
| 자동 테스트 | 새 테스트 10건 통과. 세 시설과 세 이동수단의 데모 조합, 모의 경로 응답, 호출 한도, CSV 적재를 포함 |
| Edge 데모 사용 흐름 | 통과. 빌드 화면에서 추천 3개, 점선 경로, 결과 선택, 예시 주소, 지도 클릭, 이동수단 변경, 390px 너비를 확인. 배경 타일이 차단된 조건을 사용 |
| 실제 카카오 API 및 지도 SDK | 키와 앱 권한이 필요한 재개 2단계에서 검증 |
| 공중화장실 공식 원본과 현장 접근점 | 준비된 샘플로 가져오기를 검증했다. 실제 원본과 현장 위치는 재개 2·5단계에서 확인 |

기존 95건은 원본 단계 문서에 적힌 결과다. 이 기준본의 10건은 새로 구성한 검증이며, 두 테스트 목록의 항목별 비교는 원본 테스트 소스가 확보될 때 가능하다.

시설 DB에는 저장·재사용 권한이 있는 좌표가 포함된 CSV를 사용한다. 카카오 Local의 주소 변환 결과는 개별 조회에서 사용하며, 시설 DB에 쓸 좌표 보강은 공공 좌표 원본을 기준으로 검토한다.
