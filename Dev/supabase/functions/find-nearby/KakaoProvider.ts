import type { CallBudget, SearchBudget } from './CallBudget.ts';
import type { Coordinates, Facility, FacilityType, Place, Route, Segment, TravelMode } from './Contracts.ts';
import { compareRoutes, coordinates, list, makeRoute, NoRoute, nonnegativeInteger, ProviderError, record, samePoint, string } from './Models.ts';

const missingRouteStatuses = new Set([
  'SAME_POINT', 'START_LINK_NOT_FOUND', 'END_LINK_NOT_FOUND', 'TOO_FAR_AWAY',
  'ROUTE_RESULT_NOT_FOUND', 'STARTNODES_NULL', 'ENDNODES_NULL', 'EQUAL_POINTS', 'NO_RESULTS',
]);
const missingCarCodes = new Set([1, 101, 102, 103, 104, 105, 106, 107]);
const transitKinds = { WALKING: 'walk', BUS: 'bus', SUBWAY: 'subway' } as const;

type KakaoRequest = {
  params?: Record<string, string | number>;
  body?: object;
  car?: boolean;
  search?: SearchBudget;
};

export class KakaoProvider {
  constructor(
    readonly key: string, private readonly carKey: string, private readonly budget: CallBudget,
  ) {}

  private async request(path: string, { params, body, car, search }: KakaoRequest) {
    const key = car ? this.carKey || this.key : this.key;
    if (!key) throw new ProviderError(503, '카카오 REST API 키를 서버에 설정하세요.', 'provider_error', false);
    const url = new URL(path, car ? 'https://apis-navi.kakaomobility.com' : 'https://dapi.kakao.com');
    for (const [name, value] of Object.entries(params ?? {})) url.searchParams.set(name, String(value));
    const timeout = await this.budget.take(path, false, search);
    try {
      return await this.send(url, key, timeout, body);
    } catch (error) {
      if (!(error instanceof ProviderError) || !error.retryable) throw error;
      return await this.send(url, key, await this.budget.take(path, true, search), body);
    }
  }

