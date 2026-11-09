# 테스트 폴더

키 없는 데모 API, 외부 API 모의 응답, 추천 순위, CSV와 SQLite의 기본 회귀 검증을 보관한다. Dev에서 `python -m unittest discover -s tests -p "*Tests.py" -v`로 실행한다.

## 재개 7-2 브라우저 인수시험

개발 서버를 실행하고 Playwright가 설치된 환경에서 `node tests/AcceptanceBrowserTests.cjs`를 실행한다. 기본 실행은 외부 요청을 차단하고 시험 데이터의 `active_origin_ids`로 선택한 15개 조합을 데모로 확인한다. `--touch O01-W O01-T O01-C`를 지정하면 세 조합을 모바일 터치 모사로 확인한다. 필요하면 `FIND_NEARBY_PLAYWRIGHT_PATH`에 Playwright 모듈 경로, `FIND_NEARBY_BROWSER_PATH`에 Chrome 또는 Edge 실행 파일 경로를 설정한다.

실연동은 공급자 무료 잔여량과 유료 설정, 로컬 사용량을 확인한 뒤 선택한 15개 범위에서 한 조합씩 실행한다. 예를 들어 `node tests/AcceptanceBrowserTests.cjs --live --free-quota-verified O02-T`를 사용한다. 기존 서버의 공용 사용량 장부에서 실행 전후 API별 시도 수를 대조한다. [인수시험 기록](../../Document/검증_FindNearby_재개7-2화면인수시험.md)

브라우저 시험은 조합마다 JSON 한 줄을 출력한다. `displayMs`는 검색 버튼 클릭부터 완료 상태가 화면에 반영되는 프레임까지의 시간이고, `recommendMs`는 추천 HTTP 응답 시간이다. 자동차 상세처럼 별도 요청이 있으면 `detailMs`도 기록한다. `live`와 `reason`으로 실제·데모와 검색 중단 사유를 나눠 집계한다.
