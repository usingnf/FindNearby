# 1단계 기술 검증 보고서 — 대한민국 도보·대중교통·자동차 경로 API

- **기준일:** 2026-11-04
- **대상 시스템:** 대한민국 위치 기반 주변 시설 탐색 및 경로 안내 서비스
- **목표:** 경로 엔드포인트·인증·요청/응답 구조·오류·쿼터·후속 기술 리스크 검증
- **결과 해석:** `문서 검증`과 `모의 응답 기반 단위 테스트`를 실제 API 호출 성공과 구분한다.

## 1. 총괄 판정

| 검증 항목 | 도보 | 대중교통 | 자동차 |
| --- | --- | --- | --- |
| 공식 API 제공 확인 | 통과 | 통과 | 통과 |
| 엔드포인트/GET/인증 형식 확인 | 통과 | 통과 | 통과 |
| 필요 데이터(거리·시간·경로 좌표) 제공 근거 | 확인 | 확인 | 확인 |
| 모의 응답 파싱 검증 | 통과 | 통과 | 통과 |
| 실제 인증키를 사용한 호출 | **미실시** | **미실시** | **미실시** |
| 성능·실지역 정확도 검증 | 미실시 | 미실시 | 미실시 |

**판정:** API 조합은 초기 설계 후보로 **채택 가능**. 실제 통합 연동은 아직 통과 판정할 수 없다. REST API 키 및 앱 설정 후 실호출 3건을 진행해야 한다.

## 2. 각 API 공식 스펙

### 2.1 도보

- 엔드포인트: `GET https://dapi.kakao.com/v2/routing/walk`
- 인증: `Authorization: KakaoAK <REST_API_KEY>`
- 필수 인수: `start_x`, `start_y`, `end_x`, `end_y`; X는 경도, Y는 위도
- 권장 설정: `input_coord=WGS84`, `output_coord=WGS84`, `route_mode=SHORTEST`
- 정상 응답: `status=OK`, `route.properties.totalDistance`(m), `route.properties.totalTime`(s)
- 경로 좌표: `route.legs[].steps[].path.points` (`[[경도, 위도], ...]`)
- 특징: 기본 탐색 옵션은 `BROAD_FIRST`(넓은 길 우선)이므로 최단거리 요구사항에는 `SHORTEST`를 명시해야 한다.
- 주요 실패 상태: `SAME_POINT`, `START_LINK_NOT_FOUND`, `END_LINK_NOT_FOUND`, `TOO_MANY_SEARCH_LINK`, `TOO_FAR_AWAY`, `ROUTE_RESULT_NOT_FOUND`
- 출처: https://developers.kakao.com/docs/ko/kakaomap/rest-api

### 2.2 대중교통

- 엔드포인트: `GET https://dapi.kakao.com/v2/routing/publictraffic`
- 인증 및 필수 인수는 도보와 동일하며, `route_mode`는 공식 요청 인수에 없다.
- 정상 응답: `status=OK`, `routes[]`(복수 경로), `routes[].properties.totalDistance`, `.totalTime`, `.transfers`, `.fare`
- 구간 정보: `routes[].steps[].properties.type` (`BUS` / `SUBWAY` / `WALKING`), `stops[]`, `vehicles[]`
- 경로 좌표: `routes[].steps[].path.points`
- 추천 로직: 반환된 경로에서 `(totalTime, transfers, totalDistance)` 순으로 최선의 경로를 선택한다.
- 주요 실패 상태: `STARTNODES_NULL`, `ENDNODES_NULL`, `EQUAL_POINTS`, `INVALID_REQUEST`, `NO_RESULTS`
- **제약:** 현행 문서에는 출발 시각을 지정하는 요청 인수가 없다. 시각 지정/실시간 도착 보장 기능은 MVP 범위에서 제외하는 것이 타당하다.
- 출처: https://developers.kakao.com/docs/ko/kakaomap/rest-api

### 2.3 자동차

- 엔드포인트: `GET https://apis-navi.kakaomobility.com/v1/directions`
- 인증: `Authorization: KakaoAK <REST_API_KEY>`
- 필수 인수: `origin=경도,위도`, `destination=경도,위도`
- 권장 설정: `priority=TIME`, `summary=false`, `alternatives=false`
- 정상 응답: `routes[].result_code=0`, `routes[].summary.distance`(m), `.duration`(s)
- 경로 좌표: `routes[].sections[].roads[].vertexes` = `[경도,위도,경도,위도,...]` 교차 배열
- 부가 정보: 통행료 `routes[].summary.fare.toll` 등
- 주요 주의점: **HTTP 200이더라도 `result_code != 0`이면 길찾기 실패**일 수 있다.
- 출처: https://developers.kakaomobility.com/guide/navi-api/directions

