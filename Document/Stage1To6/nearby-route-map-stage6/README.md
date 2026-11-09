# NearPath — 6단계: 공중화장실 공공데이터·시설 접근점 통합

**버전 0.6.0 · 2026-11-04**

기존 2~5단계(지도, 출발지 지정, 편의점·역 검색, 도보/대중교통/자동차 경로, 최대 3곳 추천)를 유지하면서 **공중화장실 CSV의 로컬 수집·정제·검색**과 **검증일을 기록한 지하철역 출입구·차량 접근점**을 연결한 프로젝트입니다.

**핵심 전제:** 공중화장실 원천 CSV는 프로젝트에 포함되어 있지 않습니다. 공식 데이터 파일은 사용자가 직접 다운로드해 가져와야 합니다. 카카오 인증키는 나중에 설정해도 되지만, **2025년 2월 이후 표준 공중화장실 원천 데이터에는 위도·경도가 제공되지 않을 수 있으므로 좌표 변환이 필요한 행은 키 없이 지도에 표시할 수 없습니다.** 데모 기능과 CSV 처리 자동 테스트는 키 없이 가능합니다.

## 1. 6단계 추가 기능

| 기능 | 적용 내용 |
|---|---|
| 공중화장실 CSV 가져오기 | UTF-8/CP949 CSV 파싱, 도로명주소·지번주소, 개방시간, 관리기관, 자료 기준일 정규화 |
| 좌표 품질 | 유효하지 않은 좌표 제거; 위도/경도 순서 WGS84 검증; 좌표 없는 항목은 기본 제외 |
| 선택적 주소 좌표 변환 | `--geocode-limit N`으로 요청 수를 사전 제한. REST 키 없으면 요청하지 않음 |
| 변환 결과 확인 | **반환 주소가 원문 주소와 일치한 경우에만** 대표 좌표를 받아들이며, 출입구 좌표는 아님을 표시 |
| 중복 정제 | 동일 시설 ID·같은 시설명+주소 중복 제거, 원본 행수·제외 수 집계 |
| 로컬 저장 | `server/data/facilities.sqlite3` SQLite 저장, 사용자 GPS 및 검색 이력은 저장하지 않음 |
| 공중화장실 검색 | 최대 반경 20km, 후보 15개·직선거리순, 위치 없는 시설 제외 |
| 카카오 키워드 보완 | 공공데이터가 10개 미만이면 카카오 키워드 검색을 추가하고 중복 제거(카카오 JS 키 있는 경우만) |
| 출입구·접근점 관리 | 사용자 검증 CSV를 별도 테이블에 가져와 역/공중화장실 ID 또는 시설명+350m 범위로 매칭 |
| 이동수단별 도착점 | 도보는 보행 출입구, 대중교통은 환승/보행 출입구, 자동차는 차량 접근점 사용. 없으면 시설 중심 좌표와 경고 |
| 정보 출처 표시 | 지도 검색, 사용자가 가져온 공공데이터, 가상 데이터 출처를 구분 |
| 테스트 | 원본 CSV 처리, 오류 좌표, 0건 데이터, 캐시, API 응답, 접근점, 기존 기능 회귀 테스트 |

**중요:** 사용자가 출입구 CSV의 `source`와 `verified_at`을 채우더라도 프로그램이 현장 사실 여부를 자동으로 보증하지는 않습니다. 실제 주차 가능 여부, 지하철역 개방 출구 여부, 화장실 개방시간은 현장에서 확인해야 합니다.

## 2. Windows 실행

1. ZIP 압축 해제
2. Node.js **22.16 이상**, Python **3.10 이상** 설치
3. `START_WINDOWS.bat` 실행 (처음에는 npm/Python 의존성 다운로드 필요)
4. `http://localhost:5173` 접속
5. 출발지 지정 → 시설 선택 → 검색 → 도보/대중교통/자동차 기준 추천

수동 실행:

```powershell
# 터미널 1: 백엔드
python -m pip install -r server/requirements.txt
python -m uvicorn server.main:app --host 127.0.0.1 --port 8000

# 터미널 2: 프론트엔드
npm install
npm run dev
```

API 키가 없고 CSV도 가져오지 않았다면 이전 단계처럼 **가상 시설·가상 경로**가 표시됩니다. 임시 지도는 OpenStreetMap 타일을 사용합니다. 실제 경로와 시뮬레이션은 화면에 별도 표시됩니다. **카카오맵 JavaScript SDK가 정상 연결되지 않은 OSM 개발용 지도에서는 카카오 REST 키가 있더라도 실제 경로를 요청하지 않고 가상 경로를 표시합니다.** 실 API 실패 시 가상 결과로 조용히 대체하지 않습니다.

## 3. 공중화장실 실제 데이터 가져오기

### 3-1. 공식 데이터 확보

