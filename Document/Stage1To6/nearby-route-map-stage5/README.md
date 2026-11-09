# NearPath — 5단계: 이동수단별 최적 시설 최대 3곳 추천

**프로젝트 버전:** 0.5.0  
**작성:** 2026-11-04  
**기술 구성:** React 18 + TypeScript + Vite / Python FastAPI / 카카오 지도·로컬·경로 API

기존 2~4단계 기능(지도·출발지 선택·편의점/역/공중화장실 검색·3가지 경로 계산)을 유지하면서, **주변 시설 후보들을 실제 경로거리/소요시간 기준으로 평가하여 상위 3개를 표시**하도록 확장한 전체 프로젝트입니다.

> REST API 키가 없는 상태에서는 **가상 거리와 가상 시간이 사용되는 데모 추천**만 수행합니다. 데모는 현실의 보행로, 차량 통행, 버스·철도 운행, 교통상황을 반영하지 않습니다. 지도 화면과 추천 UI에서 `가상 추천 · 실측 아님`을 표시하며 실제 이동 안내로 사용해서는 안 됩니다.

## 1. 5단계 추가 기능

| 기능 | 구현 내용 |
|---|---|
| 이동수단별 비교 | 도보: 총 보행거리 오름차순 / 대중교통: 예상 총시간 오름차순 / 자동차: 예상 주행시간 오름차순 |
| 순위 동률 | 도보: 시간→시설 ID / 대중교통: 환승 횟수→거리→ID / 자동차: 거리→ID |
| 추천 결과 | 유효한 경로가 있는 시설 최대 3곳 / 거리·시간·환승 요약 표시 |
| 후보 비교 범위 | 직선거리 후보 상위 3 / 6 / 10개 중 선택(기본 10개) |
| 실제 도보·대중교통 | 비교 대상마다 카카오 경로 API 1회(캐시 적중 시 재호출 없이 재사용), 동시 2개 제한 |
| 실제 자동차 | 카카오모빌리티 다중 목적지 요약 API 1회 + 1위 상세 경로 최대 1회 |
| 지도 | 추천 1~3위 마커와 선택한 경로 표시; 비교 대상 밖 후보는 회색 표시 |
| 상세 조회 | 2·3위 자동차는 개별 경로 버튼으로 경로 좌표 조회 가능(별도 호출) |
| 경로 없음 | 실패 시설과 오류 원인 별도 안내 / 유효한 나머지 추천 유지 |
| API 비용 관리 | 명시적 버튼 요청, 신규 호출 수 사전 안내, 단기 3분 캐시, 기존 분당·일일 호출 제한 유지 |
| 개인정보 | 검색·GPS 위치를 영구 보관하지 않음(메모리 캐시만 3분 보관) |

**최적화의 범위:** ‘전국 전체 시설 중 절대적인 최단 3개’가 아닙니다. 3단계의 검색 결과 가운데 사용자가 선택한 직선거리 상위 3/6/10개를 대상으로 계산한 순위입니다. 검색 데이터의 누락, 이동수단의 출입구/주차장 도착점, 호출 제한 및 외부 API 품질에 따라 실제 최적 선택과 다를 수 있습니다.

## 2. Windows에서 시작하기

1. ZIP 압축을 풉니다.
2. Node.js **22.16 이상**, Python **3.10 이상**을 설치합니다.
3. `START_WINDOWS.bat`을 더블클릭합니다. 처음 실행 시 `npm install`, Python venv 생성, FastAPI/httpx 설치가 진행됩니다. 인터넷이 필요합니다.
4. 두 콘솔 창(API 서버와 웹 서버)이 실행됩니다.
5. 브라우저에서 **http://localhost:5173**으로 접속합니다.
6. 출발지를 지정 → 시설 유형(편의점/지하철역/공중화장실) 선택 → **주변 시설 검색**.
7. 도보/대중교통/자동차 선택 → 비교 후보 수 선택 → **기준 3곳 추천** 버튼.
8. 추천 1~3위를 클릭하면 마커가 선택되며, 해당 시설의 경로 좌표가 있는 경우 지도에 표시됩니다.
9. 필요하면 **개별 경로 확인** 버튼을 사용합니다(실 API 모드에서는 추가 API 호출이 될 수 있음).

실행이 안 되면 프로젝트 루트에서 터미널 두 개를 띄워 직접 실행합니다.

