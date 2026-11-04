// 《续禾杀》规则引擎：类型定义（前后端共用）。依据 rules-v2.md。
export type PlayerId = 0 | 1;
export type CardType = 'attack' | 'defense' | 'resource' | 'effect';
export type Target = 'self' | 'enemy' | 'both';
export type Faction = 'sweet' | 'savory';           // 甜粽党 / 肉粽党（§4）
export type Wind = 'tail' | 'head' | 'calm';        // 顺风 / 逆风 / 无风（§9.3）
export type Tag = 'metal' | 'flammable' | '3118' | '3119' | 'shark';

// 效果原语：卡牌效果由这些原语组合；个别怪卡用 custom 挂专门的处理函数
export type Effect =
  | { op: 'damage'; target: Target; amount: number | 'X' | { xMinus: number } }
  | { op: 'heal'; target: Target; amount: number | 'full' }
  | { op: 'sp'; target: Target; delta: number | 'clear' }
  | { op: 'draw'; target: Target; count: number }
  | { op: 'discard_random'; target: Target; count: number | 'all' }
  | { op: 'skip_next_phase'; target: Target; count?: number }   // 跳过整个出牌阶段（B2）
  | { op: 'choice'; options: Effect[][] }                         // 二选一，选项由 play.choice 给
  | { op: 'qte'; onPass: Effect[] }                               // 3 次 QTE，通过才结算（§9.1）
  | { op: 'if_friday'; then: Effect[]; else: Effect[] }           // 现实日期（§9.2）
  | { op: 'vs_faction'; faction: Faction; then: Effect[] }        // 对方是该阵营才生效
  | { op: 'set_hp'; target: Target; value: number }
  | { op: 'custom'; key: string };                                // 单卡专属逻辑

// 能在响应窗口反制哪些牌（B1）
export interface Counter {
  types?: CardType[];          // 例如 ['attack']
  ids?: string[];              // 例如 #34 只防 XHS-035
  tags?: Tag[];                // 例如 #13 只防鲨鲨
  exceptIds?: string[];        // 例如 #48 对 XHS-049 无效
  mode: 'block' | 'negate';    // block：抵消一次攻击；negate：让那张牌无效（#5 对 #4）
  onCounter?: Effect[];        // 反制时附带的效果（老木盾反伤、神奇手套回血）
}

export interface CardDef {
  id: string;                  // XHS-001～067，固定
  name: string;
  type: CardType;
  status?: 'active' | 'deleted';
  tags?: Tag[];
  cost: number;                // 实际 SP 费用；X 费另见 x
  x?: { min: number; max: number };     // X 费范围（§7.1）
  condition?: { spAtMost?: number };   // 打出条件，如 #20 只有 SP≤3 才能打
  escalating?: boolean;        // 老木盾：第 n 次使用花 n SP
  maxPerRound?: number;        // 每回合最多用几次（#8 老木盾 = 2）
  variableCost?: boolean;      // 可变费用（#8 #10 #14 #20），意见箱不能减
  attackChoices?: number[];   // 选这些 choice 下标时按攻击结算，可被防御（#42/#47）
  returnsToHand?: boolean;     // 老木盾：用后回手，不进弃牌堆
  effects: Effect[];           // 在自己出牌阶段打出时的效果
  counter?: Counter;           // 有这个字段才能在响应窗口打
  persistent?: { rounds?: number; zone: 'self' | 'enemy'; ownTurns?: boolean };   // ownTurns：rounds 按出牌方自己的出牌阶段数  // 持续效果，留在效果区
  windField?: boolean;
  freeCounterAttack?: boolean; // #62：结算前对方可免费打出任意 1 张手牌反击（补充裁定三）         // #30 风场
  flavor?: string;
}

export interface CardInst { uid: number; defId: string; from?: PlayerId }   // from：被别人放进来的牌（#3），记原主人
export interface FieldItem { card: CardInst; owner: PlayerId; roundsLeft?: number; placedAt: number; count?: number } // count：#9 已累计的出牌次数

export interface PlayerState {
  hp: number; maxHp: number; sp: number; faction: Faction;
  deck: CardInst[]; hand: CardInst[]; discard: CardInst[]; field: FieldItem[];
  skipPhases: number;          // 还要跳过几个出牌阶段
  uses: Record<string, number>;// 递增费用卡的本局使用次数
  roundUses: Record<string, number>; // 本回合使用次数
  suppressed: number[];        // #18：本回合被压制、打不出的手牌 uid
  boost: boolean;              // #38：下一张牌的宿舍加成由 ×2 变 ×3
}

export interface StackItem { card: CardInst; owner: PlayerId; x?: number; choice?: number; qteHits?: number; cancelled?: boolean
  targetUid?: number; wind?: Wind; formulaOk?: boolean;
  deferred?: boolean;   // 免费反击里先进了 select，等选完再结算
  mult?: number;               // 宿舍卡加成倍率（#57/#58/#38），只乘有益数值
  with?: CardInst; withMult?: number; // 同时打出的另一张牌（#32+#60、#55+#45、#57/#58+#38、任意+#67）
  dest?: 'enemyHand' }         // #3 结算后放进对方手牌

export type Phase =
  | { kind: 'play'; active: PlayerId }
  | { kind: 'response'; active: PlayerId; responder: PlayerId; free?: boolean }
  | { kind: 'select'; active: PlayerId; chooser: PlayerId; reason: 'math_quiz' | 'superman'; options?: number[] } // #4 出牌方从弃掉的牌里拿 1 张；#61 对方交 1 张手牌
  | { kind: 'interject'; active: PlayerId; responder: PlayerId; step: 'offer' | 'play' }  // #41 朝圣者：对方出牌阶段开始时
  | { kind: 'over'; winner: PlayerId | 'draw' };

export interface GameState {
  round: number; first: PlayerId;
  players: [PlayerState, PlayerState];
  phase: Phase; wind: Wind; stack: StackItem[];
  rng: number; nextUid: number; placeSeq: number; log: string[];
  pending?: { reason: 'math_quiz' | 'superman'; chooser: PlayerId; options: number[] };   // 结算后等人选牌
}

// 外部输入：引擎保持纯函数，现实日期由服务端传进来
export interface Ctx { cards: Record<string, CardDef>; isFriday?: boolean }

export type Action =
  | { type: 'play'; player: PlayerId; uid: number; x?: number; choice?: number; qteHits?: number
      targetUid?: number;
      withUid?: number;                        // 同时打出的第二张手牌（组合）
      wind?: Wind;                             // #31 改成的风向
      formulaOk?: boolean }                    // #64 公式是否全部匹配，由服务端填                     // 效果区的牌由客户端传；对方手牌（#15、#18）由服务端从一次性编号换回真实 uid 后填入
  | { type: 'give_card'; player: PlayerId; uid: number }   // #61：对方从自己手牌里挑一张交出
  | { type: 'pick'; player: PlayerId; uid?: number }        // #4：从对方弃掉的两张里拿一张（不传 = 不拿）
  | { type: 'pass'; player: PlayerId }
  | { type: 'end_phase'; player: PlayerId }
  | { type: 'discard'; player: PlayerId; uid: number };
