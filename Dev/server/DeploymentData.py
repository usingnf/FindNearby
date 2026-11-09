import argparse
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory

from dotenv import load_dotenv

from server.FacilityImport import PROJECT, database_path, parse_facilities, read_access
from server.FacilityStore import FacilityStore


SEED_SOURCES = (
    ("자료_공중화장실_인천미추홀구20260731.csv", "인천광역시 미추홀구 공중·개방화장실",
     "public:2cb45b28638f017768976a05"),
    ("자료_공중화장실_인천서해구.csv", "인천광역시 서해구 공중화장실 자료",
     "public:340597ecfbab6fae5db96d8d"),
)
SEED_ACCESS = "자료_FindNearby_확인된인천역출입구.csv"


def seed(target: Path) -> None:
    directory = PROJECT / "seed"
    facilities = []
    for file, label, hold in SEED_SOURCES:
        rows, _ = parse_facilities(directory / file, label, hold_ids={hold})
        facilities.extend(rows)
    access, skipped = read_access(directory / SEED_ACCESS)
    if len(facilities) != 91 or len(access) != 10 or skipped:
        raise ValueError("초기 배포 데이터 건수가 예상과 다릅니다.")
    store = FacilityStore(target)
    store.import_rows(facilities, access)
    print(f"초기 데이터 반영 완료 {store.counts()}")


def copy_facilities(source: Path, target: Path, *, restore: bool = False) -> None:
    source, target = source.resolve(), target.resolve()
    if source == target or not source.is_file() or (target.exists() and not restore):
        raise ValueError("서로 다른 기존 원본과 올바른 대상 경로를 지정하세요.")
    target.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=target.parent) as work:
        snapshot = Path(work) / "snapshot.sqlite3"
        with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as original:
            with closing(sqlite3.connect(snapshot)) as copy:
                original.backup(copy)
                tables = {name for (name,) in copy.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if not {"facilities", "access"} <= tables or "api_calls" in tables:
                    raise ValueError("시설 전용 데이터베이스가 필요합니다.")
                if copy.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                    raise ValueError("시설 데이터베이스 무결성 검사에 실패했습니다.")
        if restore:
            if any(Path(str(target) + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
                raise ValueError("서버를 중지하고 활성 DB 파일 상태를 확인하세요.")
            snapshot.replace(target)
        else:
            # A hard link publishes the completed snapshot without overwriting an existing backup.
            snapshot.rename(target) if os.name == "nt" else os.link(snapshot, target)
    print(f"시설 데이터 {'복원' if restore else '백업'} 완료")


def main() -> None:
    load_dotenv(PROJECT / ".env")
    parser = argparse.ArgumentParser(description="시험 배포 시설 데이터 관리")
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("seed")
    for command in ("backup", "restore"):
        commands.add_parser(command).add_argument("file", type=Path)
    options = parser.parse_args()
    facility_db = database_path()
    usage_db = PROJECT / (os.getenv("FIND_NEARBY_USAGE_DB") or "api-usage.sqlite3")
    if facility_db.resolve() == usage_db.resolve():
        parser.error("시설 DB와 사용량 장부에 다른 경로를 지정하세요.")
    if options.action == "seed":
        seed(facility_db)
    else:
        if options.file.resolve() == usage_db.resolve():
            parser.error("시설 백업에 사용량 장부 경로를 사용할 수 없습니다.")
        if options.action == "backup":
            copy_facilities(facility_db, options.file)
        else:
            copy_facilities(options.file, facility_db, restore=True)


if __name__ == "__main__":
    main()
