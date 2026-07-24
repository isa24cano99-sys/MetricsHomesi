# Homesi B2B Metrics

## Supabase Connection

- **Active project:** `eykplgdwlqpybzkzbpmu` (simoOS-prod)
- **Schema:** `b2b_metrics` — all PostgREST calls set `Accept-Profile: b2b_metrics` (and `Content-Profile` on writes), configured in [`sbFetch()`](js/supabase.js). The schema must stay in Supabase's *Exposed schemas* (Settings → API).
- **Connection constants:** `SB_URL` / `SB_KEY` (anon public key) live in [`js/config.js`](js/config.js).

The app talks to PostgREST directly with the **anon** key, so it is subject to Row Level Security.

### Security debt — RLS disabled (pending, not by design)

12 of the 13 tables in `b2b_metrics` have **Row Level Security DISABLED**. This was inherited as-is from the origin project (`xxayufvjvxfyxgqepaov` / homesi-realtors) to preserve behavior during the migration — it is **security debt to be addressed**, not an intentional design choice. With RLS off, the anon key has unrestricted read/write on those tables.

**TODO:** enable RLS and add explicit `anon` policies (scoped read, and write only where the app actually needs it) on the 12 tables.

- **Exception — `lo_master_assignments`:** this table keeps RLS **enabled** (matching the origin). It is currently empty. If the app ever writes to it with the anon key (LO assignments upload flow), **those writes will fail** until a policy is added. Inherited behavior, flagged here so it is not mistaken for a regression.

## Manual Assignments Backup

The file `backups/manual_assignments_*.csv` contains all human-confirmed realtor-to-BD assignments. These are the P1 priority in the owner resolution logic and must never be lost.

After each export from Settings:
1. Move the downloaded CSV to the /backups folder in this repo
2. git add backups/
3. git commit -m "backup: manual assignments YYYY-MM-DD"
4. git push

In a BigQuery migration, load this file first into master_assignments before any other data to ensure P1 priority is preserved.
