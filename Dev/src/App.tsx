import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  api, distanceLabel, examples, facilities, inServiceArea, modes,
} from './Contracts';
import type {
  ApiStatus, Coordinates, FacilityType, Place, RecommendResult, Recommendation, Route, SearchQuery, StopReason, TravelMode,
} from './Contracts';
import { KakaoMapView, LeafletMap, loadKakao, routeColors } from './MapView';
import type { KakaoMaps } from './MapView';
import './스타일_FindNearby_화면.css';

const buildKakaoKey = (import.meta.env.VITE_KAKAO_JS_KEY as string | undefined)?.trim();
const emptyItems: Recommendation[] = [];
type RouteDetail = { route?: Route; error?: string };
const sourceLabels = { demo: '가상 시설', kakao: '카카오맵', public: '공공데이터' };
const segmentLabels = { walk: '도보', bus: '버스', subway: '지하철', car: '자동차' };
const manualOrigin = '주소 검색 또는 좌표 직접 입력으로 출발지를 지정할 수 있습니다.';
const formatTime = (seconds: number) => seconds < 60 ? seconds + '초' : Math.ceil(seconds / 60) + '분';
const formatQueryTime = (value: string) => new Date(value).toLocaleTimeString('ko-KR');
const routeSources = { demo: '가상 경로', kakao_maps: '카카오맵', kakao_mobility: '카카오모빌리티' };
const stopMessages: Record<StopReason, string> = {
  exhausted: '',
  radius_limit: '최대 검색 반경 안에서 평가한 결과입니다.',
  rank_bound: '확인된 순위 기준에 따라 탐색을 마쳤습니다.',
  call_budget: 'API 호출 한도에 도달해 평가를 마친 후보만 표시합니다.',
  rate_limited: '카카오 API 호출 제한으로 검색이 중단됐습니다. 잠시 뒤 다시 시도하세요.',
  deadline: '검색 시간이 초과되어 평가를 마친 후보만 표시합니다.',
  provider_error: '일부 조회에 실패해 평가를 마친 후보만 표시합니다.',
};

