-- "Métiers": the person's last exploration (what they said, the jobs suggested and their counts), kept
-- so the page shows it again. Private to the person through the profiles policies.
alter table profiles add column if not exists career_text text;
alter table profiles add column if not exists career_ideas jsonb;
alter table profiles add column if not exists career_at timestamptz;
