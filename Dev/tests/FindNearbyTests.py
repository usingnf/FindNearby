import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import httpx
from fastapi.testclient import TestClient

from server.FacilityImport import read_access, read_facilities
from server.FacilityStore import FacilityStore
from server.FindNearbyApi import app
from server.CallBudget import CallBudget
from server.KakaoProvider import KakaoProvider, NoRoute, ProviderError
from server.Models import Coordinates, Facility, RecommendRequest
from server.RecommendationService import RecommendationService


ORIGIN = {"lat": 37.5663, "lng": 126.9779}
POINTS = [[126.9779, 37.5663], [126.9801, 37.5680]]


def step(kind, distance=250, time=120):
    return {"properties": {"type": kind, "distance": distance, "time": time}, "path": {"points": POINTS}}


class FindNearbyTests(unittest.TestCase):
    def test_demo_api_all_facilities_and_modes(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
            "KAKAO_REST_API_KEY": "", "KAKAO_MOBILITY_REST_API_KEY": "",
            "FIND_NEARBY_DAILY_LIMIT": "", "FIND_NEARBY_MINUTE_LIMIT": "",
            "FIND_NEARBY_DB": str(Path(folder) / "facilities.sqlite3"),
            "FIND_NEARBY_USAGE_DB": str(Path(folder) / "api-usage.sqlite3"),
        }), TestClient(app) as client:
            self.assertEqual(client.get("/api/status").json(), {
                "live_ready": False, "facilities": 0, "access_points": 0,
            })
            budget = app.state.service.provider.budget
            self.assertEqual((budget.daily_limit, budget.minute_limit), (300, 50))
            for kind in ("convenience", "subway", "restroom"):
                for mode, radius in (("walk", 500), ("transit", 2000), ("car", 2000)):
                    with self.subTest(kind=kind, mode=mode):
                        response = client.post("/api/recommend", json={
                            "origin": ORIGIN, "kind": kind, "mode": mode, "demo": True,
                        })
                        self.assertEqual(response.status_code, 200)
                        result = response.json()
                        self.assertTrue(result["demo"])
                        self.assertEqual(result["radius_m"], radius)
                        self.assertEqual(len(result["recommendations"]), 3)
                        self.assertEqual(result["stop_reason"], "exhausted")
                        self.assertEqual(result["matched"], result["evaluated"])
                        self.assertTrue(all(r["facility"]["kind"] == kind for r in result["recommendations"]))
                        self.assertTrue(all(r["facility"]["source"] == "demo" for r in result["recommendations"]))
                        metric = "distance_m" if mode == "walk" else "duration_s"
                        values = [r["route"][metric] for r in result["recommendations"]]
                        self.assertEqual(values, sorted(values))
                        self.assertEqual(result["recommendations"][0]["route"]["segments"][0]["path"][0], ORIGIN)

    def test_live_api_without_key_reports_error(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
            "KAKAO_REST_API_KEY": "", "KAKAO_MOBILITY_REST_API_KEY": "",
            "FIND_NEARBY_DB": str(Path(folder) / "facilities.sqlite3"),
            "FIND_NEARBY_USAGE_DB": str(Path(folder) / "api-usage.sqlite3"),
        }), TestClient(app) as client:
            response = client.post("/api/recommend", json={
                "origin": ORIGIN, "kind": "subway", "mode": "walk", "demo": False,
            })
            self.assertEqual(response.status_code, 503)
            self.assertIn("REST API 키", response.json()["detail"])

    def test_invalid_origin_rejected(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
            "FIND_NEARBY_USAGE_DB": str(Path(folder) / "api-usage.sqlite3"),
        }), TestClient(app) as client:
            response = client.post("/api/recommend", json={
                "origin": {"lat": 91, "lng": 127}, "kind": "subway", "mode": "walk",
            })
            self.assertEqual(response.status_code, 422)

    def test_walk_request_and_coordinate_mapping(self):
        def handler(request):
            self.assertEqual(request.url.path, "/v2/routing/walk")
            self.assertEqual(request.url.params["route_mode"], "SHORTEST")
            self.assertEqual(request.url.params["start_x"], str(ORIGIN["lng"]))
            self.assertEqual(request.headers["authorization"], "KakaoAK mock-key")
            return httpx.Response(200, json={
                "status": "OK", "route": {
                    "properties": {"totalDistance": 250, "totalTime": 120},
                    "legs": [{"steps": [step("WALKING")]}],
                },
            })

        with tempfile.TemporaryDirectory() as folder, httpx.Client(transport=httpx.MockTransport(handler)) as client:
            provider = KakaoProvider("mock-key", "", CallBudget(3, Path(folder) / "usage.sqlite3"), client)
            result = provider.route("walk", Coordinates(**ORIGIN), Coordinates.from_xy(*POINTS[1]))
        self.assertEqual(result.segments[0].path[0], Coordinates(**ORIGIN))

    def test_transit_walk_distance_breaks_tie(self):
        properties = {"totalDistance": 5000, "totalTime": 900, "transfers": 1}
        result = KakaoProvider.parse_route("transit", {"status": "OK", "routes": [
            {"properties": {**properties, "totalDistance": 4900}, "steps": [step("WALKING", 400), step("BUS")]},
            {"properties": properties, "steps": [step("WALKING", 130), step("SUBWAY")]},
        ]})
        self.assertEqual(result.distance_m, 5000)
        self.assertEqual(result.rank_key("transit"), (900, 1, 130))

    def test_car_route_vertices(self):
        result = KakaoProvider.parse_route("car", {"routes": [{
            "result_code": 0,
            "summary": {"distance": 420, "duration": 55, "fare": {"toll": 0}},
            "sections": [{"roads": [{"vertexes": [value for pair in POINTS for value in pair]}]}],
        }]})
        self.assertEqual(result.segments[0].path[-1], Coordinates.from_xy(*POINTS[-1]))
        self.assertEqual(result.distance_m, 420)

    def test_missing_geometry_and_no_route_are_distinct(self):
        with self.assertRaises(NoRoute):
            KakaoProvider.parse_route("transit", {"status": "NO_RESULTS"})
        with self.assertRaises(ProviderError):
            KakaoProvider.parse_route("car", {"routes": [{
                "result_code": 0, "summary": {"distance": 200, "duration": 30}, "sections": [],
            }]})

    def test_provider_quota_and_secret_safe_error(self):
        def handler(request):
            return httpx.Response(403, text="secret-api-key")

        with tempfile.TemporaryDirectory() as folder, httpx.Client(transport=httpx.MockTransport(handler)) as client:
            provider = KakaoProvider("secret-api-key", "", CallBudget(1, Path(folder) / "usage.sqlite3"), client)
            with self.assertRaises(ProviderError) as first:
                provider.addresses("서울시청")
            self.assertEqual(first.exception.status, 503)
            self.assertNotIn("secret-api-key", str(first.exception))
            with self.assertRaises(ProviderError) as second:
                provider.addresses("서울시청")
            self.assertEqual(second.exception.status, 429)

    def test_car_batch_uses_only_in_range_candidates(self):
        with tempfile.TemporaryDirectory() as folder:
            provider = Mock(spec=KakaoProvider)
            service = RecommendationService(provider, FacilityStore(Path(folder) / "facilities.sqlite3"))
            query = RecommendRequest(origin=Coordinates(**ORIGIN), kind="subway", mode="car", demo=False)
            candidates = [Facility(
                id=str(i), name=str(i), kind="subway", source="kakao",
                coordinates=Coordinates(lat=ORIGIN["lat"] + offset, lng=ORIGIN["lng"]),
            ) for i, offset in enumerate((0.02, 0.03, 0.1))]
            service.candidate_pages = Mock(return_value=[(20000, candidates)])
            provider.car_summaries.return_value = {
                i: service.simulate(query, candidates[i].coordinates) for i in (0, 1)
            }
            provider.route.return_value = service.simulate(query, candidates[2].coordinates)
            result = service.recommend(query)
            self.assertEqual(provider.car_summaries.call_args.args, (query.origin, [f.coordinates for f in candidates[:2]]))
            self.assertEqual(provider.route.call_args.args, ("car", query.origin, candidates[2].coordinates))
            self.assertEqual(len(result.recommendations), 3)

    def test_csv_import_is_idempotent_and_access_is_mode_specific(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            facilities_csv = root / "facilities.csv"
            access_csv = root / "access.csv"
            facilities_csv.write_bytes((
                "화장실명,소재지도로명주소,위도,경도,개방시간\n"
                "테스트 화장실,테스트로 1,37.5663,126.9779,24시간\n"
                "누락 화장실,테스트로 2,,126.9779,24시간\n"
            ).encode("cp949"))
            access_csv.write_text(
                "kind,facility_id,name,mode,lat,lng,label,source,verified_on\n"
                "restroom,,테스트 화장실,walk,37.5665,126.9779,입구,테스트 출처,2020-01-01\n",
                encoding="utf-8-sig",
            )
            facilities, skipped = read_facilities(facilities_csv)
            access, access_skipped = read_access(access_csv)
            store = FacilityStore(root / "data.sqlite3")
            store.import_rows(facilities, access)
            store.import_rows(facilities, access)
            origin = Coordinates(**ORIGIN)
            self.assertEqual((skipped, access_skipped), (1, 0))
            self.assertEqual(store.counts(), {"facilities": 1, "access_points": 1})
            facility, = store.nearby(origin, 500)
            self.assertEqual(facility.hours, "24시간")
            self.assertEqual(store.access_for(facility, "walk", origin).label, "입구")
            self.assertIsNone(store.access_for(facility, "car", origin))
