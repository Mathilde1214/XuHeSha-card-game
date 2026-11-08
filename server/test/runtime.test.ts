import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Room, DEFAULT_TIMING } from '../src/room.ts';
import { startServer } from '../src/main.ts';
import { Client } from './helpers.ts';
import { createGame, apply, RuleError } from '../../engine/src/engine.ts';
import { CARDS } from '../../engine/src/cards.ts';
function setup(t, a, b) {
    const s = createGame(CARDS, ['sweet', 'savory'], 1);
    s.phase = { kind: 'play', active: 0 };
    for (const [p, ids] of [[0, a], [1, b]])
        s.players[p].hand = ids.map((n, i) => ({ uid: 900 + p * 50 + i, defId: `XHS-${String(n).padStart(3, '0')}` }));
    const messages = [[], []];
    const r = new Room('test', { ...DEFAULT_TIMING, fakeDelayMin: 0, fakeDelayMax: 0 }, () => { }, 1);
    r.join({ send: m => messages[0].push(m) });
    r.join({ send: m => messages[1].push(m) });
    r.state = s;
    t.after(() => r.close());
    const act = (p, action) => r.handle(p, { t: 'action', seq: 1, action });
    return { r, act, messages };
}
test('choice 在响应窗口前校验类型和范围，合法伤害仍可防御', t => {
    for (const [id, choice] of [[42, '1'], [19, 99], [47, null], [42, 0.5]]) {
        const { r, act, messages } = setup(t, [id], [7]);
        const before = structuredClone(r.state);
        act(0, { type: 'play', uid: 900, choice });
        assert.equal(messages[0].at(-1).t, 'reject');
        assert.deepEqual(r.state, before);
        assert.throws(() => apply(before, { type: 'play', player: 0, uid: 900, choice }, { cards: CARDS }), RuleError);
    }
    const { r, act } = setup(t, [42], [7]);
    act(0, { type: 'play', uid: 900, choice: 1 });
    assert.equal(r.state.phase.kind, 'response');
    act(1, { type: 'play', uid: 950 });
    assert.equal(r.state.players[1].hp, 7);
});
test('Super Man 选牌弃掉最后一张后继续对局，含延迟的 #62 结算', t => {
    for (const deferred of [false, true]) {
        const { r, act } = setup(t, deferred ? [62, 6] : [61], deferred ? [61] : [6]);
        act(0, { type: 'play', uid: 900 });
        if (deferred)
            act(1, { type: 'play', uid: 950 });
        assert.equal(r.state.phase.kind, 'select');
        act(deferred ? 0 : 1, { type: 'discard', uid: deferred ? 901 : 950 });
        assert.equal(r.state.phase.kind, 'play');
        assert.equal(r.state.pending, undefined);
        assert.equal(r.state.stack.length, 0);
        if (deferred)
            assert.equal(r.state.players[1].hp, 1);
    }
});
test('#15 支持公开效果区目标，伪造手牌 uid 仍进入盲选', t => {
    for (const target of ['XHS-009', 'XHS-008'])
        for (const combo of [false, true]) {
            const { r, act } = setup(t, combo ? [67, 15] : [15], []);
            r.state.players[1].field = [{ card: { uid: 999, defId: target }, owner: 1, placedAt: 0 }];
            act(0, { type: 'play', uid: 900, withUid: combo ? 901 : undefined, targetUid: 999 });
            assert.equal(r.state.players[1].field.length, 0);
            assert.equal(r.flow, null);
        }
    const { r, act } = setup(t, [15], [6, 8]);
    act(0, { type: 'play', uid: 900, targetUid: 951 });
    assert.equal(r.flow.kind, 'pick');
    assert.equal(r.flow.action.targetUid, undefined);
    assert.equal(r.flow.handles.size, 1);
});
test('#5 反制 #4 不进入 QTE，主动打出仍进入 QTE', t => {
    const { r, act } = setup(t, [4], [5]);
    act(0, { type: 'play', uid: 900 });
    act(1, { type: 'play', uid: 950 });
    assert.equal(r.flow, null);
    assert.equal(r.state.phase.kind, 'play');
    assert.equal(r.state.players[1].hp, 7);
    const active = setup(t, [5], []);
    active.act(0, { type: 'play', uid: 900 });
    assert.equal(active.r.flow.kind, 'qte');
});
test('宿舍加成作用于响应和免费出牌，消耗下一张的倍率提升', t => {
    for (const free of [false, true]) {
        const { r, act } = setup(t, free ? [63] : [35], free ? [33] : [34]);
        r.state.players[1].hp = 3;
        r.state.players[1].field = [{ card: { uid: 999, defId: 'XHS-057' }, owner: 1, placedAt: 0 }];
        act(0, { type: 'play', uid: 900 });
        act(1, { type: 'play', uid: 950 });
        assert.equal(r.state.players[1].hp, 5);
        assert.equal(r.state.players[1].sp, free ? 0 : 7);
    }
    const { r, act } = setup(t, [35], [34]);
    r.state.players[1].hp = 3;
    r.state.players[1].boost = true;
    r.state.players[1].field = [{ card: { uid: 999, defId: 'XHS-057' }, owner: 1, placedAt: 0 }];
    act(0, { type: 'play', uid: 900 });
    act(1, { type: 'play', uid: 950 });
    assert.equal(r.state.players[1].hp, 6);
    assert.equal(r.state.players[1].boost, false);
});
test('非法 WebSocket 帧只断开自身，其他连接和新建房不受影响', { timeout: 5000 }, async (t) => {
    const srv = startServer(0);
    t.after(() => srv.close());
    await once(srv.wss, 'listening');
    const port = srv.wss.address().port;
    const good = new Client(`ws://127.0.0.1:${port}/ws`);
    await good.open();
    t.after(() => good.close());
    const socket = net.connect(port, '127.0.0.1');
    t.after(() => socket.destroy());
    socket.on('error', () => { });
    await once(socket, 'connect');
    socket.write('GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
    await once(socket, 'data');
    const closed = once(socket, 'close');
    socket.write(Buffer.from([0xc1, 0x80, 0, 0, 0, 0]));
    socket.resume();
    await closed;
    good.send({ t: 'create_room' });
    await good.next(m => m.t === 'room');
    good.send({ t: 'leave' });
    good.send({ t: 'create_room' });
    await good.next(m => m.t === 'room');
    assert.equal(srv.rooms.size, 1);
});
test('独立客户端命令行入口启动并保持运行', { timeout: 5000 }, async (t) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../client/serve.ts', import.meta.url))], { env: { ...process.env, CLIENT_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => child.kill());
    const [output] = await once(child.stdout, 'data');
    assert.match(String(output), /客户端/);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(child.exitCode, null);
});
