const methods = Object.freeze({ status: 'GET', addresses: 'GET', recommend: 'POST', route: 'POST' });
const apiPath = /^\/api\/(status|addresses|recommend|route)\/?$/;
const operationParam = 'findNearbyOperation';
const baseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function errorResponse(status, detail, headers) {
  return Response.json({ detail }, { status, headers: { ...baseHeaders, ...headers } });
}

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const operation = apiPath.exec(incoming.pathname)?.[1] ?? incoming.searchParams.get(operationParam);
    if (!Object.hasOwn(methods, operation)) {
      return errorResponse(404, '요청 경로를 찾을 수 없습니다.');
    }
    const method = methods[operation];
    if (request.method !== method) {
      return errorResponse(405, '지원하지 않는 요청 방식입니다.', { Allow: method });
    }

    const origin = process.env.FIND_NEARBY_SUPABASE_URL?.trim();
    const secret = process.env.FIND_NEARBY_ORIGIN_SECRET?.trim();
    if (!origin || !secret) {
      return errorResponse(503, 'Vercel 환경변수 FIND_NEARBY_SUPABASE_URL과 FIND_NEARBY_ORIGIN_SECRET을 확인하세요.');
    }
    const supabase = URL.parse(origin);
    if (!supabase || supabase.protocol !== 'https:' || supabase.username || supabase.password ||
        supabase.pathname !== '/' || supabase.search || supabase.hash) {
      return errorResponse(503, 'FIND_NEARBY_SUPABASE_URL에 Supabase 프로젝트의 HTTPS 주소를 입력하세요.');
    }

    const upstream = new URL('/functions/v1/find-nearby/' + operation, supabase);
    const headers = new Headers({ 'x-find-nearby-origin-secret': secret });
    const visitor = request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for');
    if (visitor) headers.set('x-forwarded-for', visitor);
    let body;
    if (operation === 'addresses') {
      upstream.searchParams.set('q', incoming.searchParams.get('q') ?? '');
    } else if (method === 'POST') {
      headers.set('Content-Type', request.headers.get('Content-Type') ?? 'application/json');
      try {
        body = await request.arrayBuffer();
      } catch {
        return errorResponse(400, '요청 내용을 읽을 수 없습니다.');
      }
    }

    const timeout = AbortSignal.timeout(20_000);
    try {
      const response = await fetch(upstream, {
        method, headers, body, redirect: 'error', signal: AbortSignal.any([request.signal, timeout]),
      });
      const responseHeaders = new Headers(baseHeaders);
      for (const name of ['Content-Type', 'Retry-After']) {
        const value = response.headers.get(name);
        if (value) responseHeaders.set(name, value);
      }
      return new Response(response.body, { status: response.status, headers: responseHeaders });
    } catch {
      return timeout.aborted
        ? errorResponse(504, 'Supabase 응답 시간이 초과되었습니다.')
        : errorResponse(502, 'Supabase 함수에 연결할 수 없습니다.');
    }
  },
};
