// 17 张专属结算 + 组合 + 宿舍倍率
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARDS } from '../src/cards.ts';
import { apply, canPlay, createGame, viewFor } from '../src/engine.ts';
import type { Action, GameState, PlayerId } from '../src/types.ts';

const ctx = { cards: CARDS };
let U = 5000;
const inst = (n: number) => ({ uid: U++, defId: `XHS-${String(n).padStart(3, '0')}` });
function setup(a: number[], d: number[], factions: ['sweet' | 'savory', 'sweet' | 'savory'] = ['sweet', 'sweet']) {
  const s = createGame(CARDS, factions, 3);
  const A = s.first, D = (1 - A) as PlayerId;
  s.phase = { kind: 'play', active: A };
  s.players[A].hand = a.map(inst); s.players[D].hand = d.map(inst);
  s.players[A].sp = 7; s.players[D].sp = 7;
  return { s, A, D };
}
const play = (s: GameState, p: PlayerId, uid: number, extra: Partial<Extract<Action, { type: 'play' }>> = {}) => apply(s, { type: 'play', player: p, uid, ...extra }, ctx);
const H = (s: GameState, p: PlayerId, i = 0) => s.players[p].hand[i].uid;

test('#3 流血：对方手牌+效果区的金属牌各 1 伤，本牌进对方手牌', () => {
  let { s, A, D } = setup([3], [6]);
  s.players[D].field.push({ card: inst(24), owner: A, placedAt: 0 });
  s = play(s, A, H(s, A));
  assert.equal(s.players[D].hp, 6);
  assert.ok(s.players[D].hand.some((c) => c.defId === 'XHS-003'));
});

test('#4 数学周测：对方弃 2 张、HP-1，出牌方从中拿 1 张', () => {
  let { s, A, D } = setup([4], [6, 22, 26]);
  s = play(s, A, H(s, A));
  assert.equal(s.phase.kind, 'select'); assert.equal(s.players[D].hand.length, 1); assert.equal(s.players[D].hp, 6);
  const opt = (s.phase as any).options[0];
  s = apply(s, { type: 'pick', player: A, uid: opt }, ctx);
  assert.equal(s.phase.kind, 'play'); assert.ok(s.players[A].hand.some((c) => c.uid === opt));
});

test('#9 第5天：双方合计 5 次出牌后对方 HP-3；可被攻击指定摧毁', () => {
  let { s, A, D } = setup([9, 2, 2, 2, 2, 2], []);
  s = play(s, A, H(s, A));
  for (let i = 0; i < 4; i++) s = play(s, A, H(s, A));
  assert.equal(s.players[D].hp, 7);
  s = play(s, A, H(s, A));
  assert.equal(s.players[D].hp, 4); assert.equal(s.players[A].field.length, 0);
  ({ s, A, D } = setup([29], []));
  const f = inst(9); s.players[D].field.push({ card: f, owner: D, placedAt: 0 });
  s = play(s, A, H(s, A), { targetUid: f.uid });
  assert.equal(s.players[D].field.length, 0); assert.equal(s.players[D].hp, 7);
});

test('#15 鲨鲨の怒火：弃掉选中的可燃牌', () => {
  let { s, A, D } = setup([15], [6, 10]);
  const t = s.players[D].hand[1].uid;
  s = play(s, A, H(s, A), { targetUid: t });
  assert.ok(!s.players[D].hand.some((c) => c.uid === t)); assert.equal(s.players[D].hand.length, 1);
});

test('#18 展览：对方 SP-3，被压制的牌本回合打不出，下回合恢复', () => {
  let { s, A, D } = setup([18], [6, 29]);
  const t = s.players[D].hand[1].uid;
  s = play(s, A, H(s, A), { targetUid: t });
  assert.equal(s.players[D].sp, 4); assert.deepEqual(s.players[D].suppressed, [t]);
  assert.equal(viewFor(s, A).players[D].suppressed, 1);   // 出牌方看不到是哪张
  s.phase = { kind: 'play', active: D };
  assert.throws(() => play(s, D, t), /压制/);
});

test('#31 风向标：改风向', () => {
  let { s, A } = setup([31], []);
  s = play(s, A, H(s, A), { wind: 'head' });
  assert.equal(s.wind, 'head');
});

test('#32 冰箱：单独跳 1；与 #60 同时打出跳 2，#60 也结算', () => {
  let { s, A, D } = setup([32], []);
  s = play(s, A, H(s, A)); assert.equal(s.players[D].skipPhases, 1);
  ({ s, A, D } = setup([32, 60], []));
  s = play(s, A, H(s, A), { withUid: H(s, A, 1) });
  assert.equal(s.players[D].skipPhases, 2); assert.equal(s.players[A].sp, 3); assert.equal(s.players[A].hp, 5); // 非周五 #60 自损 2
});

test('#37 工兵铲：移除对方放在我效果区的牌', () => {
  let { s, A, D } = setup([37], []);
  s.players[A].field.push({ card: inst(24), owner: D, placedAt: 0 });
  s = play(s, A, H(s, A));
  assert.equal(s.players[A].field.length, 0); assert.equal(s.players[D].discard.at(-1)!.defId, 'XHS-024');
});

