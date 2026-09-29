// Uses a real local PostgreSQL server and independent simultaneous connections.
// Creates/drops ONLY a uniquely named test database, never the database in the URL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';

const address = process.env.TEST_DATABASE_URL;
if (!address) throw new Error('Set TEST_DATABASE_URL to a LOCAL PostgreSQL admin connection. See README.');
const url = new URL(address);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Database tests only run against a local disposable PostgreSQL server.');
const database = `icpc_test_${randomUUID().replaceAll('-', '')}`;
const root = new pg.Client({ connectionString: address });
const migration = (await Promise.all([
  '202609290001_team_builder.sql', '202609290002_open_moves_and_history.sql',
  '202609290003_team_names.sql',
].map((name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')))).join('\n');

test('PostgreSQL security, persistence, and concurrent moves', async (t) => {
  await root.connect();
  let pool;
  try {
    await root.query(`create database "${database}"`);
    url.pathname = `/${database}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 30 });
    await pool.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      end $$;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
    `);
    await pool.query(migration);
    async function asUser(uid, sql, values = [], role = 'authenticated') {
      const connection = await pool.connect();
      try {
        await connection.query('begin');
        await connection.query(`set local role ${role}`);
        await connection.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? '']);
        const result = await connection.query(sql, values);
        await connection.query('commit');
        return result;
      } catch (error) { await connection.query('rollback'); throw error; }
      finally { connection.release(); }
    }
    async function user() {
      const id = randomUUID();
      await pool.query('insert into auth.users(id) values ($1)', [id]);
      return id;
    }
    const event = (await pool.query("select * from events where slug='icpc-2026'")).rows[0];
    const people = (await pool.query('select * from participants where event_id=$1 order by first_name', [event.id])).rows;
    const users = await Promise.all(people.map(() => user()));
    const move = (uid, pid, team) => asUser(uid, 'select * from public.move_participant($1,$2)', [pid, team]);

    await t.test('seed contains exactly the supplied 20 names and seven empty teams', async () => {
      assert.equal(people.length, 20);
      assert.deepEqual(people.map((p) => `${p.first_name} ${p.last_name}`), [
        'Carlos Guzman','Faatimah Seecharan','Gian Pena','Henrique Laranjinha','Jose Sanchez','Kevin Wilson','Lingtong Meng','Luis Canada','Marcelo Hernandez','Monica Barbosa','Naranjavkhlan Tumenbold','Ousman Bah','Redan Aguilar','Rohith Boppini','Romario Destine','Samuel Perez','Sebastian Arrieta','Stephen Taylor','Victor Fernandez Pavoni','Zara Maraj',
      ]);
      assert.ok(people.every((p) => p.team_number === null && p.claimed_by === null));
      assert.equal((await pool.query('select * from teams where event_id=$1', [event.id])).rowCount, 7);
    });
    await t.test('RLS and grants allow public reads, deny direct writes and admin RPCs', async () => {
      assert.equal((await asUser(null, 'select * from participants', [], 'anon')).rowCount, 20);
      await assert.rejects(asUser(users[0], 'update participants set team_number=1'), /permission denied/);
      await assert.rejects(asUser(users[0], 'delete from participants'), /permission denied/);
      await assert.rejects(asUser(users[0], "insert into events(slug,title) values ('hacked','Hacked')"), /permission denied/);
      await assert.rejects(asUser(null, 'select claim_participant($1)', [people[0].id], 'anon'), /permission denied/);
      await assert.rejects(asUser(users[0], 'select claim_participant($1)', [people[0].id]), /permission denied/);
      await assert.rejects(asUser(users[0], "select admin_create_event('X','hidden',7,'{}')"), /permission denied/);
      await assert.rejects(asUser(users[0], 'select admin_release_claim($1)', [people[0].id]), /permission denied/);
      await assert.rejects(asUser(users[0], 'select * from private.admin_login_limits'), /permission denied/);
      await assert.rejects(asUser(users[0], 'select * from team_departures'), /permission denied/);
      await assert.rejects(asUser(null, 'delete from team_departures', [], 'service_role'), /permission denied/);
    });
    await t.test('twenty simultaneous arrivals result in exactly three seats', async () => {
      const result = await Promise.allSettled(people.map((p, i) => move(users[i], p.id, 1)));
      assert.equal(result.filter((r) => r.status === 'fulfilled').length, 3);
      assert.equal(result.filter((r) => r.status === 'rejected' && r.reason.message === 'TEAM_FULL').length, 17);
      assert.equal((await pool.query('select * from participants where event_id=$1 and team_number=1', [event.id])).rowCount, 3);
    });
    await t.test('any anonymous browser can move any person without a claim', async () => {
      await move(users[1], people[0].id, 2);
      await assert.rejects(move(users[0], people[0].id, 8), /INVALID_TEAM/);
      await assert.rejects(move(users[0], people[0].id, 0), /INVALID_TEAM/);
      await assert.rejects(move(null, people[0].id, 2), /AUTH_REQUIRED/);
      const countBefore = (await pool.query('select count(*)::int as n from team_departures')).rows[0].n;
      const same = await move(users[0], people[0].id, 2);
      assert.equal(same.rows[0].team_number, 2);
      assert.equal((await pool.query('select count(*)::int as n from team_departures')).rows[0].n, countBefore);
      await move(users[0], people[0].id, null);
      const row = (await pool.query('select * from participants where id=$1', [people[0].id])).rows[0];
      assert.equal(row.team_number, null); assert.equal(row.team_slot, null); assert.equal(row.joined_at, null);
    });
    await t.test('migration rerun preserves assignments and departure history', async () => {
      const before = (await pool.query('select * from participants order by id')).rows;
      const logsBefore = (await pool.query('select * from team_departures order by id')).rows;
      await pool.query(migration);
      assert.deepEqual((await pool.query('select * from participants order by id')).rows, before);
      assert.deepEqual((await pool.query('select * from team_departures order by id')).rows, logsBefore);
    });
    await t.test('reusable events isolate rosters; teammates can move multiple names', async () => {
      const result = await asUser(null, "select * from admin_create_event('Spring','spring-2027',2,array['New Student','Second Student','Third Student'])", [], 'service_role');
      const newEvent = result.rows[0];
      const fresh = (await pool.query('select * from participants where event_id=$1 order by first_name', [newEvent.id])).rows;
      assert.equal(fresh.length, 3);
      await move(users[0], fresh[0].id, 1);
      await move(users[0], fresh[1].id, 1);
      await move(users[1], fresh[0].id, 2);
      await move(users[1], fresh[0].id, null);
      assert.equal((await pool.query('select * from participants where event_id=$1', [event.id])).rowCount, 20);
      await assert.rejects(move(users[0], fresh[0].id, 3), /INVALID_TEAM/);
      await pool.query('select admin_add_participants($1, $2)', [newEvent.id, ['Fourth Student', 'Fifth Student']]);
      await pool.query('update events set is_open=false where id=$1', [newEvent.id]);
      await assert.rejects(move(users[0], fresh[0].id, null), /EVENT_CLOSED/);
      await pool.query('update events set is_open=true where id=$1', [newEvent.id]);
      await move(users[0], fresh[0].id, 1);
      const logs = (await asUser(null, 'select * from team_departures where event_id=$1 order by id', [newEvent.id], 'service_role')).rows;
      assert.equal(logs.length, 2);
      assert.deepEqual(logs.map(l => [l.from_team_number, l.to_team_number]), [[1,2],[2,null]]);
      assert.ok(logs.every(l => l.actor_id === users[1] && l.participant_id === fresh[0].id && l.participant_name === `${fresh[0].first_name} ${fresh[0].last_name}` && l.occurred_at));
    });
    await t.test('failed moves leave no false audit record; a logging failure rolls back the move', async () => {
      await move(users[0], people[0].id, 2);
      const before = (await pool.query('select * from participants where id=$1', [people[0].id])).rows[0];
      const count = (await pool.query('select count(*)::int as n from team_departures')).rows[0].n;
      await assert.rejects(move(users[0], people[0].id, 99), /INVALID_TEAM/);
      assert.equal((await pool.query('select count(*)::int as n from team_departures')).rows[0].n, count);
      await pool.query("alter table team_departures add constraint qa_reject_log check (participant_name <> 'Carlos Guzman') not valid");
      await assert.rejects(move(users[0], people[0].id, 3), /qa_reject_log/);
      assert.deepEqual((await pool.query('select * from participants where id=$1', [people[0].id])).rows[0], before);
      await pool.query('alter table team_departures drop constraint qa_reject_log');
    });
    await t.test('event creation and adding names are atomic on invalid/duplicate input', async () => {
      await assert.rejects(pool.query("select admin_create_event('Duplicate','rollback-event',7,array['Same Name','same name'])"), /DUPLICATE_NAME/);
      assert.equal((await pool.query("select * from events where slug='rollback-event'")).rowCount, 0);
      await assert.rejects(pool.query('select admin_add_participants($1,$2)', [event.id, ['Brand New', 'Carlos Guzman']]), /DUPLICATE_NAME/);
      assert.equal((await pool.query("select * from participants where first_name='Brand'")).rowCount, 0);
      await assert.rejects(pool.query("select admin_create_event('Bad','bad-event',51,'{}')"), /INVALID_EVENT/);
    });
    await t.test('concurrent swaps and repeated moves stay under the hard capacity cap', async () => {
      await Promise.all(people.map((p, i) => move(users[i], p.id, null)));
      await move(users[0], people[0].id, 2); await move(users[1], people[1].id, 3);
      await Promise.all([move(users[0], people[0].id, 3), move(users[1], people[1].id, 2)]);
      for (let round = 0; round < 5; round++) {
        const results = await Promise.allSettled(people.map((p, i) => move(users[i], p.id, 1 + ((i + round) % 7))));
        for (const r of results) if (r.status === 'rejected') assert.equal(r.reason.message, 'TEAM_FULL');
        const overfull = await pool.query('select count(*) from participants where team_number is not null group by event_id,team_number having count(*)>3');
        assert.equal(overfull.rowCount, 0);
      }
      await assert.rejects(pool.query('update participants set team_number=1,team_slot=4,joined_at=now() where id=$1', [people[0].id]), /valid_team_slot/);
    });
    await t.test('login rate limit is shared and race-safe', async () => {
      const key = 'a'.repeat(64);
      const results = await Promise.all(Array.from({length:20}, () => asUser(null, 'select check_admin_login_limit($1) as allowed', [key], 'service_role')));
      assert.equal(results.filter((r) => r.rows[0].allowed).length, 10);
    });
    await t.test('team renaming validates input, survives migrations, and cannot bypass closed events or RLS', async () => {
      const rename = (uid, number, name) => asUser(uid, 'select * from rename_team($1,$2,$3)', [event.id, number, name]);
      const renamed = (await rename(users[0], 1, '  Binary   Trees  ')).rows[0];
      assert.equal(renamed.name, 'Binary Trees');
      assert.equal(renamed.version, 2);
      assert.equal((await rename(users[0], 1, 'Binary Trees')).rows[0].version, 2);
      await assert.rejects(rename(users[0], 1, 'x'.repeat(41)), /INVALID_TEAM_NAME/);
      await assert.rejects(rename(users[0], 99, 'No team'), /INVALID_TEAM/);
      await assert.rejects(rename(null, 1, 'No session'), /AUTH_REQUIRED/);
      await assert.rejects(asUser(null, 'select rename_team($1,1,$2)', [event.id, 'Anon'], 'anon'), /permission denied/);
      await assert.rejects(asUser(users[0], "update teams set name='Bypass'"), /permission denied/);
      await pool.query(migration);
      assert.equal((await pool.query('select name from teams where event_id=$1 and team_number=1', [event.id])).rows[0].name, 'Binary Trees');
      await pool.query('update events set is_open=false where id=$1', [event.id]);
      await assert.rejects(rename(users[0], 1, 'Closed'), /EVENT_CLOSED/);
      await pool.query('update events set is_open=true where id=$1', [event.id]);
      assert.equal((await rename(users[1], 1, '   ')).rows[0].name, null);
      const other = (await pool.query("select id from events where slug='spring-2027'")).rows[0];
      assert.equal((await pool.query('select name from teams where event_id=$1 and team_number=1', [other.id])).rows[0].name, null);
    });
    await t.test('Realtime publication includes participant, event, and team name updates', async () => {
      const rows = (await pool.query("select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename")).rows;
      assert.deepEqual(rows.map((r) => r.tablename), ['events','participants','teams']);
    });
  } finally {
    if (pool) await pool.end();
    await root.query(`drop database if exists "${database}" with (force)`);
    await root.end();
  }
});
