import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { startServer } from '../../server/src/main.ts';
import { DEFAULT_TIMING } from '../../server/src/room.ts';
import { createGame, apply } from '../../engine/src/engine.ts';
import { CARDS } from '../../engine/src/cards.ts';
import { once } from 'node:events';
const srv = startServer(0, { ...DEFAULT_TIMING, playMs: 60000, fakeDelayMin: 0, fakeDelayMax: 0 });
await once(srv.wss, 'listening');
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const pageErrors = [];
const U = `http://127.0.0.1:${srv.wss.address().port}/`;
async function pair() { const context = await browser.newContext(); const a = await context.newPage(), b = await context.newPage(); for (const page of [a, b]) {
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.goto(U);
    await page.waitForFunction(() => window.__xhs?.ws?.readyState === 1);
} await a.click('#btn-create'); await a.waitForFunction(() => document.querySelector('#room-code').textContent.length === 6); const code = await a.textContent('#room-code'); await b.fill('#in-code', code); await b.click('#btn-join'); await a.click('[data-f="sweet"]'); await b.click('[data-f="savory"]'); await a.waitForFunction(() => window.__xhs.view); await b.waitForFunction(() => window.__xhs.view); return { context, a, b, room: srv.rooms.get(code) }; }
async function fixture(p, hand, field = [], sp = 7) { const s = createGame(CARDS, ['sweet', 'savory'], 1); s.phase = { kind: 'play', active: 0 }; s.players[0].hand = hand.map((id, i) => ({ uid: 900 + i, defId: `XHS-${String(id).padStart(3, '0')}` })); s.players[1].hand = []; s.players[0].field = field; s.players[0].sp = sp; p.room.commitState(s, null); await p.a.waitForFunction(() => window.__xhs.view?.players[0].hand[0]?.uid === 900); await p.a.waitForTimeout(50); }
try {
    {
        const p = await pair();
        p.a.once('dialog', d => d.accept());
        await p.a.getByRole('button', { name: '认输离开' }).click();
        await p.a.waitForTimeout(100);
        await p.a.click('#btn-create');
        await p.a.waitForTimeout(250);
        assert.equal(await p.a.isVisible('#lobby-start'), false);
        assert.equal(srv.rooms.size, 1);
        console.log('leave-then-create-once', JSON.stringify({ lobbyVisible: await p.a.isVisible('#lobby-start'), roomCount: srv.rooms.size, toast: await p.a.textContent('#toast') }));
        await p.context.close();
    }
    {
        const p = await pair();
        await fixture(p, [67, 42], [], 0);
        const legal = apply(p.room.state, { type: 'play', player: 0, uid: 901, withUid: 900, choice: 1 }, { cards: CARDS });
        await p.a.locator('#my-hand [data-def="XHS-042"]').click();
        const mainModal = await p.a.isVisible('#modal');
        assert.equal(mainModal, true);
        assert.equal(await p.a.inputValue('#f-with'), '900');
        await p.a.click('#f-cancel');
        await p.a.locator('#my-hand [data-def="XHS-067"]').click();
        await p.a.selectOption('#f-with', '901');
        await p.a.check('input[name=f-choice][value="1"]');
        await p.a.click('#f-ok');
        await p.a.waitForFunction(() => window.__xhs.view.players[0].hand.length === 0);
        assert.equal(p.room.state.players[1].hp, 6);
        console.log('discount-combo-choice', JSON.stringify({ mainModal, toast: await p.a.textContent('#toast'), handCount: p.room.state.players[0].hand.length, engineLegalEnemyHp: legal.players[1].hp }));
        await p.context.close();
    }
    {
        const p = await pair();
        await fixture(p, [6], [{ card: { uid: 999, defId: 'XHS-009' }, owner: 0, placedAt: 0, count: 1 }]);
        const s = structuredClone(p.room.state);
        s.players[0].field = [];
        s.players[0].discard.push({ uid: 999, defId: 'XHS-009' });
        p.room.commitState(s, null);
        await p.a.waitForTimeout(100);
        p.room.close();
        await p.a.waitForTimeout(1300);
        assert.equal(await p.a.isVisible('#game'), false);
        assert.equal(await p.a.isVisible('#lobby'), true);
        assert.equal(await p.a.evaluate(() => window.__xhs.view), null);
        console.log('closed-room-after-animation', JSON.stringify({ gameVisible: await p.a.isVisible('#game'), lobbyVisible: await p.a.isVisible('#lobby'), hasStaleView: !!await p.a.evaluate(() => window.__xhs.view), roomClosed: p.room.closed }));
        await p.context.close();
    }
    assert.deepEqual(pageErrors, []);
}
finally {
    await browser.close();
    await srv.close();
}