test('#57/#58 宿舍 ×2，#38 让下一张 ×3；自损不乘', () => {
  let { s, A, D } = setup([58, 38, 65, 65], []);
  s = play(s, A, H(s, A, 1), { withUid: H(s, A, 0) });   // 顺序反着传也行
  assert.equal(s.players[A].sp, 3); assert.equal(s.players[A].field[0].card.defId, 'XHS-058');
  s.players[A].sp = 7;
  s = play(s, A, H(s, A)); assert.equal(s.players[D].hp, 4); assert.equal(s.players[D].skipPhases, 1); // ×3，跳过不乘
  s = play(s, A, H(s, A)); assert.equal(s.players[D].hp, 2);                                            // 回到 ×2
});

test('#41 朝圣者：对方阶段开始时打出，再出一张牌（不耗 SP）', () => {
  let { s, A, D } = setup([], [41, 29]);
  s.phase = { kind: 'play', active: D };
  s = apply(s, { type: 'end_phase', player: D }, ctx);          // 回合结束 → A 的出牌阶段开始前，D 可打朝圣者
  assert.equal(s.phase.kind, 'interject');
  s = play(s, D, s.players[D].hand.find((c) => c.defId === 'XHS-041')!.uid);
  s = play(s, D, s.players[D].hand.find((c) => c.defId === 'XHS-029')!.uid);
  if (s.phase.kind === 'response') s = apply(s, { type: 'pass', player: A }, ctx);   // A 刚摸的牌里可能有防御
  assert.equal(s.players[A].hp, 6); assert.equal(s.players[D].sp, 6);   // 只付了朝圣者的 1
  assert.equal(s.phase.kind, 'play'); assert.equal((s.phase as any).active, A);
});

test('#49 篮球：对方有灯管 HP-5、自己 HP-1，灯管防不了', () => {
  let { s, A, D } = setup([49], [48]);
  s = play(s, A, H(s, A));
  assert.equal(s.phase.kind, 'play'); assert.equal(s.players[D].hp, 2); assert.equal(s.players[A].hp, 6);
  ({ s, A, D } = setup([49], []));
  s = play(s, A, H(s, A)); assert.equal(s.players[D].hp, 6);
});

test('#55 肉粽：只伤甜粽党；与 #45 同时打出不看阵营 HP-3 SP-1', () => {
  let { s, A, D } = setup([55], [], ['sweet', 'sweet']);
  s.players[D].faction = 'savory';
  s = play(s, A, H(s, A)); assert.equal(s.players[D].hp, 7);
  ({ s, A, D } = setup([45, 55], []));
  s.players[D].faction = 'savory';
  s = play(s, A, H(s, A), { withUid: H(s, A, 1) });
  assert.equal(s.players[D].hp, 4); assert.equal(s.players[D].sp, 6); assert.equal(s.players[A].sp, 3);
});

test('#61 Super Man：对方交 1 张；对方没手牌则 SP+1', () => {
  let { s, A, D } = setup([61], [6, 22]);
  s = play(s, A, H(s, A));
  assert.equal(s.phase.kind, 'select');
  const g = H(s, D, 1);
  s = apply(s, { type: 'give_card', player: D, uid: g }, ctx);
  assert.ok(s.players[A].hand.some((c) => c.uid === g)); assert.equal(s.phase.kind, 'play');
  ({ s, A, D } = setup([61], []));
  s = play(s, A, H(s, A)); assert.equal(s.players[A].sp, 7);
});

test('#63：对方先免费出一张，然后自己弃光、HP→1，对方 SP 清零', () => {
  let { s, A, D } = setup([63, 6], [29]);
  s = play(s, A, H(s, A));
  assert.equal((s.phase as any).free, true);
  s = play(s, D, H(s, D));
  assert.equal(s.players[A].hp, 1); assert.equal(s.players[A].hand.length, 0); assert.equal(s.players[D].sp, 0);
});

test('#64 Physics：公式通过 SP+1、HP+1', () => {
  let { s, A } = setup([64], []);
  s.players[A].hp = 5;
  s = play(s, A, H(s, A), { formulaOk: true });
  assert.equal(s.players[A].hp, 6); assert.equal(s.players[A].sp, 7);
});

test('#67 意见箱：另一张费用 -2，可叠 #62，不能用于可变费用牌', () => {
  let { s, A, D } = setup([67, 59], []);
  s = play(s, A, H(s, A, 1), { withUid: H(s, A, 0) });
  assert.equal(s.players[A].sp, 6); assert.equal(s.players[D].hp, 3);
  ({ s, A } = setup([67, 10], []));
  assert.throws(() => play(s, A, H(s, A, 1), { withUid: H(s, A, 0), x: 3 }), /意见箱/);
});

