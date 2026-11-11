import logging
import os
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, Query, Request
from fastapi.responses import JSONResponse

from server.CallBudget import DEFAULT_MINUTE_LIMIT, CallBudget
from server.FacilityImport import PROJECT, database_path
from server.FacilityStore import FacilityStore
from server.KakaoProvider import KakaoProvider, NoRoute, ProviderError
from server.Models import Place, RecommendRequest, RecommendResult, Route, RouteRequest
from server.RecommendationService import RecommendationService


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_dotenv(PROJECT / ".env")
    budget = CallBudget(
        int(os.getenv("FIND_NEARBY_DAILY_LIMIT") or 300),
        PROJECT / (os.getenv("FIND_NEARBY_USAGE_DB") or "api-usage.sqlite3"),
        minute_limit=int(os.getenv("FIND_NEARBY_MINUTE_LIMIT") or DEFAULT_MINUTE_LIMIT),
    )
    with httpx.Client(timeout=4.0, trust_env=False) as client:
        provider = KakaoProvider(
            os.getenv("KAKAO_REST_API_KEY", ""), os.getenv("KAKAO_MOBILITY_REST_API_KEY", ""),
            budget, client,
        )
        app.state.service = RecommendationService(
            provider, FacilityStore(database_path()),
            search_calls=int(os.getenv("FIND_NEARBY_SEARCH_CALLS") or 12),
            search_seconds=float(os.getenv("FIND_NEARBY_SEARCH_SECONDS") or 8),
        )
        logging.getLogger("uvicorn.error").info(
            "FindNearby REST daily limit: %d calls, rolling 60-second limit: %d calls",
            budget.daily_limit, budget.minute_limit,
        )
        yield


router = APIRouter()


async def provider_error(request: Request, exc: ProviderError):
    return JSONResponse(status_code=exc.status, content={"detail": str(exc), "reason": exc.reason})


async def no_route(request: Request, exc: NoRoute):
    return JSONResponse(status_code=404, content={"detail": "선택한 이동수단으로 이용할 수 있는 경로가 없습니다."})


@router.get("/api/status")
def status(request: Request):
    service = request.app.state.service
    response = {"live_ready": bool(service.provider.key), **service.store.counts()}
    if request.app.state.deployment:
        response["map_js_key"] = os.getenv("FIND_NEARBY_MAP_JS_KEY", "")
    return response


@router.get("/api/addresses", response_model=list[Place])
def addresses(request: Request, q: str = Query(min_length=2, max_length=120)):
    return request.app.state.service.provider.addresses(q)


@router.post("/api/recommend", response_model=RecommendResult)
def recommend(query: RecommendRequest, request: Request):
    return request.app.state.service.recommend(query)


@router.post("/api/route", response_model=Route)
def route(query: RouteRequest, request: Request):
    service = request.app.state.service
    if query.demo:
        return service.simulate(query, query.destination)
    return service.provider.route(query.mode, query.origin, query.destination)


def create_api(*, deployment: bool = False) -> FastAPI:
    api = FastAPI(title="FindNearby", lifespan=lifespan, openapi_url=None if deployment else "/openapi.json")
    api.state.deployment = deployment
    api.add_exception_handler(ProviderError, provider_error)
    api.add_exception_handler(NoRoute, no_route)
    api.include_router(router)
    return api


app = create_api()
