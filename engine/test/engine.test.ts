import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, buildDeck, createGame, viewFor } from '../src/engine.ts';
import type { CardDef, Ctx, GameState, PlayerId } from '../src/types.ts';

// 测试用卡，参照 cards-v2 的几张写的，不是正式数据
const cards: Record<string, CardDef> = {
  atk: { id: 'atk', name: '动能定理', type: 'attack', cost: 1, effects: [{ op: 'damage', target: 'enemy', amount: 1 }] },
  def: { id: 'def', name: '小兲の壳', type: 'defense', cost: 1, effects: [], counter: { mode: 'block' } },
  glove: { id: 'glove', name: '神奇手套', type: 'defense', cost: 2, effects: [{ op: 'heal', target: 'self', amount: 1 }],
    counter: { mode: 'block', ids: ['soccer'], onCounter: [{ op: 'sp', target: 'self', delta: 1 }, { op: 'heal', target: 'self', amount: 1 }] } },
  soccer: { id: 'soccer', name: 'Soccer!!!', type: 'attack', cost: 1, effects: [{ op: 'damage', target: 'enemy', amount: 1 }] },
  bread: { id: 'bread', name: '面包', type: 'effect', cost: 1, effects: [{ op: 'heal', target: 'self', amount: 1 }] },
  shield: { id: 'shield', name: '老木盾', type: 'defense', cost: 1, escalating: true, returnsToHand: true, effects: [],
    counter: { mode: 'block', onCounter: [{ op: 'damage', target: 'enemy', amount: 1 }] } },
  skip: { id: 'skip', name: '孙吧の新星', type: 'attack', cost: 2, effects: [{ op: 'damage', target: 'enemy', amount: 1 }, { op: 'skip_next_phase', target: 'enemy' }] },
  lots: { id: 'lots', name: '抽签筒', type: 'resource', cost: 1, attackChoices: [1],
    effects: [{ op: 'choice', options: [[{ op: 'draw', target: 'self', count: 2 }], [{ op: 'damage', target: 'enemy', amount: 1 }]] }] },
};
const ctx: Ctx = { cards };
const filler = Array(20).fill('atk');

function setup(handA: string[], handD: string[]): { s: GameState; a: PlayerId; d: PlayerId } {
  const s = createGame(cards, ['sweet', 'savory'], 1, [filler, filler]);
  const a = s.first, d = (1 - a) as PlayerId;
  let uid = 1000;
  s.players[a].hand = handA.map((defId) => ({ uid: uid++, defId }));
  s.players[d].hand = handD.map((defId) => ({ uid: uid++, defId }));
  return { s, a, d };
}

test('开局：先手 3 张、后手 4 张，HP/SP=7', () => {
  const s = createGame(cards, ['sweet', 'savory'], 42, [filler, filler]);
  assert.equal(s.players[s.first].hand.length, 3);
  assert.equal(s.players[1 - s.first].hand.length, 4);
  assert.equal(s.players[0].hp, 7); assert.equal(s.players[s.first].sp, 7);
});

test('对方手里没有反制牌：不开窗口，直接结算', () => {
  let { s, a, d } = setup(['atk'], ['bread']);
  s = apply(s, { type: 'play', player: a, uid: 1000 }, ctx);
  assert.equal(s.phase.kind, 'play');
  assert.equal(s.players[d].hp, 6);
});

test('有防御牌才开窗口；防御后不扣血', () => {
  let { s, a, d } = setup(['atk'], ['def']);
  s = apply(s, { type: 'play', player: a, uid: 1000 }, ctx);
  assert.equal(s.phase.kind, 'response');
  s = apply(s, { type: 'play', player: d, uid: 1001 }, ctx);
  assert.equal(s.players[d].hp, 7);
});

test('回血牌不能被防御：对方有防御牌也不开窗口', () => {
  let { s, a } = setup(['bread'], ['def']);
  s.players[a].hp = 5;
  s = apply(s, { type: 'play', player: a, uid: 1000 }, ctx);
  assert.equal(s.phase.kind, 'play'); assert.equal(s.players[a].hp, 6);
});

