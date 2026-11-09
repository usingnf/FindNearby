import logging
import os
from collections import OrderedDict, deque
from time import monotonic

from dotenv import load_dotenv
from fastapi import Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from server.FacilityImport import PROJECT
from server.FindNearbyApi import create_api


class ClientRateLimit:
    def __init__(self, limit: int, max_clients: int = 2048):
        if limit < 1:
            raise ValueError("FIND_NEARBY_CLIENT_MINUTE_LIMIT must be positive")
        self.limit = limit
        self.max_clients = max_clients
        self.attempts: OrderedDict[str, deque[float]] = OrderedDict()

    def allow(self, client: str) -> bool:
        now = monotonic()
        cutoff = now - 60
        while self.attempts:
            oldest = next(iter(self.attempts.values()))
            if oldest[-1] > cutoff:
                break
            self.attempts.popitem(last=False)

        attempts = self.attempts.get(client)
        if attempts is None:
            if len(self.attempts) >= self.max_clients:
                return False
            attempts = self.attempts[client] = deque()
        while attempts and attempts[0] <= cutoff:
            attempts.popleft()
        if len(attempts) >= self.limit:
            return False
        attempts.append(now)
        self.attempts.move_to_end(client)
        return True


def create_deployment():
    load_dotenv(PROJECT / ".env")
    web = PROJECT / "web"
    index = web / "index.html"
    if not index.is_file():
        raise RuntimeError("The packaged web/index.html is missing")

    app = create_api(deployment=True)
    limiter = ClientRateLimit(int(os.getenv("FIND_NEARBY_CLIENT_MINUTE_LIMIT") or 12))
    operations = {
        "/api/addresses": "addresses",
        "/api/recommend": "recommend",
        "/api/route": "route",
    }
    logger = logging.getLogger("uvicorn.error")

    @app.middleware("http")
    async def guard(request: Request, call_next):
        path = request.url.path.rstrip("/")
        operation = operations.get(path)
        started = monotonic()
        client = request.client.host if request.client else "unknown"
        if operation and not limiter.allow(client):
            response = JSONResponse(
                {"detail": "요청이 많습니다. 잠시 뒤 다시 시도하세요.", "reason": "rate_limited"},
                status_code=429, headers={"Retry-After": "60"},
            )
        else:
            response = await call_next(request)
        if operation:
            logger.info("api_operation=%s status=%d elapsed_ms=%d",
                        operation, response.status_code, (monotonic() - started) * 1000)
        if path.startswith("/api/") or path == "":
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

    @app.get("/", include_in_schema=False)
    def home():
        return FileResponse(index)

    app.mount("/assets", StaticFiles(directory=web / "assets"), name="assets")
    return app