test('#62 免费反击里打 #61：先让对方交牌，再结算 #62（不卡死）', () => {
  let { s, A, D } = setup([62, 6, 22], [61, 26]);
  s = play(s, A, s.players[A].hand.find((c) => c.defId === 'XHS-062')!.uid);
  assert.equal(s.phase.kind, 'response');
  s = play(s, D, s.players[D].hand.find((c) => c.defId === 'XHS-061')!.uid);
  assert.equal(s.phase.kind, 'select'); assert.equal((s.phase as any).chooser, A);
  assert.equal(s.stack.length, 1);
  s = apply(s, { type: 'give_card', player: A, uid: H(s, A) }, ctx);
  assert.equal(s.stack.length, 0); assert.notEqual(s.phase.kind, 'select');
});

test('补充裁定四：#38 单独打出，己方效果区有宿舍卡就让下一张 ×3', () => {
  let { s, A, D } = setup([38, 65], []);
  s.players[A].field.push({ card: inst(58), owner: A, roundsLeft: 10, placedAt: 0 });
  s = play(s, A, H(s, A)); assert.equal(s.players[A].boost, true);
  s = play(s, A, H(s, A)); assert.equal(s.players[D].hp, 4);
  ({ s, A, D } = setup([38], []));
  s = play(s, A, H(s, A)); assert.equal(s.players[A].boost, false);   // 没宿舍卡：无效果
});

test('补充裁定四：宿舍卡按出牌方自己的回合计，放下那回合算第 1 个，第 10 个自己回合结束时到期', async () => {
  const { DORM_ROUNDS } = await import('../src/cards.ts');
  let { s, A } = setup([57], []);
  s = play(s, A, H(s, A)); assert.equal(s.players[A].field[0].roundsLeft, DORM_ROUNDS);
  let ownEnded = 0;
  const endCur = () => { const p = (s.phase as any).active; s = apply(s, { type: 'end_phase', player: p }, ctx);
    while (s.phase.kind === 'interject') s = apply(s, { type: 'pass', player: (s.phase as any).responder }, ctx); return p; };
  while (ownEnded < DORM_ROUNDS - 1) { if (endCur() === A) ownEnded++; assert.equal(s.players[A].field.length, 1); }
  while ((s.phase as any).active !== A) { endCur(); assert.equal(s.players[A].field.length, 1); }   // 对方的回合不算
  endCur();   // A 的第 10 个自己回合结束
  assert.equal(s.players[A].field.length, 0); assert.ok(s.players[A].discard.some((c) => c.defId === 'XHS-057'));
});

test('补充裁定四：第 5 次出牌恰好是摧毁 #9 的攻击，先摧毁、不触发', () => {
  let { s, A, D } = setup([29], []);
  const nine = inst(9);
  s.players[D].field.push({ card: nine, owner: D, placedAt: 0, count: 4 });
  s = play(s, A, H(s, A), { targetUid: nine.uid });
  if (s.phase.kind === 'response') s = apply(s, { type: 'pass', player: D }, ctx);
  assert.equal(s.players[D].field.length, 0); assert.equal(s.players[A].hp, 7);
  assert.ok(s.players[D].discard.some((c) => c.uid === nine.uid));
});

test('#3 进对方手牌后带 from 标记，双方 #3 总数不变', () => {
  let { s, A, D } = setup([3], [6, 3]);
  s = play(s, A, H(s, A));
  const got = s.players[D].hand.filter((c) => c.defId === 'XHS-003');
  assert.equal(got.length, 2); assert.equal(got.filter((c) => c.from === A).length, 1);
});

test('#9 响应打出：只抵消 1 点伤害，攻击照常结算（#60 周五 4 伤 → 3）', () => {
  const fctx = { cards: CARDS, isFriday: true };
  let { s, A, D } = setup([60], [9]);
  s = apply(s, { type: 'play', player: A, uid: H(s, A) }, fctx);
  assert.equal(s.phase.kind, 'response');
  s = apply(s, { type: 'play', player: D, uid: H(s, D) }, fctx);
  assert.equal(s.players[D].hp, 4);
  assert.ok(s.players[D].discard.some((c) => c.defId === 'XHS-009'));
  assert.ok(s.log.some((l) => l.includes('抵消 1 点伤害') && l.includes('造成 3 点')));
  assert.equal(s.phase.kind, 'play');
});

test('canPlay：费用、阶段、响应、压制', () => {
  let { s, A, D } = setup([59, 7, 23], [7, 29]);
  s.players[A].sp = 2;
  assert.deepEqual(canPlay(s, A, H(s, A, 0), ctx), { ok: false, cost: 3, reason: '费用不足：需要 3 SP，当前 2' });
  assert.equal(canPlay(s, A, H(s, A, 2), ctx).ok, true);
  assert.equal(canPlay(s, A, H(s, A, 2), ctx).cost, 2);
  assert.equal(canPlay(s, D, H(s, D, 0), ctx).reason, '不是你的出牌阶段');
  s = play(s, A, H(s, A, 2));   // 中位数定理，D 有壳 → 响应窗口
  assert.equal(s.phase.kind, 'response');
  const v = viewFor(s, D);
  assert.equal(canPlay(v as any, D, H(s, D, 0), ctx).ok, true);
  assert.equal(canPlay(v as any, D, H(s, D, 1), ctx).ok, false);
  s.players[D].suppressed.push(H(s, D, 0));
  assert.match(canPlay(s, D, H(s, D, 0), ctx).reason!, /压制/);
});
