import { type Coordinates, facilities, inServiceArea, modes, type Recommendation, type Route, type SearchQuery, type StopReason, type TravelMode } from './Contracts.ts';

export type AccessPoint = NonNullable<Recommendation['access']> & {
  facility_address: string;
};

export class ApiError extends Error {
  constructor(public readonly status: number, detail: string) {
    super(detail);
  }
}

export class ProviderError extends ApiError {
  constructor(
    status: number, detail: string,
    public readonly reason: StopReason = 'provider_error',
    public readonly attempted = true,
    public readonly retryable = false,
  ) {
    super(status, detail);
  }
}

export class NoRoute extends ApiError {
  constructor() {
    super(404, '선택한 이동수단으로 이용할 수 있는 경로가 없습니다.');
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected an object');
  return value as Record<string, unknown>;
}

export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Expected an array');
  return value;
}

export function string(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected a string');
  return value;
}

function finite(value: unknown): number {
  const result = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof result !== 'number' || !Number.isFinite(result)) throw new TypeError('Expected a finite number');
  return result;
}

export function nonnegativeInteger(value: unknown): number {
  const result = finite(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new TypeError('Expected a nonnegative integer');
  return result;
}

export function coordinates(lat: unknown, lng: unknown): Coordinates {
  const point = { lat: finite(lat), lng: finite(lng) };
  if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) throw new TypeError('Invalid coordinates');
  return point;
}

export function parseSearch(value: unknown): SearchQuery {
  try {
    const { origin, mode, kind, demo = true } = record(value);
    const point = record(origin);
    const position = coordinates(point.lat, point.lng);
    if (typeof mode !== 'string' || !Object.hasOwn(modes, mode) ||
        typeof kind !== 'string' || !Object.hasOwn(facilities, kind) || typeof demo !== 'boolean') {
      throw new TypeError('Invalid search options');
    }
    if (!inServiceArea(position)) throw new ApiError(422, '대한민국 내 출발지를 선택하세요.');
    return { origin: position, mode: mode as TravelMode, kind: kind as SearchQuery['kind'], demo };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, '출발지와 검색 조건을 확인하세요.');
  }
}

export function parseDestination(value: unknown): Coordinates {
  try {
    const point = record(value);
    const position = coordinates(point.lat, point.lng);
    if (inServiceArea(position)) return position;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  throw new ApiError(422, '대한민국 내 목적지를 선택하세요.');
}

export function distance(a: Coordinates, b: Coordinates): number {
  const radians = Math.PI / 180;
  const lat = a.lat * radians;
  const other = b.lat * radians;
  const h = Math.sin((other - lat) / 2) ** 2 +
    Math.cos(lat) * Math.cos(other) * Math.sin((b.lng - a.lng) * radians / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function samePoint(a: Coordinates, b: Coordinates): boolean {
  return a.lat === b.lat && a.lng === b.lng;
}

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function makeRoute(
  source: Route['source'], distance_m: number, duration_s: number,
  segments: Route['segments'], transfers = 0, fare_won: number | null = null,
): Route {
  return {
    distance_m, duration_s, transfers, fare_won, segments, source,
    calculated_at: new Date().toISOString(),
    geometry: segments.some(({ path }) => path.length >= 2) ? 'polyline' : 'summary',
    walking_distance_m: source === 'kakao_mobility' || segments.some(({ kind }) => kind === 'car')
      ? null
      : segments.reduce((sum, segment) => sum + (segment.kind === 'walk' ? segment.distance_m : 0), 0),
  };
}

export function compareRoutes(a: Route, b: Route, mode: TravelMode): number {
  if (mode === 'walk') return a.distance_m - b.distance_m || a.duration_s - b.duration_s;
  if (mode === 'car') return a.duration_s - b.duration_s || a.distance_m - b.distance_m;
  return a.duration_s - b.duration_s || a.transfers - b.transfers ||
    (a.walking_distance_m ?? 0) - (b.walking_distance_m ?? 0);
}
