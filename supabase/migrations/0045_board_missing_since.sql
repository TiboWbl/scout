-- A career page that answers 404 once may be a passing error: dropped only when it still does a day later.
alter table public.companies add column if not exists board_missing_since timestamptz;
