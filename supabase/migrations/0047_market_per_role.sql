-- Mon marché for each role sought: '' is the first role with its equivalent titles (as before); another
-- role sought has its own picture, under its name.
alter table public.market_snapshots add column if not exists role text not null default '';
alter table public.market_snapshots drop constraint if exists market_snapshots_pkey;
alter table public.market_snapshots add primary key (profile_id, day, role);
