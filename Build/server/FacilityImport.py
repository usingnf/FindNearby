import argparse
import csv
import io
import os
import re
from collections import Counter
from datetime import date
from hashlib import sha256
from pathlib import Path

from dotenv import load_dotenv

from server.FacilityStore import FacilityStore, access_name, address_key, normalized
from server.Models import AccessPoint, Coordinates, Facility


PROJECT = Path(__file__).resolve().parents[1]
NAME = ("name", "화장실명", "공중화장실명", "명칭", "화장실명칭")
ROAD = ("address", "소재지도로명주소", "도로명주소")
LOT = ("alternate_address", "소재지지번주소", "지번주소")
LAT = ("lat", "위도", "WGS84위도", "WGS84 위도")
LNG = ("lng", "경도", "WGS84경도", "WGS84 경도")


def database_path() -> Path:
    value = os.getenv("FIND_NEARBY_DB", "")
    return PROJECT / (value or "facilities.sqlite3")


def csv_rows(path: Path):
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp949")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError(f"CSV 헤더가 비어 있습니다. {path.name}")
    return reader


def field(row: dict, *names: str) -> str:
    return next((row[name].strip() for name in names if row.get(name) and row[name].strip()), "")


def position(row: dict) -> Coordinates:
    coordinates = Coordinates(
        lat=field(row, *LAT), lng=field(row, *LNG),
    )
    if not coordinates.in_service_area():
        raise ValueError("좌표가 검색 범위를 벗어났습니다.")
    return coordinates


def parse_facilities(
    path: Path, source_label: str = "", *, hold_ids: set[str] | frozenset[str] = frozenset(),
) -> tuple[list[Facility], list[tuple[int, str]]]:
    reader = csv_rows(path)
    headers = set(reader.fieldnames or [])
    if not headers.intersection(NAME) or not headers.intersection(ROAD + LOT):
        raise ValueError(f"시설명 또는 주소 열을 찾을 수 없습니다. {path.name}")
    facilities = {}
    review = []
    conflicted = set()
    for row in reader:
        line = reader.line_num
        name = field(row, *NAME)
        road, lot = field(row, *ROAD), field(row, *LOT)
        address = road or lot
        if not name or not address:
            review.append((line, "필수값 누락"))
            continue
        if not field(row, *LAT) or not field(row, *LNG):
            review.append((line, "좌표 누락"))
            continue
        try:
            coordinates = position(row)
        except ValueError:
            review.append((line, "좌표 오류"))
            continue
        facility_id = field(row, "facility_id")
        if facility_id and not re.fullmatch(r"public:[0-9a-f]{24}", facility_id):
            review.append((line, "시설 ID 오류"))
            continue
        key = sha256(f"{normalized(name)}|{normalized(address)}".encode()).hexdigest()[:24]
        facility_id = facility_id or f"public:{key}"
        if facility_id in hold_ids:
            review.append((line, "위치 재검토"))
            continue
        alternate = lot if road else ""
        if lot and not any(character.isdigit() for character in road):
            address, alternate = lot, ""
        identity = (normalized(name), address_key(address))
        if identity in conflicted:
            review.append((line, "중복 좌표 충돌"))
            continue
        if identity in facilities:
            old_line, old = facilities[identity]
            if old.coordinates.distance_to(coordinates) > 25:
                review.extend(((old_line, "중복 좌표 충돌"), (line, "중복 좌표 충돌")))
                del facilities[identity]
                conflicted.add(identity)
            else:
                review.append((line, "중복"))
            continue
        facilities[identity] = (line, Facility(
            id=facility_id, name=name, address=address,
            alternate_address=alternate, coordinates=coordinates, kind="restroom",
            source="public", source_label=source_label, hours=field(row, "hours", "개방시간"),
            updated=field(row, "updated", "데이터기준일자"),
        ))
    id_counts = Counter(facility.id for _, facility in facilities.values())
    result = []
    for line, facility in facilities.values():
        if id_counts[facility.id] > 1:
            review.append((line, "시설 ID 충돌"))
        else:
            result.append(facility)
    return result, sorted(review)


def read_facilities(path: Path) -> tuple[list[Facility], int]:
    facilities, review = parse_facilities(path)
    return facilities, len(review)


def read_access(path: Path) -> tuple[list[tuple], int]:
    access = []
    skipped = 0
    reader = csv_rows(path)
    if not {"kind", "mode", "source", "verified_on", "lat", "lng"}.issubset(reader.fieldnames or []):
        raise ValueError(f"접근점 필수 열을 찾을 수 없습니다. {path.name}")
    for row in reader:
        try:
            kind, mode = field(row, "kind"), field(row, "mode")
            name, facility_id = field(row, "name"), field(row, "facility_id")
            address = field(row, "facility_address")
            source, verified_on = field(row, "source"), field(row, "verified_on")
            if (
                kind not in {"convenience", "subway", "restroom"}
                or mode not in {"walk", "transit", "car"}
                or not (name or facility_id) or not source
                or (not facility_id and kind != "restroom" and not address)
                or date.fromisoformat(verified_on) > date.today()
            ):
                raise ValueError("시설과 이동수단, 출처, 검증일이 필요합니다.")
            point = AccessPoint(
                coordinates=position(row), label=field(row, "label") or "확인된 접근점",
                source=source, verified_on=verified_on, facility_address=address,
            )
            access.append((
                kind, facility_id, access_name(kind, name), mode, point.coordinates.lat, point.coordinates.lng,
                point.model_dump_json(),
            ))
        except ValueError:
            skipped += 1
    return access, skipped


def main() -> None:
    load_dotenv(PROJECT / ".env")
    parser = argparse.ArgumentParser(description="좌표가 있는 공중화장실 및 확인된 접근점 CSV 가져오기")
    parser.add_argument("--facilities", type=Path)
    parser.add_argument("--source-label", default="")
    parser.add_argument("--access", type=Path)
    parser.add_argument("--review", action="store_true", help="제외 행의 CSV 줄 번호와 사유 표시")
    parser.add_argument("--hold-facility", action="append", default=[], metavar="PUBLIC_ID")
    parser.add_argument("--delete-facility", action="append", default=[], metavar="PUBLIC_ID")
    options = parser.parse_args()
    if not (options.facilities or options.access or options.delete_facility):
        parser.error("--facilities, --access, --delete-facility 중 하나를 지정하세요.")
    if any(not re.fullmatch(r"public:[0-9a-f]{24}", key) for key in options.delete_facility + options.hold_facility):
        parser.error("--delete-facility와 --hold-facility에는 public 시설 ID를 입력하세요.")
    facilities, review = (
        parse_facilities(options.facilities, options.source_label, hold_ids=set(options.hold_facility))
        if options.facilities else ([], [])
    )
    access, access_skipped = read_access(options.access) if options.access else ([], 0)
    if facilities or access or options.delete_facility:
        FacilityStore(database_path()).import_rows(facilities, access, options.delete_facility)
    print(f"시설 {len(facilities)}건, 접근점 {len(access)}건 반영. 삭제 지정 {len(options.delete_facility)}건.")
    for reason, count in Counter(reason for _, reason in review).items():
        print(f"{reason} {count}건")
    if access_skipped:
        print(f"접근점 제외 {access_skipped}건")
    if options.review:
        for line, reason in review:
            print(f"{line}행 {reason}")


if __name__ == "__main__":
    main()
