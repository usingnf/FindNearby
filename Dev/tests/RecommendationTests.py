import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock, patch

import httpx

from server.CallBudget import BudgetExceeded, CallBudget, SearchBudget
from server.FacilityStore import FacilityStore
from server.KakaoProvider import KakaoProvider, NoRoute, ProviderError
from server.Models import Coordinates, Facility, RecommendRequest
from server.RecommendationService import RecommendationService


ORIGIN = Coordinates(lat=37.5663, lng=126.9779)


class RecommendationTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.provider = Mock(spec=KakaoProvider)
        self.provider.car_summaries.return_value = {}
        self.service = RecommendationService(self.provider, FacilityStore(self.root / "facilities.sqlite3"))

    def facilities(self, count):
        return [
            Facility(
                id=f"f{i:02}", name=f"시설 {i}", kind="convenience", source="kakao",
                coordinates=Coordinates(lat=ORIGIN.lat + (i + 1) * .0002, lng=ORIGIN.lng),
            )
            for i in range(count)
        ]

    def query(self, mode="walk"):
        return RecommendRequest(origin=ORIGIN, kind="convenience", mode=mode, demo=False)

    def serve_pages(self, pages):
        self.provider.facilities.side_effect = (
            lambda origin, kind, radius, page, **kw: pages.get((radius, page), ([], True))
        )

    def route(self, mode, origin, destination, **kw):
        return self.service.simulate(self.query(mode), destination)

    def test_valid_route_shortage_continues_to_next_page(self):
        facilities = self.facilities(11)
        self.serve_pages({
            (500, 1): (facilities[:10], False),
            (500, 2): ([facilities[0], facilities[10]], True),
        })
        unavailable = [f.coordinates for f in facilities[2:10]]

        def route(mode, origin, destination, **kw):
            if destination in unavailable:
                raise NoRoute
            return self.route(mode, origin, destination)

        self.provider.route.side_effect = route
        result = self.service.recommend(self.query())
        self.assertEqual([r.facility.id for r in result.recommendations], ["f00", "f01", "f10"])
        self.assertEqual((result.matched, result.evaluated, result.unavailable), (11, 11, 8))
        self.assertEqual(result.stop_reason, "radius_limit")
        self.assertEqual(self.provider.route.call_count, 11)

    def test_better_later_route_can_replace_an_initial_top_three(self):
        facilities = self.facilities(11)
        self.serve_pages({(500, 1): (facilities[:10], True), (1000, 1): ([facilities[10]], True)})

        def route(mode, origin, destination, **kw):
            result = self.route(mode, origin, destination)
            distance = 450 if destination == facilities[10].coordinates else 2000
            return result.model_copy(update={"distance_m": distance})

        self.provider.route.side_effect = route
        result = self.service.recommend(self.query())
        self.assertEqual(result.recommendations[0].facility.id, "f10")
        self.assertEqual(result.evaluated, 11)

    def test_equal_routes_sort_by_facility_id_in_every_mode(self):
        # Reverse IDs relative to coordinates, so nearest-first order differs from final order.
        facilities = [f.model_copy(update={"id": f"f{3 - i}"}) for i, f in enumerate(self.facilities(4))]
        for mode, radius in (("walk", 500), ("transit", 2000), ("car", 2000)):
            with self.subTest(mode=mode):
                self.serve_pages({(radius, 1): (facilities, True)})
                self.provider.route.return_value = self.route(mode, ORIGIN, facilities[0].coordinates)
                result = self.service.recommend(self.query(mode))
                self.assertEqual([r.facility.id for r in result.recommendations], ["f0", "f1", "f2"])

    def test_limit_keeps_success_and_does_not_count_unattempted_candidate(self):
        facilities = self.facilities(3)
        self.serve_pages({(500, 1): (facilities, True)})
        self.provider.route.side_effect = [
            self.route("walk", ORIGIN, facilities[0].coordinates),
            ProviderError(429, "budget reached", reason="call_budget", attempted=False),
        ]
        result = self.service.recommend(self.query())
        self.assertEqual((result.matched, result.evaluated, result.failed), (3, 1, 0))
        self.assertEqual(result.stop_reason, "call_budget")
        self.assertEqual(len(result.recommendations), 1)

    def test_later_page_error_preserves_recommendations(self):
        facility, = self.facilities(1)
        self.provider.facilities.side_effect = [([facility], False), ProviderError(502, "unavailable")]
        self.provider.route.side_effect = self.route
        result = self.service.recommend(self.query())
        self.assertEqual(result.stop_reason, "provider_error")
        self.assertEqual(result.recommendations[0].facility.id, facility.id)
        self.assertEqual(result.radius_m, 500)

    def test_exact_destination_is_unavailable_without_an_upstream_route(self):
        facility, = self.facilities(1)
        self.serve_pages({(500, 1): ([facility.model_copy(update={"coordinates": ORIGIN})], True)})
        result = self.service.recommend(self.query())
        self.assertEqual((result.evaluated, result.unavailable, len(result.recommendations)), (1, 1, 0))
        self.provider.route.assert_not_called()

    def test_car_batch_missing_item_uses_single_destination(self):
        facilities = self.facilities(3)
        self.serve_pages({(2000, 1): (facilities, True)})
        self.provider.car_summaries.return_value = {
            0: self.route("car", ORIGIN, facilities[0].coordinates).model_copy(
                update={"source": "kakao_mobility", "segments": []},
            ),
        }
        self.provider.route.side_effect = self.route
        result = self.service.recommend(self.query("car"))
        self.assertEqual(self.provider.car_summaries.call_args.kwargs["search"].reserve, 3)
        self.assertEqual(self.provider.route.call_count, 2)
        top = result.recommendations[0]
        self.assertEqual((top.destination, top.route.geometry), (facilities[0].coordinates, "summary"))
        self.assertIsNone(top.route.walking_distance_m)

    def test_global_quota_is_shared_after_restart_and_between_workers(self):
        path = self.root / "usage.sqlite3"
        before_restart = CallBudget(5, path)
        before_restart.take("addresses")
        after_restart = CallBudget(5, path)
        another_worker = CallBudget(5, path)

        def take(index):
            try:
                (after_restart if index % 2 else another_worker).take("route")
            except BudgetExceeded:
                return False
            return True

        with ThreadPoolExecutor(max_workers=8) as pool:
            self.assertEqual(sum(pool.map(take, range(12))), 4)
        with closing(sqlite3.connect(path)) as db:
            counts = dict(db.execute("SELECT operation, COUNT(*) FROM api_calls GROUP BY operation"))
        self.assertEqual(counts, {"addresses": 1, "route": 4})

    def test_rolling_minute_limit_survives_utc_day_change(self):
        budget = CallBudget(1, self.root / "usage.sqlite3", minute_limit=1)
        with patch("server.CallBudget.time", side_effect=[86399, 86401, 86460]):
            budget.take("addresses")
            with self.assertRaises(BudgetExceeded):
                budget.take("route")
            budget.take("route")

    def test_transient_retry_is_charged_and_deadline_prevents_call(self):
        responses = iter((httpx.Response(502), httpx.Response(200, json={"documents": []})))
        budget = CallBudget(5, self.root / "usage.sqlite3")
        with httpx.Client(transport=httpx.MockTransport(lambda _: next(responses))) as client:
            provider = KakaoProvider("mock-key", "", budget, client)
            search = SearchBudget(3, 5)
            self.assertEqual(provider.request("/test", search=search), {"documents": []})
            self.assertEqual(search.remaining_calls, 1)
            with self.assertRaises(ProviderError) as stopped:
                provider.request("/test", search=SearchBudget(3, 0))
            self.assertEqual((stopped.exception.reason, stopped.exception.attempted), ("deadline", False))
        with closing(sqlite3.connect(budget.path)) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM api_calls").fetchone()[0], 2)
