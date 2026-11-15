import { createApi } from './FindNearbyApi.ts';

Deno.serve(createApi(name => Deno.env.get(name)));
