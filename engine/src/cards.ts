// 《续禾杀》卡牌数据：依据 cards-v2.md 和 card-specs-v2.md（游戏设计师）。编号固定。
// custom:xxx 表示这张卡有专属逻辑，在 handlers 里实现；标 ⚠ 的是还在等 Siyuan 拍板的地方（已并入 rules-v2 补充裁定二）。
// 宿舍卡 #57/#58 与 #38：倍率不设上限，只翻倍对自己有利的数值。
import type { CardDef, Effect } from './types.ts';
// 宿舍卡 #57/#58 在效果区持续的回合数：按出牌方自己的回合算，放下那回合算第 1 个（补充裁定四）
export const DORM_ROUNDS = 10;

const dmg = (n: number): Effect => ({ op: 'damage', target: 'enemy', amount: n });
const selfDmg = (n: number): Effect => ({ op: 'damage', target: 'self', amount: n });
const heal = (n: number | 'full'): Effect => ({ op: 'heal', target: 'self', amount: n });
const sp = (d: number): Effect => ({ op: 'sp', target: 'self', delta: d });
const enemySp = (d: number | 'clear'): Effect => ({ op: 'sp', target: 'enemy', delta: d });
const draw = (n: number): Effect => ({ op: 'draw', target: 'self', count: n });
const skip = (target: 'self' | 'enemy', count = 1): Effect => ({ op: 'skip_next_phase', target, count });
const custom = (key: string): Effect => ({ op: 'custom', key });
const block = { mode: 'block' as const };

