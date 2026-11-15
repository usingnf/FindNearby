import { SearchBudget } from './CallBudget.ts';
import { type Coordinates, type Facility, facilities, inServiceArea, type Recommendation, type RecommendResult, type Route, type SearchQuery, type StopReason } from './Contracts.ts';
import { addressKeys, type FacilityStore, normalized } from './FacilityStore.ts';
import type { KakaoProvider } from './KakaoProvider.ts';
import { compareRoutes, compareText, distance, makeRoute, NoRoute, ProviderError, samePoint } from './Models.ts';
import { DatabaseError } from './SupabaseDatabase.ts';

const recommendationLimit = 3;
const radii = {
  walk: [500, 1000, 3000, 5000, 10000, 20000],
  transit: [2000, 3000, 5000, 10000, 20000],
  car: [2000, 3000, 5000, 10000, 20000],
};
const demoOffsets = [
  [.0018, .0016], [-.0026, .0017], [.0024, -.0025],
  [-.0012, -.0032], [.0009, .0039], [-.0037, -.0010],
];
const demoSpeed = { walk: 1.3, transit: 4.5, car: 7.5 };

function matchName(facility: Facility): string {
  const name = normalized(facility.name);
  return facility.kind === 'restroom' ? name.replace(/공중화장실$/, '').replace(/화장실$/, '') || name : name;
}

function isDuplicate(facility: Facility, other: Facility): boolean {
  if (distance(facility.coordinates, other.coordinates) >= 25) return false;
  const left = addressKeys(facility);
  const right = addressKeys(other);
  return left.size && right.size
    ? [...left].some(address => right.has(address))
    : normalized(facility.name) === normalized(other.name);
}

function canUsePartialResults(error: unknown): error is ProviderError {
  return error instanceof ProviderError && error.reason === 'provider_error' &&
    (error.status === 502 || error.status === 504);
}

export class RecommendationService {
  constructor(
    private readonly provider: KakaoProvider, private readonly store: FacilityStore,
    private readonly searchCalls: number, private readonly searchSeconds: number,
  ) {}

  static simulate(query: SearchQuery, destination: Coordinates): Route {
    const { origin, mode } = query;
    if (samePoint(origin, destination)) throw new NoRoute();
    const bend = { lat: origin.lat, lng: destination.lng };
    const meters = Math.round(distance(origin, bend) + distance(bend, destination));
    const seconds = Math.round(meters / demoSpeed[mode]) + (mode === 'transit' ? 120 : 0);
    return makeRoute('demo', meters, seconds, [{
      kind: mode === 'transit' ? 'bus' : mode, distance_m: meters, duration_s: seconds,
      path: [origin, bend, destination], lines: [], stops: [],
    }]);
  }

  private async *candidatePages(query: SearchQuery, search: SearchBudget) {
    const { origin, mode, kind } = query;
    if (query.demo) {
      const demo: Facility[] = demoOffsets.map(([dy, dx], index) => ({
        id: `demo:${kind}:${index + 1}`, name: `가상 ${facilities[kind]} ${index + 1}`, kind, source: 'demo',
        coordinates: { lat: origin.lat + dy, lng: origin.lng + dx },
        address: '', alternate_address: '', source_label: '', hours: '', updated: '',
      }));
      yield { radius: radii[mode][0], facilities: demo };
      return;
    }
    for (const radius of radii[mode]) {
      search.checkCall();
      let publicFacilities = kind === 'restroom' ? await this.store.nearby(origin, radius, search) : [];
      for (let page = 1; page <= 45; page++) {
        try {
          const { places, lastPage } = await this.provider.facilities(origin, kind, radius, page, search);
          yield { radius, facilities: publicFacilities.concat(places) };
          if (lastPage) break;
          publicFacilities = [];
        } catch (error) {
          if (publicFacilities.length && canUsePartialResults(error)) yield { radius, facilities: publicFacilities };
          throw error;
        }
      }
    }
  }