test('神奇手套只防 Soccer，防住后 SP+1、HP+1', () => {
  let { s, a, d } = setup(['atk', 'soccer'], ['glove']);
  s = apply(s, { type: 'play', player: a, uid: 1000 }, ctx);
  assert.equal(s.phase.kind, 'play');               // 普通攻击，手套不能防，不开窗口
  s = apply(s, { type: 'play', player: a, uid: 1001 }, ctx);
  assert.equal(s.phase.kind, 'response');
  s = apply(s, { type: 'play', player: d, uid: 1002 }, ctx);
  assert.equal(s.players[d].hp, 7);                 // 6 → 防住 → +1 = 7
});

test('老木盾：反伤、回手、第二次花 2 SP', () => {
  let { s, a, d } = setup(['atk', 'atk'], ['shield']);
  s = apply(s, { type: 'play', player: a, uid: 1000 }, ctx);
  s = apply(s, { type: 'play', player: d, uid: 1002 }, ctx);
  assert.equal(s.players[a].hp, 6); assert.equal(s.players[d].hand.length, 1); assert.equal(s.players[d].sp, 6);
  s = apply(s, { type: 'play', player: a, uid: 1001 }, ctx);
  s = apply(s, { type: 'play', player: d, uid: 1002 }, ctx);
  assert.equal(s.players[d].sp, 4);
});

test('跳过出牌 = 跳过整个下一个出牌阶段', () => {
  let { s, a, d } = setup(['skip'], []);
  s = apply(s, { type: 'play', player: a, uid: 1000 }, ctx);
  s = apply(s, { type: 'end_phase', player: a }, ctx);
  // d 的阶段被跳过，回到下一回合 a 的出牌阶段
  assert.deepEqual(s.phase, { kind: 'play', active: a });
  assert.equal(s.round, 2);
});

test('死亡判定只在自己出牌阶段结束时', () => {
  let { s, a } = setup([], []);
  s.players[a].hp = -1;
  s = apply(s, { type: 'end_phase', player: a }, ctx);
  assert.deepEqual(s.phase, { kind: 'over', winner: 1 - a });
});

test('视角：对手手牌、牌库只给数量，不下发种子', () => {
  const s = createGame(cards, ['sweet', 'savory'], 3, [filler, filler]);
  const v = viewFor(s, 0) as any;
  assert.equal(typeof v.players[1].hand, 'number'); assert.equal(typeof v.players[0].deck, 'number');
  assert.equal(v.rng, undefined);
});

test('卡组：双方各一整套，跳过已删除的卡', () => {
  const c = { ...cards, gone: { id: 'gone', name: '林广姬', type: 'effect', cost: 1, status: 'deleted', effects: [] } as CardDef };
  const s = createGame(c, ['sweet', 'savory'], 5);
  const n = buildDeck(c).length;
  assert.equal(n, Object.keys(cards).length);
  assert.equal(s.players[0].deck.length + s.players[0].hand.length, n);
  assert.ok(![...s.players[0].deck, ...s.players[0].hand].some((x) => x.defId === 'gone'));
});

test('老木盾每回合最多 2 次，第 3 次不开窗口', () => {
  let { s, a, d } = setup(['atk', 'atk', 'atk'], ['shield']);
  (cards.shield as any).maxPerRound = 2;
  for (const uid of [1000, 1001]) { s = apply(s, { type: 'play', player: a, uid }, ctx); s = apply(s, { type: 'play', player: d, uid: 1003 }, ctx); }
  s = apply(s, { type: 'play', player: a, uid: 1002 }, ctx);
  assert.equal(s.phase.kind, 'play');
  delete (cards.shield as any).maxPerRound;
});

test('#42 选伤害按攻击结算：开防御窗口；选抽牌不开', () => {
  let { s, a, d } = setup(['lots', 'lots'], ['def']);
  s = apply(s, { type: 'play', player: a, uid: 1000, choice: 1 }, ctx);
  assert.equal(s.phase.kind, 'response');
  s = apply(s, { type: 'play', player: d, uid: 1002 }, ctx);
  assert.equal(s.players[d].hp, 7);
  ({ s, a, d } = setup(['lots'], ['def']));
  const n = s.players[a].hand.length;
  s = apply(s, { type: 'play', player: a, uid: 1000, choice: 0 }, ctx);
  assert.equal(s.phase.kind, 'play'); assert.equal(s.players[a].hand.length, n - 1 + 2);
});
