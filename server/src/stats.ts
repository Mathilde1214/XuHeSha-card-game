// 真人对局统计：node src/stats.ts [记录文件]
// 默认读 server/data/games.jsonl（服务器每打完一局追加一行）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const file = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'games.jsonl');
let rows: any[] = [];
try { rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { console.log(`还没有对局记录（${file}）`); process.exit(0); }
const pct = (a: number, n: number) => (n ? ((100 * a) / n).toFixed(1) + '%' : '-');
function report(title: string, rs: any[]) {
  const n = rs.length, w = rs.filter((r) => r.firstWon).length, p = n ? w / n : 0, ci = n ? 196 * Math.sqrt((p * (1 - p)) / n) : 0;
  const rounds = rs.map((r) => r.rounds).sort((a, b) => a - b);
  console.log(`\n${title}：${n} 局`);
  if (!n) return;
  console.log(`  先手胜率 ${pct(w, n)}（误差约 ±${ci.toFixed(1)} 个百分点）`);
  console.log(`  回合数 平均 ${(rounds.reduce((a, b) => a + b, 0) / n).toFixed(1)}，中位数 ${rounds[Math.floor(n / 2)]}，最长 ${rounds[n - 1]}`);
  console.log(`  平均用时 ${Math.round(rs.reduce((a, r) => a + r.seconds, 0) / n / 60 * 10) / 10} 分钟`);
}
report('全部对局', rows);
report('正常打完（不含掉线、认输离开）', rows.filter((r) => r.reason === 'hp'));
const by: Record<string, number> = {}; for (const r of rows) by[r.reason] = (by[r.reason] ?? 0) + 1;
console.log('\n结束方式：' + Object.entries(by).map(([k, v]) => `${({ hp: '打到分出胜负', disconnect: '掉线判负', leave: '认输离开', forfeit: '判负' } as any)[k] ?? k} ${v}`).join('，'));
