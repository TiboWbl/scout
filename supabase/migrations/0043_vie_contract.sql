-- V.I.E. (volontariat international en entreprise): a contract of its own, abroad by definition.
alter table public.offers drop constraint if exists offers_contract_check;
alter table public.offers add constraint offers_contract_check check (contract in ('cdi', 'cdd', 'stage', 'alternance', 'freelance', 'vie', 'unknown'));
