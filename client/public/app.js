// 续禾杀 最简网页客户端：状态全部来自服务端的 viewFor()，客户端只发意图（protocol-v1）
const $ = (id) => document.getElementById(id);
const WIND = { tail: '顺风', head: '逆风', calm: '无风' };
const FACTION = { sweet: '甜粽党', savory: '肉粽党' };
const TYPE = { attack: '攻击', defense: '防御', resource: '资源', effect: '效果' };
const COMBOS = { 'XHS-032': ['XHS-060'], 'XHS-055': ['XHS-045'], 'XHS-057': ['XHS-038'], 'XHS-058': ['XHS-038'] };
const HELPERS = new Set(['XHS-060', 'XHS-045', 'XHS-038', 'XHS-067']);
// 和房间服务同端口时走 /ws；单独用 5173 开发服务时连 8787（?ws= 可改端口）
const WS_URL = location.port === '5173' || new URLSearchParams(location.search).get('ws')
  ? `ws://${location.hostname}:${new URLSearchParams(location.search).get('ws') ?? 8787}/ws` : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

let defs = {}, ws, view = null, seat = null, seq = 1, waiting = false, deadline = 0, timerPhase = '', clockOffset = 0;
const logLines = [];

const img = (defId) => `cards/${defId}.jpg`;
const nameOf = (defId) => defs[defId]?.name ?? defId;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => (t.style.display = 'none'), 2600); }
function send(m) { ws?.readyState === 1 && ws.send(JSON.stringify(m)); }
function act(action) { send({ t: 'action', seq: seq++, action }); }

// ---------- 连接 ----------
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { const tk = sessionStorage.getItem('xhs-token'); if (tk) send({ t: 'resume', token: tk, lastVer: 0 }); send({ t: 'ping' }); };
  ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  ws.onclose = () => { toast('和服务器断开，3 秒后重连'); setTimeout(connect, 3000); };
}
setInterval(() => send({ t: 'ping' }), 8000);

function onMsg(m) {
  switch (m.t) {
    case 'pong': clockOffset = m.serverTime - Date.now(); break;
    case 'room': seat = m.seat; sessionStorage.setItem('xhs-token', m.token); $('lobby-start').hidden = true; $('lobby-room').hidden = false;
      $('room-code').textContent = m.code; $('lobby-msg').textContent = `你是 ${m.seat + 1} 号位，等待对手加入…`; break;
    case 'lobby': $('lobby-msg').textContent = '双方都到了，请选阵营'; $('faction').hidden = false; break;
    case 'ack': if (m.what === 'pick_faction') { $('faction').hidden = true; $('lobby-msg').textContent = '已选阵营，等待对手…'; } break;
    case 'reject':
      if (/重连凭证/.test(m.reason ?? '')) { sessionStorage.removeItem('xhs-token'); break; }
      toast(m.reason ?? '操作被拒绝'); break;
    case 'state': view = m.view; waiting = false; logLines.push(...(m.log ?? [])); $('lobby').hidden = true; $('game').hidden = false; closeModal('flow'); render(); break;
    case 'waiting': waiting = true; render(); break;
    case 'timer': deadline = m.deadline; timerPhase = m.phase; break;
    case 'opponent': toast(m.online ? '对手已重新连上' : '对手掉线了，1 分钟内没回来判负'); break;
    case 'hidden_pick': return hiddenPick(m);
    case 'qte_start': return qte(m);
    case 'formula_start': return formula(m);
    case 'qte_result': closeModal('flow'); toast(`QTE ${m.hits}/3，${m.pass ? '通过' : '未通过'}`); break;
    case 'formula_result': closeModal('flow'); toast(m.pass ? '公式全部正确' : `公式未全部匹配`); break;
  }
}

// ---------- 渲染 ----------
const me = () => view.players[view.self];
const opp = () => view.players[1 - view.self];
const ph = () => view.phase;

