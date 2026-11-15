import assert from 'node:assert/strict';
import type { RecommendResult, Route } from './Contracts.ts';
import { createApi } from './FindNearbyApi.ts';

const origin = { lat: 37.5663, lng: 126.9779 };
const points = [[126.9779, 37.5663], [126.9801, 37.5680]];
const secret = 'local-test-secret';

function localRequest(path: string, body?: object, authorized = true): Request {
  const headers = new Headers();
  if (authorized) headers.set('x-find-nearby-origin-secret', secret);
  if (body) headers.set('Content-Type', 'application/json');
  return new Request('https://project.example/functions/v1/find-nearby/' + path, {
    headers, method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
  });
}

async function withApi(
  dispatch: (url: URL, init?: RequestInit) => Response,
  run: (api: ReturnType<typeof createApi>) => Promise<void>,
  options: Record<string, string> = {},
) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => dispatch(new URL(String(input)), init);
  const env: Record<string, string> = {
    FIND_NEARBY_ORIGIN_SECRET: secret, SUPABASE_URL: 'https://project.example',
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_test' }),
    ...options,
  };
  try {
    await run(createApi(name => env[name]));
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test('status and all demo combinations keep the browser contract', async () => {
  let calls = 0;
  await withApi(url => {
    calls++;
    if (url.pathname.endsWith('/find_nearby_status')) return Response.json({ facilities: 91, access_points: 10 });
    assert(url.pathname.endsWith('/find_nearby_take_request'));
    return Response.json(true);
  }, async api => {
    assert.equal((await api(localRequest('status', undefined, false))).status, 401);
    assert.equal(calls, 0);
    const status = await api(localRequest('status'));
    assert.equal(status.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await status.json(), { facilities: 91, access_points: 10, live_ready: false });
    assert.equal((await api(localRequest('recommend', { origin: { lat: 90, lng: 127 } }))).status, 422);
    for (const kind of ['convenience', 'subway', 'restroom']) {
      for (const mode of ['walk', 'transit', 'car']) {
        const response = await api(localRequest('recommend', { kind, mode, origin }));
        assert.equal(response.status, 200);
        const result: RecommendResult = await response.json();
        assert.equal(result.demo, true);
        assert.equal(result.recommendations.length, 3);
        assert.equal(result.stop_reason, 'exhausted');
        assert(result.recommendations.every(item => item.facility.kind === kind && item.route.geometry === 'polyline'));
      }
    }
  });
});

Deno.test('Kakao address, walking, transit and selected car routes obey the existing contract', async () => {
  let batch: { key: string; x: number; y: number }[] = [];
  const destination = { lat: 37.568, lng: 126.9801 };
  const walk = { properties: { type: 'WALKING', distance: 100, time: 60 }, path: { points } };
  const bus = { properties: { type: 'BUS', distance: 400, time: 120, stops: [{ name: '시청' }] }, path: { points } };
  const properties = { totalDistance: 500, totalTime: 180, transfers: 0 };
  const routeSummary = { distance: 600, duration: 200, fare: { toll: 0 } };
  await withApi((url, init) => {
    const path = url.pathname;
    if (path.endsWith('find_nearby_access')) return Response.json([]);
    if (path.endsWith('find_nearby_take_call') || path.endsWith('find_nearby_take_request')) return Response.json(true);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'KakaoAK mocked-kakao-key');
    if (path.endsWith('address.json')) {
      assert.equal(url.searchParams.get('query'), '서울시청');
      return Response.json({ documents: [{ address_name: '서울시청', x: String(origin.lng), y: String(origin.lat) }] });
    }
    if (path.endsWith('category.json')) {
      const documents = [1, 2, 3].map(id => ({
        id: String(id), place_name: '시설 ' + id, x: String(destination.lng), y: String(destination.lat + id / 10000),
      }));
      return Response.json({ documents, meta: { is_end: true } });
    }
    if (path.endsWith('/routing/walk')) {
      assert.equal(url.searchParams.get('route_mode'), 'SHORTEST');
      return Response.json({ status: 'OK', route: { properties, legs: [{ steps: [walk] }] } });
    }
    if (path.endsWith('/routing/publictraffic')) {
      return Response.json({ status: 'OK', routes: [{ properties, steps: [walk, bus] }] });
    }
    if (path.endsWith('/destinations/directions')) {
      batch = JSON.parse(String(init?.body)).destinations;
      return Response.json({ routes: batch.map(({ key }) => ({ key, result_code: 0, summary: routeSummary })) });
    }
    assert.equal(path, '/v1/directions');
    assert(batch.some(point => url.searchParams.get('destination') === point.x + ',' + point.y));
    return Response.json({
      routes: [{ result_code: 0, summary: routeSummary, sections: [{ roads: [{ vertexes: points.flat() }] }] }],
    });
  }, async api => {
    const address = await api(localRequest('addresses?q=' + encodeURIComponent('서울시청')));
    assert.deepEqual(await address.json(), [{ name: '서울시청', address: '', coordinates: origin }]);
    for (const mode of ['walk', 'transit', 'car']) {
      const query = { origin, mode, kind: 'convenience', demo: false };
      const response = await api(localRequest('recommend', query));
      assert.equal(response.status, 200);
      const result: RecommendResult = await response.json();
      assert.equal(result.recommendations.length, 3);
      const first = result.recommendations[0];
      if (mode === 'transit') assert.equal(first.route.walking_distance_m, 100);
      if (mode === 'car') {
        assert.equal(first.route.geometry, 'summary');
        const selected = await api(localRequest('route', { ...query, destination: first.destination }));
        assert.equal(selected.status, 200);
        const route: Route = await selected.json();
        assert.equal(route.geometry, 'polyline');
        assert.deepEqual(route.segments[0].path[0], origin);
      }
    }
  }, { KAKAO_REST_API_KEY: 'mocked-kakao-key' });
});

Deno.test('failed upstream attempts are charged and earlier recommendations are preserved', async () => {
  let debits = 0;
  let routeCalls = 0;
  await withApi(url => {
    const path = url.pathname;
    if (path.endsWith('find_nearby_access')) return Response.json([]);
    if (path.endsWith('find_nearby_take_request')) return Response.json(true);
    if (path.endsWith('find_nearby_take_call')) {
      debits++;
      return Response.json(true);
    }
    if (path.endsWith('category.json')) {
      return Response.json({
        documents: [1, 2].map(id => ({ id, place_name: '시설 ' + id, x: 126.98, y: 37.567 + id / 10000 })),
        meta: { is_end: true },
      });
    }
    assert.equal(path, '/v2/routing/walk');
    routeCalls++;
    if (routeCalls > 1) return new Response(null, { status: 503 });
    return Response.json({
      status: 'OK',
      route: {
        properties: { totalDistance: 100, totalTime: 60 },
        legs: [{ steps: [{ properties: { distance: 100, time: 60 }, path: { points } }] }],
      },
    });
  }, async api => {
    const response = await api(localRequest('recommend', { origin, mode: 'walk', kind: 'convenience', demo: false }));
    assert.equal(response.status, 200);
    const result: RecommendResult = await response.json();
    assert.equal(result.recommendations.length, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.stop_reason, 'call_budget');
    assert.equal(debits, 4);
    assert.equal(routeCalls, 3);
  }, { KAKAO_REST_API_KEY: 'mocked-kakao-key', FIND_NEARBY_SEARCH_CALLS: '4' });
});