const list: CardDef[] = [
  { id: 'XHS-001', name: '“小绿”', type: 'defense', cost: 0, tags: ['flammable'], effects: [], counter: { ...block, onCounter: [skip('self')] } },
  { id: 'XHS-002', name: '逃出的1点Sp.', type: 'effect', cost: 1, effects: [sp(1)] },
  { id: 'XHS-003', name: '流血!!!', type: 'effect', cost: 2, effects: [custom('bleed')] },                 // 金属制牌数 = 对方手牌 + 效果区
  { id: 'XHS-004', name: '数学周测', type: 'attack', cost: 2, tags: ['flammable'], effects: [custom('math_quiz'), dmg(1)] },
  { id: 'XHS-005', name: '竹鼠的纯几何方法', type: 'effect', cost: 1, effects: [{ op: 'qte', onPass: [sp(3), dmg(1)] }],
    counter: { mode: 'negate', ids: ['XHS-004'] } },
  { id: 'XHS-006', name: '一块好像很可怜的面包', type: 'effect', cost: 1, effects: [heal(1)] },
  { id: 'XHS-007', name: '小兲の壳', type: 'defense', cost: 1, effects: [], counter: block },
  { id: 'XHS-008', name: '老木盾', type: 'defense', cost: 1, escalating: true, variableCost: true, maxPerRound: 2, returnsToHand: true, tags: ['flammable'], effects: [],
    counter: { ...block, onCounter: [dmg(1)] } },                                                            // 每回合最多 2 次；计入 #9 出牌次数
  { id: 'XHS-009', name: '「等成绩的第5天」', type: 'effect', cost: 0, persistent: { zone: 'self' }, effects: [custom('fifth_day')],
    counter: { ...block, absorb: 1, onCounter: [] } },                                                                   // 削弱：仍 0 费，结算时对方 HP-3
  { id: 'XHS-010', name: 'Math 作业', type: 'attack', cost: 0, x: { min: 0, max: 5 }, variableCost: true, tags: ['flammable'], effects: [{ op: 'damage', target: 'enemy', amount: 'X' }] },
  { id: 'XHS-011', name: '涂改带·真', type: 'defense', cost: 2, effects: [], counter: block },
  { id: 'XHS-012', name: '涂改带', type: 'effect', cost: 2, effects: [] },
  { id: 'XHS-013', name: '黄xx的呼喊', type: 'defense', cost: 2, effects: [], counter: { ...block, ids: ['XHS-014', 'XHS-015', 'XHS-016'] } },
  { id: 'XHS-014', name: '醒来的鲨鲨', type: 'attack', cost: 0, x: { min: 2, max: 4 }, variableCost: true, tags: ['shark'], effects: [{ op: 'damage', target: 'enemy', amount: { xMinus: 1 } }] },
  { id: 'XHS-015', name: '鲨鲨の怒火', type: 'attack', cost: 2, tags: ['shark'], effects: [custom('burn_flammable')] },  // 对方可燃手牌背面展示，出牌方选一张丢（临时选择 id，不暴露 uid）
  { id: 'XHS-016', name: '迟到的鲨鲨', type: 'attack', cost: 3, tags: ['shark'], effects: [selfDmg(1), { op: 'qte', onPass: [dmg(1)] }] },
  { id: 'XHS-017', name: '沉睡的鲨鲨', type: 'effect', cost: 1, tags: ['shark'], effects: [heal(1)] },
  { id: 'XHS-018', name: '两个半月の展览', type: 'attack', cost: 4, effects: [enemySp(-3), custom('suppress_card')] },   // 出牌方盲选对方第几张；服务端换成真实 uid 填进 targetUid
  { id: 'XHS-019', name: 'Mask', type: 'attack', cost: 2, tags: ['flammable'], effects: [{ op: 'choice', options: [[dmg(1)], [heal(1)]] }] },
  { id: 'XHS-020', name: '枕头大战!!', type: 'attack', cost: 0, x: { min: 1, max: 3 }, variableCost: true, condition: { spAtMost: 3 }, tags: ['flammable', '3118'],
    effects: [{ op: 'damage', target: 'enemy', amount: 'X' }] },
  { id: 'XHS-021', name: '3118,10号的柜子', type: 'resource', cost: 1, tags: ['flammable', '3118'], effects: [draw(2)] },
  { id: 'XHS-022', name: '一根你知道怎么用的针', type: 'effect', cost: 1, effects: [heal(1)] },
  { id: 'XHS-023', name: '中位数定理', type: 'attack', cost: 2, effects: [dmg(2)] },
  { id: 'XHS-024', name: '一枝钢笔', type: 'effect', cost: 1, tags: ['metal'], persistent: { zone: 'enemy' }, effects: [] },
  { id: 'XHS-025', name: '林广秦', type: 'attack', cost: 1, tags: ['3119'], effects: [{ op: 'heal', target: 'enemy', amount: 1 }] },
  { id: 'XHS-026', name: '林广泰', type: 'effect', cost: 1, tags: ['3119'], effects: [heal(1)] },
  { id: 'XHS-027', name: '林广姬', type: 'effect', cost: 1, status: 'deleted', tags: ['3119'], effects: [] },
  { id: 'XHS-028', name: '林广耶', type: 'effect', cost: 1, tags: ['3119'], effects: [] },
  { id: 'XHS-029', name: '动能定理', type: 'attack', cost: 1, effects: [dmg(1)] },
  { id: 'XHS-030', name: '〇风艳', type: 'effect', cost: 1, windField: true, persistent: { zone: 'self', rounds: 3 }, effects: [] },
  { id: 'XHS-031', name: 'Yakito の 风向标', type: 'effect', cost: 1, tags: ['3118'], effects: [custom('change_wind')] },  // 风向公开；本牌只能改一次风向
  { id: 'XHS-032', name: '双开门冰箱', type: 'attack', cost: 2, tags: ['3118'], effects: [custom('fridge_skip')] },     // 配 060 跳 2 次
  { id: 'XHS-033', name: '武装直升机', type: 'attack', cost: 5, tags: ['3119'], effects: [dmg(3), heal(1)] },
  { id: 'XHS-034', name: '神奇手套', type: 'defense', cost: 2, tags: ['3119'], effects: [heal(1)],
    counter: { ...block, ids: ['XHS-035'], onCounter: [sp(1), heal(1)] } },
  { id: 'XHS-035', name: 'Soccer!!!', type: 'attack', cost: 1, tags: ['3119'], effects: [dmg(1)] },
  { id: 'XHS-036', name: '武功秘籍!!!', type: 'defense', cost: 0, tags: ['flammable'], effects: [], counter: { ...block, onCounter: [skip('self')] } },
  { id: 'XHS-037', name: '工兵铲', type: 'effect', cost: 1, effects: [custom('remove_from_my_zone')] },
  { id: 'XHS-038', name: '卡牌游戏!!!', type: 'effect', cost: 1, tags: ['flammable'], effects: [custom('dorm_x3')] },
  { id: 'XHS-039', name: '该死的电脑', type: 'effect', cost: 0, effects: [skip('self')] },
  { id: 'XHS-040', name: '牛奶定理', type: 'attack', cost: 1, effects: [dmg(1), enemySp(-1)] },
  { id: 'XHS-041', name: '朝圣者', type: 'effect', cost: 1, effects: [custom('pilgrim')] },                     // 对方阶段开始时打出
  { id: 'XHS-042', attackChoices: [1], name: '抽签筒', type: 'resource', cost: 1, effects: [{ op: 'choice', options: [[draw(2)], [dmg(1)]] }] },
  { id: 'XHS-043', name: 'CSA的大作', type: 'attack', cost: 2, tags: ['flammable'], effects: [{ op: 'qte', onPass: [heal(1), dmg(1)] }] },
  { id: 'XHS-044', name: '不知道写了什么的横幅', type: 'attack', cost: 2, tags: ['flammable'], effects: [enemySp(-4)] },
  { id: 'XHS-045', name: '麻酱和油碟', type: 'defense', cost: 3, effects: [], counter: { ...block, ids: ['XHS-053'] } },
  { id: 'XHS-046', name: '长得像试剂的饮料', type: 'effect', cost: 1, effects: [heal(1)] },
  { id: 'XHS-047', attackChoices: [1], name: '卡牌容器', type: 'resource', cost: 2, effects: [{ op: 'choice', options: [[draw(2)], [dmg(1)]] }] },
  { id: 'XHS-048', name: '3104的灯管', type: 'defense', cost: 1, effects: [], counter: { ...block, exceptIds: ['XHS-049'] } },
  { id: 'XHS-049', name: '3104的篮球', type: 'attack', cost: 3, effects: [custom('basketball')] },
  { id: 'XHS-050', name: '世界上最美味的肥料', type: 'effect', cost: 1, effects: [heal(1)] },
  { id: 'XHS-051', name: 'CYN的飞镖', type: 'attack', cost: 1, effects: [dmg(1)] },
  { id: 'XHS-052', name: '神秘の皮筋', type: 'attack', cost: 2, effects: [dmg(3), selfDmg(1)] },
  { id: 'XHS-053', name: '甜粽', type: 'attack', cost: 1, tags: ['flammable'], effects: [{ op: 'vs_faction', faction: 'savory', then: [dmg(1)] }] },
  { id: 'XHS-054', name: '白糖', type: 'defense', cost: 1, tags: ['flammable'], effects: [heal(1)], counter: { ...block, ids: ['XHS-055'] } },
  { id: 'XHS-055', name: '肉粽', type: 'attack', cost: 1, tags: ['flammable'], effects: [custom('zongzi_combo')] },  // 对甜粽党 HP-1；配 #45：不看阵营，HP-3、SP-1
  { id: 'XHS-056', name: '马踏飞燕', type: 'resource', cost: 2, tags: ['3119'], effects: [{ op: 'discard_random', target: 'self', count: 'all' }, draw(1)] },
  { id: 'XHS-057', name: '众神的宴请', type: 'effect', cost: 3, tags: ['3119'], persistent: { zone: 'self', rounds: DORM_ROUNDS, ownTurns: true }, effects: [] },  // 3119 有益数值 ×2
  { id: 'XHS-058', name: '电竞室!', type: 'effect', cost: 3, tags: ['3118'], persistent: { zone: 'self', rounds: DORM_ROUNDS, ownTurns: true }, effects: [] },     // 3118 有益数值 ×2
  { id: 'XHS-059', name: '○○飞的语言攻击', type: 'attack', cost: 3, effects: [dmg(4)] },
  { id: 'XHS-060', name: '一瓶神奇的粉色饮料', type: 'attack', cost: 2, tags: ['flammable', '3119'], effects: [{ op: 'if_friday', then: [dmg(4)], else: [selfDmg(2)] }] },
  { id: 'XHS-061', name: 'Super Man', type: 'attack', cost: 1, effects: [custom('superman')] },
  { id: 'XHS-062', name: '?????', type: 'attack', cost: 7, tags: ['flammable'], freeCounterAttack: true,
    effects: [{ op: 'discard_random', target: 'enemy', count: 'all' }, { op: 'set_hp', target: 'enemy', value: 1 }] }, // 补充裁定三：先给对方一次免费反击，再弃光、HP→1
  { id: 'XHS-063', name: '¿¿¿¿¿', type: 'effect', cost: 0, tags: ['flammable'], freeCounterAttack: true,
    effects: [{ op: 'discard_random', target: 'self', count: 'all' }, { op: 'set_hp', target: 'self', value: 1 }, enemySp('clear')] }, // 先给对方一次免费出牌（C26）
  { id: 'XHS-064', name: 'Physics', type: 'effect', cost: 1, effects: [custom('physics_formulas')] },
  { id: 'XHS-065', name: '孙吧の新星', type: 'attack', cost: 2, tags: ['3118'], effects: [dmg(1), skip('enemy')] },
  { id: 'XHS-066', name: 'OreO', type: 'effect', cost: 3, effects: [heal('full')] },
  { id: 'XHS-067', name: '意见箱', type: 'effect', cost: 0, effects: [custom('cost_minus_2')] },             // 可叠高费牌；不能用于 variableCost 的牌
];


export const CARDS: Record<string, CardDef> = Object.fromEntries(list.map((c) => [c.id, c]));
