-- Stay within the free plan's 5 GB of monthly egress.
-- The length of a description, so a collection can compare texts without downloading them.
alter table public.offers add column if not exists description_length int generated always as (coalesce(char_length(description), 0)) stored;

-- The active offers not sorted yet for this person and version: only those travel, not the whole stock.
create or replace function public.unscored_offers(p_user uuid, p_version int)
returns table (id uuid, title text, location_raw text, places jsonb, remote text, remote_scope text[], contract text, experience_min_years int, experience_level text, company_id uuid, has_description boolean, company_name text)
language sql stable security invoker as $$
  select o.id, o.title::text, o.location_raw::text, o.places, o.remote::text, o.remote_scope, o.contract::text, o.experience_min_years::int, o.experience_level::text, o.company_id, o.has_description, c.name::text
  from public.offers o
  left join public.companies c on c.id = o.company_id
  where o.archived_at is null
    and not exists (select 1 from public.offer_scores s where s.user_id = p_user and s.criteria_version = p_version and s.offer_id = o.id)
  order by o.first_seen_at desc;
$$;
revoke execute on function public.unscored_offers(uuid, int) from public, anon;
grant execute on function public.unscored_offers(uuid, int) to authenticated, service_role;
