# NearPath — 2단계: 기본 지도 및 출발지 지정

React + TypeScript + Vite로 작성한 **실행 가능한 웹 프로젝트 소스코드**입니다. 시설 검색, 실제 경로 탐색, 차량/대중교통 안내는 **3~5단계에서 구현할 기능**으로 이번 결과물에 포함하지 않았습니다.

## 주요 기능

- 대한민국 인터랙티브 지도: 확대·축소·지도 이동
- **지도 클릭**으로 출발지 지정 및 마커 표시
- **브라우저 GPS**로 출발지 지정 (사용자 동의 필요)
- **위도·경도 직접 입력** 및 좌표 범위 검증
- **주소·장소 검색** (카카오 JavaScript 키 입력 시 활성화)
- 선택된 출발지의 좌표(소수 6자리), 지정 방법 표시 및 복사
- PC/모바일 반응형 UI, 오류·권한 거부 처리
- **키 미설정 상태의 개발용 지도**: Leaflet + OpenStreetMap, 예시 장소 검색
- 다음 단계에서 REST 경로 API에 연결할 수 있도록 WGS84 `lat/lng` 자료형 및 `x/y` 변환 함수 제공

## Windows 실행 — 가장 쉬운 방법

1. Node.js **22.16 이상** 또는 22 이상을 설치합니다. https://nodejs.org/
2. 프로젝트 ZIP을 압축 해제합니다.
3. 압축 해제된 폴더에서 **`START_WINDOWS.bat`를 더블 클릭**합니다.
4. 최초 실행 시 의존성 설치를 진행하므로 인터넷 연결이 필요합니다.
5. 브라우저에서 **http://localhost:5173** 을 엽니다.
6. 키를 입력하지 않아도 개발용 지도에서 지도 클릭·현재 위치·좌표 직접 입력·예시 장소를 확인할 수 있습니다.

> 배치 파일은 이전 Windows 인코딩 문제를 피하기 위해 영문 ASCII로 작성되어 있습니다.

## 터미널 실행 — Windows, macOS, Linux

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:5173 에 접속합니다.

개발 서버 실행 중 소스코드 수정 사항은 자동 반영됩니다.

## 추후 카카오맵 JavaScript 키 입력하기

1. 카카오디벨로퍼스 앱을 등록하고 **카카오맵 사용 설정을 ON**으로 전환합니다.
2. **JavaScript 플랫폼 키**의 **JavaScript SDK 도메인**에 `http://localhost:5173`을 등록합니다. (외부 배포 시 배포 도메인 별도 등록)
3. 프로젝트의 `.env.example`을 복사하여 `.env` 파일을 만듭니다.
4. 아래처럼 **JavaScript 키**를 입력합니다.

```dotenv
VITE_KAKAO_JS_KEY=여기에_발급받은_JavaScript_키
```

5. 실행 중인 개발 서버를 종료(`Ctrl+C`)하고 다시 시작합니다.
6. 상단에 `카카오맵 연결됨`이 표시되면 Kakao Maps SDK 지도, 실제 주소·장소 검색을 사용할 수 있습니다.

**중요:** JavaScript 키와 REST API 키는 다릅니다. `VITE_` 접두어로 설정한 값은 웹 브라우저의 코드에 포함되므로 **REST API 키나 어드민 키를 넣으면 안 됩니다.** JavaScript 플랫폼 키는 웹 SDK가 사용하도록 만들어졌으며 도메인 제한 설정을 해야 합니다. REST 키는 추후 백엔드 서버 환경변수에만 저장합니다.

키가 올바르지 않거나 SDK 로딩에 실패하면 경고를 표시하고 개발용 지도로 전환합니다.

## 키가 없을 때와 있을 때 차이

| 기능 | 키 없음: 개발용 지도 | 키 있음: 카카오맵 |
|---|---|---|
| 지도 표시/조작 | O (OpenStreetMap) | O (카카오맵) |
| 지도 클릭 출발지 지정 | O | O |
| GPS 출발지 지정 | O | O |
| 위도·경도 직접 입력 | O | O |
| 마커·좌표 표시/복사 | O | O |
| 자유로운 주소·장소 검색 | X (예시 8곳만) | O |
| 시설 유형 검색/경로 제공 | 다음 단계 | 다음 단계 |

**키 없는 모드에서도 지도 타일을 받으려면 인터넷이 필요합니다.** OSM 공개 타일은 개발·소규모 테스트만을 위한 임시 구성입니다. 공개 서비스 운영 시 서비스 규모에 맞는 지도 타일 제공 계약 및 이용정책을 검토하고, 최종 카카오맵 전환을 권장합니다.

## GPS 유의사항

- 브라우저가 사용자 위치 권한을 요청합니다. **허용**해야 현재 위치를 지정할 수 있습니다.
- GPS API는 일반적으로 `HTTPS` 또는 `http://localhost`에서 동작합니다. 파일을 더블클릭해 `file://`로 실행하면 사용할 수 없습니다.
- 장비나 브라우저 정책에 따라 위치 정확도가 달라집니다.
- 위치가 불가능한 경우 지도 클릭 또는 좌표 직접 입력을 사용하세요.
- 출발지는 **현재 브라우저의 React 상태로만 저장**되며, 서버·파일·로컬 스토리지에 자동 저장하지 않습니다.

## 소스 구조

```text
nearby-route-map-stage2/
├─ START_WINDOWS.bat                # Windows 바로 실행
├─ RUN_TESTS_WINDOWS.bat            # Windows 단위 테스트
├─ .env.example                     # 키 입력 템플릿
├─ index.html
├─ package.json
├─ src/
│  ├─ App.tsx                       # 전체 UI 및 출발지 선택 흐름
│  ├─ location.ts                   # WGS84 좌표 검증/변환
│  ├─ samplePlaces.ts               # 키 없는 상태 예시 장소 검색
│  ├─ components/
│  │  ├─ DemoMap.tsx                # 임시 Leaflet/OSM 지도
│  │  ├─ KakaoMap.tsx               # Kakao Maps 지도 구현
│  │  └─ Icons.tsx                  # UI 아이콘
│  ├─ services/kakaoSdk.ts          # 지도 SDK 로더·주소/장소 검색
│  └─ styles.css
├─ tests/location.test.mjs          # 좌표/검색 로직 자동 테스트
└─ docs/STAGE2_VERIFICATION.md      # 완료 기준·검증 한계
```

## 테스트 및 빌드

```bash
npm test        # 소스 로직 단위 테스트
npm run typecheck
npm run build   # dist/ 생성
npm run preview # 빌드 결과 확인
```

정확한 완료 기준과 사용자 수동 테스트는 `docs/STAGE2_VERIFICATION.md`를 참고하세요.

## 다음 단계 연계

현재 출발지 데이터는 다음 형태입니다.

```ts
{
  coords: { lat: 37.566295, lng: 126.977945 },
  label: '서울시청',
  source: 'search'
}
```

다음 단계에서는 시설 후보 검색에 이 좌표를 전달합니다. 경로 REST API는 **x=경도, y=위도** 순서이므로 `src/location.ts`의 `toRouteCoordinates`를 사용하세요.

## 관련 공식 문서

- [Kakao Maps JavaScript 웹 가이드](https://apis.map.kakao.com/web/guide/)
- [Kakao Maps Web API Reference](https://apis.map.kakao.com/web/documentation/)
- [카카오맵 서비스 사용 절차](https://developers.kakao.com/docs/ko/kakaomap/common)
- [OpenStreetMap 타일 이용 정책](https://operations.osmfoundation.org/policies/tiles/)
