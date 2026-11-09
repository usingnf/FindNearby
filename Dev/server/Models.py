from datetime import datetime
from math import asin, cos, radians, sin, sqrt
from typing import Literal

from pydantic import BaseModel, Field, computed_field, model_validator


FacilityType = Literal["convenience", "subway", "restroom"]
TravelMode = Literal["walk", "transit", "car"]
Source = Literal["demo", "kakao", "public"]
RouteSource = Literal["demo", "kakao_maps", "kakao_mobility"]
StopReason = Literal[
    "exhausted", "radius_limit", "rank_bound", "call_budget",
    "rate_limited", "deadline", "provider_error",
]


class Coordinates(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)

    @classmethod
    def from_xy(cls, x, y):
        return cls(lat=y, lng=x)

    def distance_to(self, other: "Coordinates") -> float:
        lat, other_lat = radians(self.lat), radians(other.lat)
        lng_diff = radians(other.lng - self.lng)
        a = sin((other_lat - lat) / 2) ** 2 + cos(lat) * cos(other_lat) * sin(lng_diff / 2) ** 2
        return 12_742_000 * asin(sqrt(min(1, a)))

    def in_service_area(self) -> bool:
        return 32.8 <= self.lat <= 39.5 and 124 <= self.lng <= 132


class Place(BaseModel):
    name: str
    address: str = ""
    coordinates: Coordinates


class Facility(Place):
    id: str
    kind: FacilityType
    source: Source
    source_label: str = ""
    alternate_address: str = ""
    hours: str = ""
    updated: str = ""


class AccessPoint(BaseModel):
    coordinates: Coordinates
    label: str
    source: str
    verified_on: str
    facility_address: str = ""


class Segment(BaseModel):
    kind: Literal["walk", "bus", "subway", "car"]
    distance_m: int = Field(ge=0)
    duration_s: int = Field(ge=0)
    path: list[Coordinates]
    lines: list[str] = Field(default_factory=list)
    stops: list[str] = Field(default_factory=list)


class Route(BaseModel):
    distance_m: int = Field(ge=0)
    duration_s: int = Field(ge=0)
    transfers: int = Field(default=0, ge=0)
    fare_won: int | None = Field(default=None, ge=0)
    calculated_at: datetime
    segments: list[Segment] = Field(default_factory=list)
    source: RouteSource

    @computed_field
    @property
    def geometry(self) -> Literal["summary", "polyline"]:
        return "polyline" if any(len(segment.path) >= 2 for segment in self.segments) else "summary"

    @computed_field
    @property
    def walking_distance_m(self) -> int | None:
        if self.source == "kakao_mobility" or any(segment.kind == "car" for segment in self.segments):
            return None
        return sum(segment.distance_m for segment in self.segments if segment.kind == "walk")

    def rank_key(self, mode: TravelMode) -> tuple:
        if mode == "walk":
            return self.distance_m, self.duration_s
        if mode == "car":
            return self.duration_s, self.distance_m
        return self.duration_s, self.transfers, self.walking_distance_m


class RecommendRequest(BaseModel):
    origin: Coordinates
    kind: FacilityType
    mode: TravelMode
    demo: bool = True

    @model_validator(mode="after")
    def validate_origin(self):
        if not self.origin.in_service_area():
            raise ValueError("대한민국 내 출발지를 선택하세요.")
        return self


class RouteRequest(RecommendRequest):
    destination: Coordinates

    @model_validator(mode="after")
    def validate_destination(self):
        if not self.destination.in_service_area():
            raise ValueError("대한민국 내 목적지를 선택하세요.")
        return self


class Recommendation(BaseModel):
    facility: Facility
    access: AccessPoint | None = None
    destination: Coordinates
    route: Route


class RecommendResult(BaseModel):
    recommendations: list[Recommendation]
    matched: int
    public_matched: int = 0
    evaluated: int
    radius_m: int
    unavailable: int
    failed: int
    demo: bool
    stop_reason: StopReason