function stats(pl, mine) {
  return `<span>${mine ? '我' : '对手'}（${FACTION[pl.faction]}）</span>
    <span>HP <b class="hp">${pl.hp}</b>/${pl.maxHp}</span><span>SP <b>${pl.sp}</b></span>
    <span>牌库 ${pl.deck}</span><span>弃牌堆 ${pl.discard.length}</span>
    ${pl.skipPhases ? `<span>还要跳过 ${pl.skipPhases} 个出牌阶段</span>` : ''}${pl.boost ? '<span>下一张宿舍加成 ×3</span>' : ''}
    ${!mine && (typeof pl.hand === 'number' ? pl.hand : pl.hand.length) >= 0 ? `<span>手牌 ${typeof pl.hand === 'number' ? pl.hand : pl.hand.length} 张</span>` : ''}`;
}
function cardEl(defId, { cls = '', badge = '', tag = '', onclick } = {}) {
  const d = document.createElement('div'); d.className = `card ${cls}`; d.dataset.def = defId;
  d.innerHTML = `<img src="${img(defId)}" alt="${nameOf(defId)}">${badge ? `<span class="x">${badge}</span>` : ''}${tag ? `<span class="tag">${tag}</span>` : ''}`;
  if (onclick) d.onclick = onclick;
  return d;
}
function fieldEl(container, pl, ownerSelf) {
  container.innerHTML = `<span style="opacity:.7">${ownerSelf ? '我的' : '对手的'}效果区：</span>`;
  if (!pl.field.length) container.insertAdjacentHTML('beforeend', '<span style="opacity:.5">空</span>');
  for (const f of pl.field) {
    const by = f.owner === view.self ? '我放的' : '对手放的';
    const extra = [f.roundsLeft ? `剩 ${f.roundsLeft} 回合` : '', f.card.defId === 'XHS-009' ? `${f.count ?? 0}/5` : ''].filter(Boolean).join(' ');
    container.appendChild(cardEl(f.card.defId, { badge: extra, tag: by }));
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
  $('opp-stats').innerHTML = stats(O, false);
  $('my-stats').innerHTML = stats(M, true);
  const n = typeof O.hand === 'number' ? O.hand : O.hand.length;
  $('opp-hand').innerHTML = '<div class="back"></div>'.repeat(n);
  fieldEl($('opp-field'), O, false); fieldEl($('my-field'), M, true);
  $('status').innerHTML = `第 ${view.round} 回合 · 风向 <b>${WIND[view.wind]}</b><br>${phaseText()}${waiting && p.kind !== 'over' ? '<br><i>等待中…</i>' : ''}<br><span id="clock"></span>`;
  $('stack').innerHTML = '';
  const top = view.stack.at(-1); if (top) { $('stack').append('结算中：'); $('stack').appendChild(cardEl(top.card.defId)); }
  $('log').innerHTML = logLines.slice(-80).map((l) => `<div>${l}</div>`).join(''); $('log').scrollTop = 1e9;

  // 手牌
  const hand = $('my-hand'); hand.innerHTML = '';
  for (const c of M.hand) {
    const sup = M.suppressed.includes(c.uid);
    const el = cardEl(c.defId, { cls: sup ? 'dim' : '', tag: sup ? '被压制' : c.from !== undefined && c.from !== seat ? '对方放入' : '', onclick: () => onHandClick(c) });
    el.oncontextmenu = (e) => { e.preventDefault(); if (confirm(`弃掉〈${nameOf(c.defId)}〉？`)) act({ type: 'discard', uid: c.uid }); };
    hand.appendChild(el);
  }
  // 按钮
  const A = $('actions'); A.innerHTML = '<span style="opacity:.6;font-size:12px">右键手牌 = 弃牌（随时可弃）</span> ';
  const btn = (txt, fn, cls = '') => { const b = document.createElement('button'); b.textContent = txt; b.className = cls; b.onclick = fn; A.appendChild(b); };
  if (p.kind === 'play' && p.active === view.self) btn('结束阶段', () => act({ type: 'end_phase' }));
  if ((p.kind === 'response' || p.kind === 'interject') && p.responder === view.self) btn('放弃', () => act({ type: 'pass' }), 'ghost');
  if (p.kind === 'select' && p.chooser === view.self && p.reason === 'math_quiz') mathQuiz(p);
  if (p.kind === 'over') btn('再来一局', () => { sessionStorage.removeItem('xhs-token'); location.reload(); });
  attachTips();
}
setInterval(() => { const c = $('clock'); if (c && deadline && view?.phase.kind !== 'over') { const s = Math.max(0, Math.ceil((deadline - Date.now() - clockOffset) / 1000)); c.textContent = `倒计时 ${s} 秒`; } }, 250);

// ---------- 出牌 ----------
function onHandClick(c) {
  const p = ph(), d = defs[c.defId];
  if (p.kind === 'select' && p.chooser === view.self && p.reason === 'superman') return act({ type: 'give_card', uid: c.uid });
  if (p.kind === 'interject' && p.responder === view.self && p.step === 'offer') return act({ type: 'play', uid: c.uid });
  const canMain = (p.kind === 'play' && p.active === view.self) || (p.kind === 'interject' && p.responder === view.self && p.step === 'play');
  const canResp = p.kind === 'response' && p.responder === view.self;
  if (!canMain && !canResp) return toast('现在不能出这张牌');
  playDialog(c, d, canMain);
}

const hasOp = (effs, op) => effs.some((e) => e.op === op || (e.op === 'choice' && e.options.some((o) => hasOp(o, op))) || (e.then && hasOp(e.then, op)));
const custom = (d, key) => d.effects.some((e) => e.op === 'custom' && e.key === key);
function descEffects(list) {
  return list.map((e) => e.op === 'draw' ? `抽 ${e.count} 张` : e.op === 'damage' ? `${e.target === 'self' ? '自己' : '对方'} HP-${e.amount}` : e.op === 'heal' ? `HP+${e.amount}` : e.op === 'sp' ? `SP${e.delta > 0 ? '+' : ''}${e.delta}` : e.op).join('，');
}

function playDialog(c, d, main) {
  const M = me(), O = opp();
  const choice = d.effects.find((e) => e.op === 'choice');
  const needWind = custom(d, 'change_wind');
  const fieldTargets = [];
  if (custom(d, 'remove_from_my_zone')) for (const f of M.field) if (f.owner !== view.self) fieldTargets.push(f);
  if (d.type === 'attack') for (const f of O.field) if (f.card.defId === 'XHS-009') fieldTargets.push(f);
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
function attachTips() {
  for (const el of document.querySelectorAll('.card')) {
    el.onmouseenter = (e) => { const d = defs[el.dataset.def]; if (!d) return; const t = $('tip');
      t.innerHTML = `<b>${d.name}</b> · ${TYPE[d.type]} · ${d.x ? `X 费 ${d.x.min}–${d.x.max}` : d.escalating ? '第 n 次用花 n SP' : `${d.cost} SP`}<br>${d.text ?? ''}`; t.hidden = false; };
    el.onmousemove = (e) => { const t = $('tip'); t.style.left = Math.min(innerWidth - 270, e.clientX + 14) + 'px'; t.style.top = Math.max(0, e.clientY - 90) + 'px'; };
    el.onmouseleave = () => ($('tip').hidden = true);
  }
}

// ---------- 大厅 ----------
$('btn-create').onclick = () => { sessionStorage.removeItem('xhs-token'); send({ t: 'create_room' }); };
$('btn-join').onclick = () => { sessionStorage.removeItem('xhs-token'); send({ t: 'join_room', code: $('in-code').value.trim() }); };
for (const b of document.querySelectorAll('#faction button')) b.onclick = () => send({ t: 'pick_faction', faction: b.dataset.f });

window.__xhs = { get view() { return view; }, get ws() { return ws; } };   // 联调/自动测试用
defs = await (await fetch('cards.json')).json();
connect();
