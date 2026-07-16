---
title: Migrations, RLS, and the Role Model
last_updated: 2026-07-15
tags: [backend, migrations, rls, postgres, security]
---

# Migrations, RLS, and the Role Model

There are 358 migrations in `supabase/migrations/` (as of 2026-07-15). This doc covers how they're named, how RLS is written here, the role model and its SQL helpers, the SECURITY DEFINER view pattern, and — critically — **how to actually apply a migration** given that this project's migration history has diverged from the remote database.

## ⚠️ Migration history has DIVERGED — do NOT `supabase db push`

The local `supabase/migrations/` folder and the remote database's `supabase_migrations.schema_migrations` history are **out of sync**. Running `supabase db push` (or `supabase migration up`) will try to replay migrations the remote has already applied, or error on version-history mismatches, and can corrupt state.

**Apply migrations through the Supabase MCP `apply_migration` tool instead** — it executes the SQL against the remote directly (as a transactional DDL block) and records it, bypassing the broken CLI diff. Workflow:

1. Write the migration file to `supabase/migrations/<timestamp>_<name>.sql` (for the git record / future fresh-DB rebuilds).
2. Apply the same SQL to the live DB via `mcp__…__apply_migration` with a `name` and the `query`.
3. Never `supabase db push`.

This is a standing project constraint. When in doubt, apply via MCP and commit the file.

## File naming

`YYYYMMDDHHMMSS_snake_case_description.sql`, e.g. `20260715120000_transaction_duplicates.sql`, `20260709190000_agency_portal.sql`. The 14-digit UTC timestamp prefix is the ordering key. Newer files use a clean `HHMMSS`; some older ones use auto-generated timestamps (`20260630035704_...`). Keep new ones lexically after the latest — pick a timestamp greater than the current max.

Cron-only migrations are conventionally named `..._cron_<job>.sql` (e.g. `20260704200000_cron_plaid_sync.sql`).

## How RLS is written here

Every new table follows the same shape (see `20260714140000_idea_titles_ratings.sql`, `20260715120000_transaction_duplicates.sql`):

```sql
create table if not exists public.idea_ratings (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.write_ideas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  unique (idea_id, user_id)
);

alter table public.idea_ratings enable row level security;

create policy "raters read idea ratings" on public.idea_ratings
  for select to authenticated
  using ( exists (select 1 from public.profiles p
                  where p.id = auth.uid()
                    and p.role in ('admin','director_creative','director_comms')) );
```

Conventions that recur:

- **`enable row level security` immediately after `create table`.** A table with no policies + RLS on = nobody can read it, which is the safe default.
- **Policies split by verb** (`for select`, `for insert`, `for update`, `for delete`) rather than one `for all`, when the checks differ. `for all` is used when read/write share the same predicate (e.g. `sponsor_campaigns` "Allow all for authenticated").
- **`to authenticated`** almost always; `to service_role using (true) with check (true)` is added when an edge function needs to write with the service key *and* you also want an explicit escape hatch (`20260715120000_transaction_duplicates.sql:38-39`). Note: the service-role key already bypasses RLS, so a service policy is belt-and-suspenders / documentation.
- **`using` gates reads/deletes; `with check` gates the row *being written*.** Insert/update policies commonly assert `user_id = auth.uid()` in `with check` so a user can only write their own row.
- **Role checks are inlined** as `exists (select 1 from profiles where id = auth.uid() and role in (...))` **or** via a helper function (below).

## The role model

`profiles.role` is a text column with a CHECK constraint enumerating valid roles. The full set (as of the agency migration, `20260709190000_agency_portal.sql:13-15`):

```
admin, assistant, member, partner, freelancer,
director_creative, director_comms, producer, agency
```

Adding a role means **dropping and re-adding the CHECK constraint** in a migration:

```sql
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['admin','assistant','member','partner','freelancer',
    'director_creative','director_comms','producer','agency']));
```

"Admin-tier" is not one role: **`admin`, `director_creative`, and `director_comms` are all treated as admin** by the SQL helper `is_admin()`. Keep this in mind — a SQL policy using `is_admin()` grants the two directors access, whereas an edge function checking `role === 'admin'` literally does not (see doc 01).

## Role helper functions

Grep for `create ... function public.is_` — these are `SECURITY DEFINER STABLE` SQL functions with a pinned `search_path`, used inside RLS policies:

- **`is_admin(uid uuid)`** — `role in ('admin','director_creative','director_comms')` (`20260602140000_director_roles.sql`). Also a no-arg `is_admin()` overload that uses `auth.uid()`.
- **`is_admin_or_assistant(uid uuid)`**
- **`is_agency(uid uuid)`** — `role = 'agency'` (`20260709190000_agency_portal.sql:18-26`)
- **`is_freelancer(uid uuid)`**, **`is_producer_or_admin(uid uuid)`**, **`is_bd_viewer(uid uuid)`**, **`is_channel_admin()`**

Canonical shape:

```sql
create or replace function public.is_admin(uid uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role in ('admin','director_creative','director_comms')
  );
$$;
```
(`20260602140000_director_roles.sql`)

Why `SECURITY DEFINER` here: the function reads `profiles` to make an access decision. If it ran as the caller, the caller's own RLS on `profiles` could recurse or block the lookup. Definer + pinned `search_path` makes the role check deterministic and injection-safe. Lock down execution afterward when appropriate: `REVOKE EXECUTE ... FROM anon, public;` (`20260709190000_agency_portal.sql:135`).

## SECURITY DEFINER views (the agency pattern)

