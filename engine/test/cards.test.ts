import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARDS } from '../src/cards.ts';
import { apply, buildDeck, createGame } from '../src/engine.ts';

test('卡表：67 个编号，66 张有效卡，编号连续', () => {
  assert.equal(Object.keys(CARDS).length, 67);
  assert.equal(buildDeck(CARDS).length, 66);
  for (let i = 1; i <= 67; i++) assert.ok(CARDS[`XHS-${String(i).padStart(3, '0')}`]);
});

test('用正式卡表开一局，随机打牌 200 步不报内部错误', () => {
  for (let seed = 1; seed <= 20; seed++) {
    let s = createGame(CARDS, ['sweet', 'savory'], seed);
    for (let step = 0; step < 300 && s.phase.kind !== 'over'; step++) {
      const ph = s.phase;
      const c = { cards: CARDS };
      if (ph.kind === 'select') {
        const p = ph.chooser;
        s = apply(s, ph.reason === 'superman' ? { type: 'give_card', player: p, uid: s.players[p].hand[0].uid } : { type: 'pick', player: p, uid: ph.options?.[0] }, c);
        continue;
      }
      const p = ph.kind === 'response' || ph.kind === 'interject' ? ph.responder : ph.active;
      const hand = s.players[p].hand;
      const card = hand[(step * 7) % Math.max(1, hand.length)];
      const mate = hand[(step * 7 + 1) % Math.max(1, hand.length)];
      const base = card ? { type: 'play', player: p, uid: card.uid, x: CARDS[card.defId].x?.min, choice: 0, wind: 'tail', formulaOk: step % 2 === 0, qteHits: step % 4 } as const : undefined;
      const tries = base ? [mate && mate !== card && step % 3 === 0 ? { ...base, withUid: mate.uid } : base, base] : [];
      let moved = false;
      for (const a of tries) { if (moved) break; try { s = apply(s, a, c); moved = true; } catch (e: any) { if (e.name !== 'Error' || !/SP|不能|只能|X|已删除|最多|压制|同时|朝圣者/.test(e.message)) throw e; } }
      if (!moved) s = apply(s, ph.kind === 'play' ? { type: 'end_phase', player: p } : { type: 'pass', player: p }, c);
    }
  }
});

import type { PlayerId } from '../src/types.ts';
test('#62：对方先免费反击一张，再弃光手牌、HP 变 1', () => {
  let s = createGame(CARDS, ['sweet', 'savory'], 9);
  const a = s.first, d = (1 - a) as PlayerId;
  s.players[a].hand = [{ uid: 9001, defId: 'XHS-062' }];
  s.players[d].hand = [{ uid: 9002, defId: 'XHS-059' }, { uid: 9003, defId: 'XHS-006' }];
  s.players[d].sp = 0;
  s = apply(s, { type: 'play', player: a, uid: 9001 }, { cards: CARDS });
  assert.equal(s.phase.kind, 'response');
  s = apply(s, { type: 'play', player: d, uid: 9002 }, { cards: CARDS });   // 0 SP 也能免费打出 4 伤
  assert.equal(s.players[a].hp, 3);
  assert.equal(s.players[d].hp, 1);
  assert.equal(s.players[d].hand.length, 0);
  assert.equal(s.phase.kind, 'play');
});

test('#62：对方没有手牌就直接结算', () => {
  let s = createGame(CARDS, ['sweet', 'savory'], 9);
  const a = s.first, d = (1 - a) as PlayerId;
  s.players[a].hand = [{ uid: 9001, defId: 'XHS-062' }];
  s.players[d].hand = [];
  s = apply(s, { type: 'play', player: a, uid: 9001 }, { cards: CARDS });
  assert.equal(s.phase.kind, 'play'); assert.equal(s.players[d].hp, 1);
});
