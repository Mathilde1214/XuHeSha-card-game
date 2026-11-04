// 《续禾杀》房间：一局两人。服务端唯一权威，按 protocol-v1.md 实现。
import { randomBytes, randomInt } from 'node:crypto';
import { apply, createGame, RuleError, viewFor } from '../../engine/src/engine.ts';
import { CARDS } from '../../engine/src/cards.ts';
import type { Action, CardDef, Ctx, Faction, GameState, PlayerId } from '../../engine/src/types.ts';
import { checkFormulas } from './formulas.ts';

export interface Timing {
  playMs: number; responseMs: number; selectMs: number; pickMs: number; formulaMs: number;
  graceMs: number; fakeDelayMin: number; fakeDelayMax: number;
  qteLeadMs: number; qteGapMs: number; qteWindowMs: number; qteToleranceMs: number;
}
export const DEFAULT_TIMING: Timing = {
  playMs: 60_000, responseMs: 15_000, selectMs: 15_000, pickMs: 15_000, formulaMs: 45_000,
  graceMs: 60_000, fakeDelayMin: 1_000, fakeDelayMax: 3_000,
  qteLeadMs: 1_000, qteGapMs: 1_300, qteWindowMs: 600, qteToleranceMs: 150,
};

export interface Conn { send(msg: object): void }
interface Seat { token: string; conn: Conn | null; faction?: Faction; logIdx: number; graceTimer?: NodeJS.Timeout }

type Flow =
  | { kind: 'pick'; id: string; seat: PlayerId; action: Action & { type: 'play' }; handles: Map<string, number>; timer: NodeJS.Timeout }
  | { kind: 'qte'; id: string; seat: PlayerId; action: Action & { type: 'play' }; windows: { start: number; end: number }[]; hits: boolean[]; timer: NodeJS.Timeout }
  | { kind: 'formula'; id: string; seat: PlayerId; action: Action & { type: 'play' }; timer: NodeJS.Timeout };

const other = (p: PlayerId) => (1 - p) as PlayerId;
const newId = () => randomBytes(6).toString('hex');

/** 北京时间今天是不是周五（§9.2，每局开局算一次） */
export function beijingIsFriday(now = new Date()): boolean {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(now) === 'Fri';
}

function hasOp(def: CardDef, op: string): boolean {
  return JSON.stringify([def.effects, def.counter ?? null]).includes(`"op":"${op}"`);
}
function customKeys(def: CardDef): string[] {
  return [...JSON.stringify(def.effects).matchAll(/"op":"custom","key":"([^"]+)"/g)].map((m) => m[1]);
}
// 需要出牌方从对方手牌里“背面选牌”的专属效果 → 候选牌筛选
const HIDDEN_PICK: Record<string, (def: CardDef) => boolean> = {
  burn_flammable: (d) => !!d.tags?.includes('flammable'),   // #15 只在对方可燃手牌里选
  suppress_card: () => true,                                // #18 对方全部手牌里盲选
};

export class Room {
  seats: [Seat | null, Seat | null] = [null, null];
  state: GameState | null = null;
  ver = 0;
  ctx: Ctx;
  flow: Flow | null = null;
  private phaseTimer?: NodeJS.Timeout;
  private playKey = ''; private playRemaining = 0; private playDeadline = 0;
  private busyUntil: [number, number] = [0, 0];
  private holdState: [boolean, boolean] = [false, false];   // 防泄露：暂不给出牌方推送
  private delayTimer?: NodeJS.Timeout;
  closed = false;

  code: string; timing: Timing; onClose: (r: Room) => void; private seed: number;
  constructor(code: string, timing: Timing = DEFAULT_TIMING, onClose: (r: Room) => void = () => {},
    seed = randomInt(2 ** 31), isFriday = beijingIsFriday()) {
    this.code = code; this.timing = timing; this.onClose = onClose; this.seed = seed;
    this.ctx = { cards: CARDS, isFriday };
  }

  // ---------- 入座 / 重连 ----------
  join(conn: Conn): { seat: PlayerId; token: string } | null {
    const seat = this.seats[0] ? (this.seats[1] ? null : 1) : 0;
    if (seat === null) return null;
    const token = randomBytes(16).toString('hex');
    this.seats[seat] = { token, conn, logIdx: 0 };
    conn.send({ t: 'room', code: this.code, token, seat });
    if (this.seats[0] && this.seats[1]) this.toAll({ t: 'lobby', ready: true, need: 'pick_faction' });
    return { seat: seat as PlayerId, token };
  }

