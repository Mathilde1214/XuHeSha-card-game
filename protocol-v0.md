# 《续禾杀》联网协议 草案 v0（后端联网程序）

复用 `engine/src/types.ts` 的 `Action`、`GameState`、`CardDef`，不另起类型。服务端唯一权威：只有服务端调用 `apply()`，客户端只发“意图”，收到的状态一律来自 `viewFor()`。

## 传输
- WebSocket，消息为 JSON：`{ t: <消息类型>, ...字段 }`。
- 每局一个房间，房间码 6 位，两人对战（先只做好友房，不做匹配）。

## 客户端 → 服务端
| t | 字段 | 说明 |
|---|---|---|
| `create_room` | `deck: string[]` | 建房，返回房间码 |
| `join_room` | `code, deck` | 加入；两人到齐后服务端 `createGame(decks, seed)` |
| `action` | `seq, action` | `action` 即引擎的 `Action`，但 **`player` 字段由服务端按连接身份覆盖**，客户端填了也无视，防冒充 |
| `resume` | `token, lastVer` | 断线重连 |
| `ping` | — | 心跳 |

## 服务端 → 客户端
| t | 字段 | 说明 |
|---|---|---|
| `room` | `code, token, seat` | `seat` 即 `PlayerId`，`token` 用于重连 |
| `state` | `ver, view, log` | `view = viewFor(state, seat)`；`ver` 单调递增；`log` 只发本次新增的条目 |
| `ack` / `reject` | `seq, reason?` | `apply()` 抛 `RuleError` 时回 `reject`，状态不变 |
| `timer` | `phase, deadline` | 当前阶段的截止时间（毫秒时间戳） |
| `opponent` | `online: boolean` | 对手掉线/回来 |

## 关键规则
1. **手牌保密**：对手手牌只有张数、牌库只有张数、`rng` 不下发（`viewFor` 已做到）。以后加“看对方手牌”类的卡时，由服务端在 `view` 里给该玩家单独附上，不改全局。
2. **响应窗口**：攻击牌打出后进入 `phase.kind = 'response'`，只接受 `responder` 的 `play`（防御牌）或 `pass`。超时自动 `pass`。
3. **超时**：出牌阶段超时自动 `end_phase`，弃牌超时随机弃。时长待定（建议出牌 60 秒、响应 15 秒）。
4. **重连**：带 `token` 和 `lastVer` 发 `resume`，服务端直接补发最新一份完整 `state`（状态小，不做增量回放）。掉线期间计时照走，超时照常自动处理。
5. **随机数**：种子只在服务端，存档 = 种子 + 双方卡组 + 动作列表，可完整复盘。

## 待确认
- 超时时长、掉线多久判负。
- “我有异议”这类打断牌：如果确认能打断非攻击牌，`response` 窗口需要在**任何**出牌后都开，而不只是攻击牌后，引擎和协议都要改。
- X 费：`action.x` 由客户端填，服务端校验 `x ≤ 当前 SP`。
