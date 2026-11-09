# FindNearby 요구사항과 검증 대응표

재개 3단계 기준으로 SRS의 기능 20개, 비기능 12개, 인수 조건 12개를 코드와 검증 방법에 연결했다. **실연동**은 재개 2단계에서 실제 응답이나 브라우저 동작을 확인한 범위, **기준본**은 기존 코드 또는 모의 테스트로 확인한 범위, **보완**은 다음 단계의 구현·검증이 필요한 범위다. [SRS](REQUIREMENTS_DEFINITION_SRS_v1.0.md), [실연동 검증](검증_FindNearby_재개2공개자료.md), [추천 및 응답 설계](설계_FindNearby_추천정책및응답형식.md)

구현 위치는 [화면](../Dev/src/App.tsx), [지도](../Dev/src/MapView.tsx), [화면 계약](../Dev/src/Contracts.ts), [서버 API](../Dev/server/FindNearbyApi.py), [서버 모델](../Dev/server/Models.py), [추천](../Dev/server/RecommendationService.py), [공급자](../Dev/server/KakaoProvider.py), [저장소](../Dev/server/FacilityStore.py), [CSV 가져오기](../Dev/server/FacilityImport.py), [자동 테스트](../Dev/tests/FindNearbyTests.py)를 기준으로 한다.

## 기능 요구사항

| ID | 구현 위치 | 확인 범위와 다음 검증 |
| --- | --- | --- |
| FR-01 | MapView | 실연동에서 카카오 지도 타일과 클릭 확인. 8단계에서 PC·모바일 이동·확대·축소 확인 |
| FR-02 | App | 기준본에 브라우저 위치 권한 요청. 7·8단계에서 HTTPS 또는 로컬 주소로 권한 허용·거부 시험 |
| FR-03 | App, MapView, FindNearbyApi, KakaoProvider | 실연동에서 주소 검색·선택과 지도 클릭으로 출발지 변경 확인 |
| FR-04 | App, RecommendationService, KakaoProvider | 기준본의 세 유형 선택과 데모 조합 통과. 실연동에서 편의점·역·화장실 응답 확인 |
| FR-05 | App, Models | 기준본에서 도보·대중교통·자동차 전환 및 도보 기본값 확인. AT-05에서 재평가 대조 |
| FR-06 | RecommendationService, KakaoProvider, FacilityStore | 기준본에서 모드별 초기 반경과 좌표 범위 적용. 4단계에서 경계 안팎의 후보를 고정 데이터로 비교 |
| FR-07 | RecommendationService | 시설 수 부족 시 확대하는 기준본. 4단계에서 경로 평가 뒤 유효 결과가 부족할 때 추가 탐색 검증 |
| FR-08 | RecommendationService, Models, FacilityImport | ID·이름·좌표 정제와 CSV 중복 처리 기준본. 4·5단계에서 출처가 다른 동일 시설과 비정상 행 시험 |
| FR-09 | KakaoProvider, FindNearbyApi, RecommendationService | 세 모드 단건 실제 경로와 자동차 다중 요약 실연동. 4단계에서 실패 후보와 추가 후보 평가 확인 |
| FR-10 | Models, RecommendationService | 기준본에 거리·시간과 동률 키 구현. 대중교통 도보거리 동률 테스트 통과. 4단계에서 세 모드 ID 동률까지 검증 |
| FR-11 | RecommendationService, App | 기준본과 자동차 실연동에서 최대 3개 확인. 4단계에서 경로 부족 시 보완 후 0~3개 반환 확인 |
| FR-12 | App, Contracts | 시설명·주소·거리·시간 표시 기준본, 자동차 화면 실연동. 7·8단계에서 세 시설 유형 및 주소 누락 표시 확인 |
| FR-13 | MapView, App | 실제 지도·출발지·편의점 마커·자동차 경로선 확인. 도보·대중교통 경로선은 8단계 브라우저 검증 |
| FR-14 | App, MapView | 1위 표시와 자동차 2위 선택 시 상세 경로 전환 실연동. 7·8단계에서 빠른 연속 선택·실패·재시도 검증 |
| FR-15 | KakaoProvider, Models, App | 실연동에서 도보·버스·지하철 구간과 환승 수신. 8단계에서 노선·정류장·요금의 화면 표시 확인 |
| FR-16 | KakaoProvider, FacilityStore | 실제 자동차 경로 응답 확인. 5단계에서 차량 접근점과 입구 위치, 8단계에서 접근 불가 사례 대조 |
| FR-17 | App, RecommendationService | 최초 검색 후 조건 변경 시 재요청하는 기준본. 4·7단계에서 동일 조건 재진입 및 최신 결과만 표시 검증 |
| FR-18 | KakaoProvider, FindNearbyApi, App | 경로 없음·응답 실패·제한 구분 기준본. 4단계에서 일부 실패 후 유효 결과 유지와 제한 사유 검증 |
| FR-19 | Models, App, MapView | 시설 출처·가상 모드·대표 좌표 안내 기준본. 4·7단계에서 경로 출처·시각·조회 범위와 제한 표시 확인 |
| FR-20 | KakaoProvider, FindNearbyApi | 프로세스 단위 호출 제한 모의 테스트 통과. 4·8·9단계에서 지속 집계·한도·운영 지표 확인 |