## 3. 공식 쿼터와 비용

| 기능 | 문서상 무료 일일 쿼터 | 쿼터 초과 단가 |
| --- | ---: | ---: |
| 카카오맵 도보 경로 | 1,000건 | 10원/건 |
| 카카오맵 대중교통 경로 | 1,000건 | 10원/건 |
| 카카오모빌리티 자동차 경로 | 10,000건 | 8원/건* |
| 카카오모빌리티 다중 목적지 | 1,000건 | 20원/건* |

\* 카카오모빌리티 공개 가격표에 명시된 사용량 구간 기준. 실제 앱의 계약/과금 권한 확인 필요.

- 카카오맵 무료 쿼터는 **개발자 계정에서 첫 번째로 카카오맵 API를 활성화한 앱**에만 적용한다. 2번째 앱부터는 유료 API 설정이 필요할 수 있다.
- 쿼터가 부족하다고 자동으로 무료 제공량이 늘어나지 않는다. 무료/유료 설정과 중단 동작을 구분해야 한다.
- 유료 사용을 허용하지 않으면 자동 요금 발생을 피하는 대신 서비스가 호출 제한으로 중단될 수 있다.
- 공식 출처:
  - https://developers.kakao.com/docs/ko/getting-started/quota
  - https://developers.kakao.com/docs/ko/kakaomap/common
  - https://developers.kakaomobility.com/price/

### 3.1 호출량 예시

시설 후보가 10개이고, **한 검색에서 선택한 이동수단의 모든 후보를 평가**한다고 가정한다.

- 도보 검색 1회: 도보 경로 10회 호출
- 대중교통 검색 1회: 대중교통 경로 10회 호출
- 자동차 검색 1회: 자동차 경로 10회 호출
- 이 경우 도보/대중교통은 각각 해당 API의 무료 쿼터만 기준으로 보면 하루 약 100회 사용자 검색을 처리할 수 있다. 실제 사용 가능량은 다른 API 사용/계정 설정에 따라 달라질 수 있다.

자동차에서는 더 나은 방식이 있다.

1. `POST /v1/destinations/directions`로 최대 30개 시설의 차량 거리·시간을 한 번에 계산한다.
2. 최상위 3개를 선정한다.
3. 최상위 3개의 상세 경로 좌표만 `GET /v1/directions`로 추가 수신한다.
4. 단, 다중 목적지 API는 **요약 정보만 제공**하며 길찾기 반경 상한이 10km이므로 전국형 서비스의 모든 케이스에 직접 적용할 수는 없다.

- 출처: https://developers.kakaomobility.com/guide/navi-api/destinations

## 4. 검증 환경과 수행 내역

- 실행 환경: Python 표준 라이브러리를 사용한 로컬 오프라인 실행
- 외부 API 키: 제공되지 않음 (`KAKAO_REST_API_KEY` 환경변수 미설정)
- 실제 외부 API 호출: **0회**
- 단위 테스트: **9건 성공 / 0건 실패**
- 검증 코드: `route_api_validate.py`
- 단위 테스트: `tests/test_response_parsers.py`
- 실호출 결과 증빙: `validation_result.json` (모든 모드가 `NOT_RUN`, 실제 연결 데이터 아님)

### 4.1 자동화한 확인 항목

| ID | 검증 항목 | 실행 결과 |
| --- | --- | --- |
| UT-01 | 도보 정상 응답 파싱 | 통과 |
| UT-02 | 도보 경로 없음 처리 | 통과 |
| UT-03 | 대중교통 복수 경로 중 최단시간 선정 | 통과 |
| UT-04 | 대중교통 결과 없음 처리 | 통과 |
| UT-05 | 자동차 상세 경로 좌표 파싱 | 통과 |
| UT-06 | 자동차 HTTP 200 내부 오류 감지 | 통과 |
| UT-07 | 자동차 상세 경로 좌표 누락 감지 | 통과 |
| UT-08 | 경위도 순서가 뒤바뀐 좌표 감지 | 통과 |
| UT-09 | 엔드포인트 및 최단 경로 옵션 설정 검사 | 통과 |

