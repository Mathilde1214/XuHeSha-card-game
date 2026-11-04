// 随机对打统计：node sim.ts [局数] [策略 random|greedy]
import { apply, createGame, RuleError } from '../engine/src/engine.ts';
import { CARDS } from '../engine/src/cards.ts';
import type { Action, Ctx, GameState, PlayerId } from '../engine/src/types.ts';
const N = +(process.argv[2] ?? 10000), MODE = process.argv[3] ?? 'random';
let seed = 12345; const r = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
const qte = () => [0,1,2].filter(() => r() < 0.7).length;   // 每次 QTE 命中率 70%
const LAST = new WeakMap<object, any>();
function tryAct(s: GameState, a: Action, ctx: Ctx) { try { const g = apply(s, a, ctx); LAST.set(g, { a, prevPhase: s.phase, prevHands: s.players.map(p=>p.hand.map(c=>c.uid+':'+c.defId)) }); return g; } catch (e) { if (e instanceof RuleError) return null; throw e; } }
const HELPERS = new Set(['XHS-060', 'XHS-045', 'XHS-038', 'XHS-067']);
const WINDS = ['tail', 'calm', 'head'] as const;
function variants(s: GameState, p: PlayerId, uid: number, defId: string): Action[] {
  const d = CARDS[defId]; const xs = d.x ? Array.from({ length: d.x.max - d.x.min + 1 }, (_, i) => d.x!.min + i) : [undefined];
  const chs = d.effects.some((e) => e.op === 'choice') ? [0, 1] : [undefined];
  const q = (1 - p) as PlayerId; const pool = [...s.players[q].hand, ...s.players[q].field.map((f) => f.card), ...s.players[p].field.map((f) => f.card)];
  const tgt = () => (pool.length && r() < 0.9 ? pick(pool).uid : undefined);
  const withs: (number | undefined)[] = [undefined];
  if (HELPERS.has(defId)) for (const c of s.players[p].hand) if (c.uid !== uid) withs.push(c.uid);
  const out: Action[] = [];
  for (const x of xs) for (const choice of chs) for (const withUid of withs)
    out.push({ type: 'play', player: p, uid, x, choice, qteHits: qte(), targetUid: tgt(), withUid, wind: pick([...WINDS]), formulaOk: r() < 0.6 });
  return out;
}
const legal = (s: GameState, p: PlayerId, ctx: Ctx) => s.players[p].hand.flatMap((c) => variants(s, p, c.uid, c.defId)).map((a) => tryAct(s, a, ctx)).filter(Boolean) as GameState[];
const score = (a: Action) => (a.type === 'play' ? (CARDS[0 as any], 0) : 0);
function step(s: GameState, ctx: Ctx): GameState {
  const ph = s.phase as any;
  if (ph.kind === 'response') {
    const p = ph.responder as PlayerId;
    const opts = legal(s, p, ctx);
    if (opts.length && (MODE === 'greedy' || r() < 0.8)) return pick(opts);
    return apply(s, { type: 'pass', player: p }, ctx);
  }
  if (ph.kind === 'select') {
    const c = ph.chooser as PlayerId;
    const pd = (s as any).pending ?? ph; if (pd.reason === 'superman') { const h = s.players[c].hand; if (!h.length) throw new Error('SOFTLOCK61'); const g = h.length ? tryAct(s, { type: 'give_card', player: c, uid: pick(h).uid }, ctx) : null; return g ?? apply(s, { type: 'pass', player: c } as any, ctx); }
    const opts: (number | undefined)[] = [...(pd.options ?? []), undefined];
    for (const uid of [...opts].sort(() => r() - .5)) { const g = tryAct(s, { type: 'pick', player: c, uid }, ctx); if (g) return g; }
    throw new Error('select 无合法动作');
  }
  if (ph.kind === 'interject') {
    const p = ph.responder as PlayerId; const opts = legal(s, p, ctx);
    if (opts.length && r() < 0.8) return pick(opts);
    return apply(s, { type: 'pass', player: p }, ctx);
  }
  const p = ph.active as PlayerId;
  const opts = legal(s, p, ctx);
  if (MODE === 'greedy' && opts.length) { // 贪心：选让对方 HP 最低、自己 HP 最高的那一步
    const q = (1 - p) as PlayerId; const v = (g: GameState) => g.players[p].hp - 1.5 * g.players[q].hp + 0.1 * g.players[p].hand.length;
    const best = opts.reduce((a, b) => (v(b) > v(a) ? b : a)); if (v(best) >= v(s) - 0.05 || r() < 0.5) return best;
  } else if (opts.length && r() < 0.85) return pick(opts);
  return apply(s, { type: 'end_phase', player: p }, ctx);
}
const stats = { first: 0, second: 0, draw: 0, rounds: [] as number[], deckOut: 0, stuck: 0, unimpl: new Map<string, number>() };
for (let g = 0; g < N; g++) {
  const ctx: Ctx = { cards: CARDS, isFriday: r() < 1 / 7 };
  let s = createGame(CARDS, [r() < .5 ? 'sweet' : 'savory', r() < .5 ? 'sweet' : 'savory'], (Math.floor(r() * 1e9)) | 0);
  let steps = 0;
  try { while (s.phase.kind !== 'over' && steps++ < 5000) s = step(s, ctx); } catch (e: any) { if (e.message === 'SOFTLOCK61') { stats.stuck++; continue; } throw e; }
  if (s.phase.kind !== 'over') { stats.stuck++; continue; }
  const w = s.phase.winner; if (w === 'draw') stats.draw++; else if (w === s.first) stats.first++; else stats.second++;
  stats.rounds.push(s.round); if (s.players.some((p) => p.maxHp < 7)) stats.deckOut++;
  for (const l of s.log) { const m = l.match(/\[未实现\] (\w+)/); if (m) stats.unimpl.set(m[1], (stats.unimpl.get(m[1]) ?? 0) + 1); }
}
const R = stats.rounds.sort((a, b) => a - b), done = R.length, pct = (x: number) => (100 * x / done).toFixed(1) + '%';
console.log(JSON.stringify({ mode: MODE, games: N, done, stuck: stats.stuck, firstWin: pct(stats.first), secondWin: pct(stats.second), draw: pct(stats.draw),
  avgRounds: (R.reduce((a, b) => a + b, 0) / done).toFixed(2), median: R[done >> 1], p10: R[Math.floor(done * .1)], p90: R[Math.floor(done * .9)], max: R[done - 1],
  reachedDeckOut: pct(stats.deckOut), unimplKeys: stats.unimpl.size }));