  resume(seat: PlayerId, conn: Conn) {
    const s = this.seats[seat]!; s.conn = conn; clearTimeout(s.graceTimer); s.graceTimer = undefined;
    conn.send({ t: 'room', code: this.code, token: s.token, seat });
    s.logIdx = 0;
    if (this.state) this.pushState(seat, true);
    if (!this.state && this.seats[0] && this.seats[1]) conn.send({ t: 'lobby', ready: true, need: 'pick_faction' });
    this.resendFlow(seat);
    this.toSeat(other(seat), { t: 'opponent', online: true });
  }

  disconnect(seat: PlayerId) {
    const s = this.seats[seat]; if (!s || this.closed) return;
    s.conn = null;
    const graceUntil = Date.now() + this.timing.graceMs;
    this.toSeat(other(seat), { t: 'opponent', online: false, graceUntil });
    s.graceTimer = setTimeout(() => this.forfeit(seat, '掉线超过 1 分钟'), this.timing.graceMs);
  }

  private forfeit(loser: PlayerId, why: string) {
    if (!this.state || this.state.phase.kind === 'over') { this.close(); return; }
    const st = structuredClone(this.state);
    st.phase = { kind: 'over', winner: other(loser) }; st.log.push(`P${loser} ${why}，判负`);
    this.commitState(st, null);
  }

  // ---------- 消息入口 ----------
  handle(seat: PlayerId, msg: any) {
    try {
      switch (msg?.t) {
        case 'pick_faction': return this.pickFaction(seat, msg.faction);
        case 'action': return this.onAction(seat, msg.seq, msg.action);
        case 'qte_hit': return this.onQteHit(seat, msg.qteId, msg.round);
        case 'formula': return this.onFormula(seat, msg.qteId, msg.lines);
        case 'hidden_pick_reply': return this.onPick(seat, msg.pickId, msg.handle);
        case 'ping': return this.toSeat(seat, { t: 'pong', serverTime: Date.now() });
        default: this.toSeat(seat, { t: 'reject', seq: msg?.seq, reason: '未知消息' });
      }
    } catch (e) {
      this.toSeat(seat, { t: 'reject', seq: msg?.seq, reason: e instanceof RuleError ? e.message : '服务器内部错误' });
      if (!(e instanceof RuleError)) console.error(e);
    }
  }

  private pickFaction(seat: PlayerId, f: Faction) {
    if (this.state) throw new RuleError('对局已开始');
    if (f !== 'sweet' && f !== 'savory') throw new RuleError('阵营只能是 sweet 或 savory');
    this.seats[seat]!.faction = f;
    this.toSeat(seat, { t: 'ack', what: 'pick_faction' });
    const [a, b] = this.seats;
    if (a?.faction && b?.faction) {
      const st = createGame(CARDS, [a.faction, b.faction], this.seed);
      this.commitState(st, null);
    }
  }

  // ---------- 出牌 ----------
  private onAction(seat: PlayerId, seq: number, raw: any) {
    if (!this.state) throw new RuleError('对局还没开始');
    if (this.flow) throw new RuleError('正在进行判定，请稍候');
    // 假等待和真响应窗口给出牌方的回复必须一模一样，否则能猜出对方有没有反制牌
    if (Date.now() < this.busyUntil[seat] || this.holdState[seat]) throw new RuleError('结算中，请稍候');
    if (!raw || typeof raw.type !== 'string') throw new RuleError('动作格式不对');
    const a: any = { ...raw, player: seat };   // 身份按连接认，客户端填的 player 无视
    delete a.qteHits; delete a.formulaOk;      // QTE、公式结果只能由服务端算
    const action = a as Action;

    if (action.type === 'play') {
      const def = this.comboDef(seat, action);
      const pickKey = customKeys(def).find((k) => HIDDEN_PICK[k]);
      if (pickKey) delete (action as any).targetUid;                         // 对方手牌只能走一次性编号
      if (hasOp(def, 'choice') && action.choice === undefined) throw new RuleError('这张牌要先选一个选项');
      apply(this.state, { ...action, qteHits: 0 }, this.ctx);               // 试结算：费用、时机不合法直接拒绝，不进判定
      this.toSeat(seat, { t: 'ack', seq });
      if (pickKey) return this.startPick(seat, action, pickKey, def);
      return this.afterPick(seat, action, def);
    }
    const prev = this.state;
    const next = apply(prev, action, this.ctx);
    this.toSeat(seat, { t: 'ack', seq });
    this.commitState(next, { seat, action });
  }

