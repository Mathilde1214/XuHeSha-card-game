// 续禾杀 最简网页客户端：状态全部来自服务端的 viewFor()，客户端只发意图（protocol-v1）
import { fx } from './fx.js';
import { canPlay, WIND_ZH as WIND } from './engine.js';   // engine.js 由 client/build.ts 生成
const $ = (id) => document.getElementById(id);
const FACTION = { sweet: '甜粽党', savory: '肉粽党' };
const TYPE = { attack: '攻击', defense: '防御', resource: '资源', effect: '效果' };
const COMBOS = { 'XHS-032': ['XHS-060'], 'XHS-055': ['XHS-045'], 'XHS-057': ['XHS-038'], 'XHS-058': ['XHS-038'] };
const HELPERS = new Set(['XHS-060', 'XHS-045', 'XHS-038', 'XHS-067']);
// 和房间服务同端口时走 /ws；单独用 5173 开发服务时连 8787（?ws= 可改端口）
const WS_URL = location.port === '5173' || new URLSearchParams(location.search).get('ws')
  ? `ws://${location.hostname}:${new URLSearchParams(location.search).get('ws') ?? 8787}/ws` : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

let defs = {}, ws, view = null, seat = null, seq = 1, waiting = false, deadline = 0, timerPhase = '', clockOffset = 0;
const logLines = [];
let pendingPlay = null;

const img = (defId) => `cards/${defId}.jpg`;
const nameOf = (defId) => defs[defId]?.name ?? defId;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => (t.style.display = 'none'), 2600); }
function send(m) { ws?.readyState === 1 && ws.send(JSON.stringify(m)); }
function act(action) { pendingPlay = action.type === 'play' ? me().hand.find(c => c.uid === action.uid)?.defId : null; send({ t: 'action', seq: seq++, action }); }

// ---------- 连接 / 重连 ----------
// 凭证存两份：sessionStorage 是本标签页的（刷新后直接接管座位），
// localStorage 里存最近 10 个（关掉标签页再打开时，服务端只接回不在线的座位，两个标签页本地对打也不会抢座）
const TK = 'xhs-token', TKS = 'xhs-tokens';
const tokenList = () => { try { return JSON.parse(localStorage.getItem(TKS) ?? '[]'); } catch { return []; } };
function saveToken(tk) { sessionStorage.setItem(TK, tk); localStorage.setItem(TKS, JSON.stringify([tk, ...tokenList().filter((x) => x !== tk)].slice(0, 10))); }
function dropToken(tk = sessionStorage.getItem(TK)) { sessionStorage.removeItem(TK); if (tk) localStorage.setItem(TKS, JSON.stringify(tokenList().filter((x) => x !== tk))); }
let kicked = false, lostAt = 0, rematchVotes = [false, false], oppLeft = false;
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    if (lostAt) { toast('已重新连上服务器'); lostAt = 0; }
    const tk = sessionStorage.getItem(TK), list = tokenList();
    if (tk || list.length) send({ t: 'resume', token: tk ?? undefined, tokens: list });
    send({ t: 'ping' });
  };
  ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  ws.onclose = () => {
    if (kicked) return;
    if (!lostAt) { lostAt = Date.now(); toast('和服务器断开，正在重连…（1 分钟内连回来可以接着打）'); }
    setTimeout(connect, 1500);
  };
}
function backToLobby(msg) {
  stateEpoch++; stateChain = Promise.resolve();
  view = null; seat = null; waiting = false; deadline = 0; logLines.length = 0; rematchVotes = [false, false]; oppLeft = false;
  clearPreview(); closeCardReader(); pendingPlay = null;
  closeModal(); $('game').hidden = true; $('lobby').hidden = false; $('lobby-start').hidden = false; $('lobby-room').hidden = true; $('faction').hidden = true;
  if (msg) toast(msg);
}
setInterval(() => send({ t: 'ping' }), 8000);

