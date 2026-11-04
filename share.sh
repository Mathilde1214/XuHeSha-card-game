#!/usr/bin/env bash
# 一条命令：启动《续禾杀》服务器 + 开 Cloudflare 临时隧道 + 打印公网地址（免费、不用注册）
# 用法：./share.sh      按 Ctrl+C 同时关掉服务器和隧道
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8787}"
CF="$(command -v cloudflared || echo ./tools/cloudflared)"
if [ ! -x "$CF" ]; then
  echo "第一次运行，下载 cloudflared…"
  mkdir -p tools
  curl -sSL -o tools/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x tools/cloudflared; CF=./tools/cloudflared
fi
(cd server && [ -d node_modules ] || npm install --silent)
PORT=$PORT node server/src/main.ts & SRV=$!
LOG=$(mktemp); "$CF" tunnel --no-autoupdate --protocol http2 --url "http://127.0.0.1:$PORT" > "$LOG" 2>&1 & TUN=$!
trap 'kill $SRV $TUN 2>/dev/null' EXIT INT TERM
for i in $(seq 60); do URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1); [ -n "$URL" ] && break; sleep 1; done
[ -z "$URL" ] && { echo "隧道没起来，日志："; cat "$LOG"; exit 1; }
echo; echo "======================================"
echo " 发给朋友的地址：$URL"
echo " 两人打开同一个地址，一个建房，一个输房间号"
echo "======================================"; echo
wait $SRV
