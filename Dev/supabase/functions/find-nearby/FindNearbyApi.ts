import { CallBudget } from './CallBudget.ts';
import type { ApiStatus } from './Contracts.ts';
import { FacilityStore } from './FacilityStore.ts';
import { KakaoProvider } from './KakaoProvider.ts';
import { ApiError, parseDestination, parseSearch, ProviderError, record } from './Models.ts';
import { RecommendationService } from './RecommendationService.ts';
import { DatabaseError, SupabaseDatabase } from './SupabaseDatabase.ts';

const apiPath = /^(?:\/functions\/v1)?\/find-nearby\/(status|addresses|recommend|route)\/?$/;
const encoder = new TextEncoder();

function digest(secret: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(secret));
}

async function matchesSecret(value: string, expected: Promise<ArrayBuffer>): Promise<boolean> {
  const a = new Uint8Array(await digest(value));
  const b = new Uint8Array(await expected);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

function json(value: object, status = 200, headers?: Record<string, string>): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}

function databaseKey(env: (name: string) => string | undefined): string {
  const secrets = env('SUPABASE_SECRET_KEYS');
  if (secrets) {
    const key = record(JSON.parse(secrets)).default;
    if (typeof key === 'string' && key) return key;
  }
  return env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY') || '';
}

export function createApi(env: (name: string) => string | undefined) {
  const secret = env('FIND_NEARBY_ORIGIN_SECRET') ?? '';
  const secretHash = secret ? digest(secret) : null;
  const clientHashKey = secret ? crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  ) : null;
  const db = new SupabaseDatabase(env('SUPABASE_URL') ?? '', databaseKey(env));
  function positive(name: string, fallback: number, integer = true): number {
    const configured = env('FIND_NEARBY_' + name);
    const value = Number(configured || fallback);
    if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value))) {
      throw new Error('Invalid FIND_NEARBY_' + name);
    }
    return value;
  }
  const budget = new CallBudget(db, positive('DAILY_LIMIT', 300), positive('MINUTE_LIMIT', 50),
    positive('CLIENT_MINUTE_LIMIT', 12));
  const provider = new KakaoProvider(env('KAKAO_REST_API_KEY')?.trim() ?? '', env('KAKAO_MOBILITY_REST_API_KEY')?.trim() ?? '', budget);
  const service = new RecommendationService(provider, new FacilityStore(db), positive('SEARCH_CALLS', 12),
    positive('SEARCH_SECONDS', 8, false));

  async function allowClient(request: Request): Promise<boolean> {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip')?.trim() || 'unknown';
    const signature = await crypto.subtle.sign('HMAC', await clientHashKey!, encoder.encode(ip));
    const hash = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
    return await budget.allowClient(hash);
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const operation = apiPath.exec(url.pathname)?.[1];
    if (!operation) return json({ detail: '요청 경로를 찾을 수 없습니다.' }, 404);
    if (!secretHash) return json({ detail: 'API 서버 연결을 설정하세요.' }, 503);
    const presented = request.headers.get('x-find-nearby-origin-secret');
    if (!presented || !await matchesSecret(presented, secretHash)) return json({ detail: '인증이 필요합니다.' }, 401);
    const method = operation === 'status' || operation === 'addresses' ? 'GET' : 'POST';
    if (request.method !== method) return json({ detail: '지원하지 않는 요청 방식입니다.' }, 405, { Allow: method });
    const started = performance.now();
    let response: Response;
    try {
      if (operation === 'status') {
        const counts = await db.rpc<Pick<ApiStatus, 'facilities' | 'access_points'>>('find_nearby_status');
        response = json({ ...counts, live_ready: Boolean(provider.key) });
      } else if (!await allowClient(request)) {
        response = json({ detail: '요청이 많습니다. 잠시 뒤 다시 시도하세요.', reason: 'rate_limited' }, 429, { 'Retry-After': '60' });
      } else if (operation === 'addresses') {
        const query = url.searchParams.get('q') ?? '';
        if ([...query].length < 2 || [...query].length > 120) throw new ApiError(422, '주소는 2자 이상 120자 이하로 입력하세요.');
        response = json(await provider.addresses(query));
      } else {
        const body = await request.json().catch(() => null);
        const query = parseSearch(body);
        if (operation === 'recommend') {
          response = json(await service.recommend(query));
        } else {
          const destination = parseDestination(record(body).destination);
          response = json(query.demo ? RecommendationService.simulate(query, destination)
            : await provider.route(query.mode, query.origin, destination));
        }
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        response = json({ detail: error.message, reason: error.reason }, error.status);
      } else if (error instanceof ApiError) {
        response = json({ detail: error.message }, error.status);
      } else if (error instanceof DatabaseError) {
        response = json({ detail: error.message }, 503);
      } else {
        response = json({ detail: '서버가 요청을 처리하지 못했습니다.' }, 500);
      }
    }
    console.info('api_operation=%s status=%d elapsed_ms=%d', operation, response.status, Math.round(performance.now() - started));
    return response;
  };
}
