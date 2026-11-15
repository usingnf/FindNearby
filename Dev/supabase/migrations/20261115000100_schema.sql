create schema find_nearby;
revoke all on schema find_nearby from public, anon, authenticated;

create table find_nearby.facilities (
  id text primary key,
  lat double precision not null check (lat between 32.8 and 39.5),
  lng double precision not null check (lng between 124 and 132),
  payload jsonb not null
);
create index facilities_position on find_nearby.facilities (lat, lng);

-- Some verified station entrances match a live Kakao place by name and address.
create table find_nearby.access_points (
  kind text not null check (kind in ('convenience', 'subway', 'restroom')),
  facility_id text not null,
  name text not null,
  mode text not null check (mode in ('walk', 'transit', 'car')),
  lat double precision not null check (lat between 32.8 and 39.5),
  lng double precision not null check (lng between 124 and 132),
  payload jsonb not null,
  primary key (kind, facility_id, name, mode, lat, lng)
);
create index access_name_mode on find_nearby.access_points (kind, mode, name);

create table find_nearby.api_calls (
  attempted_at timestamptz not null,
  operation text not null
);
create index api_calls_time on find_nearby.api_calls (attempted_at);

create table find_nearby.client_requests (
  client_key text not null,
  attempted_at timestamptz not null
);
create index client_requests_key_time on find_nearby.client_requests (client_key, attempted_at);
create index client_requests_time on find_nearby.client_requests (attempted_at);

alter table find_nearby.facilities enable row level security;
alter table find_nearby.access_points enable row level security;
alter table find_nearby.api_calls enable row level security;
alter table find_nearby.client_requests enable row level security;

create function public.find_nearby_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'facilities', (select count(*) from find_nearby.facilities),
    'access_points', (select count(*) from find_nearby.access_points)
  );
$$;

create function public.find_nearby_facilities(
  min_lat double precision, max_lat double precision,
  min_lng double precision, max_lng double precision
)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(payload order by id), '[]'::jsonb)
  from find_nearby.facilities
  where lat between min_lat and max_lat and lng between min_lng and max_lng;
$$;

create function public.find_nearby_access(
  facility_kind text, travel_mode text, facility_ids text[], facility_names text[]
)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'facility_id', facility_id, 'name', name, 'point', payload
  )), '[]'::jsonb)
  from find_nearby.access_points
  where kind = facility_kind and mode = travel_mode
    and (facility_id = any(facility_ids) or (facility_id = '' and name = any(facility_names)));
$$;

create function public.find_nearby_take_call(
  operation_name text, daily_limit integer, minute_limit integer, reserve integer
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  attempted timestamptz;
  day_start timestamptz;
  minute_start timestamptz;
  daily_count bigint;
  minute_count bigint;
begin
  perform pg_advisory_xact_lock(158901, 1);
  attempted := clock_timestamp();
  day_start := date_trunc('day', attempted, 'UTC');
  minute_start := attempted - interval '60 seconds';
  delete from find_nearby.api_calls where attempted_at < least(day_start, minute_start);
  select count(*) filter (where attempted_at >= day_start),
         count(*) filter (where attempted_at > minute_start)
    into daily_count, minute_count from find_nearby.api_calls;
  if daily_count + reserve >= daily_limit or minute_count + reserve >= minute_limit then
    return false;
  end if;
  insert into find_nearby.api_calls values (attempted, operation_name);
  return true;
end;
$$;

create function public.find_nearby_take_request(client_hash text, minute_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  attempted timestamptz;
  minute_start timestamptz;
begin
  perform pg_advisory_xact_lock(158902, hashtext(client_hash));
  attempted := clock_timestamp();
  minute_start := attempted - interval '60 seconds';
  if pg_try_advisory_xact_lock(158901, 2) then
    delete from find_nearby.client_requests where attempted_at <= minute_start;
  end if;
  if (select count(*) from find_nearby.client_requests
      where client_key = client_hash and attempted_at > minute_start) >= minute_limit then
    return false;
  end if;
  insert into find_nearby.client_requests values (client_hash, attempted);
  return true;
end;
$$;

revoke execute on function public.find_nearby_status() from public, anon, authenticated;
revoke execute on function public.find_nearby_facilities(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.find_nearby_access(text, text, text[], text[]) from public, anon, authenticated;
revoke execute on function public.find_nearby_take_call(text, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.find_nearby_take_request(text, integer) from public, anon, authenticated;

grant execute on function public.find_nearby_status() to service_role;
grant execute on function public.find_nearby_facilities(double precision, double precision, double precision, double precision) to service_role;
grant execute on function public.find_nearby_access(text, text, text[], text[]) to service_role;
grant execute on function public.find_nearby_take_call(text, integer, integer, integer) to service_role;
grant execute on function public.find_nearby_take_request(text, integer) to service_role;