```powershell
# 터미널 1: 백엔드
python -m pip install -r server/requirements.txt
python -m uvicorn server.main:app --host 127.0.0.1 --port 8000

# 터미널 2: 프론트엔드
npm install
npm run dev
```

상태 조회: `http://127.0.0.1:8000/api/status` (설정 유무만 알리며 API 키를 반환하지 않음).

## 3. API 키는 나중에 추가 가능

- `.env.example` → `.env` 복사 후 카카오 **JavaScript 키** 입력:
  `VITE_KAKAO_JS_KEY=...`
- `server/.env.example` → `server/.env` 복사 후 카카오 **REST API 키** 입력:
  `KAKAO_REST_API_KEY=...`
- 두 서버를 재시작하고 카카오 JavaScript SDK의 사이트 도메인 허용, 카카오맵 활성화, 도보·대중교통·자동차·다중 목적지 길찾기 API의 권한과 과금 설정을 확인합니다.

**주의:** REST 키는 React 소스·`VITE_*` 변수·공개 저장소에 입력하지 않습니다. 서버의 `.env`는 `.gitignore`로 제외되어 있습니다. 사용자의 키를 이 채팅에 전달하지 않아도 됩니다.

**실 API 구동 조건:** 카카오맵 시설 검색으로 수집한 실제 시설 + REST 키가 설정된 백엔드가 준비되어야 합니다. 실 API 오류가 나면 가상의 ‘성공’ 경로로 대체하지 않습니다. 카카오 지도가 있어도 REST 키가 없다면 추천은 가상 데이터로 처리됨을 명시합니다.

## 4. API와 시스템 설계

`POST /api/recommend` (같은 출처 프록시 `/api`)는 사용자 지정 이동수단과 최대 10개 후보를 입력받습니다.

```json
{
  "mode": "walk",
  "origin": {"lat": 37.566295, "lng": 126.977945},
  "candidates": [
    {"id": "facility-1", "coords": {"lat": 37.575, "lng": 126.987}},
    {"id": "facility-2", "coords": {"lat": 37.578, "lng": 126.989}}
  ]
}
```

성공 응답 구조 (값은 형식 예시이며 실측 결과가 아닙니다):

```json
{
  "mode": "walk",
  "source": "live",
  "strategy": "individual",
  "comparedCount": 2,
  "successfulCount": 1,
  "ranked": [
    {
      "facilityId": "facility-1", "distanceMeters": 800, "durationSeconds": 600,
      "transfers": null, "fareWon": null, "tollWon": null,
      "route": {
        "mode": "walk", "source": "live", "distanceMeters": 800, "durationSeconds": 600,
        "segments": [{
          "kind": "walk", "distanceMeters": 800, "durationSeconds": 600,
          "instruction": "예시 안내", "vehicles": [], "stops": [],
          "path": [{"lat": 37.566295, "lng": 126.977945}, {"lat": 37.575, "lng": 126.987}]
        }],
        "path": [{"lat": 37.566295, "lng": 126.977945}, {"lat": 37.575, "lng": 126.987}],
        "transfers": null, "fareWon": null, "tollWon": null, "warnings": []
      }
    }
  ],
  "failures": [{"facilityId": "facility-2", "code": "NO_ROUTE", "message": "경로를 찾지 못했습니다."}],
  "cacheHits": 0,
  "upstreamAttemptLimit": 2,
  "warnings": ["추천 순위는 비교한 후보에 한정됩니다."]
}
```

위 구조는 **필드 예시**입니다. 실제 성공 응답의 `route.path`는 도로·보행로 경로 좌표를 포함해야 합니다. 예시의 좌표는 구조 설명용이며 실제 800m 도보 경로를 나타내지 않습니다.

서버에서는 내부 보안과 API 비용을 위해 다음을 적용합니다.