**주의:** 테스트용 응답은 공식 문서 구조를 따른 모의 JSON이다. 실제 운영 API의 성공률이나 속도를 증명하지 않는다.

## 5. 실호출 테스트 시나리오 및 통과 기준

기준 출발/도착은 공식 문서에 등장하는 판교역 부근 → 성남시청 부근 좌표를 사용한다.

| ID | 이동수단 | 실제 통과 기준 |
| --- | --- | --- |
| LT-01 | 도보 | HTTP 200, `status=OK`, 거리/시간 양수, 경로 좌표 2개 이상 |
| LT-02 | 대중교통 | HTTP 200, `status=OK`, 1개 이상 경로, 거리/시간 양수, 경로 좌표 2개 이상 |
| LT-03 | 자동차 | HTTP 200, `result_code=0`, 거리/시간 양수, 경로 좌표 2개 이상 |

후속 품질 테스트로 서울/수도권 1개, 지방 대도시 1개, 교통 취약 지역 1개 이상을 각각 조사하되, **경로가 제공되지 않는 정상 상황**과 API 연동 실패를 구분한다. 목적지가 지하철역·화장실이면 실제 출입구/차량 접근점에 대한 보정이 필요하다.

## 6. 검증 결과에 따른 설계 조정

- **도보:** `SHORTEST` 옵션을 강제한다. 최단 직선거리가 아닌 API 경로거리를 추천의 1차 기준으로 사용한다.
- **대중교통:** `routes[]` 중 최단 소요시간 경로 선택. 출발시각·도착예정시간 보장은 하지 않는다.
- **자동차:** `TIME` 옵션 적용. 초기에는 단일 목적지 API로 구현하고, 후보 수가 늘면 다중 목적지 API 도입을 검토한다.
- **좌표:** 모든 지도 좌표를 `[경도, 위도]`로 내부 통일하며 자동차의 평탄화된 좌표 배열은 2개씩 묶어 변환한다.
- **오류:** HTTP 상태 외에 JSON 내부의 `status` 또는 `result_code`를 검사한다.
- **보안:** REST API 키는 서버 환경변수에만 두고 웹 클라이언트 코드와 Git 저장소에 두지 않는다.
- **성능:** 목표 P95 10초 이내 충족 여부는 API 실호출과 검색 후보 수를 반영한 측정 후 판단한다.

## 7. 미해결 리스크 및 결정

| 위험 | 영향 | 후속 조치 |
| --- | --- | --- |
| 사용자의 앱/API 키 부재 | 실호출 불가 | 앱 생성 및 카카오맵 사용 설정 후 3개 요청 테스트 |
| 사업자 계정/유료 기능 권한 | 무료 쿼터 적용 여부 변화 | 관리 콘솔에서 앱별 권한·무료 적용 뱃지 확인 |
| 도보·대중교통 1,000건/일 | 후보 10개 탐색 시 약 100회/일 | 후보 단축·캐시·호출 예산 관리 |
| 대중교통 출발시각 미지정 | 특정 시각 경로 비교 불가 | MVP에서 시간 조건 기능 제외 유지 |
| 차량 도착점이 시설 입구와 다름 | 부정확한 최종 안내 | 출입구·차량 접근점 보정 검증 |
| 짧은 거리의 대중교통 경로 없음 | 추천 후보 부족 | `NO_RESULTS` 허용 및 도보 전환 UI 제공 |
| 자동차 다중 목적지 API 10km 반경 | 자동차 후보 확장 제한 | 범위 밖 후보는 단일 목적지 API로 폴백 |
| 지도/경로 데이터 라이선스 | 저장/재배포 위험 | 서비스 이용 조건 확인, 데이터 최소 저장 |

## 8. 최종 결론

**1단계 문서 적합성 검증 및 자체 응답 파서 단위 테스트는 완료했다.**
다만 *실제 API 연결·응답·성능·지리적 정확성* 검증은 인증키가 없는 이유로 미실시되었다.

**판정: 조건부 채택.** `LT-01`~`LT-03`이 모두 통과하면 2단계 기본 지도 및 출발지 지정 구현으로 진행한다. 일부가 실패하면 API 권한·응답 스키마를 수정하거나 대체 제공자를 평가한다.
