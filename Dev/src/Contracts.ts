import type { Place } from '../supabase/functions/find-nearby/Contracts';
export * from '../supabase/functions/find-nearby/Contracts';

export const examples: Place[] = [
  { name: '서울시청', address: '서울 중구', coordinates: { lat: 37.5663, lng: 126.9779 } },
  { name: '판교역', address: '경기 성남시', coordinates: { lat: 37.3948, lng: 127.1112 } },
  { name: '부산역', address: '부산 동구', coordinates: { lat: 35.1151, lng: 129.0414 } },
];

export function distanceLabel(meters: number) {
  return meters < 1000 ? meters + 'm' : (meters / 1000).toFixed(1) + 'km';
}

export async function api<T>(path: string, signal: AbortSignal, payload?: object): Promise<T> {
  const response = await fetch('/api/' + path, {
    signal,
    ...(payload ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    } : {}),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body === null) {
    throw new Error(typeof body?.detail === 'string' ? body.detail : '서버 응답을 확인할 수 없습니다. 다시 시도하세요.');
  }
  return body as T;
}
