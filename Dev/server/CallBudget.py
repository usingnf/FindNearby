import sqlite3
from contextlib import closing
from pathlib import Path
from time import monotonic, time

from server.Models import StopReason


DEFAULT_MINUTE_LIMIT = 50


class BudgetExceeded(Exception):
    def __init__(self, reason: StopReason, message: str):
        super().__init__(message)
        self.reason = reason


class CallBudget:
    def __init__(self, daily_limit: int, path: Path, minute_limit: int = DEFAULT_MINUTE_LIMIT):
        self.daily_limit = daily_limit
        self.minute_limit = minute_limit
        self.path = path
        with closing(self.connect()) as db, db:
            db.execute("""
                CREATE TABLE IF NOT EXISTS api_calls (
                    attempted_at REAL NOT NULL, operation TEXT NOT NULL
                )
            """)
            db.execute("CREATE INDEX IF NOT EXISTS api_calls_time ON api_calls(attempted_at)")

    def connect(self):
        return sqlite3.connect(self.path, timeout=1)

    def take(self, operation: str, reserve: int = 0) -> None:
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            now = time()
            day_start = int(now) // 86400 * 86400
            minute_start = now - 60
            db.execute("DELETE FROM api_calls WHERE attempted_at < ?", (min(day_start, minute_start),))
            today, recent = db.execute(
                """SELECT COUNT(CASE WHEN attempted_at >= ? THEN 1 END),
                          COUNT(CASE WHEN attempted_at > ? THEN 1 END)
                   FROM api_calls""",
                (day_start, minute_start),
            ).fetchone()
            if today + reserve >= self.daily_limit or recent + reserve >= self.minute_limit:
                raise BudgetExceeded("call_budget", "서비스 API 호출 한도에 도달했습니다.")
            db.execute("INSERT INTO api_calls VALUES (?, ?)", (now, operation))


class SearchBudget:
    def __init__(self, call_limit: int, seconds: float, *, reserve: int = 0):
        self.remaining_calls = call_limit
        self.deadline = monotonic() + seconds
        self.reserve = reserve

    def remaining_time(self) -> float:
        remaining = self.deadline - monotonic()
        if remaining <= 0:
            raise BudgetExceeded("deadline", "추천 검색 시간이 초과되었습니다.")
        return remaining

    def check_call(self) -> float:
        remaining = self.remaining_time()
        if self.remaining_calls <= 0:
            raise BudgetExceeded("call_budget", "이번 검색의 API 호출 한도에 도달했습니다.")
        return remaining
