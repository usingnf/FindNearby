import type { SearchBudget } from './CallBudget.ts';
import type { Coordinates, Facility, TravelMode } from './Contracts.ts';
import { type AccessPoint, compareText, distance } from './Models.ts';
import type { SupabaseDatabase } from './SupabaseDatabase.ts';

const regionNames: Record<string, string> = {
  서울: '서울특별시', 인천: '인천광역시', 부산: '부산광역시', 대구: '대구광역시',
  울산: '울산광역시', 대전: '대전광역시', 광주: '광주광역시', 경기: '경기도', 전남: '전라남도',
};

export function normalized(value: string): string {
  return value.toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ').replace(/\s+/gu, '');
}

function addressKey(value: string): string {
  const address = value.normalize('NFKC').trim().replace(/\s*\([^()]*\)\s*$/, '').replace(/(?<=\d)\s*,.*$/, '');
  return normalized(address.replace(/^([^ ]+) /, (match, region: string) =>
    Object.hasOwn(regionNames, region) ? regionNames[region] + ' ' : match));
}

export function addressKeys(facility: Facility): Set<string> {
  return new Set([addressKey(facility.address), addressKey(facility.alternate_address)].filter(Boolean));
}

function facilityNames(facility: Facility): string[] {
  const name = normalized(facility.name);
  const station = facility.kind === 'subway' ? /^(.+역)(?:인천)?\d+호선$/.exec(name)?.[1] : undefined;
  return station ? [name, station] : [name];
}

type AccessRow = { facility_id: string; name: string; point: AccessPoint };

export class FacilityStore {
  constructor(private readonly db: SupabaseDatabase) {}

  async nearby(origin: Coordinates, radius: number, search: SearchBudget): Promise<Facility[]> {
    const dy = radius / 110_000;
    const dx = radius / (110_000 * Math.cos((origin.lat + dy) * Math.PI / 180));
    const rows = await this.db.rpc<Facility[]>('find_nearby_facilities', {
      min_lat: origin.lat - dy, max_lat: origin.lat + dy,
      min_lng: origin.lng - dx, max_lng: origin.lng + dx,
    }, Math.min(4000, search.remainingTime()));
    return rows.filter(facility => distance(origin, facility.coordinates) <= radius)
      .sort((a, b) => distance(origin, a.coordinates) - distance(origin, b.coordinates) || compareText(a.id, b.id));
  }

  async accessFor(batch: Facility[], mode: TravelMode, origin: Coordinates, search: SearchBudget): Promise<(AccessPoint | null)[]> {
    if (batch[0].source === 'demo') return batch.map(() => null);
    const rows = await this.db.rpc<AccessRow[]>('find_nearby_access', {
      facility_kind: batch[0].kind, travel_mode: mode,
      facility_ids: batch.map(facility => facility.id),
      facility_names: [...new Set(batch.flatMap(facilityNames))],
    }, Math.min(4000, search.remainingTime()));

    return await Promise.all(batch.map(async facility => {
      const names = facilityNames(facility);
      const addresses = addressKeys(facility);
      const exact: AccessPoint[] = [];
      const corroborated: AccessPoint[] = [];
      const legacy: AccessPoint[] = [];
      for (const { facility_id, name, point } of rows) {
        if (distance(facility.coordinates, point.coordinates) > 350) continue;
        if (facility_id === facility.id) exact.push(point);
        else if (!facility_id && names.includes(name)) {
          if (addresses.has(addressKey(point.facility_address))) corroborated.push(point);
          else if (!point.facility_address && facility.source === 'public') legacy.push(point);
        }
      }
      let points = exact.length ? exact : corroborated;
      if (!points.length && legacy.length) {
        points = [];
        for (const point of legacy) {
          const nearby = await this.nearby(point.coordinates, 350, search);
          if (!nearby.some(other => other.id !== facility.id && normalized(other.name) === names[0])) {
            points.push(point);
          }
        }
      }
      return points.sort((a, b) => distance(origin, a.coordinates) - distance(origin, b.coordinates) ||
        compareText(a.label, b.label) || a.coordinates.lat - b.coordinates.lat || a.coordinates.lng - b.coordinates.lng)[0] ?? null;
    }));
  }
}
