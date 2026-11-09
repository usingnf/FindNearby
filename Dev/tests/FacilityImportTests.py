import sqlite3
import tempfile
import unittest
from pathlib import Path

from server.FacilityImport import parse_facilities, read_access
from server.FacilityStore import FacilityStore
from server.Models import Coordinates, Facility, RecommendRequest
from server.RecommendationService import RecommendationService


class FacilityImportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.store = FacilityStore(self.root / "data.sqlite3")
        self.origin = Coordinates(lat=37.565, lng=126.978)

    def csv(self, name, content):
        path = self.root / name
        path.write_text(content, encoding="utf-8-sig")
        return path

    def test_import_review_and_formatting(self):
        file = self.csv("restrooms.csv", """명칭,도로명주소,지번주소,위도,경도,데이터기준일자
공원 화장실,인천광역시 미추홀구 테스트로 1,인천 미추홀구 테스트동 1,37.45,126.68,2026-07-31
공원 화장실,인천 미추홀구 테스트로 1 (테스트동),,37.45,126.68,
주소 없음,,,37.45,126.68,
좌표 누락,인천 테스트로 3,,,126.68,
좌표 오류,인천 테스트로 4,,126.68,37.45,
같은 명칭,인천 테스트로 5,,37.45,126.68,
같은 명칭,인천 테스트로 5,,37.46,126.68,
""")
        (facility,), review = parse_facilities(file, "시청")
        self.assertEqual(facility.source_label, "시청")
        self.assertTrue(facility.alternate_address.endswith("테스트동 1"))
        self.assertEqual(review, [
            (3, "중복"), (4, "필수값 누락"), (5, "좌표 누락"), (6, "좌표 오류"),
            (7, "중복 좌표 충돌"), (8, "중복 좌표 충돌"),
        ])
        kept, held = parse_facilities(file, hold_ids={facility.id})
        self.assertEqual(kept[0].address, "인천 미추홀구 테스트로 1 (테스트동)")
        self.assertIn((2, "위치 재검토"), held)
        bad = self.csv("invalid.csv", "incorrect,header\n1,2\n")
        with self.assertRaises(ValueError):
            parse_facilities(bad)

    def test_partial_update_delete_and_rollback(self):
        a = Facility(id="public:a", name="A", kind="restroom", source="public", coordinates=self.origin)
        b = a.model_copy(update={"id": "public:b", "name": "B"})
        access, skipped = read_access(self.csv("access.csv", """kind,facility_id,name,mode,lat,lng,label,source,verified_on
restroom,public:a,A,walk,37.5652,126.978,입구,자료,2020-01-01
"""))
        self.assertEqual(skipped, 0)
        self.store.import_rows([a, b], access)
        updated = a.model_copy(update={"name": "A 갱신"})
        self.store.import_rows([updated], [])
        self.store.import_rows([updated], [])
        self.assertEqual(self.store.counts(), {"facilities": 2, "access_points": 1})
        self.assertEqual(self.store.access_for(updated, "walk", self.origin).label, "입구")
        with self.assertRaises(sqlite3.ProgrammingError):
            self.store.import_rows([], [("bad",)], [a.id])
        self.assertEqual(self.store.counts(), {"facilities": 2, "access_points": 1})
        self.store.import_rows([], [], [a.id])
        self.assertEqual(self.store.counts(), {"facilities": 1, "access_points": 0})

    def test_provider_receives_verified_destination_for_each_mode(self):
        facility = Facility(
            id="kakao:station", name="테스트역 인천2호선", address="인천 미추홀구 테스트로 1",
            kind="subway", source="kakao", coordinates=Coordinates(lat=37.566, lng=126.978),
        )
        access, skipped = read_access(self.csv("access.csv", """kind,facility_id,name,mode,lat,lng,label,source,verified_on,facility_address
subway,,테스트역,walk,37.5661,126.978,1번 출구,자료,2020-01-01,인천광역시 미추홀구 테스트로 1 (테스트동)
subway,,테스트역,walk,37.5662,126.978,2번 출구,자료,2020-01-01,인천광역시 미추홀구 테스트로 1
subway,,테스트역,walk,37.5655,126.978,오매칭,자료,2020-01-01,인천광역시 미추홀구 테스트로 2
subway,,테스트역,transit,37.5663,126.978,환승 출구,자료,2020-01-01,인천광역시 미추홀구 테스트로 1
subway,kakao:station,테스트역,car,37.5664,126.978,차량 접근점,자료,2020-01-01,
subway,,테스트역,car,37.5654,126.978,미확인,자료,2020-01-01,
"""))
        self.assertEqual(skipped, 1)
        self.store.import_rows([], access)

        class Provider:
            def facilities(self, *args, **kwargs):
                return [facility], True

            def route(self, mode, origin, destination, **kwargs):
                calls.append((mode, destination))
                return RecommendationService.simulate(
                    RecommendRequest(origin=origin, kind="subway", mode=mode), destination,
                )

        calls = []
        service = RecommendationService(Provider(), self.store)
        for mode, label, lat in (
            ("walk", "1번 출구", 37.5661),
            ("transit", "환승 출구", 37.5663),
            ("car", "차량 접근점", 37.5664),
        ):
            result = service.recommend(RecommendRequest(origin=self.origin, kind="subway", mode=mode, demo=False))
            item, = result.recommendations
            self.assertEqual(item.access.label, label)
            self.assertEqual(item.destination.lat, lat)
            self.assertEqual(calls[-1], (mode, item.destination))
        self.assertIsNone(self.store.access_for(
            facility.model_copy(update={"id": "kakao:other", "address": "인천 미추홀구 테스트로 3"}),
            "walk", self.origin,
        ))

    def test_provider_duplicate_uses_address_and_keeps_public_record(self):
        public = Facility(
            id="public:park", name="테스트공원", address="인천광역시 미추홀구 테스트로 1",
            alternate_address="인천광역시 미추홀구 테스트동 1", kind="restroom", source="public",
            coordinates=Coordinates(lat=37.566, lng=126.978),
        )
        provider = public.model_copy(update={
            "id": "kakao:park", "name": "테스트공원 공중화장실", "source": "kakao",
            "address": "인천 미추홀구 테스트동 1", "alternate_address": "",
        })
        other = provider.model_copy(update={"id": "kakao:other", "address": "인천 미추홀구 테스트동 2"})

        class Service(RecommendationService):
            def candidate_pages(self, query, search):
                yield 500, [public, provider, other]

        class Provider:
            def route(self, mode, origin, destination, **kwargs):
                return RecommendationService.simulate(
                    RecommendRequest(origin=origin, kind="restroom", mode=mode), destination,
                )

        result = Service(Provider(), self.store).recommend(
            RecommendRequest(origin=self.origin, kind="restroom", mode="walk", demo=False),
        )
        self.assertEqual((result.matched, result.public_matched), (2, 1))
        self.assertEqual({item.facility.id for item in result.recommendations}, {public.id, other.id})