function onMsg(m) {
  switch (m.t) {
    case 'pong': clockOffset = m.serverTime - Date.now(); break;
    case 'room': stateEpoch++; stateChain = Promise.resolve(); seat = m.seat; saveToken(m.token); $('lobby-start').hidden = true; $('lobby-room').hidden = false;
      $('room-code').textContent = m.code; $('room-heading').textContent = m.resumed ? '已回到房间' : m.seat === 0 ? '房间已创建' : '已加入房间';
      $('lobby-self-label').textContent = '我 · 已加入';
      $('lobby-wait-hint').hidden = false;
      setLobbyFriend(m.opponent?.online ?? m.seat === 1);
      $('lobby-msg').textContent = '等待好友加入…';
      if (m.resumed) { rematchVotes = m.rematch ?? [false, false]; if (m.opponent && !m.opponent.online) toast('对手现在不在线，等他重连'); }
      break;
    case 'lobby':
      if (m.game) { stateEpoch++; stateChain = Promise.resolve(); }
      if (m.game) { view = null; waiting = false; deadline = 0; logLines.length = 0; rematchVotes = [false, false]; closeModal(); $('game').hidden = true; $('lobby').hidden = false; $('lobby-start').hidden = true; $('lobby-room').hidden = false; }
      setLobbyFriend(true); $('lobby-self-label').textContent = '我 · 已加入'; $('lobby-wait-hint').hidden = true;
      $('lobby-msg').textContent = m.game ? `第 ${m.game + 1} 局：请重新选阵营` : '双方都到了，请选阵营'; $('faction').hidden = false; break;
    case 'rematch': rematchVotes = m.votes; if (m.votes[1 - seat] && !m.votes[seat]) toast('对手想再来一局'); if (view) render(); break;
    case 'room_closed': dropToken(); backToLobby(oppLeft ? '对手离开了，房间已关闭' : '房间已关闭'); break;
    case 'kicked': kicked = true; dropToken(); backToLobby(); $('lobby-start').hidden = true; $('lobby-room').hidden = false; $('lobby-msg').textContent = '这个座位已经在别的页面打开了，这个页面不再连接。'; break;
    case 'ack': if (m.what === 'pick_faction') { $('faction').hidden = true; $('lobby-msg').textContent = '已选阵营，等待好友选择…'; $('lobby-self-label').textContent = '我 · 已准备'; } break;
    case 'reject':
      pendingPlay = null;
      if (m.code === 'resume_failed') { const had = sessionStorage.getItem(TK); dropToken(); localStorage.removeItem(TKS); if (view || had) backToLobby('原来的房间已经关闭了'); break; }
      toast(m.reason ?? '操作被拒绝'); break;
    case 'state': { const epoch = stateEpoch; stateChain = stateChain.then(() => onState(m, epoch)).catch((e) => console.error(e)); break; }
    case 'waiting': waiting = true; render(); break;
    case 'timer': deadline = m.deadline; timerPhase = m.phase; break;
    case 'opponent': if (!view) setLobbyFriend(m.online && !m.left, !m.left); if (m.left) { oppLeft = true; toast('对手离开了房间'); } else toast(m.online ? '对手已重新连上' : '对手掉线了，1 分钟内没回来判负'); break;
    case 'hidden_pick': return hiddenPick(m);
    case 'qte_start': return qte(m);
    case 'formula_start': return formula(m);
    case 'qte_result': closeModal('flow'); toast(`QTE ${m.hits}/3，${m.pass ? '通过' : '未通过'}`); break;
    case 'formula_result': closeModal('flow'); toast(m.pass ? '公式全部正确' : `公式未全部匹配`); break;
  }
}

