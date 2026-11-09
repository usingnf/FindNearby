# NearPath · 4단계 — 도보/대중교통/자동차 경로 계산

2026-11-04 · Stage 04 / 09 · React + TypeScript + Vite + FastAPI

**기존 3단계의 출발지 설정 및 편의점·역·공중화장실 검색을 유지하면서, 선택한 시설까지 3가지 이동수단의 경로를 계산하고 지도에 표시하는 기능을 추가했습니다.**

> API 키가 아직 없으면 개발용 **가상 경로 시뮬레이션**만 동작합니다. 가상 경로는 실제 보행로·차도·대중교통 노선을 사용하지 않으며, 경로 거리·시간도 실제 계산값이 아닙니다. 결과 화면에서 반드시 `가상 · 실측 아님`으로 표시합니다. 실제 이동 안내에 사용하면 안 됩니다.

## 제공 기능과 구현 범위

| 기능 | 4단계 내용 |
|---|---|
| 기본 지도·출발지 GPS/수동 선택 | 2단계 구현 유지 |
| 편의점·지하철역·공중화장실 후보 검색 | 3단계 구현 유지, 직선거리순 |
| 이동수단 선택 | 도보 / 대중교통 / 자동차 |
| 선택 시설까지의 실제 경로 요청 | API 키 및 Python 백엔드 실행 시 지원 |
| 공통 응답 정규화 | 거리(m), 시간(s), 구간, WGS84 경로 좌표 |
| 도보 | Kakao Maps `route_mode=SHORTEST` |
| 대중교통 | 반환 경로 중 예상시간 최단 경로 및 환승·요금·노선 정보 |
| 자동차 | Kakao Mobility `priority=TIME`, 상세 road vertexes, 통행료 |
| 지도 표시 | 실제 구간별 실선 / 가상 경로 점선 |
| 안전장치 | REST 키는 백엔드에만, 사용자가 버튼을 눌러 호출, 응답·좌표 검증, 요청 변경시 이전 결과 무효화 |
| 이후 단계 | 후보 전체 비교·이동수단별 추천 상위 3개 (5단계) |

### 4단계에서 **하지 않는 것**

- 후보 15개 모두의 실제 경로 자동 계산·최단시설 자동 추천 (5단계).
- 실제 대중교통 실시간 도착·시간표 보장, 차량 주차장 진입점 확정, 공중화장실 개방시간 보장.
- API 호출 성공률 및 실제 길 정확도 보장(실키 연동 후 검증 대상).

## Windows에서 설치 및 실행

**필요:** Windows 10/11, Node.js **22.16 이상**, Python **3.10 이상**, 인터넷 연결(최초 패키지 설치와 지도 타일 로딩).

1. ZIP 압축을 풉니다.
2. `START_WINDOWS.bat`을 더블클릭합니다. 최초 실행은 `npm install` 및 Python `.venv`에 FastAPI·Uvicorn·HTTPX를 설치합니다.
3. **별도 API 서버 콘솔**과 프론트엔드 콘솔이 실행됩니다. API 서버가 포트 8000에서, Vite가 5173에서 실행됩니다.
4. 웹브라우저에서 <http://localhost:5173>에 접속합니다.
5. 출발지를 지정한 다음 시설 유형을 선택하고 **주변 시설 검색**을 실행합니다.
6. 목록 또는 지도에서 **시설 후보 하나**를 선택한 후 `도보 / 대중교통 / 자동차`를 누르고 **경로 계산**을 누릅니다.
7. API 키가 없으면 지도 위에 **가상 점선 경로**, 가상 소요시간, 구간 정보가 표시됩니다.
8. 실행 종료 시 프론트엔드 및 API 서버 콘솔 **두 개 모두 닫아주세요**.

자동 시작이 실패하면 두 콘솔에서 별도 실행합니다.

```powershell
# 터미널 1 — 프로젝트 루트에서
python -m pip install -r server/requirements.txt
python -m uvicorn server.main:app --host 127.0.0.1 --port 8000

# 터미널 2 — 프로젝트 루트에서
npm install
npm run dev
```

