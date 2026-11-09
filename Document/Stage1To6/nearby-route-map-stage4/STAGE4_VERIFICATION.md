# Stage 04 · 개발 및 검증 기록

작성일: 2026-11-04

## 범위

- 이전 2·3단계 기능 유지: GPS·주소 검색·지도 클릭 / 편의점·역·공중화장실 후보.
- 선택 시설에 대한 도보, 대중교통, 자동차 경로 계산 기능.
- 서버 전용 REST 키 보관, 공통 경로 응답 변환, 지도 폴리라인, 상세 정보 표시.
- API 키 없는 가상 경로 시뮬레이션: 반드시 `demo` / 실선 아닌 점선.

## 실제 실행한 테스트

| 유형 | 실행 명령 | 결과 |
|---|---|---|
| 프론트 단위 테스트 | `npm test` | **33 / 33 통과** (2~3단계 23개 + 신규 10개) |
| 백엔드 단위·모의 요청 | `python -m unittest discover -s server/tests -v` | **19 / 19 통과** |
| 핵심 TS 엄격 검사 | `tsc --noEmit --strict --module ESNext --target ES2022 --moduleResolution bundler --allowImportingTsExtensions src/routing.ts src/facilities.ts src/location.ts src/services/facilitySearch.ts src/services/kakaoSdk.ts` | **통과** |
| TS/TSX 구문 검사 | TypeScript AST 파서 전체 소스 | **12개 파일 오류 없음** |
| 실서버 호출 | REST API 키 부재 | **미실시** |
| 전체 React/Vite 빌드 | `npm install` | **npm 레지스트리 DNS 오류(EAI_AGAIN)로 미실시** |
| 실제 브라우저 렌더 | 전체 빌드 미완료 | **미실시** |

테스트에서 모의한 실제 API JSON 및 HTTP 응답은 **카카오 실호출 결과가 아닙니다**. API 파서 규격 검증은 실제 수신·성공·성능·지리적 정확도 보증이 아닙니다.

## 확인한 사항

- 요청 좌표는 브라우저 `{lat,lng}`에서 REST API X=경도/Y=위도 순으로 전달.
- 도보 API에 `route_mode=SHORTEST`, 자동차 API에 `priority=TIME`, `summary=false` 적용.
- 대중교통 경로 여러 개 중 최단시간을 선택하며 버스·지하철·도보 구간, 환승 수·요금을 반영.
- 자동차 `roads[].vertexes`의 1차원 X,Y 배열을 위도·경도 경로로 변환.
- API의 경로 없음·누락된 지오메트리·오류·비정상 좌표를 별도 오류로 처리.
- 실제 호출은 React 앱에서 REST 키를 사용하지 않고 로컬 FastAPI 서버를 통해 수행.
- 서버 키 미설정/연결 불가 및 가상 시설은 가상 경로로 처리하며 사용자에게 경고.
- 서비스 실행 시 임의의 후보 전체에 API를 호출하지 않음.
- 출발지/시설/이동수단 변경 시 이전 경로 응답은 화면에서 무효화.

## 사용자 PC 확인 체크리스트

- [ ] ZIP 해제 후 `START_WINDOWS.bat` 실행
- [ ] localhost:5173 웹 화면 정상 표시
- [ ] 도보·대중교통·자동차 버튼 정상 선택
- [ ] 가상 시설 선택 → 세 가지 모드의 **가상 점선** 경로 표시
- [ ] 출발지·시설·모드 변경 시 경로 결과 초기화
- [ ] 설치 후 `npm run build` 및 `npm run typecheck` 통과
- [ ] 2·3단계 GPS·주소·시설 기능 회귀 테스트
- [ ] 카카오 JS 키 설정 후 실제 장소·지도 동작
- [ ] REST 키 설정 후 `python server/live_smoke.py --live` → 3가지 모두 PASS
- [ ] 실제 대중교통 이용 불가 구간·주차장 없는 시설·출입구 오차 점검

## 아직 필요한 후속 개발

**5단계:** 10~15개 후보에 대한 API 호출 최적화, 이동수단별 경로 기반 순위/최적 시설 3개 자동 추천. `429` 한도 대비 배치, 캐시·재시도 전략 및 운영비 계산을 추가.

**6단계:** 화장실 공공데이터, 지하철역 출입구·차량 접근 지점 보정.

**8단계:** 실 API 연동 테스트, 경로 정확도 비교, 모바일 UI, 사용량·쿼터 실측 및 배포 품질 확인.
