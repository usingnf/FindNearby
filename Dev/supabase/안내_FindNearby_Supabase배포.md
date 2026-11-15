# FindNearby Vercel·Supabase 배포

이 폴더에는 FindNearby의 Supabase 프로젝트 설정과 PostgreSQL 이전 SQL, Edge Function을 둡니다. Vercel은 `Dev`에서 웹 화면을 빌드하고 기존 `/api` 주소를 Supabase 함수로 연결합니다.

## 1. PostgreSQL 초기 데이터 적재

1. [Supabase 대시보드](https://supabase.com/dashboard)에서 프로젝트를 생성하고 프로젝트 URL과 Project Ref를 확인합니다. 아래 명령은 저장소의 `Dev`에서 실행합니다. Supabase CLI가 필요합니다.
2. 터미널의 브라우저 로그인과 프로젝트 연결을 마치고 데이터베이스 이전을 적용합니다. `PROJECT_REF`는 실제 값으로 바꿉니다. [Supabase CLI 설치](https://supabase.com/docs/guides/local-development/cli/getting-started) · [데이터베이스 이전](https://supabase.com/docs/guides/local-development/database-migrations)

   ```powershell
   supabase login
   supabase link --project-ref PROJECT_REF
   supabase db push
   ```

3. SQL Editor에서 `select public.find_nearby_status();`를 실행해 `facilities`가 91, `access_points`가 10인지 확인합니다. 초기 SQL은 `Resource`의 검증된 CSV에서 생성했고, 저장소의 로컬 시설 SQLite와 항목별 내용이 일치했습니다. 별도로 갱신한 시설 SQLite가 있으면 `python SupabaseSeed.py ..\Temp\FindNearbyData.sql --sqlite facilities.sqlite3`로 검토할 SQL을 만들 수 있습니다. 이 SQL은 해당 키의 행을 추가·갱신합니다. 삭제를 반영해야 할 때는 대상 행을 확인해 별도 이전 SQL에 기록합니다.

## 2. 상태 API 배포

1. `supabase/.env.example`을 `supabase/.env.production.local`에 복사합니다. 아래 명령으로 서버 간 공유 키를 생성해 `FIND_NEARBY_ORIGIN_SECRET`에 넣습니다. 같은 값을 3단계에서 Vercel의 서버 환경변수에도 사용합니다.

   ```powershell
   node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
   supabase secrets set --env-file supabase/.env.production.local
   supabase functions deploy find-nearby
   ```

2. 상태만 확인하는 첫 배포에서는 카카오 REST 키를 나중에 넣을 수 있습니다. 이 상태에서 `live_ready`는 `false`이고 데모 추천을 사용할 수 있습니다. 기존 시험 ZIP에 포함된 카카오 REST 키는 교체하고 기존 키를 폐기합니다. 새 키는 `KAKAO_REST_API_KEY`에, 자동차용 키가 별도라면 `KAKAO_MOBILITY_REST_API_KEY`에 넣습니다. 실제 기능을 시험할 때 키 등록 명령을 다시 실행합니다. 기존 서버와 같은 카카오 앱을 쓰는 경우 두 호출량 장부가 분리됩니다. 전환 전후 잔여 호출량을 확인하거나 별도 시험 키를 사용합니다. [Edge Function 환경변수](https://supabase.com/docs/guides/functions/secrets)

## 3. Vercel 연결

Vercel의 Framework Preset은 `Vite`, Root Directory는 `Dev`, Build Command는 `npm run build`, Output Directory는 `dist`입니다. `Dev/vercel.json`과 `Dev/api/find-nearby.js`가 포함된 커밋을 배포합니다. 환경별 값은 Vercel 프로젝트의 **Settings → Environment Variables**에 입력합니다. [Vercel Node.js 함수](https://vercel.com/docs/functions/runtimes/node-js#create-a-nodejs-function-in-api) · [Vercel 환경변수](https://vercel.com/docs/environment-variables)

| 변수 | 등록할 값 |
| --- | --- |
| `FIND_NEARBY_SUPABASE_URL` | Supabase 프로젝트 URL. 예를 들어 `https://PROJECT_REF.supabase.co` |
| `FIND_NEARBY_ORIGIN_SECRET` | Supabase에 저장한 동일한 공유 키 |
| `VITE_KAKAO_JS_KEY` | 카카오 JavaScript 지도 키 |

Supabase URL에는 경로나 끝의 슬래시를 붙이지 않습니다. Vercel이 네 API에만 공유 키를 붙여 보내며, Edge Function은 키가 맞는 요청을 처리합니다. 카카오 REST 키와 Supabase 데이터베이스 키는 Supabase 쪽에서 사용합니다. 카카오 JavaScript 키에는 실제 접속할 Vercel 도메인을 등록합니다. [카카오맵 도메인 설정](https://apis.map.kakao.com/web/guide/)

Preview를 확인한 뒤 Production 환경변수를 설정하고 배포합니다. 환경변수를 변경했다면 다시 배포합니다.

## 4. 배포 후 확인

1. Supabase 함수의 `/functions/v1/find-nearby/status`를 공유 키 없이 열면 `401`이어야 합니다.
2. Vercel의 `/api/status`는 HTTP 200과 시설·접근점 건수를 반환해야 합니다. `live_ready: true`는 REST 키가 설정됐다는 뜻입니다.
3. Vercel 화면에서 **실제 데이터** 표시, 주소 검색, 도보·대중교통·자동차 추천을 확인합니다. 자동차 카드 선택 후 상세 경로가 열리는지, 지도에 경로선이 그려지는지도 확인합니다. 공급자 권한은 실제 응답으로 확인합니다.
4. 시험 환경에서 두 이용자의 분당 한도가 독립적으로 적용되는지, 동시 요청·재시도에도 전체 호출 한도가 유지되는지 확인합니다. 앱 로그에는 작업명·상태·응답시간이 기록됩니다. 운영 전 호스팅 플랫폼의 요청 로그에 주소 쿼리나 위치 좌표가 보관되는지도 확인합니다.

Vercel의 `404`는 배포에 라우팅 설정과 함수가 포함됐는지 확인합니다. `401`은 양쪽의 공유 키를 확인합니다. `503` 메시지에 Vercel 환경변수 이름이 나오면 해당 배포 환경에 두 변수를 등록하고 재배포합니다. 데이터베이스 또는 카카오 관련 메시지가 나오면 데이터 이전이나 카카오 키·권한을 확인합니다.

## 로컬 실행 및 검증

`Dev`에서 `supabase start`로 로컬 프로젝트를 시작합니다. `supabase/.env.example`을 `supabase/.env.local`에 복사하고 로컬 공유 키를 설정한 뒤 `supabase functions serve find-nearby --env-file supabase/.env.local`로 실행합니다. Vite의 `Dev/.env.local`에 `FIND_NEARBY_SUPABASE_URL=http://127.0.0.1:54321` 및 동일한 `FIND_NEARBY_ORIGIN_SECRET`을 넣고 `pnpm dev`를 시작합니다. `FIND_NEARBY_SUPABASE_URL`을 비워 둔 개발 설정은 포트 8000의 기존 FastAPI를 사용합니다.

```powershell
pnpm build
deno check supabase/functions/find-nearby/index.ts
deno test supabase/functions/find-nearby/FindNearbyApi_test.ts
```

PostgreSQL 엔진에서 두 이전 SQL, 초기 자료 재적재, 권한과 호출 제한 함수, 공공시설 반경 검색과 주안역 출입구 매칭을 검증했습니다. 로컬 Edge 브라우저에서는 PostgreSQL에 연결된 API의 상태, 주소 검색, 세 이동수단 추천과 자동차 경로 상세를 확인했습니다. 카카오 응답은 모의 응답을 사용했습니다. Vite 빌드, Deno 테스트 3개, 기존 FastAPI 테스트 24개가 통과했습니다. Vercel 라우팅은 공식 설정 스키마와 대조했습니다.

Supabase 호스팅 환경과 Vercel 배포 경로에서의 동작, 실제 카카오 응답과 응답시간은 프로젝트 생성 후 확인합니다.
