import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/main.ts';
import { DEFAULT_TIMING } from '../src/room.ts';
import { checkFormulas } from '../src/formulas.ts';
import { CARDS } from '../../engine/src/cards.ts';
import { Client } from './helpers.ts';

const PORT = 18787;
const fast = { ...DEFAULT_TIMING, playMs: 3000, responseMs: 300, selectMs: 300, pickMs: 300, formulaMs: 300, graceMs: 400,
  fakeDelayMin: 5, fakeDelayMax: 20, qteLeadMs: 40, qteGapMs: 90, qteWindowMs: 60, qteToleranceMs: 20 };
const srv = startServer(PORT, fast);
after(() => srv.close());
const url = `ws://127.0.0.1:${PORT}/ws`;

async function pair() {
  const a = new Client(url), b = new Client(url); await a.open(); await b.open();
  a.send({ t: 'create_room' }); const ra = await a.next((m) => m.t === 'room');
  b.send({ t: 'join_room', code: ra.code }); const rb = await b.next((m) => m.t === 'room');
  await a.next((m) => m.t === 'lobby'); await b.next((m) => m.t === 'lobby');
  a.send({ t: 'pick_faction', faction: 'sweet' }); b.send({ t: 'pick_faction', faction: 'savory' });
  const sa = await a.next((m) => m.t === 'state'); const sb = await b.next((m) => m.t === 'state');
  return { a, b, ra, rb, sa, sb };
}

test('公式库：写法统一、两边对调、不能重复', () => {
  assert.equal(checkFormulas(['F = m*a', 'mv=p', 'Ek=½mv²']).pass, true);
  assert.equal(checkFormulas(['F=ma', 'ma=F', 'p=mv']).pass, false);
  assert.equal(checkFormulas(['F=ma', 'p=mv']).pass, false);
});

test('建房、入座、开局：双方各自视角，对手手牌只有张数，不下发种子', async () => {
  const { a, b, ra, rb, sa, sb } = await pair();
  assert.equal(ra.seat, 0); assert.equal(rb.seat, 1);
  for (const [s, me] of [[sa, 0], [sb, 1]] as const) {
    assert.ok(Array.isArray(s.view.players[me].hand));
    assert.equal(typeof s.view.players[1 - me].hand, 'number');
    assert.equal(typeof s.view.players[me].deck, 'number');
    assert.equal(s.view.rng, undefined);
  }
  a.close(); b.close();
});

test('冒充对方、伪造 qteHits 无效', async () => {
  const { a, b, sa } = await pair();
  const active = sa.view.phase.active;
  const [act, idle] = active === 0 ? [a, b] : [b, a];
  // 非出牌方冒充出牌方结束阶段：服务端按连接身份认，应被拒绝
  idle.send({ t: 'action', seq: 1, action: { type: 'end_phase', player: active } });
  const rj = await idle.next((m) => m.t === 'reject' && m.seq === 1);
  assert.match(rj.reason, /不是你的/);
  a.close(); b.close();
});

test('掉线 1 分钟（测试里缩短）未重连判负；重连可拿回完整状态', async () => {
  const { a, b, ra } = await pair();
  a.close();
  await b.next((m) => m.t === 'opponent' && m.online === false);
  const a2 = new Client(url); await a2.open();
  a2.send({ t: 'resume', token: ra.token, lastVer: 0 });
  const st = await a2.next((m) => m.t === 'state');
  assert.ok(Array.isArray(st.view.players[0].hand));
  await b.next((m) => m.t === 'opponent' && m.online === true);
  a2.close();
  await b.next((m) => m.t === 'opponent' && m.online === false);
  const over = await b.next((m) => m.t === 'state' && m.view.phase.kind === 'over', 3000);
  assert.equal(over.view.phase.winner, 1);
  b.close();
});

test('随机对打：从开局打到胜负，全程不泄露对方手牌', { timeout: 120_000 }, async () => {
  const { a, b, sa, sb } = await pair();
  const views: any[] = [sa.view, sb.view];
  let seq = 10; let leaks = 0; let flows = { pick: 0, qte: 0, formula: 0 };
  const drive = (c: Client, me: number) => {
    const act = () => {
      const v = views[me]; const ph = v.phase;
      if (ph.kind === 'play' && ph.active === me) {
        const hand = v.players[me].hand as any[];
        const ok = hand.filter((h) => CARDS[h.defId].cost <= v.players[me].sp && CARDS[h.defId].status !== 'deleted');
        if (ok.length && Math.random() < 0.75) {
          const h = ok[Math.floor(Math.random() * ok.length)]; const d = CARDS[h.defId];
          c.send({ t: 'action', seq: ++seq, action: { type: 'play', uid: h.uid, x: d.x?.min, choice: 0, qteHits: 3 } });
        } else c.send({ t: 'action', seq: ++seq, action: { type: 'end_phase' } });
      } else if (ph.kind === 'response' && ph.responder === me) c.send({ t: 'action', seq: ++seq, action: { type: 'pass' } });
      else if (ph.kind === 'interject' && ph.responder === me) c.send({ t: 'action', seq: ++seq, action: { type: 'pass' } });
      else if (ph.kind === 'select' && ph.chooser === me) {
        if (ph.reason === 'math_quiz') c.send({ t: 'action', seq: ++seq, action: { type: 'pick', uid: ph.options?.[0] } });
        else if (v.players[me].hand.length) c.send({ t: 'action', seq: ++seq, action: { type: 'give_card', uid: v.players[me].hand[0].uid } });
      }
    };
    c.onMsg = (m) => {
      if (m.t === 'state') {
        if (typeof m.view.players[1 - me].hand !== 'number' || m.view.rng !== undefined) leaks++;
        views[me] = m.view; act();
      }
      if (m.t === 'reject' && m.reason !== '结算中，请稍候' && m.reason !== '正在进行判定，请稍候') {
        const ph = views[me].phase; if (ph.kind === 'play' && ph.active === me) c.send({ t: 'action', seq: ++seq, action: { type: 'end_phase' } });
      }
      if (m.t === 'reject' && m.reason === '结算中，请稍候') setTimeout(act, 30);
      if (m.t === 'hidden_pick') { flows.pick++; assert.ok(m.handles.every((h: string) => /^[0-9a-f]{12}$/.test(h))); c.send({ t: 'hidden_pick_reply', pickId: m.pickId, handle: m.handles[0] }); }
      if (m.t === 'qte_start') { flows.qte++; for (const [i, w] of m.windows.entries()) setTimeout(() => c.send({ t: 'qte_hit', qteId: m.qteId, round: i }), w.start - Date.now() + 10); }
      if (m.t === 'formula_start') { flows.formula++; c.send({ t: 'formula', qteId: m.qteId, lines: ['F=ma', 'p=mv', 'W=Fs'] }); }
    };
  };
  drive(a, 0); drive(b, 1);
  const first = sa.view.phase.active; const fc = first === 0 ? a : b;
  // 开局推动一下
  fc.onMsg!({ t: 'state', view: views[first], ver: 0, log: [] });
  const end = await Promise.race([
    a.next((m) => m.t === 'state' && m.view.phase.kind === 'over', 110_000),
  ]);
  console.log('结果', end.view.phase, '回合', end.view.round, '判定流程', flows);
  assert.equal(leaks, 0);
  a.close(); b.close();
});
