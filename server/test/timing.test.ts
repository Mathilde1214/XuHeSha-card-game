import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Room, DEFAULT_TIMING } from '../src/room.ts';
import type { PlayerId } from '../../engine/src/types.ts';

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
  const messages: any[][] = [[], []];
  const room = new Room('test', { ...DEFAULT_TIMING, playMs: 1000, responseMs: 300, formulaMs: 200, fakeDelayMin: 0, fakeDelayMax: 0 }, () => {}, 1);
  t.after(() => room.close());
  for (const p of [0, 1] as PlayerId[]) {
    room.join({ send: (m) => messages[p].push(m) });
    room.handle(p, { t: 'pick_faction', faction: 'sweet' });
  }
  if (room.state!.phase.kind === 'interject') {
    room.handle(room.state!.phase.responder, { t: 'action', action: { type: 'pass' } });
  }
  const active = room.state!.phase.active as PlayerId, other = (1 - active) as PlayerId;
  room.state!.players[active].hand = [{ uid: 900, defId: 'XHS-010' }, { uid: 901, defId: 'XHS-006' }];
  room.state!.players[other].hand = [];
  const act = (p: PlayerId, action: object) => { room.handle(p, { t: 'action', action }); t.mock.timers.tick(0); };
  const deadline = (p = active) => messages[p].filter((m) => m.t === 'timer').at(-1)?.deadline;
  return { room, messages, active, other, act, deadline };
}

test('首次截止时间有效，弃牌和普通出牌不延长阶段，到期自动结束', (t) => {
  const { room, active, other, act, deadline } = setup(t);
  assert.equal(deadline(), 11_000);
  t.mock.timers.tick(150);
  act(active, { type: 'discard', uid: 901 });
  assert.equal(deadline(), 11_000);
  t.mock.timers.tick(150);
  act(active, { type: 'play', uid: 900, x: 1 });
  assert.equal(deadline(), 11_000);
  t.mock.timers.tick(700);
  assert.equal(room.state!.phase.active, other);
  assert.equal(deadline(other), 12_000);
});

test('响应期间保留出牌剩余时间，弃牌不重置响应倒计时', (t) => {
  const { room, active, other, act, deadline } = setup(t);
  room.state!.players[other].hand = [{ uid: 902, defId: 'XHS-007' }, { uid: 903, defId: 'XHS-006' }];
  t.mock.timers.tick(200);
  act(active, { type: 'play', uid: 900, x: 1 });
  assert.equal(room.state!.phase.kind, 'response');
  assert.equal(deadline(other), 10_500);
  t.mock.timers.tick(100);
  act(other, { type: 'discard', uid: 903 });
  assert.equal(deadline(other), 10_500);
  t.mock.timers.tick(200); // 响应超时，恢复剩余 800ms
  assert.equal(room.state!.phase.kind, 'play');
  assert.equal(deadline(), 11_300);
});

test('公式判定期间暂停出牌计时，结束后恢复剩余时间', (t) => {
  const { room, active, act, deadline } = setup(t);
  room.state!.players[active].hand = [{ uid: 904, defId: 'XHS-064' }];
  t.mock.timers.tick(250);
  act(active, { type: 'play', uid: 904 });
  assert.equal(room.flow?.kind, 'formula');
  t.mock.timers.tick(200);
  assert.equal(room.flow, null);
  assert.equal(deadline(), 11_200);
});

test('房间入口拒绝非法 X，拒绝后仍可合法出牌', (t) => {
  const { room, active, other, messages, act } = setup(t);
  const before = structuredClone(room.state);
  act(active, { type: 'play', uid: 900, x: 'bad' });
  assert.equal(messages[active].at(-1).t, 'reject');
  assert.deepEqual(room.state, before);
  act(active, { type: 'play', uid: 900, x: 2 });
  assert.equal(room.state!.players[active].sp, 5);
  assert.equal(room.state!.players[other].hp, 5);
});