- 후보 `id` 길이·중복·개수, 좌표 유효성 및 지원 국가 인근 범위 검사.
- 카카오 REST 키는 서버 환경에서만 관리하며 요청 본문/응답/오류에 포함시키지 않음.
- 도보·대중교통 경로는 2개 동시 요청, 결과는 경로 거리/시간 기준 정렬.
- 자동차는 `POST https://apis-navi.kakaomobility.com/v1/destinations/directions`로 한꺼번에 비교. 다중 목적지는 **요약만 반환**하므로 1위 상세선은 기존 `GET /v1/directions` 한 번을 추가하여 얻음.
- 비정상/경로 없는 후보를 오류 목록으로 분리하고 나머지 후보를 유지.
- 프로세스당 기본 **분당 12회 / 일일 50회** 소프트 한도(`NEARPATH_MAX_DAILY_REQUESTS`로 일일 한도 조정 가능). 서버 재시작으로 초기화되고, 실제 카카오 청구 상한을 보장하지 않음.
- 성공 결과는 3분간 **메모리** 캐시에 저장, 최대 256개 엔트리. 자동차의 다중 목적지 캐시도 별도 키로 관리하며, 시설 ID와 좌표·순서를 구분. 프로세스 재시작 시 사라짐.

### 차량 순위와 상세 경로 정보 차이

자동차 다중 목적지 API에서 받은 요약 소요시간이 기본 순위입니다. 1위 상세 경로 조회에서 시간이 약간 다르게 나와도 순위를 은밀히 바꾸지 않습니다. 결과 화면에 이 제한을 알려주며 2·3위 경로는 선택 후 개별 조회 버튼을 누르면 표시됩니다.

### 도보 및 대중교통의 호출량

상위 10개를 선택하면 **최대 10개 신규 호출**이 생길 수 있습니다. 비교 전 3개 또는 6개로 줄일 수 있으며, 동일한 좌표·이동수단을 다시 비교할 때 캐시가 유효하면 사용량을 절약합니다. 단, 캐시는 카카오의 무료 쿼터·운영 약관을 대체하지 않습니다.

## 5. 주요 프로젝트 파일

```text
nearby-route-map-stage5/
├── START_WINDOWS.bat, RUN_TESTS_WINDOWS.bat, RUN_API_WINDOWS.bat
├── src/
│   ├── App.tsx                 # 추천 버튼, 순위 카드, 모드별 상태 관리
│   ├── recommendations.ts     # 추천 비교/정렬/데모/실 API 응답 검증
│   ├── routing.ts             # 기존 도보/대중교통/자동차 경로 모델
│   ├── facilities.ts          # 기존 주변 시설 검색 모델
│   └── components/            # 1~3위 추천 마커, 선택 경로 그리기
├── server/
│   ├── main.py                # /api/recommend, REST 키 보호, 호출량 관리/캐시
│   ├── recommendation.py      # 순위 결정, 자동차 다중 목적지 규격/응답 파서
│   ├── routing.py             # 기존 경로 API 호출 규격/좌표 파싱
│   ├── tests/
│   └── .env.example
├── tests/recommendations.test.mjs
└── docs/STAGE5_VERIFICATION.md
```

## 6. 테스트

```powershell
npm test
python -m unittest discover -s server/tests -v
npm run typecheck
npm run build
```

검증 결과 및 **검증하지 못한 항목**은 `docs/STAGE5_VERIFICATION.md` 참고. 개발 환경에서 npm 레지스트리 DNS 접속 오류(`EAI_AGAIN`)가 발생해 전체 웹 빌드 및 실제 브라우저 구동은 수행하지 못했습니다. React 타입을 제외한 핵심 TypeScript 엄격 검사와 TS/TSX 소스 파싱 및 자동 테스트는 실행했습니다.

실제 REST API 3종 및 자동차 다중 목적지 API의 **실호출은 아직 진행하지 않았습니다**. 키 연결 후 기존 `python server/live_smoke.py --live` 및 웹 추천 버튼으로 실제 경로를 검증해야 합니다. 자동차 다중 목적지 API의 접근 권한·과금은 개별 길찾기 API와 별도로 확인하십시오.

## 7. 향후 단계

- **6단계:** 공중화장실 공공데이터 정합성, 장소 데이터 보강, 시설별 도착점 보정.
- **7단계:** 모바일 추천 카드와 환승 상세 UX 고도화.
- **8단계:** API 실제 응답/서울·지방·농어촌·우회 상황별 정확도/성능/비용 측정.
- **9단계:** HTTPS, 인증·과금 상한·로그 정책 및 정식 배포.

## 공식 문서

- [카카오맵 도보/대중교통 경로](https://developers.kakao.com/docs/ko/kakaomap/rest-api)
- [카카오모빌리티 다중 목적지 길찾기](https://developers.kakaomobility.com/guide/navi-api/destinations)
- [카카오모빌리티 자동차 길찾기](https://developers.kakaomobility.com/guide/navi-api/directions)