  private afterPick(seat: PlayerId, action: Action & { type: 'play' }, def: CardDef) {
    if (customKeys(def).includes('physics_formulas')) return this.startFormula(seat, action);
    if (hasOp(def, 'qte')) return this.startQte(seat, action);
    this.commitState(apply(this.state!, action, this.ctx), { seat, action });
  }

  /** 出牌用到的卡（含组合的第二张 withUid）合成一个“虚拟定义”，用来判断要不要走判定流程 */
  private comboDef(seat: PlayerId, action: Action & { type: 'play' }): CardDef {
    const hand = this.state!.players[seat].hand;
    const card = hand.find((c) => c.uid === action.uid); if (!card) throw new RuleError('手牌里没有这张');
    const defs = [CARDS[card.defId]];
    if (action.withUid !== undefined) { const w = hand.find((c) => c.uid === action.withUid); if (!w) throw new RuleError('组合的第二张不在手牌里'); defs.push(CARDS[w.defId]); }
    return { ...defs[0], effects: defs.flatMap((d) => d.effects), counter: defs[0].counter };
  }

  // ---------- 背面选牌（#15 / #18）----------
  private startPick(seat: PlayerId, action: Action & { type: 'play' }, key: string, def: CardDef) {
    const opp = this.state!.players[other(seat)];
    const cands = opp.hand.filter((c) => HIDDEN_PICK[key](CARDS[c.defId]));
    if (cands.length === 0) return this.afterPick(seat, action, def);
    const shuffled = [...cands].sort(() => randomInt(3) - 1);
    const handles = new Map(shuffled.map((c) => [newId(), c.uid]));
    this.pauseTimers();
    const id = newId();
    const timer = setTimeout(() => this.onPick(seat, id, [...handles.keys()][randomInt(handles.size)]), this.timing.pickMs);
    this.flow = { kind: 'pick', id, seat, action, handles, timer };
    this.resendFlow(seat);
    this.toSeat(other(seat), { t: 'waiting', who: seat });
  }
  private onPick(seat: PlayerId, pickId: string, handle: string) {
    const f = this.flow; if (!f || f.kind !== 'pick' || f.id !== pickId || f.seat !== seat) throw new RuleError('这次选牌已失效');
    const uid = f.handles.get(handle); if (uid === undefined) throw new RuleError('无效的选择');
    clearTimeout(f.timer); this.flow = null;
    const action = { ...f.action, targetUid: uid };
    this.afterPick(seat, action, this.comboDef(seat, action));
  }

  // ---------- QTE（§9.1，按服务端收到时间判定）----------
  private startQte(seat: PlayerId, action: Action & { type: 'play' }) {
    const T = this.timing; const now = Date.now();
    const windows = [0, 1, 2].map((i) => { const start = now + T.qteLeadMs + i * T.qteGapMs + randomInt(0, 400); return { start, end: start + T.qteWindowMs }; });
    this.pauseTimers();
    const id = newId();
    const timer = setTimeout(() => this.finishQte(id), windows[2].end + T.qteToleranceMs + 100 - now);
    this.flow = { kind: 'qte', id, seat, action, windows, hits: [false, false, false], timer };
    this.resendFlow(seat);
    this.toSeat(other(seat), { t: 'waiting', who: seat });
  }
  private onQteHit(seat: PlayerId, qteId: string, round: number) {
    const f = this.flow; if (!f || f.kind !== 'qte' || f.id !== qteId || f.seat !== seat) return;
    const w = f.windows[round]; if (!w || f.hits[round]) return;
    const now = Date.now();
    if (now >= w.start && now <= w.end + this.timing.qteToleranceMs) f.hits[round] = true;
  }
  private finishQte(id: string) {
    const f = this.flow; if (!f || f.kind !== 'qte' || f.id !== id) return;
    this.flow = null;
    const qteHits = f.hits.filter(Boolean).length;
    this.toAll({ t: 'qte_result', qteId: id, hits: qteHits, pass: qteHits >= 2 });
    this.commitState(apply(this.state!, { ...f.action, qteHits }, this.ctx), { seat: f.seat, action: f.action });
  }

