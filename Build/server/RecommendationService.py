from datetime import datetime, timezone

from server.CallBudget import SearchBudget
from server.FacilityStore import FacilityStore, address_keys, normalized
from server.KakaoProvider import KakaoProvider, NoRoute, ProviderError
from server.Models import Coordinates, Facility, Recommendation, RecommendRequest, RecommendResult, Route, Segment


class RecommendationService:
    recommendation_limit = 3
    labels = {"convenience": "편의점", "subway": "지하철역", "restroom": "공중화장실"}
    offsets = [
        (.0018, .0016), (-.0026, .0017), (.0024, -.0025),
        (-.0012, -.0032), (.0009, .0039), (-.0037, -.0010),
    ]
    radii = {
        "walk": (500, 1000, 3000, 5000, 10000, 20000),
        "transit": (2000, 3000, 5000, 10000, 20000),
        "car": (2000, 3000, 5000, 10000, 20000),
    }

    def __init__(
        self, provider: KakaoProvider, store: FacilityStore, *, search_calls: int = 12, search_seconds: float = 8,
    ):
        self.provider = provider
        self.store = store
        self.search_calls = search_calls
        self.search_seconds = search_seconds

    def candidate_pages(self, query: RecommendRequest, search: SearchBudget):
        if query.demo:
            yield self.radii[query.mode][0], [
                Facility(
                    id=f"demo:{query.kind}:{i}", name=f"가상 {self.labels[query.kind]} {i}",
                    kind=query.kind, source="demo",
                    coordinates=Coordinates(lat=query.origin.lat + dy, lng=query.origin.lng + dx),
                )
                for i, (dy, dx) in enumerate(self.offsets, start=1)
            ]
            return

        for radius in self.radii[query.mode]:
            public = self.store.nearby(query.origin, radius) if query.kind == "restroom" else []
            for page in range(1, 46):
                try:
                    places, last_page = self.provider.facilities(
                        query.origin, query.kind, radius, page, search=search,
                    )
                except ProviderError as exc:
                    if public and exc.reason == "provider_error" and exc.status in (502, 504):
                        yield radius, public
                    raise
                yield radius, public + places
                public = []
                if last_page:
                    break

    @staticmethod
    def simulate(query: RecommendRequest, destination: Coordinates) -> Route:
        origin = query.origin
        if origin == destination:
            raise NoRoute
        bend = Coordinates(lat=origin.lat, lng=destination.lng)
        distance = round(origin.distance_to(bend) + bend.distance_to(destination))
        speed = {"walk": 1.3, "transit": 4.5, "car": 7.5}[query.mode]
        duration = round(distance / speed) + (120 if query.mode == "transit" else 0)
        return Route(
            distance_m=distance, duration_s=duration, calculated_at=datetime.now(timezone.utc), source="demo",
            segments=[Segment(
                kind="bus" if query.mode == "transit" else query.mode,
                distance_m=distance, duration_s=duration, path=[origin, bend, destination],
            )],
        )

    def car_summaries(self, query: RecommendRequest, destinations: list[Coordinates], search: SearchBudget):
        if query.demo or query.mode != "car":
            return {}
        indices = [
            i for i, destination in enumerate(destinations)
            if query.origin != destination and query.origin.distance_to(destination) <= 10000
        ]
        if len(indices) < 2:
            return {}
        try:
            results = self.provider.car_summaries(query.origin, [destinations[i] for i in indices], search=search)
        except ProviderError as exc:
            if exc.reason != "provider_error" or exc.status not in (502, 504):
                raise
            return {}
        return {index: results[position] for position, index in enumerate(indices) if position in results}

    @staticmethod
    def match_name(facility: Facility) -> str:
        name = normalized(facility.name)
        if facility.kind == "restroom":
            stem = name.removesuffix("공중화장실").removesuffix("화장실")
            return stem or name
        return name

    @staticmethod
    def is_duplicate(facility: Facility, other: Facility) -> bool:
        if facility.coordinates.distance_to(other.coordinates) >= 25:
            return False
        left, right = address_keys(facility), address_keys(other)
        if left and right:
            return bool(left & right)
        return normalized(facility.name) == normalized(other.name)

    def recommend(self, query: RecommendRequest) -> RecommendResult:
        reserve = self.recommendation_limit if query.mode == "car" else 0
        search = SearchBudget(self.search_calls, self.search_seconds, reserve=reserve)
        seen_ids: set[str] = set()
        by_name: dict[str, list[Facility]] = {}
        recommendations: list[Recommendation] = []
        matched = public_matched = failed = unavailable = radius_m = 0
        last_error = None
        stop_reason = "exhausted" if query.demo else "radius_limit"
        try:
            for radius_m, page in self.candidate_pages(query, search):
                pending = []
                for facility in page:
                    coords = facility.coordinates
                    if (
                        facility.id in seen_ids or not coords.in_service_area()
                        or query.origin.distance_to(coords) > radius_m
                    ):
                        continue
                    seen_ids.add(facility.id)
                    locations = by_name.setdefault(self.match_name(facility), [])
                    if any(self.is_duplicate(facility, other) for other in locations):
                        continue
                    locations.append(facility)
                    pending.append(facility)
                    public_matched += int(facility.source == "public")
                matched += len(pending)
                pending.sort(key=lambda facility: (query.origin.distance_to(facility.coordinates), facility.id))
                for start in range(0, len(pending), 10):
                    batch = pending[start:start + 10]
                    points = [self.store.access_for(facility, query.mode, query.origin) for facility in batch]
                    destinations = [
                        point.coordinates if point else facility.coordinates
                        for facility, point in zip(batch, points, strict=True)
                    ]
                    summaries = self.car_summaries(query, destinations, search)
                    for i, (facility, point, destination) in enumerate(zip(batch, points, destinations, strict=True)):
                        try:
                            if destination == query.origin:
                                raise NoRoute
                            if query.demo:
                                route = self.simulate(query, destination)
                            else:
                                route = summaries.get(i) or self.provider.route(
                                    query.mode, query.origin, destination, search=search,
                                )
                            recommendations.append(Recommendation(
                                facility=facility, access=point, destination=destination, route=route,
                            ))
                        except NoRoute:
                            unavailable += 1
                        except ProviderError as exc:
                            failed += int(exc.attempted)
                            last_error = exc
                            if exc.reason != "provider_error" or exc.status == 503:
                                raise
        except ProviderError as exc:
            last_error = exc
            stop_reason = exc.reason
        else:
            if failed:
                stop_reason = "provider_error"

        if not recommendations and last_error and stop_reason == "provider_error":
            raise last_error
        recommendations.sort(key=lambda item: (*item.route.rank_key(query.mode), item.facility.id))
        return RecommendResult(
            recommendations=recommendations[:self.recommendation_limit], matched=matched,
            public_matched=public_matched, radius_m=radius_m,
            evaluated=len(recommendations) + failed + unavailable, unavailable=unavailable,
            failed=failed, demo=query.demo, stop_reason=stop_reason,
        )