When a role needs a **trimmed** slice of a table (some columns hidden), the pattern is a `security_barrier` view that is itself gated, while the base table's RLS *excludes* that role entirely. The agency portal is the reference implementation:

```sql
CREATE OR REPLACE VIEW public.agency_deliverables
WITH (security_barrier) AS
SELECT d.id, d.title, d.status, d.due_date, ...   -- NO pay/notes/ad_copy columns
       c.name AS brand_name, s.name AS sponsor_name
FROM public.sponsor_deliverables d
LEFT JOIN public.sponsor_campaigns c ON c.id = d.campaign_id
LEFT JOIN public.sponsors s ON s.id = d.sponsor_id
WHERE public.is_agency(auth.uid()) OR public.is_admin(auth.uid());

REVOKE ALL ON public.agency_deliverables FROM anon, public;
GRANT SELECT ON public.agency_deliverables TO authenticated;
```
(`20260709190000_agency_portal.sql:107-130`)

Then the base tables get their staff policies **narrowed to exclude agency** via `ALTER POLICY ... USING (NOT public.is_agency(auth.uid()))` (`20260709190000_agency_portal.sql:30-73`). Net effect: an agency user cannot touch `sponsor_deliverables` directly at all; they can only `SELECT` the trimmed view, whose `WHERE` re-asserts they're agency. Two independent gates.

`agency_briefs` is the same pattern for `campaign_briefs`, dropping `source_text` (`:123-130`).

## Trigger-enforced author snapshots (never trust the client)

`agency_comments` shows the "don't trust client-supplied identity" pattern. A `BEFORE INSERT` trigger overwrites `author_id` with `auth.uid()` and snapshots the author's role at post time:

```sql
CREATE FUNCTION public.set_agency_comment_author() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN NEW.author_id := auth.uid(); END IF;
  SELECT role INTO NEW.author_role FROM public.profiles WHERE id = NEW.author_id;
  NEW.author_role := COALESCE(NEW.author_role, 'member');
  RETURN NEW;
END; $$;
CREATE TRIGGER agency_comments_set_author
  BEFORE INSERT ON public.agency_comments FOR EACH ROW
  EXECUTE FUNCTION public.set_agency_comment_author();
```
(`20260709190000_agency_portal.sql:156-173`)

## profiles FK convention

User-owned rows reference **`public.profiles(id)`**, not `auth.users(id)` — profiles is the app-level identity table and mirrors the auth id. Choose the cascade deliberately:

- `references public.profiles(id) on delete cascade` — the row is meaningless without its owner (ratings, comments, assignments). (`20260714140000_idea_titles_ratings.sql:14-16`; `20260709190000_agency_portal.sql:142`)
- `references public.profiles(id) on delete set null` — keep the row for history, just orphan it (`duplicate_dismissals.created_by`, `20260715120000_transaction_duplicates.sql:25`).

Exception: `automations.created_by` references `auth.users(id)` (`20260601100000_create_automations.sql`) — older table, follows the auth convention. Prefer `profiles(id)` for new tables unless matching an existing pattern.

## Cascade deletes

Cascades are expressed on the FK (`on delete cascade`) and are load-bearing for the app's "delete parent, clean up children" flows. Examples: `bd_initiatives`/`bd_milestones` cascade off `bd_phases.phase_id` (deleting a Business Dev phase wipes its whole tree); `idea_ratings` cascade off `write_ideas`; `automation_runs` cascade off `automations` (`20260601100000_create_automations.sql:44`).

## Realtime opt-in

To make a table emit `postgres_changes`, add it to the `supabase_realtime` publication, guarded so re-running the migration is idempotent:

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND tablename='agency_comments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agency_comments;
  END IF;
END $$;
```
(`20260709190000_agency_portal.sql:203-212`)

## Notification-summary RPC

The bell/badge counts come from one big `SECURITY DEFINER` RPC, `get_notification_summary(...)`, which is `CREATE OR REPLACE`d whenever a new badge is added (the agency migration re-defines it to add `agency_unresolved_count`, `20260709190000_agency_portal.sql:219-272`). If you add a notifiable surface, you extend this function — don't invent a parallel counter.

## Migration authoring checklist

1. **Timestamp** the filename after the current max; `snake_case` description.
2. Use **`if not exists` / `or replace`** so the SQL is safely re-runnable.
3. `create table` → **`enable row level security`** in the same migration.
4. FK user columns → **`public.profiles(id)`**; pick `cascade` vs `set null` on purpose.
5. Write **verb-split policies**; `using` for read/delete visibility, `with check` for write validation; assert `= auth.uid()` for ownership.
6. Reuse role helpers (`is_admin()`, `is_agency()`, ...) rather than re-inlining role lists; add a new helper only for a genuinely new role.
7. If exposing a trimmed slice to a role, use a **`security_barrier` view** gated by a helper, and **exclude the role from the base-table policies**.
8. Never trust client-set identity — snapshot `auth.uid()`/role via a **BEFORE INSERT trigger** with `SECURITY DEFINER`.
9. New helper/trigger functions: `SECURITY DEFINER`, `set search_path = public, pg_temp`, and `REVOKE EXECUTE FROM anon/public` unless a role legitimately calls it.
10. Realtime table → add to `supabase_realtime` publication (guarded `DO $$`).
11. New notifiable event → extend `get_notification_summary`.
12. Cron/trigger→edge-fn calls → read the shared secret from **Vault** (`select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'`), never hardcode (doc 03).
13. **Apply via MCP `apply_migration`**, then commit the file. **Never `supabase db push`.**