  // ---------- 公式（#64）----------
  private startFormula(seat: PlayerId, action: Action & { type: 'play' }) {
    this.pauseTimers();
    const id = newId();
    const timer = setTimeout(() => this.onFormula(seat, id, []), this.timing.formulaMs);
    this.flow = { kind: 'formula', id, seat, action, timer };
    this.resendFlow(seat);
    this.toSeat(other(seat), { t: 'waiting', who: seat });
  }
  private onFormula(seat: PlayerId, id: string, lines: unknown) {
    const f = this.flow; if (!f || f.kind !== 'formula' || f.id !== id || f.seat !== seat) throw new RuleError('这次输入已失效');
    clearTimeout(f.timer); this.flow = null;
    const r = checkFormulas(Array.isArray(lines) ? lines.map(String) : []);
    this.toAll({ t: 'formula_result', qteId: id, pass: r.pass, detail: r.matched });
    this.commitState(apply(this.state!, { ...f.action, formulaOk: r.pass }, this.ctx), { seat: f.seat, action: f.action });
  }

  private resendFlow(seat: PlayerId) {
    const f = this.flow; if (!f || f.seat !== seat) return;
    if (f.kind === 'pick') this.toSeat(seat, { t: 'hidden_pick', pickId: f.id, handles: [...f.handles.keys()] });
    if (f.kind === 'qte') this.toSeat(seat, { t: 'qte_start', qteId: f.id, rounds: 3, windows: f.windows, serverTime: Date.now() });
    if (f.kind === 'formula') this.toSeat(seat, { t: 'formula_start', qteId: f.id, count: 3, deadline: Date.now() + this.timing.formulaMs });
  }

  // ---------- 状态推送 + 防泄露 ----------
  private commitState(next: GameState, by: { seat: PlayerId; action: Action } | null) {
    const prev = this.state; this.state = next; this.ver++;
    const ph = next.phase;
    // 防泄露（§8、#41）：对方“有没有反制牌”只能由服务端知道。
    //  - 真窗口（response 非 free、interject）：暂不给等待方推状态，只发 waiting
    //  - 没开窗口：给等待方随机假等 1～3 秒，表现和真窗口一样
    const waiter: PlayerId | null =
      ph.kind === 'response' && !ph.free ? ph.active : ph.kind === 'interject' ? ph.active : null;
    let fake: PlayerId | null = null;
    if (waiter === null && ph.kind !== 'over') {
      const playedOwn = by && by.action.type === 'play' && prev?.phase.kind === 'play' && prev.phase.active === by.seat;
      const newPhase = ph.kind === 'play' && prev && this.isNewPlayPhase(prev, next);
      if (playedOwn) fake = by!.seat;
      else if (newPhase && ph.kind === 'play') fake = ph.active;
    }
    for (const p of [0, 1] as PlayerId[]) {
      if (waiter === p) { this.holdState[p] = true; this.toSeat(p, { t: 'waiting', who: other(p) }); continue; }
      this.holdState[p] = false;
      if (fake === p) {
        const d = randomInt(this.timing.fakeDelayMin, this.timing.fakeDelayMax + 1);
        this.toSeat(p, { t: 'waiting', who: other(p) });
        this.busyUntil[p] = Date.now() + d;
        clearTimeout(this.delayTimer);
        this.delayTimer = setTimeout(() => this.pushState(p), d);
        continue;
      }
      this.pushState(p);
    }
    this.scheduleTimers(fake !== null && ph.kind === 'play' && fake === ph.active ? this.busyUntil[fake] - Date.now() : 0);
    if (ph.kind === 'over') { this.clearAllTimers(); setTimeout(() => this.close(), 5 * 60_000).unref?.(); }
  }