// 新状态：先给消失的效果区牌播摧毁动画，再重绘；HP 变化在重绘后播受伤 / 治疗
let stateChain = Promise.resolve();
let stateEpoch = 0; // 离开、重连或新一局后，旧状态与未完成动画不再更新页面
const fieldUids = (v) => new Set(v ? v.players.flatMap((pl) => pl.field.map((f) => f.card.uid)) : []);
async function onState(m, epoch) {
  if (epoch !== stateEpoch) return;
  const prev = view, gone = [...fieldUids(prev)].filter((u) => !fieldUids(m.view).has(u));
  if (prev && gone.length) await Promise.all(gone.map((u) => document.querySelector(`.field .card[data-uid="${u}"]`)).filter(Boolean).map((el) => fx.destroy(el)));
  if (epoch !== stateEpoch) return;
  view = m.view; waiting = false; pendingPlay = null; logLines.push(...(m.log ?? [])); $('lobby').hidden = true; $('game').hidden = false; closeModal('flow'); render();
  if (prev) for (const [q, id] of [[view.self, 'my-stats'], [1 - view.self, 'opp-stats']]) {
    const d = prev.players[q].hp - view.players[q].hp, el = $(id).querySelector('.hp');
    if (d && el) fx.hurt(el, d, { self: q === view.self });
  }
}
// 日志里的 P0 / P1 换成「你 / 对手」
const fmtLog = (l) => l.replace(/\bP([01])\b/g, (_, d) => (Number(d) === view.self ? '你' : '对手'));

// ---------- 渲染 ----------
const me = () => view.players[view.self];
const opp = () => view.players[1 - view.self];
const ph = () => view.phase;

