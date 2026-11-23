-- Multisport-Trainingsplaner: Schema, Zeilenschutz (RLS) und Hilfsfunktionen.
-- Ausführen: Supabase Dashboard → SQL Editor → einfügen → Run (oder `supabase db push`).

create extension if not exists pgcrypto;

-- Profile (1:1 zu auth.users) -------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  start_date date not null,
  end_date date not null,
  goal jsonb not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index plans_user_idx on public.plans (user_id, status);

create table public.sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete cascade,
  date date not null,
  status text not null default 'planned' check (status in ('planned', 'done', 'skipped')),
  kind text not null,
  sport text,
  title text,
  duration_min integer check (duration_min is null or duration_min between 0 and 1000),
  intensity text check (intensity is null or intensity in ('easy', 'moderate', 'hard')),
  load numeric,
  priority text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index sessions_user_date_idx on public.sessions (user_id, date);
create index sessions_plan_idx on public.sessions (plan_id);

-- Garmin-Rohdaten (Server-Sync und Datei-Import schreiben; jeder Nutzer nur in seine eigenen Zeilen) ----
create table public.garmin_activities (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  primary key (user_id, id)
);
create index garmin_activities_date_idx on public.garmin_activities (user_id, date);

create table public.garmin_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  primary key (user_id, date)
);

-- Garmin-Verbindung: verschlüsselte Tokens. Der Browser darf NUR status/last_sync_at/last_error lesen.
create table public.garmin_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'none' check (status in ('none', 'mfa_pending', 'connected', 'error')),
  token_cipher text,
  mfa_cipher text,
  last_sync_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

-- KI-Nutzung pro Nutzer und Tag (Schutz des kostenlosen Kontingents) ------------------
create table public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  primary key (user_id, day)
);

-- updated_at automatisch ---------------------------------------------------------------
create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger plans_touch before update on public.plans for each row execute function public.touch_updated_at();
create trigger sessions_touch before update on public.sessions for each row execute function public.touch_updated_at();

-- Profil bei Registrierung anlegen ----------------------------------------------------
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id) values (new.id) on conflict do nothing; return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Zeilenschutz: jeder sieht und ändert ausschließlich seine eigenen Zeilen -----------------
alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.sessions enable row level security;
alter table public.garmin_activities enable row level security;
alter table public.garmin_daily enable row level security;
alter table public.garmin_links enable row level security;
alter table public.ai_usage enable row level security;

create policy profiles_own on public.profiles for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy plans_own on public.plans for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy sessions_own on public.sessions for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy garmin_activities_read on public.garmin_activities for select to authenticated using (user_id = (select auth.uid()));
create policy garmin_activities_delete on public.garmin_activities for delete to authenticated using (user_id = (select auth.uid()));
create policy garmin_activities_write on public.garmin_activities for insert to authenticated with check (user_id = (select auth.uid()));
create policy garmin_activities_update on public.garmin_activities for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy garmin_daily_read on public.garmin_daily for select to authenticated using (user_id = (select auth.uid()));
create policy garmin_daily_delete on public.garmin_daily for delete to authenticated using (user_id = (select auth.uid()));
create policy garmin_daily_write on public.garmin_daily for insert to authenticated with check (user_id = (select auth.uid()));
create policy garmin_daily_update on public.garmin_daily for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy garmin_links_status on public.garmin_links for select to authenticated using (user_id = (select auth.uid()));
-- ai_usage: bewusst keine Policy -> für Nutzer vollständig gesperrt

-- Explizite Rechte (unabhängig von Supabase-Default-Privileges) -------------------------
revoke all on public.profiles, public.plans, public.sessions, public.garmin_activities, public.garmin_daily, public.garmin_links, public.ai_usage from anon, authenticated;
grant select, insert, update, delete on public.profiles, public.plans, public.sessions to authenticated;
grant select, insert, update, delete on public.garmin_activities, public.garmin_daily to authenticated;
grant select (user_id, status, last_sync_at, last_error) on public.garmin_links to authenticated;   -- Spalten token_cipher/mfa_cipher bleiben unlesbar
grant all on public.profiles, public.plans, public.sessions, public.garmin_activities, public.garmin_daily, public.garmin_links, public.ai_usage to service_role;

-- KI-Tageslimit: zählt hoch und liefert den neuen Stand (nur service_role darf aufrufen) -------
create function public.ai_hit(p_user uuid, p_limit integer) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.ai_usage (user_id, day, count) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1 returning count into n;
  return n;
end $$;
revoke all on function public.ai_hit(uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_hit(uuid, integer) to service_role;

-- Konto löschen (Selbstbedienung): entfernt den Nutzer, alle Daten verschwinden per CASCADE ---------
create function public.delete_my_account() returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