  private isNewPlayPhase(prev: GameState, next: GameState) {
    if (next.phase.kind !== 'play') return false;
    if (prev.phase.kind === 'interject') return false;            // 从朝圣者窗口回来，已经等过了
    return prev.round !== next.round || !('active' in prev.phase) || prev.phase.active !== next.phase.active;
  }

  private pushState(p: PlayerId, full = false) {
    const s = this.seats[p]; if (!s || !this.state) return;
    const log = this.state.log.slice(full ? 0 : s.logIdx); s.logIdx = this.state.log.length;
    this.toSeat(p, { t: 'state', ver: this.ver, view: viewFor(this.state, p), log });
    const ph = this.state.phase;
    if (ph.kind === 'play') this.toSeat(p, { t: 'timer', phase: 'play', active: ph.active, deadline: this.playDeadline });
    if ((ph.kind === 'response' || ph.kind === 'interject') && ph.responder === p) this.toSeat(p, { t: 'timer', phase: ph.kind, deadline: this.phaseDeadline });
    if (ph.kind === 'select' && ph.chooser === p) this.toSeat(p, { t: 'timer', phase: 'select', deadline: this.phaseDeadline });
  }

  // ---------- 计时 ----------
  private phaseDeadline = 0;
  private pauseTimers() {
    clearTimeout(this.phaseTimer);
    const ph = this.state?.phase;
    if (ph?.kind === 'play') this.playRemaining = Math.max(0, this.playDeadline - Date.now());
  }
  private scheduleTimers(extraMs = 0) {
    clearTimeout(this.phaseTimer);
    const st = this.state!; const ph = st.phase; const T = this.timing;
    if (ph.kind === 'play') {
      const key = `${st.round}:${ph.active}`;
      if (key !== this.playKey) { this.playKey = key; this.playRemaining = T.playMs + Math.max(0, extraMs); }
      this.playDeadline = Date.now() + this.playRemaining;
      this.phaseTimer = setTimeout(() => this.auto({ type: 'end_phase', player: ph.active }), this.playRemaining);
      return;
    }
    if (this.playDeadline && ph.kind !== 'over') this.playRemaining = Math.max(0, this.playDeadline - Date.now());
    if (ph.kind === 'response' || ph.kind === 'interject') {
      this.phaseDeadline = Date.now() + T.responseMs;
      this.phaseTimer = setTimeout(() => this.auto({ type: 'pass', player: ph.responder }), T.responseMs);
    } else if (ph.kind === 'select') {
      this.phaseDeadline = Date.now() + T.selectMs;
      this.phaseTimer = setTimeout(() => {
        if (ph.reason === 'math_quiz') return this.auto({ type: 'pick', player: ph.chooser } as Action);
        const hand = this.state!.players[ph.chooser].hand;
        if (hand.length) this.auto({ type: 'give_card', player: ph.chooser, uid: hand[randomInt(hand.length)].uid });
      }, T.selectMs);
    }
  }

  private auto(a: Action) {
    if (!this.state || this.flow) return;
    try { this.commitState(apply(this.state, a, this.ctx), { seat: a.player, action: a }); }
    catch (e) {
      // 结束出牌阶段失败（比如手牌超上限要先弃牌）：随机弃到能结束为止
      if (a.type === 'end_phase') {
        let st = this.state;
        for (let i = 0; i < 20; i++) {
          const hand = st.players[a.player].hand; if (!hand.length) break;
          st = apply(st, { type: 'discard', player: a.player, uid: hand[randomInt(hand.length)].uid }, this.ctx);
          try { return this.commitState(apply(st, a, this.ctx), { seat: a.player, action: a }); } catch {}
        }
      }
      console.error('自动处理失败', e);
    }
  }
  private clearAllTimers() { clearTimeout(this.phaseTimer); clearTimeout(this.delayTimer); if (this.flow) clearTimeout(this.flow.timer); }

  // ---------- 发送 ----------
  toSeat(p: PlayerId, msg: object) { this.seats[p]?.conn?.send(msg); }
  toAll(msg: object) { this.toSeat(0, msg); this.toSeat(1, msg); }
  close() {
    if (this.closed) return; this.closed = true; this.clearAllTimers();
    for (const s of this.seats) if (s) clearTimeout(s.graceTimer);
    this.onClose(this);
  }
}