function stats(pl, mine) {
  const pips = (kind, value, max) => Array.from({ length: Math.max(0, max) }, (_, i) => `<img src="icons/icon_${kind}.png" class="stat-icon ${i < value ? '' : 'spent'}" alt="">`).join('');
  return `<strong class="player-name">${mine ? '我' : '对手'} · ${FACTION[pl.faction]}</strong>
    <span class="hp"><img class="stat-icon" src="icons/icon_hp.png" alt=""> HP <b>${pl.hp}</b>/${pl.maxHp} <span class="pips" aria-hidden="true">${pips('hp', pl.hp, pl.maxHp)}</span></span>
    <span class="sp"><img class="stat-icon" src="icons/icon_sp.png" alt=""> SP <b>${pl.sp}</b>/7 <span class="pips" aria-hidden="true">${pips('sp', pl.sp, 7)}</span></span>
    ${pl.skipPhases ? `<small>还要跳过 ${pl.skipPhases} 个出牌阶段</small>` : ''}${pl.boost ? '<small>下一张宿舍加成 ×3</small>' : ''}`;
}
function piles(pl) {
  return `<div class="pile deck"><span>牌库</span><b>${pl.deck}</b></div><div class="pile"><span>弃牌</span><b>${pl.discard.length}</b></div>`;
}
function inspectCard(defId, hint = '') {
  const d = defs[defId]; if (!d) return;
  const picture = $('preview-image'); picture.src = img(defId); picture.alt = d.name; picture.hidden = false;
  $('preview-empty').hidden = true;
  const detail = $('card-detail'); detail.replaceChildren();
  const title = document.createElement('h3'); title.textContent = d.name;
  const type = document.createElement('span'); type.className = `type-label ${d.type}`;
  type.textContent = `${TYPE[d.type]}牌 · ${d.x ? 'X' : d.cost} SP`;
  const description = document.createElement('p'); description.textContent = d.text ?? '';
  const help = document.createElement('p'); help.className = 'muted'; help.textContent = hint;
  detail.append(title, type, description, help);
}
function clearPreview() {
  $('preview-image').hidden = true; $('preview-image').removeAttribute('src');
  $('preview-empty').hidden = false;
  $('card-detail').innerHTML = '<p class="muted">悬停或聚焦卡牌查看详情</p>';
}
function bindPreview(el, defId) {
  el.onmouseenter = () => inspectCard(defId, el.dataset.hint ?? '');
  el.onmouseleave = clearPreview;
  el.onfocus = () => { if (el.matches(':focus-visible')) inspectCard(defId, el.dataset.hint ?? ''); };
  el.onblur = clearPreview;
}
let readerTrigger = null;
function openCardReader(defId, trigger) {
  const d = defs[defId]; if (!d) return;
  readerTrigger = trigger;
  $('reader-image').src = img(defId); $('reader-image').alt = d.name;
  $('reader-title').textContent = d.name; $('reader-text').textContent = d.text ?? '';
  $('card-reader').hidden = false; $('reader-close').focus();
}
function closeCardReader() {
  $('card-reader').hidden = true;
  if (readerTrigger?.isConnected) readerTrigger.focus();
  readerTrigger = null;
  clearPreview();
}
function renderLog() {
  const log = $('log'); log.replaceChildren();
  const cards = Object.values(defs).filter(d => d.name).sort((a,b) => b.name.length - a.name.length);
  for (const line of logLines.slice(-80)) {
    const row = document.createElement('div'); let rest = fmtLog(line);
    while (rest) {
      let match = null, start = rest.length;
      for (const d of cards) { const i = rest.indexOf(d.name); if (i >= 0 && (i < start || (i === start && !match))) { start = i; match = d; } }
      if (!match) { row.append(rest); break; }
      row.append(rest.slice(0, start));
      const link = document.createElement('button'); link.className = 'log-card'; link.textContent = match.name;
      link.dataset.def = match.id; link.title = '查看原卡与效果';
      bindPreview(link, match.id); link.onclick = () => openCardReader(link.dataset.def, link);
      row.append(link); rest = rest.slice(start + match.name.length);
    }
    log.append(row);
  }
  log.scrollTop = 1e9;
}
function waitingText() {
  const p = ph();
  if (waiting) return pendingPlay && defs[pendingPlay]?.type === 'attack' ? '等待对手防御中' : '等待对手响应或完成操作';
  if (p.kind === 'response') {
    if (p.responder === view.self) return p.free ? '请选择一张牌免费响应，或放弃' : '请选择防御或反制牌，或放弃响应';
    return p.free ? '等待对手免费出牌响应' : '等待对手防御中';
  }
  if (p.kind === 'interject') return p.responder === view.self ? '请选择朝圣者响应，或放弃' : '等待对手朝圣者响应';
  if (p.kind === 'select' && p.chooser !== view.self) return '等待对手选牌';
  return '';
}
function cardEl(defId, { cls = '', badge = '', tag = '', onclick, uid } = {}) {
  const d = document.createElement('div'); d.className = `card ${cls}`; d.dataset.def = defId; if (uid !== undefined) d.dataset.uid = uid;
  d.innerHTML = `<img src="${img(defId)}" alt="${nameOf(defId)}">${badge ? `<span class="x">${badge}</span>` : ''}${tag ? `<span class="tag">${tag}</span>` : ''}`;
  d.tabIndex = 0;
  bindPreview(d, defId);
  if (onclick) { d.onclick = onclick; d.setAttribute('role', 'button'); d.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onclick(); } }; }
  return d;
}
function fieldEl(container, pl, ownerSelf) {
  container.innerHTML = `<span class="field-title">${ownerSelf ? '我的' : '对方'}效果区</span>`;
  if (!pl.field.length) container.insertAdjacentHTML('beforeend', '<span class="field-empty">暂无持续效果</span>');
  for (const f of pl.field) {
    const by = f.owner === view.self ? '我放的' : '对手放的';
    const extra = [f.roundsLeft ? `剩 ${f.roundsLeft} 回合` : '', f.card.defId === 'XHS-009' ? `${f.count ?? 0}/5` : ''].filter(Boolean).join(' ');
    container.appendChild(cardEl(f.card.defId, { badge: extra, tag: by, uid: f.card.uid }));
  }
}

function phaseText() {
  const p = ph(), mine = (who) => who === view.self;
  if (p.kind === 'over') return `<div class="over">${p.winner === 'draw' ? '平局' : mine(p.winner) ? '你赢了！' : '你输了'}</div>`;
  if (p.kind === 'play') return mine(p.active) ? '<span class="big">你的出牌阶段</span><br>点手牌出牌，打完点“结束阶段”' : '<span class="big">对手出牌中</span>';
  if (p.kind === 'response') {
    const top = view.stack.at(-1); const nm = top ? nameOf(top.card.defId) : '';
    if (mine(p.responder)) return p.free ? `<span class="big">免费出牌</span><br>对方打出〈${nm}〉，你可以免费打出任意 1 张手牌（防御牌可以直接挡掉它）` : `<span class="big">响应窗口</span><br>对方打出〈${nm}〉，选一张能反制的牌，或放弃`;
    return `对方正在响应〈${nm}〉…`;
  }
  if (p.kind === 'interject') return mine(p.responder) ? (p.step === 'offer' ? '<span class="big">朝圣者</span><br>对方出牌阶段开始前，你可以打出〈朝圣者〉' : '<span class="big">朝圣者</span><br>再打出 1 张牌（照常付费）') : '对方在考虑要不要打〈朝圣者〉…';
  if (p.kind === 'select') {
    if (!mine(p.chooser)) return '等对方选牌…';
    return p.reason === 'superman' ? '<span class="big">Super Man</span><br>选 1 张手牌交给对方' : '<span class="big">数学周测</span><br>从对方弃掉的牌里拿 1 张，或不拿';
  }
  return '';
}