  private async send(url: URL, key: string, timeout: number, body?: object) {
    const signal = AbortSignal.timeout(Math.max(1, Math.ceil(timeout)));
    let response: Response;
    try {
      response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: body ? { Authorization: 'KakaoAK ' + key, 'Content-Type': 'application/json' }
          : { Authorization: 'KakaoAK ' + key },
        body: body ? JSON.stringify(body) : undefined,
        signal,
        redirect: 'error',
      });
    } catch {
      throw signal.aborted
        ? new ProviderError(504, '외부 API 응답 시간이 초과되었습니다.', 'provider_error', true, true)
        : new ProviderError(502, '외부 API에 연결할 수 없습니다.', 'provider_error', true, true);
    }
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(503, '카카오 앱의 키와 API 권한을 확인하세요.');
    }
    if (response.status === 429) {
      throw new ProviderError(429, '외부 API 호출 한도에 도달했습니다.', 'rate_limited');
    }
    if ([500, 502, 503, 504].includes(response.status)) {
      throw new ProviderError(502, '외부 API가 일시적으로 요청을 처리하지 못했습니다.', 'provider_error', true, true);
    }
    try {
      if (!response.ok) throw new TypeError('Unsuccessful response');
      return record(await response.json());
    } catch {
      if (signal.aborted) throw new ProviderError(504, '외부 API 응답 시간이 초과되었습니다.', 'provider_error', true, true);
      throw new ProviderError(502, '외부 API가 요청을 처리하지 못했습니다.');
    }
  }

  async addresses(query: string): Promise<Place[]> {
    const data = await this.request('/v2/local/search/address.json', { params: { query, size: 5 } });
    try {
      return list(data.documents).map(value => {
        const row = record(value);
        return { name: string(row.address_name), address: '', coordinates: coordinates(row.y, row.x) };
      });
    } catch {
      throw new ProviderError(502, '주소 응답 형식이 올바르지 않습니다.');
    }
  }

  async facilities(origin: Coordinates, kind: FacilityType, radius: number, page: number, search: SearchBudget) {
    const restroom = kind === 'restroom';
    const data = await this.request('/v2/local/search/' + (restroom ? 'keyword.json' : 'category.json'), {
      params: {
        x: origin.lng, y: origin.lat, radius, page, size: 15, sort: 'distance',
        ...(restroom ? { query: '공중화장실' } : { category_group_code: kind === 'convenience' ? 'CS2' : 'SW8' }),
      },
      search,
    });
    try {
      const rows = list(data.documents);
      const lastPage = record(data.meta).is_end;
      if (typeof lastPage !== 'boolean') throw new TypeError('Invalid last page flag');
      const places: Facility[] = [];
      for (const value of rows) {
        try {
          const row = record(value);
          if (!row.id || (typeof row.id !== 'number' && typeof row.id !== 'string')) continue;
          const road = string(row.road_address_name || '');
          const lot = string(row.address_name || '');
          places.push({
            id: 'kakao:' + row.id, name: string(row.place_name), kind, source: 'kakao',
            address: road || lot, alternate_address: road ? lot : '',
            coordinates: coordinates(row.y, row.x), source_label: '', hours: '', updated: '',
          });
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
        }
      }
      return { places, lastPage };
    } catch {
      throw new ProviderError(502, '시설 검색 응답 형식이 올바르지 않습니다.');
    }
  }

  async route(mode: TravelMode, origin: Coordinates, destination: Coordinates, search?: SearchBudget): Promise<Route> {
    if (samePoint(origin, destination)) throw new NoRoute();
    const data = mode === 'car'
      ? await this.request('/v1/directions', { car: true, search, params: {
        origin: `${origin.lng},${origin.lat}`, destination: `${destination.lng},${destination.lat}`,
        priority: 'TIME', summary: 'false',
      } })
      : await this.request('/v2/routing/' + (mode === 'walk' ? 'walk' : 'publictraffic'), { search, params: {
        start_x: origin.lng, start_y: origin.lat, end_x: destination.lng, end_y: destination.lat,
        input_coord: 'WGS84', output_coord: 'WGS84', ...(mode === 'walk' ? { route_mode: 'SHORTEST' } : {}),
      } });
    return KakaoProvider.parseRoute(mode, data);
  }

  async carSummaries(origin: Coordinates, destinations: Coordinates[], search: SearchBudget): Promise<Map<number, Route>> {
    const data = await this.request('/v1/destinations/directions', { car: true, search, body: {
      origin: { x: origin.lng, y: origin.lat },
      destinations: destinations.map((point, index) => ({ key: String(index), x: point.lng, y: point.lat })),
      radius: 10000, priority: 'TIME',
    } });
    try {
      const summaries = new Map<number, Route>();
      for (const value of list(data.routes)) {
        const row = record(value);
        if (row.result_code === 0) summaries.set(nonnegativeInteger(row.key), KakaoProvider.carSummary(row.summary, []));
      }
      return summaries;
    } catch {
      throw new ProviderError(502, '자동차 요약 응답 형식이 올바르지 않습니다.');
    }
  }

  private static carSummary(value: unknown, path: Coordinates[]): Route {
    const summary = record(value);
    const meters = nonnegativeInteger(summary.distance);
    const seconds = nonnegativeInteger(summary.duration);
    const segments: Segment[] = path.length ? [{
      kind: 'car', distance_m: meters, duration_s: seconds, path, lines: [], stops: [],
    }] : [];
    return makeRoute('kakao_mobility', meters, seconds, segments, 0, fare(summary.fare, 'toll'));
  }

  static parseRoute(mode: TravelMode, data: Record<string, unknown>): Route {
    try {
      let route: Route | undefined;
      if (mode === 'car') {
        const row = record(list(data.routes)[0]);
        const code = nonnegativeInteger(row.result_code);
        if (missingCarCodes.has(code)) throw new NoRoute();
        if (code !== 0) throw new TypeError('Unknown route result code');
        const path = list(row.sections).flatMap(section =>
          list(record(section).roads).flatMap(road => {
            const vertices = list(record(road).vertexes);
            const points: Coordinates[] = [];
            for (let i = 0; i < vertices.length; i += 2) points.push(coordinates(vertices[i + 1], vertices[i]));
            return points;
          }));
        route = KakaoProvider.carSummary(row.summary, path);
      } else {
        const status = string(data.status);
        if (missingRouteStatuses.has(status)) throw new NoRoute();
        if (status !== 'OK') throw new TypeError('Unknown route status');
        if (mode === 'walk') {
          const row = record(data.route);
          const steps = list(row.legs).flatMap(leg => list(record(leg).steps));
          route = KakaoProvider.parseSteps(row, steps, true);
        } else {
          for (const value of list(data.routes)) {
            try {
              const row = record(value);
              const alternative = KakaoProvider.parseSteps(row, list(row.steps), false);
              if (alternative.geometry === 'polyline' && (!route || compareRoutes(alternative, route, mode) < 0)) {
                route = alternative;
              }
            } catch (error) {
              if (!(error instanceof TypeError)) throw error;
            }
          }
        }
      }
      if (route?.geometry !== 'polyline') throw new TypeError('Missing route geometry');
      return route;
    } catch (error) {
      if (error instanceof NoRoute) throw error;
      throw new ProviderError(502, '경로 응답 형식 또는 경로 좌표가 올바르지 않습니다.');
    }
  }

  private static parseSteps(row: Record<string, unknown>, steps: unknown[], walk: boolean): Route {
    const summary = record(row.properties);
    const segments = steps.map(value => {
      const step = record(value);
      const props = record(step.properties);
      const type = walk ? 'WALKING' : string(props.type);
      if (!Object.hasOwn(transitKinds, type)) throw new TypeError('Unknown step type');
      return {
        kind: transitKinds[type as keyof typeof transitKinds],
        distance_m: nonnegativeInteger(props.distance), duration_s: nonnegativeInteger(props.time),
        path: list((step.path ? record(step.path).points : undefined) ?? []).map(value => {
          const [lng, lat] = list(value);
          return coordinates(lat, lng);
        }),
        lines: list(props.vehicles ?? []).map(vehicle => string(record(vehicle).name)),
        stops: list(props.stops ?? []).map(stop => string(record(stop).name)),
      };
    });
    return makeRoute(
      'kakao_maps', nonnegativeInteger(summary.totalDistance), nonnegativeInteger(summary.totalTime),
      segments, walk ? 0 : nonnegativeInteger(summary.transfers), fare(summary.fare, 'value'),
    );
  }
}

function fare(value: unknown, name: string): number | null {
  const amount = value ? record(value)[name] : undefined;
  return amount == null ? null : nonnegativeInteger(amount);
}
