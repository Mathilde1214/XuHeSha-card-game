// 把网页客户端发布到 /workspace/xuhesha/web/（start.sh 的房间服务在 8787 直接发这个目录）
// 用法：node client/build.ts
import { cpSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { cardsJson } from './serve.ts';
const WEB = fileURLToPath(new URL('../web/', import.meta.url));
// 引擎去掉类型后给浏览器用（出牌提示 canPlay 与服务端同一份判定）；engine.js 是生成文件，别手改
writeFileSync(new URL('./public/engine.js', import.meta.url), '// 由 client/build.ts 从 engine/src/engine.ts 生成，勿手改\n' + stripTypeScriptTypes(readFileSync(new URL('../engine/src/engine.ts', import.meta.url), 'utf8')));
rmSync(WEB, { recursive: true, force: true });
cpSync(new URL('./public/', import.meta.url), WEB, { recursive: true });
writeFileSync(WEB + 'cards.json', cardsJson());
console.log('已发布到', WEB);
