\set ON_ERROR_STOP off
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a','a@x'),('00000000-0000-0000-0000-00000000000b','b@x');
select 'profiles auto-created:', count(*) from public.profiles;
-- Nutzer A legt Daten an
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.plans (id,title,start_date,end_date,goal) values ('11111111-1111-1111-1111-111111111111','A-Plan','2026-11-23','2027-02-01','{}');
insert into public.sessions (id,plan_id,date,kind,duration_min,intensity) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','2026-11-24','run_easy',40,'easy');
select 'A sieht eigene Sessions:', count(*) from public.sessions;
-- Nutzer B sieht nichts von A und kann nichts in A's Namen schreiben
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'B sieht Sessions von A (erwartet 0):', count(*) from public.sessions;
select 'B sieht Pläne von A (erwartet 0):', count(*) from public.plans;
insert into public.sessions (id,user_id,plan_id,date,kind) values ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','2026-11-25','run_easy');
update public.sessions set title='gehackt' where id='22222222-2222-2222-2222-222222222222';
select 'B-Update auf A-Zeile (erwartet 0 Zeilen):', count(*) from public.sessions where title='gehackt';
delete from public.plans where id='11111111-1111-1111-1111-111111111111';
-- Garmin-Link: Tokens nie lesbar
reset role; insert into public.garmin_links (user_id,status,token_cipher) values ('00000000-0000-0000-0000-00000000000a','connected','SECRET');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select status from public.garmin_links;
select token_cipher from public.garmin_links;
select * from public.garmin_links;
-- Garmin-Daten: eigene Zeilen ja, fremde user_id nein
insert into public.garmin_daily (user_id,date,data) values ('00000000-0000-0000-0000-00000000000a','2026-11-20','{}');
insert into public.garmin_daily (user_id,date,data) values ('00000000-0000-0000-0000-00000000000b','2026-11-20','{}');
select 'A hat nach Import (erwartet 1):', count(*) from public.garmin_daily;
-- ai_hit / ai_usage für Nutzer gesperrt
select public.ai_hit('00000000-0000-0000-0000-00000000000a', 5);
select * from public.ai_usage;
-- anon sieht nichts
reset role; set role anon; reset request.jwt.claim.sub;
select * from public.plans;
-- service_role: ai_hit zählt hoch
reset role; set role service_role;
select 'ai_hit 1:', public.ai_hit('00000000-0000-0000-0000-00000000000a', 5);
select 'ai_hit 2:', public.ai_hit('00000000-0000-0000-0000-00000000000a', 5);
-- Konto löschen -> CASCADE
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.delete_my_account();
reset role;
select 'nach Löschung: users/plans/sessions/links/usage/profiles', (select count(*) from auth.users), (select count(*) from public.plans), (select count(*) from public.sessions), (select count(*) from public.garmin_links), (select count(*) from public.ai_usage), (select count(*) from public.profiles);
-- ungültige Werte werden abgelehnt
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into public.plans (id,title,start_date,end_date,goal,status) values ('44444444-4444-4444-4444-444444444444','x','2026-01-01','2026-02-01','{}','hacked');