function render() {
  if (!view) return;
  const p = ph(), M = me(), O = opp();
  $('round-label').textContent = `第 ${view.round} 回合`;
  $('hand-count').textContent = `手牌 ${M.hand.length}/8`;
  $('opp-piles').innerHTML = piles(O); $('my-piles').innerHTML = piles(M);
  $('opp-stats').innerHTML = stats(O, false);
  $('my-stats').innerHTML = stats(M, true);
  const n = typeof O.hand === 'number' ? O.hand : O.hand.length;
  $('opp-hand').innerHTML = '<div class="back"></div>'.repeat(n);
  fieldEl($('opp-field'), O, false); fieldEl($('my-field'), M, true);
  $('status').innerHTML = `第 ${view.round} 回合 · 风向 <b>${WIND[view.wind]}</b><br>${phaseText()}<div class="response-notice" ${waitingText() ? '' : 'hidden'}>${waitingText()}</div><span id="clock"></span>`;
  $('stack').innerHTML = '';
  $('preview').hidden = view.stack.length > 0;
  const top = view.stack.at(-1); if (top) { $('stack').append('结算中：'); $('stack').appendChild(cardEl(top.card.defId)); }
  renderLog();

  // 手牌
  const hand = $('my-hand'); hand.innerHTML = '';
  for (const c of M.hand) {
    const sup = M.suppressed.includes(c.uid);
    const h = hintOf(c), acting = myTurnToAct();
    const el = cardEl(c.defId, { cls: `${sup ? 'dim' : ''} ${acting && h.ok ? 'playable' : ''}`, badge: acting && h.ok ? (h.cost ? `${h.cost} SP` : '免费') : '',
      tag: sup ? '被压制' : c.from !== undefined && c.from !== seat ? '对方放入' : '', onclick: () => onHandClick(c) });
    el.dataset.hint = h.ok ? `可以打出 · 需付 ${h.cost} SP${h.note ? ` · ${h.note}` : ''}` : `不能打出：${h.reason}`;
    if (acting) fx.playable(el, h.ok);
    el.oncontextmenu = (e) => { e.preventDefault(); if (confirm(`弃掉〈${nameOf(c.defId)}〉？`)) act({ type: 'discard', uid: c.uid }); };
    hand.appendChild(el);
  }
  // 按钮
  const A = $('actions'); A.innerHTML = '<span style="opacity:.6;font-size:12px">右键手牌 = 弃牌（随时可弃）</span> ';
  const btn = (txt, fn, cls = '') => { const b = document.createElement('button'); b.textContent = txt; b.className = cls; b.onclick = fn; A.appendChild(b); };
  if (p.kind === 'play' && p.active === view.self) btn('结束阶段', () => act({ type: 'end_phase' }));
  if ((p.kind === 'response' || p.kind === 'interject') && p.responder === view.self) btn('放弃', () => act({ type: 'pass' }), 'ghost');
  if (p.kind === 'select' && p.chooser === view.self && p.reason === 'math_quiz') mathQuiz(p);
  if (p.kind === 'over') {
    const mine = rematchVotes[view.self], theirs = rematchVotes[1 - view.self];
    if (!oppLeft) btn(mine ? '已申请再来一局，等对手确认（点击取消）' : theirs ? '对手想再来一局：同意' : '再来一局', () => send({ t: 'rematch', want: !mine }), mine ? 'ghost' : '');
    btn('离开房间', () => { send({ t: 'leave' }); dropToken(); backToLobby(); }, 'ghost');
  } else btn('认输离开', () => { if (confirm('现在离开算认输，确定吗？')) { send({ t: 'leave' }); dropToken(); backToLobby(); } }, 'ghost');
  clearPreview();
}
setInterval(() => { const c = $('clock'); if (c && waiting) { c.textContent = '响应结束后继续出牌计时'; return; } if (c && deadline && view?.phase.kind !== 'over') { const s = Math.max(0, Math.ceil((deadline - Date.now() - clockOffset) / 1000)); c.textContent = `倒计时 ${s} 秒`; } }, 250);

