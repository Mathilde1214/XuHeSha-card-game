// 由 client/build.ts 从 engine/src/engine.ts 生成，勿手改
// 《续禾杀》规则引擎 v2：纯函数状态机。服务端权威结算，客户端只做预览。依据 rules-v2.md。
                                                                                                                                                        

export const RULES = { HP: 7, SP: 7, HAND_LIMIT: 8, FIRST_HAND: 3, SECOND_HAND: 4, END_DRAW: 2,
  QTE_ROUNDS: 3, QTE_PASS: 2 };                       // QTE 3 次中 2 次成功算通过（提案，待 Siyuan 过目）
// 风向权重（提案）：默认三种各 1/3；风场持有者 顺风 50% / 无风 30% / 逆风 20%
export const WIND_WEIGHTS = { normal: { tail: 1, calm: 1, head: 1 }, field: { tail: 5, calm: 3, head: 2 } };

export const WIND_ZH                       = { tail: '顺风', head: '逆风', calm: '无风' };
export class RuleError extends Error {}

function rand(s           )         { // mulberry32，可复现
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const other = (p          )           => (p === 0 ? 1 : 0);
const clone = (s           )            => structuredClone(s);
const targets = (owner          , t        )             => (t === 'self' ? [owner] : t === 'enemy' ? [other(owner)] : [0, 1]);

// 卡组：双方各一整套固定的牌（卡表里所有未删除的卡，各 1 张），由服务端生成，不接受客户端传入
export function buildDeck(cards                         )           {
  return Object.values(cards).filter((c) => c.status !== 'deleted').map((c) => c.id).sort();
}

export function createGame(cards                         , factions                    , seed        , decksOverride                       )            {
  const decks = decksOverride ?? [buildDeck(cards), buildDeck(cards)];
  const s            = { round: 1, first: 0, players: [null , null ], phase: { kind: 'play', active: 0 }, wind: 'calm',
    stack: [], rng: seed, nextUid: 1, placeSeq: 0, log: [] };
  let a = 0, b = 0;
  do { a = 1 + Math.floor(rand(s) * 6); b = 1 + Math.floor(rand(s) * 6); } while (a === b);
  s.first = a > b ? 0 : 1;
  for (const p of [0, 1]              ) {
    const ids = [...decks[p]];
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rand(s) * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    const deck = ids.map((defId) => ({ uid: s.nextUid++, defId }));   // 先洗再编 uid，uid 不泄露是哪张牌
    s.players[p] = { hp: RULES.HP, maxHp: RULES.HP, sp: RULES.SP, faction: factions[p], deck, hand: [], discard: [], field: [], skipPhases: 0, uses: {}, roundUses: {}, suppressed: [], boost: false };
  }
  draw(s, s.first, RULES.FIRST_HAND); draw(s, other(s.first), RULES.SECOND_HAND);
  s.log.push(`掷骰 ${a}:${b}，P${s.first} 先手`);
  startPlayPhase(s, s.first, { cards });
  return s;
}

function draw(s           , p          , n        ) {
  const pl = s.players[p];
  for (let i = 0; i < n; i++) {
    if (pl.hand.length >= RULES.HAND_LIMIT || pl.deck.length === 0) break; // 满手或牌库空就停，不洗弃牌堆
    pl.hand.push(pl.deck.shift() );
  }
}

function hasWindField(s           , p          , ctx     ) {
  return s.players.some((pl) => pl.field.some((f) => f.owner === p && ctx.cards[f.card.defId]?.windField));
}

function rollWind(s           , p          , ctx     )       {
  const w = hasWindField(s, p, ctx) ? WIND_WEIGHTS.field : WIND_WEIGHTS.normal;
  const total = w.tail + w.calm + w.head; let r = rand(s) * total;
  if ((r -= w.tail) < 0) return 'tail';
  if ((r -= w.calm) < 0) return 'calm';
  return 'head';
}

const DORMS                         = { 'XHS-057': '3119', 'XHS-058': '3118' };   // 宿舍卡 → 加成的标签
const COMBOS                           = {   // 主牌 → 可同时打出的牌（#67 另算）
  'XHS-032': ['XHS-060'], 'XHS-055': ['XHS-045'], 'XHS-057': ['XHS-038'], 'XHS-058': ['XHS-038'] };
const HELPERS = new Set(['XHS-060', 'XHS-045', 'XHS-038', 'XHS-067']);

function startPlayPhase(s           , p          , ctx     ) {
  s.phase = { kind: 'play', active: p };
  s.players[p].sp = RULES.SP;
  s.wind = rollWind(s, p, ctx);
  s.log.push(`第 ${s.round} 回合 · P${p} 出牌阶段，风向 ${WIND_ZH[s.wind]}`);
  if (s.players[p].skipPhases > 0) { s.players[p].skipPhases--; s.log.push(`P${p} 跳过本出牌阶段`); endPhase(s, p, ctx); return; }
  // #41 朝圣者：对方手里有付得起的朝圣者，就在本阶段开始前给他一个窗口
  const o = other(p), op = s.players[o];
  if (op.hand.some((c) => c.defId === 'XHS-041' && !op.suppressed.includes(c.uid) && ctx.cards[c.defId].cost <= op.sp))
    s.phase = { kind: 'interject', active: p, responder: o, step: 'offer' };
}

// 宿舍卡加成：自己效果区里每张对应宿舍卡 ×2（用了 #38 的下一张 ×3），倍率不设上限
function dormMult(s           , p          , def         , boost         )         {
  let m = 1;
  for (const f of s.players[p].field) {
    const tag = DORMS[f.card.defId];
    if (f.owner === p && tag && def.tags?.includes(tag       )) m *= boost ? 3 : 2;
  }
  return m;
}

function applyEffects(s           , effects          , it           , ctx     ) {
  for (const e of effects) applyEffect(s, e, it, ctx);
}

// 有益数值才乘倍率：对敌伤害、对敌扣 SP、自己回 HP/SP、自己抽牌；自损和跳过次数不乘
function applyEffect(s           , e        , it           , ctx     ) {
  const owner = it.owner, m = it.mult ?? 1;
  switch (e.op) {
    case 'damage': {
      const base = e.amount === 'X' ? (it.x ?? 0) : typeof e.amount === 'object' ? (it.x ?? 0) - e.amount.xMinus : e.amount;
      const wind = hasWindField(s, owner, ctx) && s.phase.kind !== 'over' && s.phase.active === owner ? (s.wind === 'tail' ? 1 : s.wind === 'head' ? -1 : 0) : 0;
      for (const p of targets(owner, e.target)) {
        let n = Math.max(0, (p === owner ? base : base * m) + wind);
        if (p !== owner && it.absorb) { const a = Math.min(it.absorb, n); n -= a; it.absorb -= a; }   // #9 抵消的点数先扣
        s.players[p].hp -= n;
      }
      break;
    }
    case 'heal': for (const p of targets(owner, e.target)) { const pl = s.players[p];
      pl.hp = e.amount === 'full' ? pl.maxHp : Math.min(pl.maxHp, pl.hp + (p === owner ? e.amount * m : e.amount)); } break;
    case 'sp': for (const p of targets(owner, e.target)) { const pl = s.players[p];
      if (e.delta === 'clear') { pl.sp = 0; continue; }
      const good = (p === owner) === (e.delta > 0);
      pl.sp = Math.max(0, pl.sp + (good ? e.delta * m : e.delta)); } break;
    case 'draw': for (const p of targets(owner, e.target)) draw(s, p, p === owner ? e.count * m : e.count); break;
    case 'discard_random': for (const p of targets(owner, e.target)) {
      const h = s.players[p].hand; const n = e.count === 'all' ? h.length : e.count;
      for (let i = 0; i < n && h.length; i++) s.players[p].discard.push(...h.splice(Math.floor(rand(s) * h.length), 1));
    } break;
    case 'skip_next_phase': for (const p of targets(owner, e.target)) s.players[p].skipPhases += e.count ?? 1; break;
    case 'choice': { const opt = e.options[it.choice ?? 0]; if (!opt) throw new RuleError('无效的选项'); applyEffects(s, opt, it, ctx); break; }
    case 'qte': if ((it.qteHits ?? 0) >= RULES.QTE_PASS) applyEffects(s, e.onPass, it, ctx); else s.log.push(`${ctx.cards[it.card.defId].name}：QTE 未通过，效果不发动`); break;
    case 'if_friday': applyEffects(s, ctx.isFriday ? e.then : e.else, it, ctx); break;
    case 'vs_faction': if (s.players[other(owner)].faction === e.faction) applyEffects(s, e.then, it, ctx); break;
    case 'set_hp': for (const p of targets(owner, e.target)) s.players[p].hp = e.value; break;
    case 'custom': custom(s, e.key, it, ctx); break;
  }
}

const dmgE = (n        , target         = 'enemy')         => ({ op: 'damage', target, amount: n });

// 17 张怪卡的专属结算
function custom(s           , key        , it           , ctx     ) {
  const me = it.owner, en = other(me), E = s.players[en], M = s.players[me];
  const has = (c          , tag        ) => !!ctx.cards[c.defId]?.tags?.includes(tag       );
  switch (key) {
    case 'bleed': {   // #3：对方手牌 + 对方效果区里的金属制牌，每张 1 伤；本牌放进对方手牌
      const n = E.hand.filter((c) => has(c, 'metal')).length + E.field.filter((f) => has(f.card, 'metal')).length;
      if (n > 0) applyEffect(s, dmgE(n), it, ctx); else s.log.push('流血!!!：对方没有金属制牌，无伤害');
      it.dest = 'enemyHand'; break;
    }
    case 'math_quiz': {   // #4：对方随机弃 2 张，出牌方可从中拿 1 张
      const gone           = [];
      for (let i = 0; i < 2 && E.hand.length; i++) { const c = E.hand.splice(Math.floor(rand(s) * E.hand.length), 1)[0]; E.discard.push(c); gone.push(c.uid); }
      if (gone.length) s.pending = { reason: 'math_quiz', chooser: me, options: gone };
      break;
    }
    case 'fifth_day': break;   // #9：放进效果区，由 tickFifthDay 计数
    case 'burn_flammable': {   // #15：出牌方背面选对方 1 张可燃牌弃置（手牌或效果区）
      const hi = E.hand.findIndex((c) => c.uid === it.targetUid && has(c, 'flammable'));
      if (hi >= 0) { E.discard.push(E.hand.splice(hi, 1)[0]); break; }
      const fi = E.field.findIndex((f) => f.card.uid === it.targetUid && has(f.card, 'flammable'));
      if (fi >= 0) { const f = E.field.splice(fi, 1)[0]; s.players[f.owner].discard.push(f.card); break; }
      const pool = E.hand.filter((c) => has(c, 'flammable'));   // 没选或选错：随机一张（服务端超时也走这里）
      if (pool.length) { const c = pool[Math.floor(rand(s) * pool.length)]; E.discard.push(E.hand.splice(E.hand.indexOf(c), 1)[0]); }
      else s.log.push('鲨鲨の怒火：对方没有可燃牌');
      break;
    }
    case 'suppress_card': {   // #18：压制对方 1 张手牌，本回合打不出；不打断已打出的牌
      const c = E.hand.find((h) => h.uid === it.targetUid) ?? E.hand[Math.floor(rand(s) * E.hand.length)];
      if (c && !E.suppressed.includes(c.uid)) { E.suppressed.push(c.uid); s.log.push(`P${en} 的 1 张手牌本回合被压制`); }
      break;
    }
    case 'change_wind': if (it.wind) { s.wind = it.wind; s.log.push(`风向改为 ${WIND_ZH[it.wind]}`); } break;   // #31
    case 'fridge_skip': E.skipPhases += it.with?.defId === 'XHS-060' ? 2 : 1; break;   // #32，跳过次数不乘倍率
    case 'remove_from_my_zone': {   // #37：移除对方放在我效果区的 1 张牌
      const i = Math.max(M.field.findIndex((f) => f.owner === en && f.card.uid === it.targetUid), M.field.findIndex((f) => f.owner === en));
      if (i >= 0 && M.field[i].owner === en) { const f = M.field.splice(i, 1)[0]; E.discard.push(f.card); } else s.log.push('工兵铲：自己效果区里没有对方放的牌，无效果');
      break;
    }
    case 'dorm_x3':   // #38：己方效果区有宿舍卡就生效，下一张牌 ×3（补充裁定四）；同时打出的组合在 settle 里处理
      if (it.with) break;
      if (M.field.some((f) => f.owner === me && DORMS[f.card.defId])) M.boost = true;
      else s.log.push('卡牌游戏!!! 己方效果区没有宿舍卡，无效果');
      break;
    case 'pilgrim': s.log.push('朝圣者只能在对方出牌阶段开始时打出，此时无效果'); break;   // #41
    case 'basketball':   // #49：对方手里有 #48 灯管 → 对方 HP-5、自己 HP-1；否则对方 HP-1
      if (E.hand.some((c) => c.defId === 'XHS-048')) { applyEffect(s, dmgE(5), it, ctx); applyEffect(s, dmgE(1, 'self'), it, ctx); }
      else applyEffect(s, dmgE(1), it, ctx);
      break;
    case 'zongzi_combo':   // #55：对甜粽党 HP-1；与 #45 同时打出：不看阵营，HP-3、SP-1
      if (it.with?.defId === 'XHS-045') { applyEffect(s, dmgE(3), it, ctx); applyEffect(s, { op: 'sp', target: 'enemy', delta: -1 }, it, ctx); }
      else if (E.faction === 'sweet') applyEffect(s, dmgE(1), it, ctx);
      break;
    case 'superman':   // #61：对方选 1 张手牌交给我；没有手牌则我 SP+1
      if (E.hand.length) s.pending = { reason: 'superman', chooser: en, options: [] };
      else applyEffect(s, { op: 'sp', target: 'self', delta: 1 }, it, ctx);
      break;
    case 'physics_formulas':   // #64：服务端比对公式库后填 formulaOk
      if (it.formulaOk ?? (it.qteHits ?? 0) >= RULES.QTE_PASS) { applyEffect(s, { op: 'sp', target: 'self', delta: 1 }, it, ctx); applyEffect(s, { op: 'heal', target: 'self', amount: 1 }, it, ctx); }
      else s.log.push('Physics：公式未全部匹配，无效果');
      break;
    case 'cost_minus_2': if (!it.with) s.log.push('意见箱需与另一张牌同时打出，单独打出无效果'); break;   // #67，减费在出牌时算
    default: s.log.push(`[未实现] ${key}`);
  }
}

function baseCost(pl             , def         , x         ) {
  if (def.x) { if (x === undefined || x < def.x.min || x > def.x.max) throw new RuleError(`X 需在 ${def.x.min}–${def.x.max}`); }
  return def.escalating ? (pl.uses[def.id] ?? 0) + 1 : def.x ? x  : def.cost;
}
const costOf = baseCost;

function checkPlayable(pl             , def         , uid        ) {
  if (def.status === 'deleted') throw new RuleError('这张卡已删除');
  if (pl.suppressed.includes(uid)) throw new RuleError('这张牌本回合被压制，不能打出');
  if (def.condition?.spAtMost !== undefined && pl.sp > def.condition.spAtMost) throw new RuleError(`SP 需 ≤ ${def.condition.spAtMost} 才能打出`);
  if (def.maxPerRound !== undefined && (pl.roundUses[def.id] ?? 0) >= def.maxPerRound) throw new RuleError(`本回合最多用 ${def.maxPerRound} 次`);
}
function markUsed(pl             , def         ) {
  if (def.escalating) pl.uses[def.id] = (pl.uses[def.id] ?? 0) + 1;
  pl.roundUses[def.id] = (pl.roundUses[def.id] ?? 0) + 1;
}
function pay(pl             , def         , x                    , uid        ) {
  checkPlayable(pl, def, uid);
  const c = baseCost(pl, def, x);
  if (c > pl.sp) throw new RuleError('SP 不足');
  pl.sp -= c; markUsed(pl, def);
}

// 这张牌能不能反制栈顶那张
function counters(def         , target         , tChoice         )          {
  const c = def.counter; if (!c) return false;
  const isAtk = target.type === 'attack' || !!target.attackChoices?.includes(tChoice ?? 0); // #42/#47 选伤害按攻击结算
  if (c.exceptIds?.includes(target.id)) return false;
  if (c.ids) return c.ids.includes(target.id);
  if (c.tags) return isAtk && c.tags.some((t) => target.tags?.includes(t));
  if (c.mode === 'block' && !isAtk) return false; // 只有攻击牌能被防御
  return !c.types || c.types.includes(target.type);
}

// B1：只有对方手里有能反制、且付得起的牌，才开响应窗口
function shouldOpenWindow(s           , responder          , top         , ctx     , tChoice         )          {
  const pl = s.players[responder];
  return pl.hand.some((c) => { const d = ctx.cards[c.defId];
    try { checkPlayable(pl, d, c.uid); return counters(d, top, tChoice) && costOf(pl, d, d.x?.min) <= pl.sp; } catch { return false; } });
}

// #9：双方每打出一张牌（含响应、老木盾）计 1 次，满 5 次对方 HP-3，本牌移除
function tickFifthDay(s           , skipUid         ) {   // skipUid：这次出牌要摧毁的 #9，先摧毁、不计数（补充裁定四）
  for (const pl of s.players) pl.field = pl.field.filter((f) => {
    if (f.card.defId !== 'XHS-009' || f.card.uid === skipUid) return true;
    f.count = (f.count ?? 0) + 1;
    if (f.count < 5) return true;
    s.players[other(f.owner)].hp -= 3; s.players[f.owner].discard.push(f.card); s.log.push(`「等成绩的第5天」满 5 次出牌：P${other(f.owner)} HP-3`);
    return false;
  });
}

function settle(s           , it           , ctx     ) {
  const def = ctx.cards[it.card.defId];
  const pl = s.players[it.owner], en = s.players[other(it.owner)];
  // 用攻击牌指定对方效果区的 #9：这次攻击改为摧毁它
  const fifth = def.type === 'attack' && !it.cancelled ? en.field.findIndex((f) => f.card.uid === it.targetUid && f.card.defId === 'XHS-009') : -1;
  if (fifth >= 0) { const f = en.field.splice(fifth, 1)[0]; s.players[f.owner].discard.push(f.card); s.log.push(`${def.name} 摧毁了 P${other(it.owner)} 的「等成绩的第5天」（这次攻击不再造成其他效果）`); }
  else if (!it.cancelled) {
    applyEffects(s, def.effects, it, ctx);
    if (it.with && it.with.defId === 'XHS-060') applyEffects(s, ctx.cards['XHS-060'].effects, { ...it, card: it.with, mult: it.withMult }, ctx);
    if (it.with?.defId === 'XHS-038') pl.boost = true;   // 宿舍卡 + #38：下一张牌 ×3
  }
  if (it.with) pl.discard.push(it.with);
  if (def.persistent && !it.cancelled) {
    const zoneOwner = def.persistent.zone === 'self' ? it.owner : other(it.owner);
    s.players[zoneOwner].field.push({ card: it.card, owner: it.owner, roundsLeft: def.persistent.rounds, placedAt: s.placeSeq++ });
  } else if (it.dest === 'enemyHand') en.hand.push({ ...it.card, from: it.owner });   // #3 进对方手牌，标明来自对方
  else if (def.returnsToHand) pl.hand.push(it.card);
  else pl.discard.push(it.card);
}

function endPhase(s           , p          , ctx     ) {
  if (s.players[p].hp <= 0) { s.phase = { kind: 'over', winner: other(p) }; s.log.push(`P${p} 出牌阶段结束时 HP ≤ 0，判负`); return; }
  // 按出牌方自己回合计时的持续牌（宿舍卡）：出牌方每结束一个自己的出牌阶段减 1
  for (const pl of s.players) pl.field = pl.field.filter((f) => {
    if (f.owner !== p || f.roundsLeft === undefined || !ctx.cards[f.card.defId].persistent?.ownTurns) return true;
    if (--f.roundsLeft > 0) return true;
    s.players[f.owner].discard.push(f.card); s.log.push(`P${f.owner} 的 ${ctx.cards[f.card.defId].name} 到期，移入弃牌堆`); return false;
  });
  if (p === s.first) return startPlayPhase(s, other(p), ctx);
  draw(s, s.first, RULES.END_DRAW); draw(s, other(s.first), RULES.END_DRAW);
  s.round++;
  for (const pl of s.players) { pl.roundUses = {}; pl.suppressed = []; }
  // 持续效果倒计时，按放上场的先后处理（A6）
  for (const pl of s.players) pl.field = pl.field.filter((f) => {
    if (f.roundsLeft === undefined || ctx.cards[f.card.defId].persistent?.ownTurns) return true;
    if (--f.roundsLeft > 0) return true;
    s.players[f.owner].discard.push(f.card); s.log.push(`P${f.owner} 的 ${ctx.cards[f.card.defId].name} 到期，移入弃牌堆`); return false;
  });
  for (const q of [0, 1]              ) { const pl = s.players[q]; if (pl.deck.length === 0) { pl.maxHp--; s.log.push(`P${q} 牌库已空，HP 上限 -1（现为 ${pl.maxHp}）`); pl.hp = Math.min(pl.hp, pl.maxHp); } }
  const dead = ([0, 1]              ).filter((q) => s.players[q].maxHp <= 0);
  if (dead.length === 2) { s.phase = { kind: 'over', winner: 'draw' }; s.log.push('双方 HP 上限都降到 0，平局'); return; }
  if (dead.length === 1) { s.phase = { kind: 'over', winner: other(dead[0]) }; s.log.push(`P${dead[0]} HP 上限降到 0，判负`); return; } // 立刻判负（A3）
  startPlayPhase(s, s.first, ctx);
}

function takeFromHand(pl             , uid        )           {
  const i = pl.hand.findIndex((c) => c.uid === uid); if (i < 0) throw new RuleError('手牌里没有这张');
  return pl.hand.splice(i, 1)[0];
}

// 一次结算结束：有待选牌就进选牌阶段，否则回到当前出牌阶段
function resume(s           , active          ) {
  let pd = s.pending;
  if (pd?.reason === 'superman' && s.players[pd.chooser].hand.length === 0) pd = s.pending = undefined;   // 没牌可交就跳过
  if (pd) s.phase = { kind: 'select', active, chooser: pd.chooser, reason: pd.reason, options: pd.options.length ? pd.options : undefined };
  else s.phase = { kind: 'play', active };
}

// 主动出牌（自己出牌阶段，或 #41 朝圣者给的那一张）
function mainPlay(s           , player          , a                                   , active          , ctx     , free = false) {   // free：#41 给的那张不耗 SP
  const pl = s.players[player];
  let uid = a.uid, withUid = a.withUid;
  if (!pl.hand.some((c) => c.uid === uid)) throw new RuleError('手牌里没有这张');
  if (withUid !== undefined) {
    const w = pl.hand.find((c) => c.uid === withUid); if (!w || withUid === uid) throw new RuleError('手牌里没有要同时打出的牌');
    const m = pl.hand.find((c) => c.uid === uid) ;
    if (HELPERS.has(m.defId) && !HELPERS.has(w.defId)) [uid, withUid] = [withUid, uid];   // 两张谁在前都行
  }
  const card = pl.hand.find((c) => c.uid === uid) , def = ctx.cards[card.defId];
  const wc = withUid === undefined ? undefined : pl.hand.find((c) => c.uid === withUid) ;
  const wdef = wc && ctx.cards[wc.defId];
  checkPlayable(pl, def, uid);
  let cost = baseCost(pl, def, a.x);
  if (wc && wdef) {
    checkPlayable(pl, wdef, wc.uid);
    if (wdef.id === 'XHS-067') {
      if (def.variableCost || def.x) throw new RuleError('意见箱不能用于 X 费或可变费用的牌');
      cost = Math.max(0, cost - 2);
    } else if (COMBOS[def.id]?.includes(wdef.id)) cost += baseCost(pl, wdef);
    else throw new RuleError('这两张牌不能同时打出');
  }
  if (free) cost = 0;
  if (cost > pl.sp) throw new RuleError('SP 不足');
  pl.sp -= cost; markUsed(pl, def); if (wdef) markUsed(pl, wdef);
  const boost = pl.boost; pl.boost = false;   // #38 的 ×3 只管下一张
  takeFromHand(pl, uid); if (wc) takeFromHand(pl, wc.uid);
  const it            = { card, owner: player, x: a.x, choice: a.choice, qteHits: a.qteHits, targetUid: a.targetUid, wind: a.wind, formulaOk: a.formulaOk,
    mult: dormMult(s, player, def, boost), with: wc, withMult: wdef ? dormMult(s, player, wdef, boost) : undefined };
  // 攻击牌指定摧毁对方的 #9：先摧毁，这张 #9 不再因这次出牌计数（补充裁定四）
  const hitsFifth = def.type === 'attack' && s.players[other(player)].field.some((f) => f.card.uid === a.targetUid && f.card.defId === 'XHS-009') ? a.targetUid : undefined;
  s.log.push(`P${player} 打出 ${def.name}${wdef ? ` + ${wdef.name}` : ''}${a.x !== undefined && def.x ? `（X=${a.x}）` : ''}${free ? '（朝圣者，免费）' : cost ? `，花费 ${cost} SP` : ''}`);
  tickFifthDay(s, hitsFifth); if (wc) tickFifthDay(s, hitsFifth);
  s.stack.push(it);
  const o = other(player);
  if (def.freeCounterAttack && s.players[o].hand.some((c) => ctx.cards[c.defId].status !== 'deleted'))
    s.phase = { kind: 'response', active, responder: o, free: true };
  else if (shouldOpenWindow(s, o, def, ctx, a.choice)) s.phase = { kind: 'response', active, responder: o };
  else { settle(s, s.stack.pop() , ctx); resume(s, active); }
}

export function apply(state           , a        , ctx     )            {
  const s = clone(state);
  const ph = s.phase;
  if (ph.kind === 'over') throw new RuleError('对局已结束');
  const pl = s.players[a.player];

  if (a.type === 'discard') { pl.discard.push(takeFromHand(pl, a.uid)); return s; } // 随时可弃（A4）

  if (ph.kind === 'select') {
    if (a.player !== ph.chooser) throw new RuleError('现在不是你选牌');
    const pd = s.pending ;
    if (pd.reason === 'superman') {
      if (a.type !== 'give_card') throw new RuleError('请选一张手牌交给对方');
      s.players[other(a.player)].hand.push(takeFromHand(pl, a.uid));
    } else {
      if (a.type !== 'pick') throw new RuleError('请从弃掉的牌里选一张，或不拿');
      if (a.uid !== undefined) {
        if (!pd.options.includes(a.uid)) throw new RuleError('只能从这次弃掉的牌里拿');
        const src = s.players[other(a.player)].discard, i = src.findIndex((c) => c.uid === a.uid);
        if (i >= 0) pl.hand.push(src.splice(i, 1)[0]);
      }
    }
    s.pending = undefined;
    if (s.stack[s.stack.length - 1]?.deferred) settle(s, s.stack.pop() , ctx);   // 等选牌的 #62/#63 现在结算
    resume(s, ph.active); return s;
  }

  if (ph.kind === 'interject') {   // #41 朝圣者
    if (a.player !== ph.responder) throw new RuleError('现在不是你响应');
    if (a.type === 'pass') { s.phase = { kind: 'play', active: ph.active }; return s; }
    if (a.type !== 'play') throw new RuleError('只能打出朝圣者或放弃');
    if (ph.step === 'offer') {
      const c = pl.hand.find((h) => h.uid === a.uid); if (!c || c.defId !== 'XHS-041') throw new RuleError('这里只能打出朝圣者');
      pay(pl, ctx.cards['XHS-041'], undefined, c.uid); pl.discard.push(takeFromHand(pl, c.uid)); tickFifthDay(s);
      s.log.push(`P${a.player} 打出 朝圣者，可以免费再打出 1 张牌`);
      s.phase = { kind: 'interject', active: ph.active, responder: ph.responder, step: 'play' };
      return s;
    }
    mainPlay(s, a.player, a, ph.active, ctx, true);   // 朝圣者给的那一张不耗 SP（补充裁定四）
    return s;
  }

  if (ph.kind === 'response') {
    if (a.player !== ph.responder) throw new RuleError('现在不是你响应');
    const top = s.stack[s.stack.length - 1];
    if (a.type === 'pass') { settle(s, s.stack.pop() , ctx); resume(s, ph.active); return s; }
    if (a.type !== 'play') throw new RuleError('响应窗口只能反制或放弃');
    const card = pl.hand.find((c) => c.uid === a.uid); if (!card) throw new RuleError('手牌里没有这张');
    const def = ctx.cards[card.defId];
    const canCounter = counters(def, ctx.cards[top.card.defId], top.choice);
    if (ph.free && !canCounter) {
      // #62/#63 的免费出牌：打出任意 1 张手牌，不耗 SP，先结算它，再结算 #62/#63
      checkPlayable(pl, def, card.uid);
      takeFromHand(pl, a.uid); tickFifthDay(s);
      s.log.push(`P${a.player} 免费打出 ${def.name}（先于 ${ctx.cards[top.card.defId].name} 结算）`);
      settle(s, { card, owner: a.player, x: a.x, choice: a.choice, qteHits: a.qteHits, targetUid: a.targetUid, wind: a.wind, formulaOk: a.formulaOk }, ctx);
      if (s.pending) { top.deferred = true; resume(s, ph.active); return s; }   // 免费牌要选牌：先选完，再结算 #62/#63
      settle(s, s.stack.pop() , ctx);
      resume(s, ph.active);
      return s;
    }
    if (!canCounter) throw new RuleError('这张牌不能反制它');
    if (ph.free) { checkPlayable(pl, def, card.uid); takeFromHand(pl, a.uid); markUsed(pl, def); }
    else { pay(pl, def, a.x, card.uid); takeFromHand(pl, a.uid); }
    tickFifthDay(s);
    const resp            = { card, owner: a.player, x: a.x, choice: a.choice, qteHits: a.qteHits };
    const tname = ctx.cards[top.card.defId].name, pl2 = s.players[a.player];
    applyEffects(s, def.counter .onCounter ?? [], resp, ctx);
    if (def.counter .absorb) {   // #9：只抵消 N 点伤害，攻击照常结算
      top.absorb = (top.absorb ?? 0) + def.counter .absorb;
      const hp0 = pl2.hp;
      settle(s, s.stack.pop() , ctx);
      s.log.push(`P${a.player} 打出 ${def.name} 响应，抵消 ${def.counter .absorb} 点伤害（${tname} 造成 ${Math.max(0, hp0 - pl2.hp)} 点）`);
      pl2.discard.push(card);
    } else {
      top.cancelled = true;                                   // 防御 / 无效化：栈顶那张作废
      s.log.push(def.counter .mode === 'negate' ? `P${a.player} 打出 ${def.name}，让 ${tname} 无效` : `P${a.player} 打出 ${def.name}，挡住了 ${tname}`);
      settle(s, s.stack.pop() , ctx);                         // 被反制的牌进弃牌堆，不结算
      (def.returnsToHand ? pl2.hand : pl2.discard).push(card); // 防御牌不能被反防（直接落地）
    }
    resume(s, ph.active);
    return s;
  }

  if (a.player !== ph.active) throw new RuleError('现在不是你的出牌阶段');
  if (a.type === 'end_phase') { endPhase(s, a.player, ctx); return s; }
  if (a.type !== 'play') throw new RuleError('非法动作');
  mainPlay(s, a.player, a, ph.active, ctx);
  return s;
}

// 玩家视角：对手手牌和双方牌库只给数量；弃牌堆、效果区、阵营公开（§10）；不下发随机种子
export function viewFor(s           , p          ) {
  const { rng, ...rest } = s;
  return { ...rest, self: p, players: s.players.map((pl, q) => ({ ...pl, deck: pl.deck.length,
    hand: q === p ? pl.hand : pl.hand.length,
    suppressed: q === p ? pl.suppressed : pl.suppressed.length })) };   // 对手被压制的是哪张不下发
}

// 出牌提示：这张手牌现在能不能打、要付多少 SP。只读 state.players[seat]、phase、stack，
// 所以 viewFor() 给客户端的视图也能直接传进来（客户端和引擎用同一套判定）。
                                                                                                                                                   
export function canPlay(s                                                         , seat          , uid        , ctx     )           {
  const ph = s.phase, pl = s.players[seat]               ;
  const card = Array.isArray(pl?.hand) ? pl.hand.find((c) => c.uid === uid) : undefined;
  if (!card) return { ok: false, cost: 0, reason: '手牌里没有这张' };
  const def = ctx.cards[card.defId];
  if (!def) return { ok: false, cost: 0, reason: '未知的牌' };
  const no = (reason        , cost = 0)           => ({ ok: false, cost, reason });
  const check = ()                     => { try { checkPlayable(pl, def, uid); } catch (e) { return (e         ).message; } };
  const cost = def.x ? def.x.min : baseCost(pl, def);
  const afford = (c        ) => c <= pl.sp ? undefined : `费用不足：需要 ${c} SP，当前 ${pl.sp}`;
  if (ph.kind === 'over') return no('对局已结束');
  if (ph.kind === 'select') {
    if (ph.chooser !== seat) return no('等对方选牌');
    return ph.reason === 'superman' ? { ok: true, cost: 0, mode: 'give', note: '点击交给对方' } : no('请从对方弃掉的牌里选');
  }
  if (ph.kind === 'interject') {
    if (ph.responder !== seat) return no('不是你的出牌阶段');
    if (ph.step === 'offer') {
      if (def.id !== 'XHS-041') return no('现在只能打出 朝圣者');
      const r = check() ?? afford(cost); return r ? no(r, cost) : { ok: true, cost, mode: 'interject' };
    }
    const r = check(); return r ? no(r) : { ok: true, cost: 0, mode: 'main', note: '朝圣者：这张免费' };
  }
  if (ph.kind === 'response') {
    if (ph.responder !== seat) return no('对方正在响应');
    const top = s.stack[s.stack.length - 1], tdef = top && ctx.cards[top.card.defId];
    if (ph.free) { const r = def.status === 'deleted' ? '这张卡已删除' : pl.suppressed.includes(uid) ? '这张牌本回合被压制，不能打出' : undefined;
      return r ? no(r) : { ok: true, cost: 0, mode: 'free', note: '免费出牌' }; }
    if (!tdef || !counters(def, tdef, top.choice)) return no(def.counter ? `不能反制 ${tdef?.name ?? '这张牌'}` : '响应窗口只能打能反制的牌');
    const r = check() ?? afford(cost); return r ? no(r, cost) : { ok: true, cost, mode: 'response', note: def.counter?.absorb ? `抵消 ${def.counter.absorb} 点伤害` : undefined };
  }
  if (ph.active !== seat) return no('不是你的出牌阶段');
  const r = check() ?? afford(cost); if (r) return no(r, cost);
  const note = def.type === 'defense' && !def.effects.length ? '防御牌：主动打出没有效果，通常留着响应'
    : def.id === 'XHS-041' ? '朝圣者要在对方出牌阶段开始时打，现在打无效果'
    : def.id === 'XHS-067' ? '意见箱要和另一张牌同时打出' : def.x ? `X 费：${def.x.min}–${Math.min(def.x.max, pl.sp)}` : undefined;
  return { ok: true, cost, mode: 'main', note };
}
