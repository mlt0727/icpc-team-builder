# ICPC Team Builder

A reusable ICPC team-formation tool built with Next.js, TypeScript, Tailwind CSS, and dnd-kit; backed by Supabase PostgreSQL, Anonymous Auth, and Realtime; and deployed on Vercel.

Project links: [GitHub repository](https://github.com/mlt0727/icpc-team-builder) · [Student page](https://icpc-team-builder-six.vercel.app/e/icpc-2026) · [Admin page](https://icpc-team-builder-six.vercel.app/admin). Vercel is connected to this repository, with `main` as the production branch. Subsequent pushes deploy automatically through the Git integration. Environment variables are managed in Vercel project settings and are not committed to the repository.

## Student and admin URLs

| Purpose | Path |
| --- | --- |
| First event, preloaded with the specified 20 students and 7 teams | `/e/icpc-2026` |
| Future events, such as spring training | `/e/icpc-spring-2027` |
| Discreet, password-protected admin entry | `/admin` |

A small lock icon at the top right of the student page opens the admin login. The student page does not ask users to identify themselves: anyone can drag any student's name card from any part of the card to help place teammates. On a phone, press and hold a card to drag it. Admins can create events, add students in bulk, copy links, close and reopen events, and inspect departure and team-change records. Every event has its own roster and link; older events are retained. Each team always has a maximum of three students. The root URL, `/`, redirects to the first event.

On mobile, the page uses two independently scrolling columns: unassigned students on the left and teams on the right. Hold a name to drag it; pausing near the top or bottom edge of a column scrolls that column automatically. Desktop retains the full grid layout.

Click a team name to edit it. Press Enter or click elsewhere to save; press Escape to cancel. Clearing the name restores `Team N`. Names support up to 40 characters, synchronize in real time, and retain the team number. As with student moves, any visitor can edit team names without selecting an identity. Closed events do not allow name changes.

## 1. Create and initialize Supabase

After selecting an event, admins can use **Number of teams → Update team count** to set 1–50 teams. Increasing the count appends teams. Decreasing it removes the highest-numbered empty teams and their names. If a team scheduled for removal has students, saving is blocked until those students are moved out. Other assignments and history remain intact. Team counts can also be changed for closed events, and student pages synchronize automatically.

1. Create a Supabase project and keep its database password private. The GitHub integration is optional.
2. Keep **Enable Data API** enabled. Automatic exposure of new tables can be disabled; the SQL explicitly grants the required access.
3. In **SQL Editor → New query**, run these four complete files in order:
   - [`202609290001_team_builder.sql`](supabase/migrations/202609290001_team_builder.sql): base tables, the 20-student roster, and atomic team-assignment RPCs.
   - [`202609290002_open_moves_and_history.sql`](supabase/migrations/202609290002_open_moves_and_history.sql): open dragging, departure history, and removal of the old name-claiming interface.
   - [`202609290003_team_names.sql`](supabase/migrations/202609290003_team_names.sql): editable team names, server-side validation, and real-time name synchronization.
   - [`20261013225710_admin_team_count.sql`](supabase/migrations/20261013225710_admin_team_count.sql): atomic admin changes to team counts, preventing removal of occupied teams.

   Existing projects need only apply migrations that have not yet run. Keep this order when rerunning initialization.
4. In **Authentication → Sign In / Providers**, enable **Allow anonymous sign-ins** and save.
5. The SQL adds `public.participants`, `public.events`, and `public.teams` to the `supabase_realtime` publication. Verify all three under **Database → Publications**. Polling is unnecessary.

The SQL creates tables, RLS policies, and atomic RPCs, and imports all 20 specified names. It is repeatable and **does not reset existing assignments or records**. Running `DROP POLICY/TRIGGER IF EXISTS` in SQL Editor may show a generic warning; these statements recreate the application's access policies and version triggers without deleting student records. Use a dedicated Supabase project for this application.

## 2. Configure environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Source / purpose | Safe in the browser? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL from the project's Connect dialog | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public client key beginning with `sb_publishable_` | Yes |
| `SUPABASE_SECRET_KEY` | Server key beginning with `sb_secret_` under Settings → API Keys; the legacy `service_role` JWT is also supported. Do not use the public key, database password, or admin password. | **No** |
| `ADMIN_PASSWORD` | Your chosen admin password, 8–256 characters | **No** |
| `ADMIN_SESSION_SECRET` | Random session-signing secret, at least 32 characters | **No** |

Generate a random session secret:

~~~sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
~~~

The database password and admin-page password are separate. The running website does not need the database password.

`.env.local` is excluded by `.gitignore`. Do not upload it or add the `NEXT_PUBLIC_` prefix to any server-only variable. The code and delivery ZIP contain no real configuration. Without Supabase configuration, the site explicitly displays **Setup needed** instead of a fake roster. If only server-side configuration is missing, the student page can still work while the admin page reports the incomplete setup.

## 3. Run locally

Use Node.js **24 LTS**; the minimum supported version is 22.18.

~~~sh
npm install
npm run dev
~~~

Open `http://localhost:3000/e/icpc-2026`, or `http://localhost:3000/admin` for administration.

~~~sh
npm run lint
npm run typecheck
npm test
npm run build
npm start
~~~

Restart the development server after changing environment variables. `NEXT_PUBLIC_` values are embedded in the frontend during production builds; changing them after deployment requires a rebuild.

## 4. Deploy with GitHub and Vercel

1. Upload this directory as a separate GitHub repository. Include `package-lock.json` and the SQL files; exclude `.env.local`, `node_modules`, and `.next`.
2. In Vercel, choose **Add New → Project** and import the repository. Select Next.js as the framework. Leave Root Directory at its default if this directory is the repository root.
3. Select Node.js 24.x and `npm run build` as the Build Command. Keep the other framework defaults.
4. Add **all five variables** from the table to Vercel Environment Variables. The three server-only values must remain on the server. They are required for Production; use a separate Supabase project for Preview if testing must not affect the production roster.
5. Select **Deploy**. Later code pushes can trigger automatic Vercel deployments. New SQL migrations must still be applied in Supabase.
6. Under Supabase **Authentication → URL Configuration**, set Site URL to the production URL. This application does not use email or OAuth callbacks.
7. Open `https://your-domain/admin` and sign in with `ADMIN_PASSWORD`. Share each event's `/e/event-slug` link with students.

**Supabase does not need a GitHub connection to work.** Vercel hosts the website and connects to Supabase through environment variables. SQL is needed for initial database setup and schema upgrades. Subsequent event creation and student additions happen in the admin page.

## Day-to-day use

- **Create an event:** open `/admin`, enter the event name, unique URL slug, team count, and student names (one per line), then select **Create event → Copy link**.
- **Add students:** select an existing event and use **Add students**. Duplicate names are rejected; a failed batch does not leave partial data. Add distinguishing labels for students who share a name.
- **Preserve final assignments:** select **Close event**. Students can still view assignments but cannot move anyone. **Reopen event** restores editing. Old events are retained and never cleared automatically.
- **Inspect unexpected removals:** select an event and view **Departures & team changes**. Each record includes the moved student's name, previous team, destination, time, and the acting browser's anonymous ID. While visible, the admin page refreshes records every five seconds; **Refresh** updates manually, and **Load older records** retrieves earlier entries. The admin interface cannot edit or delete records.
- **Change the admin password:** update `ADMIN_PASSWORD` on the server or in Vercel and redeploy. Existing admin sessions become invalid immediately; student sessions and assignments are unaffected.

## Data and permissions

- `events` separates events, `teams` provides per-event team row locks, and `participants` stores students and assignments. The legacy `claimed_by` column remains for safe upgrades but no longer controls access.
- Opening the page does not ask for a name. The first move silently creates a Supabase anonymous session to record the acting browser. Any anonymous user can move any student in an event.
- All visitors can read public assignment data. Direct table inserts, updates, and deletes are denied. Students can execute move RPCs but cannot read, insert, update, or delete history records.
- Each RPC identifies the browser through `auth.uid()`, locks the student, locks the destination team, checks capacity, and updates the assignment in a single transaction.
- Each team supports only `team_slot = 1,2,3`, with a unique `(event_id, team_number, team_slot)` constraint. This database constraint prevents a fourth member even if a client is modified.
- Realtime subscriptions are filtered by event. Reconnection, network recovery, or making the page visible again reloads a snapshot; `version` prevents older responses from overwriting newer state. Student assignment updates do not use scheduled polling or appear saved before the move succeeds.
- Admin RPCs allow only `service_role` and are called by the server with the Secret key after verifying the admin session. Sessions use an eight-hour HttpOnly/SameSite cookie, an HMAC signature, and same-origin validation for writes. Admin login is rate-limited by source in the database to ten attempts per 15 minutes, shared across application instances.
- A database trigger appends `team_departures` records whenever a nonempty previous team changes, covering both team-to-team and team-to-Unassigned moves. First assignments, no-op moves, and rejected operations are not departures. History and the move commit in the same transaction; a history-write failure rolls back the move.
- Only admins can read history, which is excluded from the public Realtime publication. Records retain a name snapshot and the acting UUID. The normal interface has no history-clearing action; database owners retain database-level administrative access.
- Rosters and assignments are publicly readable. Event URLs do not provide confidential access. Server-side password verification secures `/admin`; the discreet link is only a presentation choice.
- An anonymous ID cannot prove who acted in real life. Clearing browser data or changing devices creates a different ID. IP addresses are not collected. Students do not need to reclaim names. See [Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous).

## Database regression tests

`npm test` checks admin-session signing, tampering and expiry, password comparison, merging older snapshots, sorting, and error sanitization.

`npm run test:db` uses a separate connection to real PostgreSQL. It covers 20 students competing for three slots concurrently, moving students from any browser, departure-record contents, rollback after history-write failure, RLS, history read/delete restrictions, cross-event isolation, persistence when SQL is rerun, atomic student additions, and admin-login rate limiting. It requires a temporary local PostgreSQL instance:

~~~powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:local-test-password@127.0.0.1:5432/postgres'
npm run test:db
~~~

The tests accept only loopback addresses and automatically create and delete a randomly named `icpc_test_…` database. They do not modify the application database named in the connection URL. No fake students are needed in production Supabase. The isolated database uses a test stub for `auth.uid()`; production JWT validation is handled by Supabase Auth.

## Deployment acceptance checks

Create a separate test event in the admin page. In two different browsers, move the same test student and verify the absence of an identity prompt, mouse/touch dragging, real-time updates, persistence after refresh, rejection of full teams, and read-only behavior after closing the event. Then check departure and team-change records in the admin page. Leave the production roster's 20 students initially unassigned until students use it themselves.

Troubleshooting:

- **Cannot read tables:** check that the SQL ran, Data API is enabled, and the Project URL and key are correct.
- **Cannot move students:** check Anonymous Sign-Ins.
- **Live is not shown:** check the three tables' Realtime publication and the network connection.
- **Admin login fails:** check the three server-side environment variables and the `check_admin_login_limit` RPC.
- **History queries fail:** check that the second migration ran.
- **Team names cannot be saved:** check that the third migration ran.

Do not show students raw database errors or keys.

Official references: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys) · [Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) · [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs).
