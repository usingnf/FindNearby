import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Coordinates, Recommendation, Route } from './Contracts';

type Props = {
  origin: Coordinates;
  items: Recommendation[];
  selectedId: string;
  routes: Route[];
  demo: boolean;
  onPick: (point: Coordinates) => void;
  onSelect: (id: string) => void;
};

type KakaoPoint = { getLat(): number; getLng(): number };
type KakaoMap = {
  setCenter(point: KakaoPoint): void;
  setBounds(bounds: KakaoBounds): void;
  getLevel(): number;
  setLevel(level: number): void;
  relayout(): void;
};
type KakaoBounds = { extend(point: KakaoPoint): void };
type KakaoOverlay = { setMap(map: KakaoMap | null): void };
export type KakaoMaps = {
  load(callback: () => void): void;
  Map: new (container: HTMLElement, options: { center: KakaoPoint; level: number }) => KakaoMap;
  LatLng: new (lat: number, lng: number) => KakaoPoint;
  LatLngBounds: new () => KakaoBounds;
  Marker: new (options: { position: KakaoPoint; title: string; clickable?: boolean }) => KakaoOverlay;
  CustomOverlay: new (options: { position: KakaoPoint; content: HTMLElement; clickable: boolean; zIndex: number }) => KakaoOverlay;
  Polyline: new (options: {
    path: KakaoPoint[]; strokeWeight: number; strokeColor: string; strokeOpacity: number;
    strokeStyle: string;
  }) => KakaoOverlay;
  event: {
    addListener<T>(target: KakaoMap | KakaoOverlay, event: string, callback: (payload: T) => void): void;
    removeListener<T>(target: KakaoMap | KakaoOverlay, event: string, callback: (payload: T) => void): void;
  };
};

export function loadKakao(key: string): Promise<KakaoMaps> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = window.setTimeout(fail, 7000);
    function fail() {
      window.clearTimeout(timer);
      script.remove();
      reject(new Error('카카오 지도를 불러오지 못했습니다.'));
    }
    script.onerror = fail;
    script.onload = () => {
      const maps = (window as Window & { kakao?: { maps: KakaoMaps } }).kakao?.maps;
      if (!maps?.load) return fail();
      maps.load(() => {
        window.clearTimeout(timer);
        if (maps.Map && maps.LatLng && maps.CustomOverlay) resolve(maps);
        else fail();
      });
    };
    script.src = 'https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey=' + encodeURIComponent(key);
    document.head.append(script);
  });
}

export const routeColors = ['#087967', '#b34e14', '#6741af'];
const tuple = ({ lat, lng }: Coordinates): L.LatLngTuple => [lat, lng];

function facilityPin(item: Recommendation, index: number, onSelect: Props['onSelect']) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rank-pin';
  button.style.backgroundColor = routeColors[index];
  button.textContent = String(index + 1);
  button.setAttribute('aria-label', `${index + 1}위 ${item.facility.name} 경로 선택`);
  button.setAttribute('aria-controls', 'route-detail');
  button.addEventListener('click', event => {
    event.stopPropagation();
    onSelect(item.facility.id);
  });
  return button;
}

function displayedPoints(origin: Coordinates, items: Recommendation[], routes: Route[]) {
  return [
    origin,
    ...items.flatMap(item => [item.facility.coordinates, item.destination]),
    ...routes.flatMap(route => route.segments.flatMap(segment => segment.path)),
  ];
}

function routeLines(items: Recommendation[], routes: Route[], selectedId: string) {
  return routes.flatMap((route, index) => route.segments.filter(segment => segment.path.length >= 2)
    .map(({ path }) => ({
      path,
      color: routeColors[index],
      // Draw wider lines first so shared portions retain each route's color.
      weight: 11 - index * 3,
      opacity: items[index].facility.id === selectedId ? 1 : .8,
    })));
}