API 서버 상태: <http://127.0.0.1:8000/api/status> — `restKeyConfigured` 값만 보여주며 키 원문은 반환하지 않습니다.

## 추후 카카오 API 키 연결

**두 종류의 키를 서로 다른 파일에 입력해야 합니다.** 키 파일은 `.gitignore`에 포함되어 있습니다.

1. 카카오 개발자 계정에서 지도 및 경로 API 활성화, 앱 사용 권한·무료/유료 쿼터를 확인합니다.
2. 프로젝트 루트의 `.env.example`을 복사해 `.env`를 만들고 JavaScript 키를 입력합니다.

   ```dotenv
   VITE_KAKAO_JS_KEY=발급받은_JavaScript_키
   ```

3. `server/.env.example`을 복사해 `server/.env`를 만들고 **REST API 키**를 입력합니다.

   ```dotenv
   KAKAO_REST_API_KEY=발급받은_REST_API_키
   ```

4. 두 콘솔을 재시작합니다. JavaScript SDK 연결 시 **실제 카카오 지도·장소 검색**, REST 키 확인 시 **실제 경로 요청**이 활성화됩니다.
5. **실제 시설 목록**을 선택하고 경로 계산 버튼을 눌러야 카카오 경로 API가 호출됩니다. 가상 시설을 대상으로는 키가 있어도 가상 경로로만 표시합니다.

**보안:** `KAKAO_REST_API_KEY`는 `VITE_`로 시작하는 변수 또는 React 소스에 입력하면 안 됩니다. `server/.env` 및 그 값을 입력한 터미널 화면, JSON 결과를 공개 저장소에 공유하지 마세요. Vite의 JavaScript 키는 SDK 특성상 브라우저에 노출되므로 카카오에서 허용 사이트를 설정하세요.

## 실제 API 연동 검증 (나중에 키 입력 후)

1. 키를 설정한 후 API 서버를 재시작합니다.
2. 별도 터미널에서 아래 명령을 실행합니다. **정확히 3개의 실제 API 경로 요청**을 수행할 수 있습니다(한도 소모 또는 과금 가능).

   ```powershell
   python server/live_smoke.py --live
   ```

3. 도보·대중교통·자동차 각각 `PASS`와 거리·시간·좌표 개수를 확인합니다. `stage4_live_result.json`에 키 없이 요약을 기록합니다.
4. API가 정상 응답하지 않으면 `FAIL` 원인을 조사합니다. API 요금, 앱 권한, IP 및 사용량 한도, 비정상 도착 좌표 등의 영향을 확인합니다.

테스트 구간은 공개 좌표인 판교 인근 → 강남 인근입니다. 경로 검증은 사용자 이동 기록이나 GPS를 저장하지 않습니다.

## 모듈·폴더 구성

```text
nearby-route-map-stage4/
├─ START_WINDOWS.bat / RUN_API_WINDOWS.bat / RUN_TESTS_WINDOWS.bat
├─ .env.example                 # 공개 JavaScript 키 입력 예시
├─ package.json / vite.config.ts
├─ src/
│  ├─ App.tsx                  # 4단계 이동수단, 경로 상세 및 상태 관리
│  ├─ routing.ts               # 공통 경로 형식, 가상 시뮬레이션, REST 연결
│  ├─ facilities.ts / location.ts / samplePlaces.ts
│  ├─ components/DemoMap.tsx   # OSM + 경로 폴리라인
│  ├─ components/KakaoMap.tsx  # 카카오 지도 + 경로 폴리라인
│  └─ services/                # 기존 카카오 SDK·시설 검색
├─ server/
│  ├─ .env.example             # 비공개 REST 키 입력 예시
│  ├─ main.py                  # 서버 API·요청량 보호·프록시
│  ├─ routing.py               # 실제 3가지 API 호출 규격/응답 변환
│  ├─ live_smoke.py            # 명시적으로 실행할 3 API 실호출 점검
│  ├─ requirements.txt
│  └─ tests/                   # 백엔드 단위/모의 네트워크 테스트
├─ tests/                      # 프론트 단위 테스트
└─ docs/STAGE4_VERIFICATION.md # 검증 결과
```

