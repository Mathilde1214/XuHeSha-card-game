// 网页客户端的静态服务：client/public + /cards.json（引擎卡表 + cards-v2.csv 的「游戏内说明」）
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { CARDS } from '../engine/src/cards.ts';

const ROOT = new URL('./public/', import.meta.url).pathname;
const CSV = new URL('../cards-v2.csv', import.meta.url).pathname;

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

export function cardsJson() {
  const rows = parseCsv(readFileSync(CSV, 'utf8').replace(/^\uFEFF/, '')); const head = rows[0];
  const ti = head.indexOf('游戏内说明'), ii = head.indexOf('编号');
  const text: Record<string, string> = {};
  for (const r of rows.slice(1)) if (r[ii]) text[r[ii]] = r[ti] ?? '';
  return JSON.stringify(Object.fromEntries(Object.values(CARDS).map((c) => [c.id, { ...c, text: text[c.id] ?? '' }])));
}

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };
export function startClient(port = Number(process.env.CLIENT_PORT ?? 5173)) {
  const srv = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (url === '/cards.json') { res.writeHead(200, { 'content-type': TYPES['.json'] }); return res.end(cardsJson()); }
    const p = normalize(join(ROOT, url === '/' ? 'index.html' : url));
    if (!p.startsWith(ROOT) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
  });
  srv.listen(port, process.env.HOST ?? '127.0.0.1');
  return srv;
}
if (import.meta.url === `file://${process.argv[1]}`) { startClient(); console.log('客户端：http://127.0.0.1:' + (process.env.CLIENT_PORT ?? 5173)); }
