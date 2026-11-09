# FindNearby 시험 배포

이 폴더에는 프런트 정적 빌드와 FastAPI 서버, 초기 공공자료를 담은 버전별 시험 배포 ZIP을 둔다. ZIP을 풀면 `web`은 브라우저에 제공할 파일, `server`는 서버 실행 코드, `seed`는 시설 초기 적재용 자료다. 배포 목록에는 파일별 SHA-256을 기록한다.

## 로컬에서 실행

ZIP을 새 폴더에 풀고 Python 3.12 환경에서 아래 명령을 실행한다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item -LiteralPath .env.example -Destination .env
.\.venv\Scripts\python.exe -m server.DeploymentData seed
.\.venv\Scripts\python.exe -m uvicorn server.FindNearbyDeployment:create_deployment --factory --host 127.0.0.1 --port 5173 --workers 1 --no-access-log --no-proxy-headers
```

브라우저에서 [로컬 시험 화면](http://127.0.0.1:5173/)을 연다. 초기 적재 후 `/api/status`에는 공중화장실 91곳, 이동수단별 접근점 10건이 표시된다. 실연동하려면 서버의 `.env`에 `FIND_NEARBY_MAP_JS_KEY`와 `KAKAO_REST_API_KEY`를 넣는다. 자동차 키가 별도면 `KAKAO_MOBILITY_REST_API_KEY`도 설정한다. 지도 키는 실행 중 브라우저로 전달되며, 지도 키에 시험 주소를 등록해야 한다. [카카오 지도 도메인 등록 안내](https://apis.map.kakao.com/web/guide/)

## HTTPS 시험 주소에서 실행

시험 호스트에서 신뢰받는 인증서를 적용한다. 같은 호스트의 HTTPS 게이트웨이 뒤에 Uvicorn을 둘 경우 서버는 루프백 주소에 바인딩하고, 게이트웨이는 초대된 시험자만 접속할 수 있게 제한한다. 게이트웨이에서 전달받을 원본 IP 헤더를 재작성하고 Uvicorn에서 해당 프록시의 IP만 신뢰한다. 앱은 주소 검색·추천·경로 요청을 클라이언트 IP당 최근 60초 12회로 기본 제한한다. HTTP 요청 제한은 프로세스 단위이므로 시험 배포는 워커 1개로 실행한다. [Uvicorn 설정](https://github.com/encode/uvicorn/blob/master/docs/settings.md)

실제 HTTPS 주소를 카카오 지도 JavaScript SDK 도메인에 등록한 뒤 Safari, iOS와 Android에서 위치 권한 허용·거부와 경로 표시를 확인한다.

## 영속 저장과 복구

버전 폴더를 교체할 때 `FIND_NEARBY_DB`와 `FIND_NEARBY_USAGE_DB`를 버전 폴더 밖의 서로 다른 절대 경로로 지정한다. 환경설정과 인증서도 버전 폴더와 분리해 관리한다. 시설 갱신 후 초기 CSV를 다시 가져오면 기존 ID를 갱신한다.

```powershell
.\.venv\Scripts\python.exe -m server.DeploymentData backup C:\FindNearbyData\시설백업.sqlite3
# 서버 중지 후 시설 복원
.\.venv\Scripts\python.exe -m server.DeploymentData restore C:\FindNearbyData\시설백업.sqlite3
```

배포 교체 시 이전 ZIP을 별도 경로에 풀고 같은 환경설정과 영속 DB를 사용해 시작한다. 시설 복원과 버전 복귀에서는 사용량 장부를 이어서 사용한다. 사용량 장부를 잃어버리면 그 집계일의 실제 호출을 중단하고 사용량을 확인한 뒤 재개한다. SQLite 시설 복원 전에 현재 데이터의 별도 백업을 남긴다.

## 운영 확인

현재 개발 소스로 새로 패키징하면 서버에 연결한 카카오 앱의 기본 REST 한도는 최근 60초 50회, UTC 일일 300회다. 공개 시험 예산은 콘솔의 무료 잔여량과 공급자 설정을 확인한 뒤 환경변수로 지정한다. 웹 지도 SDK는 서버 REST 장부와 별도로 콘솔에서 확인한다. [카카오 쿼터](https://developers.kakao.com/docs/ko/getting-started/quota) · [카카오모빌리티 무료 제공량](https://developers.kakaomobility.com/price/)

요청 로그는 API 작업명, HTTP 상태, 처리 시간만 집계한다. Uvicorn 접근 로그를 끄고 게이트웨이에도 URL 쿼리와 요청 본문을 기록하지 않도록 설정한다. 사용자 입력 좌표는 요청과 현재 화면에서 사용한다. 운영 절차와 키 설정은 서버 운영자만 접근할 수 있게 한다.

시험 운영자는 검색 P95 10초, 반복되는 5xx와 429, 일일 상한 접근, 자료 기준일을 확인한다. 브라우저 표시 시간은 인수시험 기록으로, 서버 처리 시간과 오류율은 서버 로그로, 실제 REST 시도 수는 사용량 장부로 점검한다.

초기 자료는 인천 미추홀구·서해구 공중화장실과 확인된 인천 도시철도 출입구 표본이다. 갱신 시 원천의 기준일과 이용 조건을 확인하고, 누락·불일치 검토와 시설 백업을 거쳐 반영한다. [미추홀구 자료](https://www.data.go.kr/data/15071405/fileData.do) · [서해구 자료](https://www.data.go.kr/data/15090817/fileData.do) · [철도 출입구 자료](https://www.data.go.kr/data/15166820/fileData.do) · [철도 역사 자료](https://www.data.go.kr/data/15083751/fileData.do)
