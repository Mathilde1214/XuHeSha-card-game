# 《续禾杀》联网协议 v1（按 rules-v2 更新，后端联网程序）

在 v0 基础上改动；类型仍复用 `engine/src/types.ts`。服务端唯一权威，客户端只发意图，状态一律来自 `viewFor()`。

## 传输与房间（不变）
WebSocket + JSON `{ t, ... }`；两人好友房，6 位房间码；`action.player` 由服务端按连接身份覆盖。

## 客户端 → 服务端
| t | 字段 | 说明 |
|---|---|---|
| `create_room` / `join_room` | `code?` | 不带卡组：双方固定各一整套 66 张（cards-v2 去掉 #27），由服务端按卡表生成、用种子洗牌，客户端无法指定或篡改 |
| `pick_faction` | `faction` | 开局选粽子阵营，双方都选完服务端才 `createGame`，阵营随后公开 |
| `action` | `seq, action` | 引擎 `Action`；`player`、`qteHits` 由服务端填，客户端发来的忽略；`choice`（二选一）和 `x` 由客户端填、服务端校验；带 `choice` 效果的牌缺 `choice` 直接 `reject`，选项随出牌公开（#42/#47 按 `attackChoices` 决定是否开防御窗口） |
| `qte_hit` | `qteId, round` | QTE 按键，**判定以服务端收到时间为准**（见下） |
| `formula` | `qteId, lines: string[3]` | #64 Physics 输入的三条公式，服务端比对公式库 |
| `resume` | `token, lastVer` | 重连 |
| `ping` | — | 心跳，10 秒没心跳视为掉线 |

## 服务端 → 客户端
| t | 字段 | 说明 |
|---|---|---|
| `room` | `code, token, seat` | |
| `state` | `ver, view, log` | `view = viewFor(state, seat)`，只发本人视角 |
| `ack` / `reject` | `seq, reason?` | |
| `timer` | `phase, deadline` | 出牌 60 秒、响应 15 秒，按服务器时间 |
| `waiting` | `who` | 对方在响应/在做 QTE 时只发这个，不带任何原因 |
| `qte_start` | `qteId, rounds:3, windows` | 下发 3 次判定的时间窗（服务器时间）|
| `qte_result` / `formula_result` | `qteId, pass, detail` | 双方都收到结果 |
| `opponent` | `online, graceUntil?` | 对手掉线时附上 1 分钟判负截止时间 |

## v2 新规则的实现
1. **条件响应窗口（§8）**：服务端检查对方手牌里有没有能反制且付得起的牌，有才给对方开窗口。为了不泄露“对方手里有反制牌”，出牌方看到的流程统一：每张牌打出后都显示 `waiting`；**没开窗口时服务端也随机等 1～3 秒再结算**。注意：真开了窗口时对方可能想很久（最多 15 秒），等待特别长时出牌方仍能猜到，这一点无法完全消除，请知悉。
2. **跳过（§rules v2）**：跳过整个出牌阶段，由引擎处理，协议无改动。
3. **QTE（§9.1）**：时间窗由服务端下发，按服务端收到 `qte_hit` 的时间判定，留 150ms 网络容差，防客户端伪造“按准了”。具体形式和通过标准等游戏程序的方案。
4. **公式（#64）**：公式库只放服务端，客户端只提交文本，避免答案被解包。
5. **周五（#60）**：按服务器北京时间判断。
6. **风向（§9.3，补充裁定二）**：每个出牌阶段由服务端随机，**对双方公开**，写进双方 `view`；#31 只改变一次风向。
7. **信息公开（§10）**：牌库张数、弃牌堆、效果区、粽子阵营写进双方 `view`；对手手牌只给张数。
8. **掉线（§11）**：心跳断 10 秒算掉线，开始 1 分钟倒计时；期间计时照走、超时照常自动处理；1 分钟内 `resume` 成功就补发完整 `state`，否则判负。

## 卡牌时机对应的窗口（按 card-specs-v2 枚举）
- `response_attack`、`interrupt`：对方打出牌后，按条件开响应窗口（第 1 条的防泄露处理同样适用）。
- `opponent_phase_start`（#41 朝圣者）：对方出牌阶段开始时，若我手里有可用的 #41，就给我开一个 15 秒窗口；没有也照样随机等 1～3 秒，防泄露。
- `ctx.isFriday` 由服务端按北京时间每局开局计算一次传入（对局跨零点不变）。