## 비기능 요구사항

| ID | 구현 위치 | 확인 범위와 다음 검증 |
| --- | --- | --- |
| NFR-01 | App, MapView | Edge에서 실연동 확인. 8단계 Chrome·Safari·모바일 브라우저 확인 |
| NFR-02 | App, 화면 CSS | 390px 데모 화면 기준본 확인. 7·8단계에서 실제 지도와 검색 결과를 PC·스마트폰에서 확인 |
| NFR-03 | RecommendationService, KakaoProvider | P95 10초 목표 미측정. 4단계에서 시간 예산 적용, 8단계에서 대표 검색 전체 응답 시간 측정 |
| NFR-04 | RecommendationService, Models, FacilityImport | 거리·시간 정렬과 재적재 중복 회귀 테스트 통과. 4·5·8단계에서 실자료와 동률·교차 출처 중복 검증 |
| NFR-05 | RecommendationService, KakaoProvider, App | 기준본의 후보별 경로 오류 처리. 4단계에서 검색 공급자·다중 목적지 오류 시 부분 결과 유지 검증 |
| NFR-06 | FindNearbyApi, KakaoProvider, Vite 설정 | 실연동에서 키 파일 HTTP 403 및 브라우저 코드에 REST 키 없음 확인. 9단계에서 배포 산출물·로그 재검사 |
| NFR-07 | App, FindNearbyApi, FacilityStore | GPS를 화면 상태와 요청에 사용하는 기준본. 8·9단계에서 서버·브라우저 저장소와 로그에 정확한 GPS 위치가 남는지 점검 |
| NFR-08 | Models, RecommendationService, KakaoProvider | 시설 유형·경로 호출 분리 기준본. 4단계에서 추천 정책과 공급자 세부 규격의 의존성 확인 |
| NFR-09 | MapView, RecommendationService, KakaoProvider, FacilityStore | 지도·추천·공급자·저장소 책임 분리 확인. 4단계 변경 시 책임 경계와 기존 테스트 유지 |
| NFR-10 | KakaoProvider, FindNearbyApi | 호출 제한 상태 기준본. 4·9단계에서 API별 시도 수·응답 시간·오류율 지표와 로그 집계 확인 |
| NFR-11 | App, MapView, 화면 CSS | 기본 버튼 레이블과 초점 스타일 기준본. 7단계에서 키보드로 검색·선택, 상태 안내, 대비 검증 |
| NFR-12 | KakaoProvider, FindNearbyApi | 분당·일일 소프트 제한 기준본. 4·8·9단계에서 재시작·동시 호출·한도 차감·실제 앱 과금 설정 검증 |

## 인수 조건

| ID | 확인할 동작 | 확보한 근거와 남은 시험 |
| --- | --- | --- |
| AT-01 | 주소 검색과 지도 클릭으로 출발지 설정 | 실연동에서 두 경로 확인 |
| AT-02 | 위치 권한 없이도 사용 | 수동 입력 경로 확인. 7·8단계에서 권한 거부 후 검색 완료 확인 |
| AT-03 | 편의점·역·화장실 실제 검색 | 실제 세 유형 첫 페이지 응답 확인. 8단계에서 세 유형 모두 화면까지 확인 |
| AT-04 | 세 이동수단의 경로 조회 | 세 단건 경로 API 실연동 확인. 자동차는 다중 목적지도 확인 |
| AT-05 | 이동수단 변경 시 추천 순위 재계산 | 모드별 데모 정렬 확인. 4·8단계에서 같은 시설 집합에 서로 다른 순위가 나오는 입력으로 대조 |
| AT-06 | 유효 결과가 충분할 때 최대 3개 표시 | 데모 및 실제 자동차 추천 3개 확인. 4단계에서 유효 후보 부족과 이후 탐색 검증 |
| AT-07 | 추천마다 거리와 예상 시간 표시 | 자동차 추천 카드와 상세 실연동 확인. 8단계에서 모든 모드·유형 대조 |
| AT-08 | 실제 경로 좌표를 지도에 표시 | 자동차 경로선과 선택 전환 확인. 8단계에서 도보와 대중교통 확인 |
| AT-09 | 대중교통 환승·노선 표시 | 실제 환승·구간 응답 확인. 8단계에서 노선과 정류장까지 화면 대조 |
| AT-10 | 시설 부족·경로 없음 안전 처리 | 파서 모의 테스트 통과. 4·8단계에서 0~2개, 일부 실패, 제한과 경로 없음 표시 구분 |
| AT-11 | PC·모바일 지도 및 검색 UI | Edge PC 실연동, 좁은 화면 데모 확인. 8단계에서 실제 모바일 브라우저 확인 |
| AT-12 | 키 보호와 호출 제한 | 실연동 키 보호와 모의 호출 제한 확인. 4·8단계에서 재시작·동시 요청 한도, 9단계에서 운영 적용 확인 |

8단계 인수에서는 SRS의 최소 30개 출발지와 세 이동수단 조합을 사용한다. 이 표의 실연동 항목은 해당 사례의 결과이며, 지원 지역 전체와 실제 시설 접근성을 함께 판정할 때는 인수 시험의 표본을 사용한다.