function App() {
  const [origin, setOrigin] = useState(examples[0]);
  const [kind, setKind] = useState<FacilityType>('convenience');
  const [mode, setMode] = useState<TravelMode>('walk');
  const [maps, setMaps] = useState<KakaoMaps>();
  const [mapError, setMapError] = useState('');
  const [status, setStatus] = useState<ApiStatus>();
  const kakaoKey = buildKakaoKey || status?.map_js_key?.trim();
  const [statusError, setStatusError] = useState('');
  const [term, setTerm] = useState('');
  const [addresses, setAddresses] = useState<Place[]>([]);
  const [originNote, setOriginNote] = useState('');
  const [addressPending, setAddressPending] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');
  const originHeading = useRef<HTMLHeadingElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const mapHeading = useRef<HTMLHeadingElement>(null);
  const routeHeading = useRef<HTMLHeadingElement>(null);
  const panelFocus = useRef<'route' | 'map'>();
  const addressRequest = useRef<AbortController>();
  const originIntent = useRef(0);
  const [run, setRun] = useState(0);
  const [search, setSearch] = useState<{ request: object; result?: RecommendResult; error?: string }>();
  const [selectedId, setSelectedId] = useState('');
  const [details, setDetails] = useState<{ result: RecommendResult; byId: Record<string, RouteDetail> }>();
  const detailController = useRef<AbortController>();
  const live = Boolean(status?.live_ready);
  const connecting = !status && !statusError;
  const { lat, lng } = origin.coordinates;
  const request = useMemo(() => {
    const query: SearchQuery = { origin: { lat, lng }, kind, mode, demo: !live };
    return { run, query };
  }, [lat, lng, kind, mode, live, run]);
  const result = search?.request === request ? search.result : undefined;
  const searchError = search?.request === request ? search.error : undefined;
  const items = result?.recommendations ?? emptyItems;
  const chosen = items.find(item => item.facility.id === selectedId) ?? items[0];
  const currentDetails = details?.result === result ? details?.byId : undefined;
  const detailCurrent = chosen && currentDetails?.[chosen.facility.id];
  const route = chosen?.route.geometry === 'polyline' ? chosen.route : detailCurrent?.route;
  const routes = useMemo(() => items.map(item => currentDetails?.[item.facility.id]?.route ?? item.route),
    [items, currentDetails]);
  const shownRoute = route ?? chosen?.route;
  const routePending = Boolean(chosen && !route && !detailCurrent?.error);
  const searching = run > 0 && !result && !searchError;
  const searchIncomplete = result && ['call_budget', 'rate_limited', 'deadline', 'provider_error'].includes(result.stop_reason);

  useEffect(() => {
    if (run) resultsHeading.current?.focus();
  }, [run]);

  useEffect(() => {
    const target = panelFocus.current;
    panelFocus.current = undefined;
    if (target === 'map') mapHeading.current?.focus();
    if (target === 'route') routeHeading.current?.focus();
  }, [view]);

  useEffect(() => {
    const controller = new AbortController();
    api<ApiStatus>('status', controller.signal).then(setStatus, () => {
      if (!controller.signal.aborted) setStatusError('검색 서버에 연결할 수 없습니다. 서버 실행 상태를 확인하세요.');
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!kakaoKey) return;
    let cancelled = false;
    loadKakao(kakaoKey).then(
      sdk => { if (!cancelled) setMaps(sdk); },
      () => { if (!cancelled) setMapError('카카오 지도에 연결하지 못했습니다.'); },
    );
    return () => { cancelled = true; };
  }, [kakaoKey]);

  useEffect(() => {
    if (!request.run) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<RecommendResult>('recommend', controller.signal, request.query).then(
        response => {
          if (controller.signal.aborted) return;
          setSelectedId('');
          setSearch({ request, result: response });
        },
        (error: Error) => {
          if (!controller.signal.aborted) setSearch({ request, error: error.message });
        },
      );
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [request]);

  const loadDetail = useCallback((item: Recommendation, result: RecommendResult, query: SearchQuery, signal: AbortSignal) => {
    function save(detail: RouteDetail) {
      if (signal.aborted) return;
      setDetails(previous => ({
        result,
        byId: { ...(previous?.result === result ? previous.byId : {}), [item.facility.id]: detail },
      }));
    }
    save({});
    api<Route>('route', signal, { ...query, destination: item.destination }).then(
      route => save({ route }),
      (error: Error) => save({ error: error.message }),
    );
  }, []);

  useEffect(() => {
    if (!result) return;
    const controller = new AbortController();
    detailController.current = controller;
    for (const item of result.recommendations) {
      if (item.route.geometry === 'summary') loadDetail(item, result, request.query, controller.signal);
    }
    return () => {
      controller.abort();
      detailController.current = undefined;
    };
  }, [result, request, loadDetail]);

  const changeOrigin = useCallback((place: Place) => {
    originIntent.current += 1;
    addressRequest.current?.abort();
    setAddressPending(false);
    if (!inServiceArea(place.coordinates)) {
      setOriginNote('대한민국 내 출발지를 선택하세요.');
      return;
    }
    setOrigin(place);
    setAddresses([]);
    setOriginNote('');
  }, []);

  const pickMap = useCallback((coordinates: Coordinates) => {
    changeOrigin({ name: '지도에서 선택한 위치', address: '', coordinates });
  }, [changeOrigin]);

  function useLocation() {
    if (!navigator.geolocation) {
      setOriginNote('위치 기능을 사용할 수 없습니다. ' + manualOrigin);
      return;
    }
    addressRequest.current?.abort();
    setAddressPending(false);
    const intent = ++originIntent.current;
    setOriginNote('현재 위치 확인 중…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (intent !== originIntent.current) return;
        changeOrigin({
          name: '현재 위치', address: '',
          coordinates: { lat: coords.latitude, lng: coords.longitude },
        });
      },
      ({ code }) => {
        if (intent === originIntent.current) {
          const message = code === 1 ? '위치 권한이 거부되었습니다.' : '현재 위치를 확인할 수 없습니다.';
          setOriginNote(message + ' ' + manualOrigin);
        }
      },
      { timeout: 8000 },
    );
  }

  async function findAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (connecting) return;
    originIntent.current += 1;
    addressRequest.current?.abort();
    setAddresses([]);
    setOriginNote('');
    const input = term.trim();
    if (input.length < 2) {
      setOriginNote('주소나 예시 장소를 두 글자 이상 입력하세요.');
      setAddressPending(false);
      return;
    }
    if (!live) {
      const matches = examples.filter(place => (place.name + place.address).includes(input));
      setAddresses(matches);
      setAddressPending(false);
      if (!matches.length) setOriginNote('데모에서는 서울시청, 판교역, 부산역을 검색할 수 있습니다.');
      return;
    }
    const controller = new AbortController();
    addressRequest.current = controller;
    setAddressPending(true);
    try {
      const matches = await api<Place[]>('addresses?q=' + encodeURIComponent(input), controller.signal);
      if (controller.signal.aborted) return;
      setAddresses(matches);
      if (!matches.length) setOriginNote('주소 검색 결과가 없습니다. 도로명과 건물번호를 확인하거나 좌표를 직접 입력하세요.');
    } catch (error) {
      if (!controller.signal.aborted) setOriginNote((error as Error).message + ' 주소 검색을 다시 시도하거나 좌표를 직접 입력하세요.');
    } finally {
      if (!controller.signal.aborted) setAddressPending(false);
    }
  }

  function enterCoordinates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    changeOrigin({
      name: '직접 입력한 위치', address: '',
      coordinates: { lat: Number(values.get('lat')), lng: Number(values.get('lng')) },
    });
  }

  function startSearch() {
    if (connecting || searching) return;
    setView('list');
    setRun(previous => previous + 1);
  }

  function showPanel(next: 'list' | 'map') {
    if (view === next) {
      (next === 'map' ? mapHeading : routeHeading).current?.focus();
      return;
    }
    panelFocus.current = next === 'map' ? 'map' : 'route';
    setView(next);
  }

  function retryDetail() {
    if (!chosen || !result || !detailController.current) return;
    routeHeading.current?.focus();
    loadDetail(chosen, result, request.query, detailController.current.signal);
  }

  const mapProps = {
    origin: origin.coordinates, items, selectedId: chosen?.facility.id ?? '', routes,
    demo: !live, onPick: pickMap, onSelect: setSelectedId,
  };

  return <>
    <a className="skip-link" href="#origin-heading">출발지 설정으로 이동</a>
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">↗</span> FindNearby</div>
      <span className={'mode-badge' + (live ? ' mode-live' : '')} role="status">
        {connecting ? '연결 확인 중' : live ? '실제 데이터' : '개발용 데모'}
      </span>
    </header>
    <main className="workspace" data-view={view}>
      <section className="controls" aria-label="주변 시설 검색">
        <div className="intro">
          <h1>주변 시설 길찾기</h1>
          <p>출발지와 이동수단을 선택해 가까운 시설을 비교하세요.</p>
        </div>
        <div className="block">
          <h2 id="origin-heading" tabIndex={-1} ref={originHeading}>출발지</h2>
          <div className="origin" role="status">
            <span className="origin-dot" aria-hidden="true" />
            <div><strong>{origin.name}</strong><small>{origin.address || (origin.coordinates.lat.toFixed(5) + ', ' + origin.coordinates.lng.toFixed(5))}</small></div>
          </div>
          <form className="search-form" onSubmit={findAddress}>
            <input aria-label="주소 또는 예시 장소" value={term} onChange={event => setTerm(event.target.value)} placeholder={live ? '도로명 주소 입력' : '예시: 판교역'} maxLength={120} />
            <button type="submit" aria-disabled={connecting}>{addressPending ? '검색 중' : '주소 검색'}</button>
          </form>
          {addresses.length > 0 && <ul className="address-results">
            {addresses.map((place, index) => <li key={index}><button onClick={() => {
              changeOrigin(place);
              originHeading.current?.focus();
            }}>{place.name} {place.address && <small>{place.address}</small>}</button></li>)}
          </ul>}
          <div className="origin-actions">
            <button onClick={useLocation}>현재 위치</button>
            <details><summary>좌표 직접 입력</summary>
              <form className="coords" onSubmit={enterCoordinates}>
                <label>위도<input name="lat" type="number" step="any" required defaultValue={origin.coordinates.lat} key={'lat' + origin.coordinates.lat} /></label>
                <label>경도<input name="lng" type="number" step="any" required defaultValue={origin.coordinates.lng} key={'lng' + origin.coordinates.lng} /></label>
                <button type="submit">적용</button>
              </form>
            </details>
          </div>
          <div role="status">
            {addressPending && <p className="result-meta">주소를 검색하고 있습니다.</p>}
            {addresses.length > 0 && <p className="sr-only">검색 결과 {addresses.length}곳을 찾았습니다. 목록에서 출발지를 선택하세요.</p>}
            {originNote && <p className="notice">{originNote}</p>}
          </div>
        </div>
        <div className="block">
          <h2 id="facility-heading">시설 유형</h2>
          <div className="choices" role="group" aria-labelledby="facility-heading">
            {(Object.keys(facilities) as FacilityType[]).map(value => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{facilities[value]}</button>)}
          </div>
          <h2 id="mode-heading">이동수단</h2>
          <div className="choices" role="group" aria-labelledby="mode-heading">
            {(Object.keys(modes) as TravelMode[]).map(value => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{modes[value]}</button>)}
          </div>
          <button className="search-primary" onClick={startSearch} aria-disabled={connecting || searching}>{searching ? '주변 시설 검색 중…' : '주변 시설 추천'}</button>
          {!connecting && !live && <p className="demo-note">가상 시설과 점선 경로를 표시합니다. 실제 이동 안내에 사용할 수 없습니다.</p>}
          <div role="status">
            {(mapError || statusError) && <p className="notice">{[mapError, statusError].filter(Boolean).join(' ')} {manualOrigin}</p>}
          </div>
        </div>
        <div className="view-switch" role="group" aria-label="결과 표시 방식">
          <button aria-controls="results" aria-pressed={view === 'list'} onClick={() => setView('list')}>목록 보기</button>
          <button aria-controls="map-panel" aria-pressed={view === 'map'} onClick={() => setView('map')}>지도 보기</button>
        </div>
        <section id="results" className="results" aria-labelledby="results-heading">
          <h2 id="results-heading" tabIndex={-1} ref={resultsHeading}>검색된 시설 중 추천 경로 상위 3개</h2>
          <div role="status">
            {!run && <p className="empty">시설을 검색하면 최대 3곳을 표시합니다.</p>}
            {searching && <p className="empty">선택한 이동수단으로 경로를 비교하고 있습니다.</p>}
            {searchError && <p className="notice">{searchError}</p>}
            {result && <p className="result-meta">
              {result.demo ? '가상' : '검색된'} 후보 {result.matched}곳 중 {result.evaluated}곳 평가
              {result.radius_m > 0 && ' · 반경 ' + distanceLabel(result.radius_m)}
              {result.unavailable > 0 && ' · 경로 없음 ' + result.unavailable + '건'}
              {result.failed > 0 && ' · 조회 실패 ' + result.failed + '건'}
            </p>}
            {result && stopMessages[result.stop_reason] && <p className="notice">{stopMessages[result.stop_reason]}</p>}
            {result && !result.demo && kind === 'restroom' && <p className="result-meta">
              {result.public_matched > 0
                ? '조회한 범위 내 공공 화장실 자료 ' + result.public_matched + '곳'
                : '조회한 범위 내에 좌표가 있는 공공 화장실 자료가 없습니다.'}
            </p>}
            {result && !searchIncomplete && items.length === 0 && <p className="empty">
              {result.matched === 0 ? '검색 범위 안에 해당 시설이 없습니다.' : '추천할 수 있는 경로가 없습니다.'}
              {result.matched > 0 && mode === 'transit' && ' 도보를 선택해 보세요.'}
            </p>}
            {result && searchIncomplete && items.length === 0 && <p className="empty">이번 검색에서 표시할 추천 경로가 없습니다.</p>}
          </div>
          {(searchError || searchIncomplete) && <button className="retry" onClick={startSearch}>시설 검색 다시 시도</button>}
          <p className="sr-only" role="status">{chosen && '선택한 시설 ' + chosen.facility.name}</p>
          {items.map(({ facility, route: summary }, index) => <button
            key={facility.id} className="result-card" aria-controls="route-detail" aria-pressed={facility.id === chosen?.facility.id}
            onClick={() => setSelectedId(facility.id)}
          >
            <span className="rank" style={{ backgroundColor: routeColors[index] }}><span className="sr-only">순위 </span>{index + 1}</span>
            <span className="card-label">
              <strong>{facility.name}</strong>
              <small>{facility.address || sourceLabels[facility.source]}</small>
              {facility.id === chosen?.facility.id && <small className="selected-label" aria-hidden="true">선택됨</small>}
            </span>
            <span className="metrics"><strong>{formatTime(summary.duration_s)}</strong><small>{distanceLabel(summary.distance_m)}</small></span>
          </button>)}
          {chosen && shownRoute && <section className="route-detail" id="route-detail" aria-labelledby="route-heading">
            <h3 id="route-heading" tabIndex={-1} ref={routeHeading}>{chosen.facility.name} 경로</h3>
            {(maps || !live) && <button className="map-jump" onClick={() => showPanel('map')} aria-controls="map-panel">선택 경로 지도에서 보기</button>}
            <p>{chosen.facility.source_label || sourceLabels[chosen.facility.source]}
              {chosen.facility.hours && ' · 자료에 기재된 개방시간 ' + chosen.facility.hours}
              {chosen.facility.updated && ' · 기준일 ' + chosen.facility.updated}</p>
            {chosen.facility.source === 'public' && chosen.facility.alternate_address && <p>지번주소 {chosen.facility.alternate_address}</p>}
            {chosen.access && <p>{mode === 'car' ? '차량 접근점' : '출입구'} {chosen.access.label} · {chosen.access.source} · 확인일 {chosen.access.verified_on}</p>}
            {live && !chosen.access && <p>도착점은 시설 대표 좌표입니다. {mode === 'car' ? '차량 진입 위치는 확인되지 않았습니다.' : '현장의 출입구와 다를 수 있습니다.'}</p>}
            {live && mode === 'car' && <p>주차 가능 여부는 시설에서 확인해 주세요.</p>}
            {chosen.route.geometry === 'summary' && route && <p>추천 기준 {formatTime(chosen.route.duration_s)} · {distanceLabel(chosen.route.distance_m)} · {formatQueryTime(chosen.route.calculated_at)} 조회</p>}
            <div role="status">
              {routePending && <p>상세 경로를 불러오는 중…</p>}
              {detailCurrent?.error && <p className="notice">{detailCurrent.error}</p>}
              {route?.geometry === 'summary' && <p>지도에 표시할 경로선 정보가 제공되지 않았습니다.</p>}
            </div>
            {detailCurrent?.error && <button className="retry" onClick={retryDetail}>상세 경로 다시 조회</button>}
            <p>{route ? '이동' : '추천 기준'} {formatTime(shownRoute.duration_s)} · {distanceLabel(shownRoute.distance_m)}
              {mode === 'transit' && ' · 환승 ' + shownRoute.transfers + '회'}
              {shownRoute.fare_won !== null
                ? ' · ' + (mode === 'car' ? '통행료 ' : '요금 ') + shownRoute.fare_won.toLocaleString('ko-KR') + '원'
                : mode === 'transit' ? ' · 요금 정보 없음' : ''}</p>
            <p>경로 출처 {routeSources[shownRoute.source]} · {formatQueryTime(shownRoute.calculated_at)} 조회</p>
            {mode === 'transit' && shownRoute.segments.length > 0 && <ol aria-label="대중교통 이동 구간">
              {shownRoute.segments.map((segment, index) => <li key={index}>
                {segmentLabels[segment.kind]} {segment.lines.join(', ')} · {formatTime(segment.duration_s)} · {distanceLabel(segment.distance_m)}
                {segment.stops.length > 0 && <small>{segment.stops.join(' → ')}</small>}
              </li>)}
            </ol>}
          </section>}
        </section>
      </section>
      <section id="map-panel" className="map-panel" aria-labelledby="map-heading">
        <div className="map-heading">
          <h2 id="map-heading" tabIndex={-1} ref={mapHeading}>{maps ? '카카오 지도' : live ? '지도' : '개발용 지도'}</h2>
          {(maps || !live) && <span>지도에서 클릭·우클릭·탭으로 출발지 설정</span>}
        </div>
        {chosen && <div className="map-selection">
          <p role="status"><strong>{chosen.facility.name}</strong> · {formatTime(chosen.route.duration_s)} · {distanceLabel(chosen.route.distance_m)}</p>
          <button onClick={() => showPanel('list')} aria-controls="route-detail">경로 상세 보기</button>
        </div>}
        {run > 0 && !chosen && <div className="map-selection">
          <p role="status">{searching ? '선택한 이동수단으로 경로를 비교하고 있습니다.' : '추천 경로 상태는 목록에서 확인할 수 있습니다.'}</p>
        </div>}
        {maps ? <KakaoMapView maps={maps} {...mapProps} /> : live
          ? <p className="map-unavailable" role="status">{mapError || (kakaoKey ? '지도를 연결하고 있습니다.' : '지도 설정을 확인해 주세요.')} 시설 추천과 경로 상세는 목록에서 확인할 수 있습니다.</p>
          : <LeafletMap {...mapProps} />}
        {(maps || !live) && <div className="map-footer">
          <span><i className="origin-dot" aria-hidden="true" /> 출발지</span>
          {items.map(({ facility }, index) => {
            const hasLine = routes[index].geometry === 'polyline';
            const detail = currentDetails?.[facility.id];
            return <span key={facility.id}>
              {hasLine && <i className={live ? 'route-key' : 'route-key route-key-demo'}
                style={{ borderColor: routeColors[index] }} aria-hidden="true" />}
              {index + 1}위 {live ? '경로' : '가상 경로'}
              {!hasLine && (detail?.error ? ' · 조회 실패' : detail?.route ? ' · 경로선 없음' : ' · 조회 중')}
            </span>;
          })}
        </div>}
      </section>
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