  private async carSummaries(query: SearchQuery, destinations: Coordinates[], search: SearchBudget) {
    const mapped = new Map<number, Route>();
    if (query.demo || query.mode !== 'car') return mapped;
    const eligible = destinations.map((destination, index) => ({ destination, index })).filter(({ destination }) =>
      !samePoint(query.origin, destination) && distance(query.origin, destination) <= 10000);
    if (eligible.length < 2) return mapped;
    try {
      const summaries = await this.provider.carSummaries(query.origin, eligible.map(item => item.destination), search);
      eligible.forEach(({ index }, position) => {
        const route = summaries.get(position);
        if (route) mapped.set(index, route);
      });
    } catch (error) {
      if (!canUsePartialResults(error)) throw error;
    }
    return mapped;
  }

  async recommend(query: SearchQuery): Promise<RecommendResult> {
    const { origin, mode, demo } = query;
    const search = new SearchBudget(this.searchCalls, this.searchSeconds, mode === 'car' ? recommendationLimit : 0);
    const seenIds = new Set<string>();
    const byName = new Map<string, Facility[]>();
    const recommendations: Recommendation[] = [];
    let matched = 0;
    let publicMatched = 0;
    let failed = 0;
    let unavailable = 0;
    let radiusM = 0;
    let lastError: ProviderError | undefined;
    let stopReason: StopReason = demo ? 'exhausted' : 'radius_limit';
    try {
      for await (const { radius, facilities } of this.candidatePages(query, search)) {
        radiusM = radius;
        const pending: Facility[] = [];
        for (const facility of facilities) {
          if (seenIds.has(facility.id) || !inServiceArea(facility.coordinates) ||
              distance(origin, facility.coordinates) > radius) continue;
          seenIds.add(facility.id);
          const name = matchName(facility);
          const locations = byName.get(name) ?? [];
          if (locations.some(other => isDuplicate(facility, other))) continue;
          locations.push(facility);
          byName.set(name, locations);
          pending.push(facility);
          if (facility.source === 'public') publicMatched++;
        }
        matched += pending.length;
        pending.sort((a, b) => distance(origin, a.coordinates) - distance(origin, b.coordinates) || compareText(a.id, b.id));
        for (let start = 0; start < pending.length; start += 10) {
          const batch = pending.slice(start, start + 10);
          const points = await this.store.accessFor(batch, mode, origin, search);
          const destinations = batch.map((facility, index) => points[index]?.coordinates ?? facility.coordinates);
          const summaries = await this.carSummaries(query, destinations, search);
          for (const [index, facility] of batch.entries()) {
            const destination = destinations[index];
            try {
              if (samePoint(origin, destination)) throw new NoRoute();
              const route = demo ? RecommendationService.simulate(query, destination)
                : summaries.get(index) ?? await this.provider.route(mode, origin, destination, search);
              recommendations.push({ facility, access: points[index], destination, route });
            } catch (error) {
              if (error instanceof NoRoute) {
                unavailable++;
              } else if (error instanceof ProviderError) {
                failed += Number(error.attempted);
                lastError = error;
                if (error.reason !== 'provider_error' || error.status === 503) throw error;
              } else {
                throw error;
              }
            }
          }
        }
      }
      if (failed) stopReason = 'provider_error';
    } catch (error) {
      if (error instanceof DatabaseError) {
        lastError = new ProviderError(503, error.message, 'provider_error', false);
        try { search.remainingTime(); } catch (deadline) {
          if (!(deadline instanceof ProviderError)) throw deadline;
          lastError = deadline;
        }
      } else if (error instanceof ProviderError) {
        lastError = error;
      } else {
        throw error;
      }
      stopReason = lastError.reason;
    }
    if (!recommendations.length && lastError && stopReason === 'provider_error') throw lastError;
    recommendations.sort((a, b) => compareRoutes(a.route, b.route, mode) || compareText(a.facility.id, b.facility.id));
    return {
      recommendations: recommendations.slice(0, recommendationLimit),
      matched, public_matched: publicMatched, evaluated: recommendations.length + failed + unavailable,
      radius_m: radiusM, failed, unavailable, demo, stop_reason: stopReason,
    };
  }
}
