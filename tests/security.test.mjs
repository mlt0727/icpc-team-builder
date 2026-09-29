import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminToken, verifyAdminToken, passwordMatches, SESSION_SECONDS } from '../src/lib/admin-token.ts';
import { mergeParticipants, mergeTeams, teamLabel, sortParticipants } from '../src/lib/types.ts';
import { friendlyError } from '../src/lib/messages.ts';
import { normalizeServerKey, serverKeyKind } from '../src/lib/supabase-server-key.ts';

const secret = 'test-only-session-secret-of-sufficient-length';
const password = 'test-only-password';
const now = 1790640000000;

test('admin cookies require a valid signature, expiry, and current secrets', () => {
  const token = createAdminToken(secret, password, now);
  assert.equal(verifyAdminToken(token, secret, password, now), true);
  assert.equal(verifyAdminToken(token, secret, password, now + SESSION_SECONDS * 1000), false);
  assert.equal(verifyAdminToken(`${token}x`, secret, password, now), false);
  assert.equal(verifyAdminToken(token, `${secret}x`, password, now), false);
  assert.equal(verifyAdminToken(token, secret, `${password}x`, now), false);
  assert.equal(verifyAdminToken(undefined, secret, password, now), false);
  assert.equal(verifyAdminToken('not-a-session', secret, password, now), false);
  const pieces = token.split('.'); pieces[0] = String(Number(pieces[0]) + 60);
  assert.equal(verifyAdminToken(pieces.join('.'), secret, password, now), false);
});
test('password comparison rejects wrong and empty passwords', () => {
  assert.equal(passwordMatches(password, password), true);
  assert.equal(passwordMatches(password + 'x', password), false);
  assert.equal(passwordMatches('', password), false);
});
test('server configuration accepts secret and legacy service-role keys, never public keys or passwords', () => {
  const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.testSignature`;
  assert.equal(serverKeyKind('  sb_secret_test-only-key\n'), 'secret');
  assert.equal(serverKeyKind('"sb_secret_test-only-key"'), 'secret');
  assert.equal(normalizeServerKey(' "sb_secret_test-only-key"\n'), 'sb_secret_test-only-key');
  assert.equal(serverKeyKind(jwt('service_role')), 'service_role');
  assert.equal(serverKeyKind(jwt('anon')), 'public');
  assert.equal(serverKeyKind(jwt('authenticated')), 'public');
  assert.equal(serverKeyKind('sb_publishable_test-key'), 'public');
  assert.equal(serverKeyKind('12345678'), 'invalid');
  assert.equal(serverKeyKind('eyJ.invalid.signature'), 'invalid');
  assert.equal(serverKeyKind(''), 'missing');
});
test('late snapshots and RPC responses cannot roll back newer Realtime state', () => {
  const current = [{ id: 'a', version: 5, team_number: 2 }];
  const merged = mergeParticipants(current, [{ id: 'a', version: 4, team_number: 1 }, { id: 'b', version: 1, team_number: null }]);
  assert.equal(merged[0].team_number, 2);
  assert.equal(merged.length, 2);
  assert.equal(mergeParticipants(merged, [{ id: 'a', version: 6, team_number: null }])[0].team_number, null);
});
test('unassigned is alphabetical and teammates retain joining order', () => {
  const people = [
    { id: 'z', first_name: 'Zara', last_name: 'Maraj', team_number: null },
    { id: 'a', first_name: 'Carlos', last_name: 'Guzman', team_number: null },
    { id: 'b', first_name: 'Carlos', last_name: 'Guzman', team_number: 1, joined_at: '2026-01-02' },
    { id: 'c', first_name: 'Zara', last_name: 'Maraj', team_number: 1, joined_at: '2026-01-01' },
  ];
  assert.deepEqual(sortParticipants(people, null).map((p) => p.id), ['a', 'z']);
  assert.deepEqual(sortParticipants(people, 1).map((p) => p.id), ['c', 'b']);
});
test('team names ignore stale updates and remain separate across events', () => {
  const team = {event_id:'event-a', team_number:1, name:'New name', version:3};
  const rows = mergeTeams([team], [{...team, name:'Stale', version:2}, {...team, event_id:'event-b', name:'Other event'}]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'New name');
  assert.equal(rows[1].name, 'Other event');
  assert.equal(teamLabel({...team, name:null}, 1), 'Team 1');
  assert.equal(teamLabel(team, 1), 'New name');
});
test('raw database and network errors are not exposed to users', () => {
  assert.equal(friendlyError({ message: 'TEAM_FULL' }), 'Team is full.');
  assert.equal(friendlyError({ message: 'postgres secret connection string' }), "Couldn't connect. Please try again.");
});
