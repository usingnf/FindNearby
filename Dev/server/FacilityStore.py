import re
import sqlite3
from contextlib import closing
from math import cos, radians
from pathlib import Path
from unicodedata import normalize

from server.Models import AccessPoint, Coordinates, Facility, TravelMode


def normalized(text: str) -> str:
    return "".join(text.casefold().split())


def address_key(address: str) -> str:
    address = normalize("NFKC", address).strip()
    address = re.sub(r"\s*\([^()]*\)\s*$", "", address)
    address = re.sub(r"(?<=\d)\s*,.*$", "", address)
    for short, long in (
        ("서울", "서울특별시"), ("인천", "인천광역시"), ("부산", "부산광역시"),
        ("대구", "대구광역시"), ("대전", "대전광역시"), ("광주", "광주광역시"),
        ("울산", "울산광역시"), ("경기", "경기도"), ("전남", "전라남도"),
    ):
        if address.startswith(short + " "):
            address = long + address[len(short):]
            break
    return normalized(address)


def address_keys(facility: Facility) -> set[str]:
    return {key for address in (facility.address, facility.alternate_address) if (key := address_key(address))}


def access_name(kind: str, name: str) -> str:
    name = normalized(name)
    if kind == "subway":
        match = re.fullmatch(r"(.+역)(?:인천)?\d+호선", name)
        if match:
            return match[1]
    return name


class FacilityStore:
    def __init__(self, path: Path):
        self.path = path

    def import_rows(
        self, facilities: list[Facility], access_rows: list[tuple], delete_ids: tuple[str, ...] | list[str] = (),
    ) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS facilities (
                    id TEXT PRIMARY KEY, lat REAL NOT NULL, lng REAL NOT NULL, payload TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS facility_position ON facilities(lat, lng);
                CREATE TABLE IF NOT EXISTS access (
                    kind TEXT NOT NULL, facility_id TEXT NOT NULL, name TEXT NOT NULL,
                    mode TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, payload TEXT NOT NULL,
                    PRIMARY KEY (kind, facility_id, name, mode, lat, lng)
                );
            """)
            with db:
                db.executemany("DELETE FROM facilities WHERE id = ?", [(key,) for key in delete_ids])
                db.executemany("DELETE FROM access WHERE facility_id = ?", [(key,) for key in delete_ids])
                db.executemany(
                    "INSERT OR REPLACE INTO facilities VALUES (?, ?, ?, ?)",
                    [(f.id, f.coordinates.lat, f.coordinates.lng, f.model_dump_json()) for f in facilities],
                )
                db.executemany("INSERT OR REPLACE INTO access VALUES (?, ?, ?, ?, ?, ?, ?)", access_rows)

    def connect_read_only(self):
        return sqlite3.connect(f"{self.path.resolve().as_uri()}?mode=ro", uri=True)

    def counts(self) -> dict[str, int]:
        if not self.path.is_file():
            return {"facilities": 0, "access_points": 0}
        with closing(self.connect_read_only()) as db:
            return {
                "facilities": db.execute("SELECT COUNT(*) FROM facilities").fetchone()[0],
                "access_points": db.execute("SELECT COUNT(*) FROM access").fetchone()[0],
            }

    def nearby(self, origin: Coordinates, radius_m: int) -> list[Facility]:
        if not self.path.is_file():
            return []
        dy = radius_m / 110_000
        dx = radius_m / (110_000 * cos(radians(origin.lat + dy)))
        with closing(self.connect_read_only()) as db:
            rows = db.execute(
                "SELECT payload FROM facilities WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
                (origin.lat - dy, origin.lat + dy, origin.lng - dx, origin.lng + dx),
            )
            candidates = [Facility.model_validate_json(payload) for (payload,) in rows]
        return sorted(
            (f for f in candidates if origin.distance_to(f.coordinates) <= radius_m),
            key=lambda f: (origin.distance_to(f.coordinates), f.id),
        )

    def access_for(self, facility: Facility, mode: TravelMode, origin: Coordinates) -> AccessPoint | None:
        if not self.path.is_file() or facility.source == "demo":
            return None
        with closing(self.connect_read_only()) as db:
            rows = db.execute(
                """SELECT facility_id, payload FROM access WHERE kind = ? AND mode = ?
                   AND (facility_id = ? OR (facility_id = '' AND name IN (?, ?)))""",
                (facility.kind, mode, facility.id, normalized(facility.name), access_name(facility.kind, facility.name)),
            ).fetchall()
        exact, corroborated, legacy = [], [], []
        addresses = address_keys(facility)
        for facility_id, payload in rows:
            point = AccessPoint.model_validate_json(payload)
            if facility.coordinates.distance_to(point.coordinates) > 350:
                continue
            if facility_id:
                exact.append(point)
            elif address_key(point.facility_address) in addresses:
                corroborated.append(point)
            elif not point.facility_address and facility.source == "public":
                legacy.append(point)
        if not exact and not corroborated and legacy:
            legacy = [
                point for point in legacy if not any(
                    other.id != facility.id and normalized(other.name) == normalized(facility.name)
                    for other in self.nearby(point.coordinates, 350)
                )
            ]
        return min(
            exact or corroborated or legacy,
            key=lambda point: (origin.distance_to(point.coordinates), point.label, point.coordinates.lat, point.coordinates.lng),
            default=None,
        )