export function LeafletMap({ origin, items, selectedId, routes, demo, onPick, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map>();
  const layers = useRef<L.LayerGroup>();
  const pins = useRef(new Map<string, HTMLButtonElement>());
  const [tileError, setTileError] = useState(false);
  useEffect(() => {
    const map = L.map(host.current!, { attributionControl: true }).setView(tuple(origin), 15);
    mapRef.current = map;
    layers.current = L.layerGroup().addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).on('tileerror', () => setTileError(true)).on('tileload', () => setTileError(false)).addTo(map);
    return () => {
      map.remove();
    };
  }, []);
  useEffect(() => {
    const map = mapRef.current!;
    const click = (event: L.LeafletMouseEvent) => onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    map.on('click', click);
    map.on('contextmenu', click);
    return () => {
      map.off('click', click);
      map.off('contextmenu', click);
    };
  }, [onPick]);
  useEffect(() => {
    const map = mapRef.current!;
    const container = host.current!;
    const points = displayedPoints(origin, items, routes);
    function fit() {
      if (!container.clientWidth || !container.clientHeight) return;
      map.invalidateSize({ pan: false });
      if (points.length > 1) {
        map.fitBounds(points.map(tuple), { padding: [36, 36], maxZoom: 16, animate: false });
      } else {
        map.setView(tuple(origin), Math.max(map.getZoom(), 14), { animate: false });
      }
    }
    const resize = new ResizeObserver(fit);
    resize.observe(container);
    return () => resize.disconnect();
  }, [origin, items, routes]);
  useEffect(() => {
    const group = layers.current!.clearLayers();
    for (const { path, color, weight, opacity } of routeLines(items, routes, selectedId)) {
      L.polyline(path.map(tuple), {
        color, weight, opacity, dashArray: demo ? '7 8' : undefined, interactive: false,
      }).addTo(group);
    }
    L.circleMarker(tuple(origin), {
      radius: 9, color: '#fff', weight: 3, fillColor: '#132c44', fillOpacity: 1, interactive: false,
    }).addTo(group);
  }, [origin, items, routes, selectedId, demo]);
  useEffect(() => {
    const group = L.layerGroup().addTo(mapRef.current!);
    const buttons = pins.current;
    items.forEach((item, index) => {
      const button = facilityPin(item, index, onSelect);
      buttons.set(item.facility.id, button);
      L.DomEvent.disableClickPropagation(button);
      L.marker(tuple(item.facility.coordinates), {
        keyboard: false, interactive: false,
        icon: L.divIcon({ className: 'map-pin-host', html: button, iconSize: [36, 36] }),
      }).addTo(group);
    });
    return () => { group.remove(); buttons.clear(); };
  }, [items, onSelect]);
  useEffect(() => {
    pins.current.forEach((button, id) => button.setAttribute('aria-pressed', String(id === selectedId)));
  }, [items, selectedId]);

  return <div className="map-surface">
    <div className="map-host" ref={host} aria-label="출발지와 가상 경로를 표시하는 지도" />
    <div role="status">{tileError && <p className="map-note">배경 지도를 불러올 수 없습니다. 좌표와 가상 경로는 계속 표시됩니다.</p>}</div>
  </div>;
}

export function KakaoMapView({ maps, origin, items, selectedId, routes, demo, onPick, onSelect }: Props & { maps: KakaoMaps }) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap>();
  const pins = useRef(new Map<string, HTMLButtonElement>());
  const point = ({ lat, lng }: Coordinates) => new maps.LatLng(lat, lng);
  useEffect(() => {
    const container = host.current!;
    mapRef.current = new maps.Map(container, { center: point(origin), level: 5 });
    return () => { container.replaceChildren(); };
  }, [maps]);
  useEffect(() => {
    const map = mapRef.current!;
    const click = (event: { latLng: KakaoPoint }) => onPick({ lat: event.latLng.getLat(), lng: event.latLng.getLng() });
    maps.event.addListener(map, 'click', click);
    maps.event.addListener(map, 'rightclick', click);
    return () => {
      maps.event.removeListener(map, 'click', click);
      maps.event.removeListener(map, 'rightclick', click);
    };
  }, [maps, onPick]);
  useEffect(() => {
    const map = mapRef.current!;
    const container = host.current!;
    const points = displayedPoints(origin, items, routes);
    function fit() {
      if (!container.clientWidth || !container.clientHeight) return;
      map.relayout();
      if (points.length === 1) {
        map.setCenter(point(origin));
      } else {
        const bounds = new maps.LatLngBounds();
        points.forEach(coordinates => bounds.extend(point(coordinates)));
        map.setBounds(bounds);
      }
    }
    const resize = new ResizeObserver(fit);
    resize.observe(container);
    return () => resize.disconnect();
  }, [maps, origin, items, routes]);
  useEffect(() => {
    const buttons = pins.current;
    const overlays = items.map((item, index) => {
      const button = facilityPin(item, index, onSelect);
      buttons.set(item.facility.id, button);
      const overlay = new maps.CustomOverlay({
        position: point(item.facility.coordinates), content: button, clickable: true, zIndex: 3,
      });
      overlay.setMap(mapRef.current!);
      return overlay;
    });
    return () => { overlays.forEach(overlay => overlay.setMap(null)); buttons.clear(); };
  }, [maps, items, onSelect]);
  useEffect(() => {
    pins.current.forEach((button, id) => button.setAttribute('aria-pressed', String(id === selectedId)));
  }, [maps, items, selectedId]);
  useEffect(() => {
    const map = mapRef.current!;
    const overlays: KakaoOverlay[] = [];
    const add = (overlay: KakaoOverlay) => {
      overlay.setMap(map);
      overlays.push(overlay);
    };
    add(new maps.Marker({ position: point(origin), title: '출발지' }));
    const access = items.find(item => item.facility.id === selectedId)?.access;
    if (access) add(new maps.Marker({ position: point(access.coordinates), title: access.label }));
    for (const { path, color, weight, opacity } of routeLines(items, routes, selectedId)) {
      add(new maps.Polyline({
        path: path.map(point), strokeWeight: weight, strokeColor: color,
        strokeOpacity: opacity, strokeStyle: demo ? 'shortdash' : 'solid',
      }));
    }
    return () => {
      overlays.forEach(overlay => overlay.setMap(null));
    };
  }, [maps, origin, items, selectedId, routes, demo]);

  function zoom(delta: number) {
    const map = mapRef.current!;
    map.setLevel(map.getLevel() + delta);
  }

  return <div className="map-surface">
    <div className="map-zoom" role="group" aria-label="지도 확대 및 축소">
      <button aria-label="지도 확대" onClick={() => zoom(-1)}>+</button>
      <button aria-label="지도 축소" onClick={() => zoom(1)}>−</button>
    </div>
    <div className="map-host" ref={host} onContextMenu={event => event.preventDefault()}
      aria-label="출발지와 추천 경로를 표시하는 카카오 지도" />
  </div>;
}