// ---------- 出牌 ----------
const hintOf = (c) => { try { return canPlay(view, view.self, c.uid, { cards: defs }); } catch (e) { return { ok: false, cost: 0, reason: String(e.message ?? e) }; } };
function myTurnToAct() {
  const p = ph(); if (waiting) return false;
  return (p.kind === 'play' && p.active === view.self) || ((p.kind === 'response' || p.kind === 'interject') && p.responder === view.self)
    || (p.kind === 'select' && p.chooser === view.self && p.reason === 'superman');
}
function onHandClick(c) {
  const p = ph(), d = defs[c.defId];
  if (p.kind === 'select' && p.chooser === view.self && p.reason === 'superman') return act({ type: 'give_card', uid: c.uid });
  if (p.kind === 'interject' && p.responder === view.self && p.step === 'offer') return act({ type: 'play', uid: c.uid });
  const canMain = (p.kind === 'play' && p.active === view.self) || (p.kind === 'interject' && p.responder === view.self && p.step === 'play');
  const canResp = p.kind === 'response' && p.responder === view.self;
  if (!canMain && !canResp) return toast('现在不能出这张牌');
  const h = hintOf(c);
  const discount = canMain && !d.variableCost && !d.x && d.id !== 'XHS-067'
    ? me().hand.find((m) => m.defId === 'XHS-067' && hintOf(m).ok) : undefined;
  const discounted = discount && canPlay({ ...view, players: view.players.map((pl, i) => i === view.self ? { ...pl, sp: pl.sp + 2 } : pl) }, view.self, c.uid, { cards: defs });
  if (!h.ok && !discounted?.ok) return toast(`不能打出：${h.reason}`);
  playDialog(c, d, canMain, !h.ok ? discount.uid : undefined);
}

const hasOp = (effs, op) => effs.some((e) => e.op === op || (e.op === 'choice' && e.options.some((o) => hasOp(o, op))) || (e.then && hasOp(e.then, op)));
const custom = (d, key) => d.effects.some((e) => e.op === 'custom' && e.key === key);
function descEffects(list) {
  return list.map((e) => e.op === 'draw' ? `抽 ${e.count} 张` : e.op === 'damage' ? `${e.target === 'self' ? '自己' : '对方'} HP-${e.amount}` : e.op === 'heal' ? `HP+${e.amount}` : e.op === 'sp' ? `SP${e.delta > 0 ? '+' : ''}${e.delta}` : e.op).join('，');
}

