// 把网页客户端发布到 /workspace/xuhesha/web/（start.sh 的房间服务在 8787 直接发这个目录）
// 用法：node client/build.ts
import { cpSync, writeFileSync, rmSync } from 'node:fs';
import { cardsJson } from './serve.ts';
const WEB = new URL('../web/', import.meta.url).pathname;
rmSync(WEB, { recursive: true, force: true });
cpSync(new URL('./public/', import.meta.url).pathname, WEB, { recursive: true });
writeFileSync(WEB + 'cards.json', cardsJson());
console.log('已发布到', WEB);
