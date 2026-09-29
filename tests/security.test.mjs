import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminToken, verifyAdminToken, passwordMatches, SESSION_SECONDS } from '../src/lib/admin-token.ts';
import { mergeParticipants, sortParticipants } from '../src/lib/types.ts';
import { friendlyError } from '../src/lib/messages.ts';

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
test('raw database and network errors are not exposed to users', () => {
  assert.equal(friendlyError({ message: 'TEAM_FULL' }), 'Team is full.');
  assert.equal(friendlyError({ message: 'postgres secret connection string' }), "Couldn't connect. Please try again.");
});