function playDialog(c, d, main, selectedMate) {
  const M = me(), O = opp();
  const choice = d.effects.find((e) => e.op === 'choice');
  const needWind = custom(d, 'change_wind');
  const fieldTargets = [];
  if (custom(d, 'remove_from_my_zone')) for (const f of M.field) if (f.owner !== view.self) fieldTargets.push(f);
  if (d.type === 'attack') for (const f of O.field) if (f.card.defId === 'XHS-009') fieldTargets.push(f);
  if (custom(d, 'burn_flammable')) for (const f of O.field) if (defs[f.card.defId].tags?.includes('flammable') && !fieldTargets.includes(f)) fieldTargets.push(f);
  const mates = main ? M.hand.filter((h) => h.uid !== c.uid && (
    (COMBOS[d.id] ?? []).includes(h.defId) || (COMBOS[h.defId] ?? []).includes(d.id) ||
    (h.defId === 'XHS-067' && !d.variableCost && !d.x) || (d.id === 'XHS-067' && !HELPERS.has(h.defId) && !defs[h.defId].variableCost && !defs[h.defId].x))) : [];
  if (!choice && !d.x && !needWind && !fieldTargets.length && !mates.length) return act({ type: 'play', uid: c.uid });

  let html = `<h3>打出〈${d.name}〉</h3><div style="opacity:.8">${d.text ?? ''}</div>`;
  if (d.x) html += `<label>X = <input type="number" id="f-x" min="${d.x.min}" max="${d.x.max}" value="${d.x.min}">（${d.x.min}–${d.x.max}，费用就是 X）</label>`;
  if (choice) html += `<label>选项：${choice.options.map((o, i) => `<label style="display:inline;margin-right:12px"><input type="radio" name="f-choice" value="${i}" ${i === 0 ? 'checked' : ''}> ${descEffects(o)}</label>`).join('')}</label>`;
  if (needWind) html += `<label>改成：<select id="f-wind"><option value="tail">顺风</option><option value="calm">无风</option><option value="head">逆风</option></select></label>`;
  if (fieldTargets.length) html += `<label>指定效果区的牌：<select id="f-target"><option value="">不指定</option>${fieldTargets.map((f) => `<option value="${f.card.uid}">${nameOf(f.card.defId)}${f.card.defId === 'XHS-009' ? '（用这次攻击摧毁它）' : ''}</option>`).join('')}</select></label>`;
  if (mates.length) html += `<label>同时打出：<select id="f-with"><option value="">不组合</option>${mates.map((h) => `<option value="${h.uid}">${nameOf(h.defId)}</option>`).join('')}</select></label>`;
  html += `<div><button id="f-ok">打出</button><button class="ghost" id="f-cancel">取消</button></div>`;
  openModal(html, 'dialog');
  if (mates.length) {
    if (selectedMate !== undefined) $('f-with').value = String(selectedMate);
    $('f-with').onchange = () => {
      const mate = mates.find((m) => String(m.uid) === $('f-with').value);
      if (mate && HELPERS.has(d.id) && !HELPERS.has(mate.defId)) playDialog(mate, defs[mate.defId], main, c.uid);
    };
  }
  $('f-cancel').onclick = () => closeModal();
  $('f-ok').onclick = () => {
    const a = { type: 'play', uid: c.uid };
    if (d.x) a.x = Number($('f-x').value);
    if (choice) a.choice = Number(document.querySelector('input[name=f-choice]:checked').value);
    if (needWind) a.wind = $('f-wind').value;
    if (fieldTargets.length && $('f-target').value) a.targetUid = Number($('f-target').value);
    if (mates.length && $('f-with').value) a.withUid = Number($('f-with').value);
    closeModal(); act(a);
  };
}

function mathQuiz(p) {
  const O = opp(); const opts = (p.options ?? []).map((uid) => O.discard.find((c) => c.uid === uid)).filter(Boolean);
  let html = '<h3>数学周测：拿 1 张</h3><div class="opts" id="mq"></div><button class="ghost" id="mq-no">不拿</button>';
  openModal(html, 'flow');
  for (const c of opts) $('mq').appendChild(cardEl(c.defId, { onclick: () => { closeModal(); act({ type: 'pick', uid: c.uid }); } }));
  $('mq-no').onclick = () => { closeModal(); act({ type: 'pick' }); };
}