- #62 ?????（补充裁定三）：打出后先给对方开**免费反击窗口**（15 秒）。引擎实现为对方有任意手牌就开（`phase.free = true`，可打任意 1 张牌），手牌数本来公开，所以这个窗口不需要防泄露延迟。窗口里对方的 `play` 不扣 SP（由引擎按 `free` 判断，客户端不传任何“免费”标记）；反击结算完、对方放弃或超时后，再结算 #62 的弃光手牌和 HP 减到 1。

## 背面选牌（#15 鲨鲨の怒火，补充裁定二）
- 服务端发 `hidden_pick { pickId, handles: string[] }`：对方每张可燃手牌一个随机一次性 handle，顺序打乱，不含真实 uid 和卡 ID。
- 出牌方回 `hidden_pick_reply { pickId, handle }`，服务端映射回真实 uid 后结算；handle 用完即作废。限时 15 秒，超时随机选。
- 说明：按裁定，出牌方会看到对方可燃牌的**张数**，这是规则允许公开的信息。
- #18 两个半月の展览（已定：出牌方盲选第几张）：同样用这套 handle，对象是对方**全部**手牌；handle 每次重新生成、顺序打乱，等价于“每回合打乱后选第几张”。

## 已定事项汇总（无待定）
- 选牌方式：效果区传 `targetUid`；#4 系统随机；#61 对方自己选（用他自己的 uid）；#15 背面选牌（见上）；#18 盲选（见上）。
- 已定：卡组为双方各一整套固定 66 张（Siyuan 2026-11-01）。

## 附：对接引擎 v2.1 的改动（10/23）

- 连接地址改为 `ws://<主机>:8787/ws`；同一端口的 HTTP 发 `web/`（网页客户端）、`/art/…`（卡面图）、`/engine/…`。启动：`cd /workspace/xuhesha && ./start.sh`。
- `action` 里 `play` 可带 `withUid`（组合出的第二张）和 `wind`（公开风向）。两张卡任意一张需要背面选牌、QTE 或公式，都会走对应流程。
- `formulaOk`、`qteHits` 一律由服务端填写，客户端发了也会被删掉。#64 公式判定结果写入 `formulaOk`。
- `select` 阶段：`reason:'math_quiz'`（#4）由 `chooser` 发 `{type:'pick', uid?}`，15 秒不选就由服务端发不带 uid 的 `pick`（引擎随机）；`reason:'superman'`（#61）由 `chooser` 发 `give_card`，超时随机给一张。
- `interject` 阶段（#41）：只有 `responder` 会收到 `timer{phase:'interject'}`，15 秒不操作自动 `pass`。
- 防泄露：`interject` 窗口打开时，`active` 一方只收到 `waiting`；没开窗口时，新出牌阶段开始的一方同样先收到 `waiting`，随机等 1～3 秒再推状态。等待期间他的操作一律回 `reject{reason:'结算中，请稍候'}`，假等的时间会补到他的 60 秒出牌计时里。

## 附：再来一局与重连（11/04）

客户端 → 服务端：
- `{t:'resume', token?, tokens?}`：`token` 是本标签页自己的凭证（建议存 sessionStorage），这个座位即使还在线也会直接接管，旧连接会收到 `{t:'kicked'}` 并被断开；`tokens` 是浏览器里存过的凭证列表（建议存 localStorage，最多 10 个，新的在前），只会接回当前**不在线**的座位，适合关掉标签页后重新打开。两种都失败时回 `reject{code:'resume_failed'}`，客户端应清掉凭证、回到大厅。
- `{t:'rematch', want?:boolean}`：只能在对局结束后发，`want:false` 是取消。
- `{t:'leave'}`：主动离开房间。对局中离开算判负；房间随即关闭。

服务端 → 客户端：
- `room` 在重连时多带 `resumed:true`、`game`（第几局，从 0 开始）、`opponent{online,graceUntil}`、`rematch:[bool,bool]`。
- `{t:'rematch', votes:[bool,bool]}`：谁已经点了再来一局。
- 双方都点了以后：`{t:'lobby', ready:true, need:'pick_faction', game}`，座位不变，重新选阵营，然后照常收到新一局的 `state`（日志从头开始）。
- `{t:'opponent', online:false, left:true}`：对手主动离开。
- `{t:'room_closed'}`：房间已关闭（有人离开、对局结束 10 分钟没人再来一局、或者掉线超过 1 分钟）。
- `{t:'kicked', reason}`：这个座位在别的页面连上了。
