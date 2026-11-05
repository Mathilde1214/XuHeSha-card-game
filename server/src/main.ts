// 本地 WebSocket 房间服务：node src/main.ts（默认端口 8787）
import { WebSocketServer, type WebSocket } from 'ws';
import { randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');   // /workspace/xuhesha
const STATIC: [string, string][] = [['/art/', join(ROOT, 'art')], ['/engine/', join(ROOT, 'engine')], ['/', join(ROOT, 'web')]];
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };
import { Room, DEFAULT_TIMING, type Timing } from './room.ts';
import type { PlayerId } from '../../engine/src/types.ts';

export function startServer(port = Number(process.env.PORT ?? 8787), timing: Timing = DEFAULT_TIMING) {
  const rooms = new Map<string, Room>();
  const tokens = new Map<string, { room: Room; seat: PlayerId }>();
  // 同一个端口：HTTP 发网页和卡面图，WebSocket 走 /ws
  const http = createServer(async (req, res) => {
    let path: string;
    try { path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname); }
    catch { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end('无效的 URL'); return; }
    for (const [prefix, dir] of STATIC) {
      if (!path.startsWith(prefix)) continue;
      let file = normalize(join(dir, path.slice(prefix.length) || 'index.html'));
      if (!file.startsWith(dir)) break;
      if (path.endsWith('/') && path.length > prefix.length) file = join(file, 'index.html');
      try { const body = await readFile(file); res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }); return res.end(body); }
      catch { break; }
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('没找到');
  });
  const wss = new WebSocketServer({ server: http, path: '/ws' });
  http.listen(port, process.env.HOST ?? '127.0.0.1');

  const newCode = () => { let c; do c = String(randomInt(100000, 1000000)); while (rooms.has(c)); return c; };

  wss.on('connection', (ws: WebSocket & { alive?: boolean }) => {
    let bound: { room: Room; seat: PlayerId } | null = null;
    const conn = { send: (m: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); }, close: () => { bound = null; ws.close(4000, 'kicked'); } };
    ws.alive = true; ws.on('pong', () => { ws.alive = true; });

    ws.on('message', (data) => {
      let msg: any; try { msg = JSON.parse(String(data)); } catch { return conn.send({ t: 'reject', reason: '不是合法 JSON' }); }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string')
        return conn.send({ t: 'reject', reason: '消息格式不对' });
      if (!bound) {
        if (msg.t === 'create_room') {
          const room = new Room(newCode(), timing, (r) => { rooms.delete(r.code); for (const s of r.seats) if (s) tokens.delete(s.token); });
          rooms.set(room.code, room);
          const j = room.join(conn)!; bound = { room, seat: j.seat }; tokens.set(j.token, bound); return;
        }
        if (msg.t === 'join_room') {
          const room = rooms.get(String(msg.code ?? ''));
          if (!room) return conn.send({ t: 'reject', reason: '房间不存在' });
          const j = room.join(conn); if (!j) return conn.send({ t: 'reject', reason: '房间已满' });
          bound = { room, seat: j.seat }; tokens.set(j.token, bound); return;
        }
        if (msg.t === 'resume') {
          // token：本标签页自己的凭证，座位在线也直接接管（刷新、换网络）
          // tokens：浏览器里存过的凭证列表（关掉标签页后重新打开），只接回不在线的座位
          let b = msg.token ? tokens.get(String(msg.token)) : undefined;
          if (b?.room.closed) b = undefined;
          if (!b && Array.isArray(msg.tokens)) {
            for (const tk of msg.tokens.slice(0, 10)) { const c = tokens.get(String(tk)); if (c && !c.room.closed && !c.room.seats[c.seat]?.conn) { b = c; break; } }
          }
          if (!b) return conn.send({ t: 'reject', code: 'resume_failed', reason: '重连凭证无效或房间已关闭' });
          bound = b; b.room.resume(b.seat, conn); return;
        }
        if (msg.t === 'ping') return conn.send({ t: 'pong', serverTime: Date.now() });
        return conn.send({ t: 'reject', reason: '请先建房、加入或重连' });
      }
      if (bound.room.closed) { bound = null; return conn.send({ t: 'room_closed' }); }
      bound.room.handle(bound.seat, msg);
    });
    ws.on('close', () => { if (bound && !bound.room.closed && bound.room.seats[bound.seat]?.conn === conn) bound.room.disconnect(bound.seat); });
  });

  // 心跳：每 5 秒探一次，连续 10 秒没回应就断开，进入 1 分钟重连期
  const hb = setInterval(() => {
    for (const ws of wss.clients as Set<WebSocket & { alive?: boolean; missed?: number }>) {
      if (ws.alive) { ws.alive = false; ws.missed = 0; ws.ping(); continue; }
      ws.missed = (ws.missed ?? 0) + 1; if (ws.missed >= 2) ws.terminate(); else ws.ping();
    }
  }, 5_000);
  wss.on('close', () => clearInterval(hb));
  return { wss, rooms, close: () => new Promise<void>((r) => { for (const room of rooms.values()) room.close(); for (const c of wss.clients) c.terminate(); wss.close(() => http.close(() => r())); }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { wss } = startServer();
  wss.on('listening', () => { const h = process.env.HOST ?? '127.0.0.1', p = process.env.PORT ?? 8787; console.log(`续禾杀已启动：网页 http://${h}:${p}/  联机 ws://${h}:${p}/ws`); });
}