### 백엔드 API

- `GET /api/status`: REST 키 설정 상태(`true/false`)만 반환.
- `POST /api/route`: `{ "mode":"walk|transit|car", "origin":{"lat":37.5,"lng":127.0}, "destination":{"lat":37.6,"lng":127.1} }`.
- 결과: `mode,source, distanceMeters,durationSeconds, path:[{lat,lng}], segments:[{kind,distanceMeters,durationSeconds,instruction,vehicles,stops,path}], transfers,fareWon,tollWon,warnings`.
- 상태 오류: `400` 잘못된 입력, `422` 경로 없음, `429` 로컬/업스트림 제한, `502` 업스트림 오류·데이터 이상, `503` REST 키 없음, `504` 시간 초과.

**Vite 프록시:** 브라우저는 `/api/*`에만 요청하고, 개발 서버가 포트 8000에 요청을 넘깁니다. API 서버는 기본적으로 `127.0.0.1`에서만 실행되며 CORS를 개방하지 않습니다. 외부 공개 배포 전에는 실제 서버의 인증, 접근 제한, HTTPS, 비용 제한 및 로깅 정책이 추가로 필요합니다.

### 호출 비용 방지

- 유료/무료 쿼터 소모를 피하기 위해 자동 15개 후보 전체 호출을 하지 않습니다. **버튼 클릭 시 선택한 1개 시설의 1개 이동수단을 호출**합니다.
- 개발 서버 인스턴스당 분당 최대 12회·일일 기본 50회로 제한합니다. `NEARPATH_MAX_DAILY_REQUESTS` 환경변수로 일일 한도를 변경할 수 있으나, **프로세스 재시작 시 초기화되는 소프트 제한**이므로 운영·과금상 절대 상한은 아닙니다.
- REST 키가 없는 경우 서버는 실제 API 호출 자체를 거절합니다.
- 실제 API 오류는 가상 경로 결과로 자동 대체하지 않습니다.
- 브라우저 연결이 취소되더라도 이미 시작된 API 요청은 **사용량에 포함될 수 있습니다.**

## 테스트

```bash
npm test
python -m unittest discover -s server/tests -v
npm run typecheck
npm run build
```

검증 실행 결과는 [`docs/STAGE4_VERIFICATION.md`](docs/STAGE4_VERIFICATION.md)를 확인하세요. 이전 개발 실행 환경에서는 외부 npm 레지스트리의 DNS 접속이 실패하여 **전체 React 앱 빌드/브라우저 구동을 검증하지 못했습니다**. `.env`와 실제 API 키도 없는 상태이므로 실호출은 아직 미실시입니다. 사용 중인 PC에서 위 명령으로 최종 확인해주세요.

## 이용 정책 및 정확도 유의사항

- 공용 OSM 타일은 개발용이며 정식 서비스에서는 제공 정책을 준수하는 지도 타일/카카오맵으로 전환합니다.
- 카카오 지도·경로 API는 앱 권한 및 쿼터·과금 조건을 확인해야 합니다.
- 대중교통 구간에서 API가 제공하지 않는 도보 연계·환승 상세는 보장하지 않으며, 동시간대 교통수단이 항상 운영된다고 보장하지 않습니다.
- 자동차 API는 주차장/출입구 도착 좌표를 자동 보정하지 않습니다. 서비스 출시 전 별도 목적지 좌표 관리가 필요합니다.
- 시설 후보의 **직선거리순 정렬은 경로시간 최단 추천이 아니며**, 5단계에서 별도로 계산합니다.

## 공식 자료

- [카카오맵 경로 조회 REST API](https://developers.kakao.com/docs/ko/kakaomap/rest-api)
- [카카오모빌리티 자동차 길찾기 API](https://developers.kakaomobility.com/guide/navi-api/directions)
- [카카오 API 쿼터 및 요금](https://developers.kakao.com/docs/ko/getting-started/quota)