공공데이터포털에서 [행정안전부 공중화장실정보](https://www.data.go.kr/data/15075531/standard.do)를 확인하고 CSV 파일을 내려받으세요. 다운로드 페이지·라이선스·현행 제공 양식을 직접 확인해야 합니다. xlsx를 받은 경우 엑셀에서 **CSV UTF-8**로 저장한 다음 가져옵니다.

좌표 정책 관련 공식 메타데이터에서는 **2025년 2월부터 WGS84 위도와 경도 제공 중단**을 명시합니다. 따라서 좌표가 없는 행은 선택적으로 지오코딩을 수행해야 합니다.

### 3-2. 좌표가 이미 있는 CSV (REST 키 없이 가능)

프로젝트 루트 PowerShell에서 실행:

```powershell
python -m server.import_facilities --toilets "C:\Data\public_toilets.csv"
```

또는 `IMPORT_TOILETS_WINDOWS.bat "C:\Data\public_toilets.csv"` 실행.

자동 가져오기 결과는 `read`, `imported`, `duplicates`, `invalid`, `missing_coordinates`, `geocoded` 등의 수치로 표시됩니다. 필수 시설명·주소, 유효한 좌표가 없는 행은 검색 목록에 나타나지 않습니다.

### 3-3. 좌표가 없는 CSV (키 입력 후)

`server/.env.example`을 `server/.env`로 복사하고 `KAKAO_REST_API_KEY`를 입력한 다음:

```powershell
# 한 번에 최대 100개의 새 주소를 카카오 API로 변환
python -m server.import_facilities --toilets "C:\Data\public_toilets.csv" --geocode-limit 100 --cache "server/data/geocode_cache.json"
```

**중요:** 최초 호출량 제한은 0입니다. `--geocode-limit`을 직접 지정한 경우에만 지오코딩이 수행됩니다. 매번 같은 주소를 재호출하지 않도록 `--cache`를 권장합니다. 좌표를 가진 행은 API를 호출하지 않습니다. API 키·사용 권한·과금 조건·주소 변환 결과의 저장/재사용 허용 범위를 확인한 뒤 실행하세요.

엄격한 주소 일치 기준 때문에 지오코딩의 첫 결과가 일부 누락될 수 있습니다. 이 경우 반환값을 임의로 수용하지 않고 `missing_coordinates`로 집계합니다. 국가 데이터에서 받은 주소 대표 좌표는 출입구 좌표가 아니며, 지도 경로 정확도를 보장하지 않습니다.

가져오기 후 브라우저에서 **데이터 다시 확인**을 누르거나 새로고침합니다.

### 3-4. 데이터베이스·조회 상태

- 데이터베이스: `server/data/facilities.sqlite3` (기본값, `.gitignore` 적용)
- 선택적 DB 위치: `NEARPATH_FACILITY_DB` 환경변수
- `GET http://127.0.0.1:8000/api/facilities/status`: 가져오기 건수·접근점 건수·가져오기 일자
- `GET http://127.0.0.1:8000/api/facilities/nearby?lat=37.5&lng=127.0&radius=500`: 공중화장실 주변 검색 (500/1000/3000/5000/10000/20000m)
- 백엔드는 읽기 API에서 파일을 수정하지 않으며, DB 경로나 비밀키를 반환하지 않습니다.

## 4. 출입구·차량 접근 좌표 가져오기

`examples/ACCESS_POINTS_TEMPLATE.csv`의 첫 줄(헤더)을 참고해 신뢰할 수 있는 공공기관/시설 관리자의 출입구·차량 접근 정보를 **출처·검증 날짜와 함께** 작성합니다.

```csv
facility_type,facility_name,facility_id,mode,latitude,longitude,label,source,verified_at
```

- `facility_type`: `subway` 또는 `restroom`
- `facility_name`: 지도/공공데이터 시설명 (`판교역`, `서울역` 등 실제 데이터명)
- `facility_id`: 선택 사항. 이름 매칭이 불명확한 경우 해당 NearPath 시설 ID로 연결
- `mode`: `walk`, `transit`, `car` 중 한 가지(좌표별로 행 작성)
- `latitude`, `longitude`: WGS84 좌표(출입구 등 실제 확인 위치)
- `label`: 출입구 번호 또는 차량 도착점 이름
- `source`, `verified_at`: 출처 및 `YYYY-MM-DD` 검증일 필수

```powershell
python -m server.import_facilities --access-points "C:\Data\verified_access_points.csv"
```

또는 `IMPORT_ACCESS_WINDOWS.bat "C:\Data\verified_access_points.csv"`.

매칭은 **같은 시설 유형 + 시설 ID 또는 이름 + 350m 이내 좌표**일 때만 이루어집니다. 허위/오래된 접근점이 입력되면 경로가 부정확해질 수 있으므로 검증되지 않은 행은 파일에 포함하지 마세요. 접근점을 찾지 못한 시설은 기존 시설 중심 좌표를 유지하며 별도로 고지합니다. 차량 접근점은 **주차장이 있다는 뜻이 아닙니다.**

## 5. 데이터 흐름

```text
공공데이터포털에서 CSV 직접 다운로드
         ↓
시설명/주소/좌표 유효성 검사
         ↓
좌표가 없으면 (명시적 허용 시) 카카오 REST 주소→좌표 변환
         ↓
중복 제거 · 불량 행 제외 · SQLite 저장
         ↓
/api/facilities/nearby + 지도 카카오 검색 보완
         ↓
시설 출처/개방시간/좌표 신뢰도 표시
         ↓
등록된 접근점이 있으면 도착 좌표 보정
         ↓
기존 5단계 도보·대중교통·자동차 최적 3곳 추천
```

## 6. 보안, 이용약관, 운영 시 유의사항

- REST 키는 `server/.env`에만 입력하며 **VITE_ 환경변수나 React 소스에 넣지 않습니다**. 카카오 JavaScript 키는 루트 `.env`에만 설정합니다.
- CSV가 제공하는 **공개 시설 주소**만 선택적으로 외부 주소 변환 API에 전송합니다. 사용자의 GPS 위치를 지오코딩 가져오기에 사용하지 않습니다.
- 공공데이터 이용허락 범위, 데이터 갱신 주기, 제공기관의 표시·재배포 요건을 확인하세요. 사용자 지정 CSV의 출처와 정확성은 프로그램이 보증하지 않습니다.
- 카카오 지도/로컬/경로/좌표 변환의 저장, 캐싱, 제3자 지도에 표시하는 행위 및 과금 조건을 각각 검토하세요. 주소 변환 결과 영구 보관 허용 여부도 **서비스 배포 전 검증 필요**입니다.
- 서버의 기존 개발용 분당·일일 경로 호출 제한은 재시작 시 초기화됩니다. 공개 배포 전 사용자 인증, 서비스 전체 사용량 한도, 로깅·모니터링을 추가해야 합니다.
- 전국 표준 공중화장실의 전체 레코드가 반드시 위치를 가진다는 의미가 아니며, 검색 결과는 현재 로컬 DB에 가져온 유효 좌표의 시설에 한정됩니다.

## 7. 테스트와 한계

```powershell
npm test
python -m unittest discover -s server/tests -v
npm run typecheck
npm run build
```

- 원본 파일 없이 동작하는 자동 테스트는 가상 시설명을 사용하며 **실제 공공시설의 존재/영업을 검증하지 않습니다**.
- 현재 환경에서는 npm 패키지 레지스트리 접속 오류(`EAI_AGAIN`)로 전체 React 빌드·실제 브라우저 구동 검증이 제한되었습니다.
- **실제 공공데이터 원천 CSV 대량 수집, Kakao REST/지도 API 실호출, 실물 출입구 좌표 검증은 실시하지 않았습니다**. 관련 항목은 `docs/STAGE6_VERIFICATION.md` 참고.

## 8. 주요 파일

```text
nearby-route-map-stage6/
├── START_WINDOWS.bat / RUN_API_WINDOWS.bat / RUN_TESTS_WINDOWS.bat
├── IMPORT_TOILETS_WINDOWS.bat / IMPORT_ACCESS_WINDOWS.bat
├── examples/ACCESS_POINTS_TEMPLATE.csv
├── src/
│   ├── App.tsx                        # 출처/품질 및 이동수단별 도착점 표시
│   ├── accessRouting.ts              # 접근점 선택/시설 중심 좌표 대체
│   └── services/publicData.ts        # 공공데이터·카카오 검색 병합/좌표 검증
├── server/
│   ├── facility_data.py              # CSV 정규화/SQLite 주변 검색/출입구 관리
│   ├── import_facilities.py          # 로컬 가져오기 명령
│   ├── main.py                       # 읽기 전용 시설 REST 엔드포인트
│   └── tests/test_facility_data.py
└── docs/STAGE6_VERIFICATION.md
```

## 9. 다음 개발 단계

**7단계: 사용성 및 모바일 UI 고도화** — 접근점 선택, 환승 상세, 공중화장실의 개방시간/접근성 필터(데이터 검증 후), 작은 화면에서 결과 비교. 이후 **8단계 통합 실호출·성능·데이터 품질 검사**, **9단계 배포·운영** 순서.

### 공식 참고문서
- [행정안전부 공중화장실정보](https://www.data.go.kr/data/15075531/standard.do)
- [카카오맵 로컬 API 주소→좌표 변환](https://developers.kakao.com/docs/ko/kakaomap/rest-api)
- [서울 열린데이터광장 API 이용안내](https://data.seoul.go.kr/together/guide/useGuide.do)
