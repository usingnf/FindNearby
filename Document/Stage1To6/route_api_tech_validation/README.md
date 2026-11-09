# 경로 API 검증 실행 도구

대한민국 주변 시설 검색 서비스에서 사용할 3종 경로 API의 응답 스키마를 검증합니다.

- **도보:** 카카오맵 도보 경로 API
- **대중교통:** 카카오맵 대중교통 경로 API
- **자동차:** 카카오모빌리티 자동차 경로 API

실제 호출은 `--live` 옵션을 명시할 때만 수행됩니다. `--live` 실행에는 각 API 호출에 따른 쿼터 소모가 발생합니다. API 키 또는 원본 응답 전문은 파일에 남기지 않습니다.

## 구성

- `route_api_validate.py` — 실제 API 연결/응답 구조 검사 (Python 3.10+ 표준 라이브러리)
- `tests/test_response_parsers.py` — 외부 네트워크 없이 테스트 가능한 9개 단위 테스트
- `TECHNICAL_VERIFICATION_REPORT.md` — 공식 API 명세·쿼터·한계·판정 보고서
- `validation_result.json` — 인증키가 없어 실호출을 수행하지 못한 사실을 기록한 결과 파일

## 1. 준비

1. https://developers.kakao.com/ 에서 앱을 생성합니다.
2. 해당 앱의 카카오맵 API 사용 상태를 ON으로 설정합니다.
3. 앱의 **REST API 키**를 확인합니다. 지도 JavaScript 키와 혼동하지 마세요.
4. 키에 호출 허용 IP 제한이 있다면 실제 실행하는 서버의 IP를 허용합니다.
5. 도보/대중교통/자동차 경로 API 사용 권한 및 무료 쿼터 정책을 확인합니다.

비밀키를 채팅창이나 소스코드, Git 저장소에 붙여넣지 마세요.

## 2. 네트워크 없이 파서부터 검증

프로젝트 폴더에서 다음을 실행합니다.

```bash
python -m unittest discover -s tests -v
python route_api_validate.py
```

기본 실행은 실제 API를 호출하지 않으며, `[NOT_RUN]`을 표시합니다. 단위 테스트가 성공하면 `Ran 9 tests ... OK`가 나타납니다.

## 3. 실제 API 호출 검증 — Windows PowerShell

```powershell
$key = Read-Host 'Kakao REST API Key' -AsSecureString
$env:KAKAO_REST_API_KEY = ([System.Net.NetworkCredential]::new('', $key)).Password
python .\route_api_validate.py --live --output .\validation_result.json
Remove-Item Env:\KAKAO_REST_API_KEY
```

위 명령은 **기본 좌표를 사용해 도보·대중교통·자동차 API를 각각 한 번 호출**합니다. 자동차에 별도 키가 필요하다면 `KAKAO_MOBILITY_REST_API_KEY` 환경변수를 추가로 설정할 수 있습니다.

## 4. 실제 API 호출 검증 — macOS/Linux

```bash
read -rsp 'KAKAO_REST_API_KEY: ' KAKAO_REST_API_KEY; echo
export KAKAO_REST_API_KEY
python3 route_api_validate.py --live --output validation_result.json
unset KAKAO_REST_API_KEY
```

## 5. 검증 옵션

특정 API만 테스트:

```bash
python route_api_validate.py --live --modes walk
python route_api_validate.py --live --modes transit
python route_api_validate.py --live --modes car
```

출발·도착 좌표 변경 (`경도`, `위도`):

```bash
python route_api_validate.py --live --origin-lon 127.11119217 --origin-lat 37.39477123 --dest-lon 127.12628814 --dest-lat 37.41993056
```

설정하지 않으면 위와 동일한 카카오 공식 문서의 예시 좌표를 사용합니다. 모든 좌표는 대한민국 WGS84 범위여야 하며 개인 위치정보는 테스트 목적에 필요한 경우에만 입력하세요.

## 6. 결과 읽는 법

| 상태 | 의미 |
| --- | --- |
| `PASS` | 실제 HTTP 응답, 경로 거리·시간·좌표 검증 통과 |
| `FAIL` | HTTP 실패 또는 응답 구조/경로 검증 실패 |
| `NOT_RUN` | 인증키가 없어 실제 API 호출을 실행하지 않음 |

`validation_result.json`에 상태·HTTP 응답번호·소요시간·거리·시간·경로 좌표 개수를 저장합니다. 운영 도메인, REST API 키 또는 전체 경로 좌표 목록은 기록하지 않습니다.

- `401`: 키 확인
- `403`: 서비스 활성화, 사용 권한, 허용 IP 확인
- `429`: 쿼터/호출 제한 확인
- `HTTP 200 + FAIL`: API 내부 `status`/`result_code`, 좌표 정보 또는 응답 스키마 확인

참고: 대중교통 경로가 없는 매우 짧은 구간은 `NO_RESULTS`가 정상일 수 있으므로, 기본 좌표는 2~4km 내외의 도심 간 이동 예시를 사용합니다.

## 7. 다음 단계

도보, 대중교통, 자동차 3개 결과가 모두 `PASS`일 때 지도 렌더링 및 출발지 지정 기능을 구현합니다. API 연결은 성공했지만 후보 10~15개 요청 시 성능/비용이 기준을 초과한다면 후보 수 제한, 요청 캐싱, 자동차 다중 목적지 길찾기를 검토합니다.
