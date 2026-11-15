export type Coordinates = { lat: number; lng: number };
export type FacilityType = 'convenience' | 'subway' | 'restroom';
export type TravelMode = 'walk' | 'transit' | 'car';
export type Place = { name: string; address: string; coordinates: Coordinates };
export type Facility = Place & {
  id: string;
  kind: FacilityType;
  source: 'demo' | 'kakao' | 'public';
  source_label: string;
  alternate_address: string;
  hours: string;
  updated: string;
};
export type Segment = {
  kind: 'walk' | 'bus' | 'subway' | 'car';
  distance_m: number;
  duration_s: number;
  path: Coordinates[];
  lines: string[];
  stops: string[];
};
export type Route = {
  distance_m: number;
  duration_s: number;
  transfers: number;
  fare_won: number | null;
  calculated_at: string;
  segments: Segment[];
  source: 'demo' | 'kakao_maps' | 'kakao_mobility';
  geometry: 'summary' | 'polyline';
  walking_distance_m: number | null;
};
export type Recommendation = {
  facility: Facility;
  access: { coordinates: Coordinates; label: string; source: string; verified_on: string } | null;
  destination: Coordinates;
  route: Route;
};
export type StopReason =
  | 'exhausted' | 'radius_limit' | 'rank_bound' | 'call_budget'
  | 'rate_limited' | 'deadline' | 'provider_error';
export type RecommendResult = {
  recommendations: Recommendation[];
  matched: number;
  public_matched: number;
  evaluated: number;
  radius_m: number;
  unavailable: number;
  failed: number;
  demo: boolean;
  stop_reason: StopReason;
};
export type SearchQuery = { origin: Coordinates; mode: TravelMode; kind: FacilityType; demo: boolean };
export type ApiStatus = { live_ready: boolean; facilities: number; access_points: number; map_js_key?: string };

export const facilities = {
  convenience: '편의점', subway: '지하철역', restroom: '공중화장실',
} satisfies Record<FacilityType, string>;

export const modes = { walk: '도보', transit: '대중교통', car: '자동차' } satisfies Record<TravelMode, string>;

export function inServiceArea({ lat, lng }: Coordinates) {
  return lat >= 32.8 && lat <= 39.5 && lng >= 124 && lng <= 132;
}