// ---------- 服务端判定流程 ----------
function hiddenPick(m) {
  openModal(`<h3>选对方 1 张牌（背面）</h3><div class="opts" id="hp"></div>`, 'flow');
  m.handles.forEach((h, i) => { const b = document.createElement('div'); b.className = 'back'; b.style.cssText = 'width:80px;height:112px;cursor:pointer'; b.title = `第 ${i + 1} 张`;
    b.onclick = () => { closeModal(); send({ t: 'hidden_pick_reply', pickId: m.pickId, handle: h }); }; $('hp').appendChild(b); });
}
function qte(m) {
  const off = m.serverTime - Date.now();
  openModal(`<h3>QTE：圆圈亮起时按下（空格也行），3 次中 2 次就算通过</h3><div style="text-align:center"><button class="qte" id="qte-b">按</button><div id="qte-n"></div></div>`, 'flow');
  const hit = () => { const now = Date.now() + off; const r = m.windows.findIndex((w) => now >= w.start - 250 && now <= w.end + 250); if (r >= 0) { send({ t: 'qte_hit', qteId: m.qteId, round: r }); $('qte-n').textContent = `第 ${r + 1} 次已按`; } };
  $('qte-b').onclick = hit; document.onkeydown = (e) => { if (e.code === 'Space') { e.preventDefault(); hit(); } };
  const tick = setInterval(() => { const b = $('qte-b'); if (!b) { clearInterval(tick); document.onkeydown = null; return; }
    const now = Date.now() + off; b.classList.toggle('on', m.windows.some((w) => now >= w.start && now <= w.end)); }, 30);
}
function formula(m) {
  openModal(`<h3>Physics：写出 3 条物理公式</h3>${[0, 1, 2].map((i) => `<label><input id="fm${i}" style="width:320px" placeholder="例如 F=ma"></label>`).join('')}<button id="fm-ok">提交</button>`, 'flow');
  $('fm-ok').onclick = () => { send({ t: 'formula', qteId: m.qteId, lines: [0, 1, 2].map((i) => $('fm' + i).value) }); closeModal(); };
}

// ---------- 弹窗 / 悬停说明 ----------
let modalKind = '';
function openModal(html, kind) { $('modal-box').innerHTML = html; $('modal').hidden = false; modalKind = kind; }
function closeModal(kind) { if (kind && modalKind !== kind) return; $('modal').hidden = true; modalKind = ''; }
$('reader-close').onclick = closeCardReader;
$('card-reader').onclick = e => { if (e.target === $('card-reader')) closeCardReader(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('card-reader').hidden) { e.preventDefault(); closeCardReader(); } });

$('btn-lobby-rules').onclick = $('btn-rules').onclick = () => {
  openModal('<h2>课间对战指南</h2><p>初始 HP / SP 均为 7，手牌上限 8 张。自己的出牌阶段开始时 SP 恢复至 7。</p><p>点击手牌出牌；需要选择目标或组合时会弹出选项。右键手牌可以弃牌。</p><p>打完后点击「结束阶段」。攻击牌可在响应窗口内使用防御牌应对，也可以放弃。</p><p>双方完成出牌后，各抽 2 张。自己的出牌阶段结束时 HP ≤ 0 则失败。</p><button id="rules-close">知道了</button>', 'dialog');
  $('rules-close').onclick = () => closeModal();
};
// ---------- 大厅 ----------
$('btn-create').onclick = () => { sessionStorage.removeItem(TK); send({ t: 'create_room' }); };
$('join-form').onsubmit = e => { e.preventDefault(); sessionStorage.removeItem(TK); send({ t: 'join_room', code: $('in-code').value.trim() }); };
function setLobbyFriend(online, reconnecting = false) {
  $('lobby-friend-label').textContent = online ? '好友 · 已加入' : reconnecting ? '好友 · 等待重连' : '好友 · 等待加入';
  const avatar = $('friend-seat').querySelector('.seat-avatar'); avatar.textContent = online ? '友' : '?'; avatar.classList.toggle('empty', !online);
}
$('btn-copy-code').onclick = async () => {
  const code = $('room-code').textContent;
  try { await navigator.clipboard.writeText(code); toast('房间码已复制，发给朋友吧'); }
  catch { const range = document.createRange(); range.selectNodeContents($('room-code')); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); toast('房间码已选中，请手动复制'); }
};
$('btn-lobby-back').onclick = () => { send({ t: 'leave' }); dropToken(); backToLobby(); };

for (const b of document.querySelectorAll('#faction button')) b.onclick = () => send({ t: 'pick_faction', faction: b.dataset.f });

window.__xhs = { get view() { return view; }, get ws() { return ws; } };   // 联调/自动测试用
defs = await (await fetch('cards.json')).json();
connect();
