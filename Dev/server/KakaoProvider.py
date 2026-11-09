from datetime import datetime, timezone
from sqlite3 import Error as SQLiteError

import httpx

from server.CallBudget import BudgetExceeded, CallBudget, SearchBudget
from server.Models import Coordinates, Facility, Place, Route, Segment, StopReason, TravelMode


class ProviderError(Exception):
    def __init__(
        self, status: int, message: str, *, reason: StopReason = "provider_error",
        attempted: bool = True, retryable: bool = False,
    ):
        super().__init__(message)
        self.status = status
        self.reason = reason
        self.attempted = attempted
        self.retryable = retryable


class NoRoute(Exception):
    pass


class KakaoProvider:
    local_url = "https://dapi.kakao.com"
    car_url = "https://apis-navi.kakaomobility.com"

    def __init__(self, key: str, car_key: str, budget: CallBudget, client: httpx.Client):
        self.key = key
        self.car_key = car_key or key
        self.budget = budget
        self.client = client

    def request(self, path: str, *, params=None, body=None, car=False, search: SearchBudget | None = None) -> dict:
        key = self.car_key if car else self.key
        if not key:
            raise ProviderError(503, "카카오 REST API 키를 서버에 설정하세요.", attempted=False)
        url = (self.car_url if car else self.local_url) + path
        for attempt in range(2):
            try:
                if search:
                    search.check_call()
                self.budget.take(path, reserve=search.reserve if search else 0)
                timeout = min(4, search.remaining_time()) if search else 4
                if search:
                    search.remaining_calls -= 1
            except BudgetExceeded as exc:
                raise ProviderError(
                    504 if exc.reason == "deadline" else 429, str(exc),
                    reason=exc.reason, attempted=attempt > 0,
                ) from exc
            except SQLiteError as exc:
                raise ProviderError(503, "API 사용량을 확인할 수 없습니다.", attempted=attempt > 0) from exc
            try:
                return self.send(url, key, params=params, body=body, timeout=timeout)
            except ProviderError as exc:
                if not exc.retryable or attempt == 1:
                    raise

    def send(self, url: str, key: str, *, params, body, timeout: float) -> dict:
        try:
            response = self.client.request(
                "POST" if body is not None else "GET",
                url,
                headers={"Authorization": f"KakaoAK {key}"},
                params=params,
                json=body,
                timeout=timeout,
            )
        except httpx.TimeoutException as exc:
            raise ProviderError(504, "외부 API 응답 시간이 초과되었습니다.", retryable=True) from exc
        except httpx.RequestError as exc:
            raise ProviderError(502, "외부 API에 연결할 수 없습니다.", retryable=True) from exc
        if response.status_code in (401, 403):
            raise ProviderError(503, "카카오 앱의 키와 API 권한을 확인하세요.")
        if response.status_code == 429:
            raise ProviderError(429, "외부 API 호출 한도에 도달했습니다.", reason="rate_limited")
        if response.status_code in (500, 502, 503, 504):
            raise ProviderError(502, "외부 API가 일시적으로 요청을 처리하지 못했습니다.", retryable=True)
        try:
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise ValueError("expected an object")
            return payload
        except (httpx.HTTPStatusError, ValueError) as exc:
            raise ProviderError(502, "외부 API가 요청을 처리하지 못했습니다.") from exc

    def addresses(self, query: str) -> list[Place]:
        data = self.request("/v2/local/search/address.json", params={"query": query, "size": 5})
        try:
            return [
                Place(name=row["address_name"], coordinates=Coordinates.from_xy(row["x"], row["y"]))
                for row in data["documents"]
            ]
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError(502, "주소 응답 형식이 올바르지 않습니다.") from exc

    def facilities(self, origin, kind, radius_m, page=1, *, search=None) -> tuple[list[Facility], bool]:
        params = {
            "x": origin.lng, "y": origin.lat, "radius": radius_m,
            "sort": "distance", "size": 15, "page": page,
        }
        if kind == "restroom":
            path = "/v2/local/search/keyword.json"
            params["query"] = "공중화장실"
        else:
            path = "/v2/local/search/category.json"
            params["category_group_code"] = {"convenience": "CS2", "subway": "SW8"}[kind]
        data = self.request(path, params=params, search=search)
        try:
            rows = data["documents"]
            last_page = data["meta"]["is_end"]
            if not isinstance(rows, list) or not isinstance(last_page, bool):
                raise TypeError("invalid page")
        except (KeyError, TypeError) as exc:
            raise ProviderError(502, "시설 검색 응답 형식이 올바르지 않습니다.") from exc
        facilities = []
        for row in rows:
            try:
                if not row["id"]:
                    continue
                road = row.get("road_address_name") or ""
                lot = row.get("address_name") or ""
                facilities.append(Facility(
                    id=f"kakao:{row['id']}", kind=kind, source="kakao",
                    name=row["place_name"], address=road or lot, alternate_address=lot if road else "",
                    coordinates=Coordinates.from_xy(row["x"], row["y"]),
                ))
            except (KeyError, TypeError, ValueError):
                continue
        return facilities, last_page

    def route(self, mode: TravelMode, origin: Coordinates, destination: Coordinates, *, search=None) -> Route:
        if origin == destination:
            raise NoRoute
        if mode == "car":
            data = self.request(
                "/v1/directions", car=True, search=search,
                params={
                    "origin": f"{origin.lng},{origin.lat}",
                    "destination": f"{destination.lng},{destination.lat}",
                    "priority": "TIME", "summary": "false",
                },
            )
        else:
            params = {
                "start_x": origin.lng, "start_y": origin.lat,
                "end_x": destination.lng, "end_y": destination.lat,
                "input_coord": "WGS84", "output_coord": "WGS84",
            }
            if mode == "walk":
                params["route_mode"] = "SHORTEST"
            data = self.request(
                "/v2/routing/" + ("walk" if mode == "walk" else "publictraffic"),
                params=params, search=search,
            )
        return self.parse_route(mode, data)

    def car_summaries(self, origin: Coordinates, destinations: list[Coordinates], *, search=None) -> dict[int, Route]:
        data = self.request(
            "/v1/destinations/directions", car=True, search=search,
            body={
                "origin": {"x": origin.lng, "y": origin.lat},
                "destinations": [
                    {"key": str(i), "x": point.lng, "y": point.lat}
                    for i, point in enumerate(destinations)
                ],
                "radius": 10000, "priority": "TIME",
            },
        )
        try:
            return {
                int(row["key"]): self.car_summary(row["summary"])
                for row in data["routes"] if row["result_code"] == 0
            }
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError(502, "자동차 요약 응답 형식이 올바르지 않습니다.") from exc

    @staticmethod
    def car_summary(summary: dict, path=None) -> Route:
        segments = [
            Segment(kind="car", distance_m=summary["distance"], duration_s=summary["duration"], path=path)
        ] if path else []
        return Route(
            distance_m=summary["distance"], duration_s=summary["duration"],
            fare_won=(summary.get("fare") or {}).get("toll"),
            calculated_at=datetime.now(timezone.utc), segments=segments, source="kakao_mobility",
        )

    @staticmethod
    def parse_route(mode: TravelMode, data: dict) -> Route:
        try:
            if mode == "car":
                car = data["routes"][0]
                code = car["result_code"]
                if code in (1, 101, 102, 103, 104, 105, 106, 107):
                    raise NoRoute
                if code != 0:
                    raise ValueError("unexpected result code")
                path = []
                for section in car["sections"]:
                    for road in section["roads"]:
                        vertices = road["vertexes"]
                        path.extend(
                            Coordinates.from_xy(x, y)
                            for x, y in zip(vertices[::2], vertices[1::2], strict=True)
                        )
                route = KakaoProvider.car_summary(car["summary"], path)
            else:
                status = data["status"]
                if status in {
                    "SAME_POINT", "START_LINK_NOT_FOUND", "END_LINK_NOT_FOUND", "TOO_FAR_AWAY",
                    "ROUTE_RESULT_NOT_FOUND", "STARTNODES_NULL", "ENDNODES_NULL", "EQUAL_POINTS", "NO_RESULTS",
                }:
                    raise NoRoute
                if status != "OK":
                    raise ValueError("unexpected status")
                if mode == "walk":
                    row = data["route"]
                    steps = [step for leg in row["legs"] for step in leg["steps"]]
                    route = KakaoProvider.parse_steps(row, steps, walk=True)
                else:
                    routes = []
                    for row in data["routes"]:
                        try:
                            alternative = KakaoProvider.parse_steps(row, row["steps"])
                        except (KeyError, TypeError, AttributeError, ValueError):
                            continue
                        if alternative.geometry == "polyline":
                            routes.append(alternative)
                    route = min(routes, key=lambda result: result.rank_key("transit"))
            if not any(len(segment.path) >= 2 for segment in route.segments):
                raise ValueError("missing geometry")
            return route
        except (KeyError, IndexError, AttributeError, TypeError, ValueError) as exc:
            raise ProviderError(502, "경로 응답 형식 또는 경로 좌표가 올바르지 않습니다.") from exc

    @staticmethod
    def parse_steps(row, steps, walk=False) -> Route:
        summary = row["properties"]
        segments = []
        for step in steps:
            props = step["properties"]
            kind = "walk" if walk else {"WALKING": "walk", "BUS": "bus", "SUBWAY": "subway"}[props["type"]]
            segments.append(Segment(
                kind=kind, distance_m=props["distance"], duration_s=props["time"],
                path=[Coordinates.from_xy(x, y) for x, y in (step.get("path") or {}).get("points", [])],
                lines=[v["name"] for v in props.get("vehicles") or []],
                stops=[s["name"] for s in props.get("stops") or []],
            ))
        return Route(
            distance_m=summary["totalDistance"], duration_s=summary["totalTime"],
            transfers=0 if walk else summary["transfers"],
            fare_won=(summary.get("fare") or {}).get("value"),
            calculated_at=datetime.now(timezone.utc), segments=segments, source="kakao_maps",
        )
