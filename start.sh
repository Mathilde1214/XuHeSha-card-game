#!/usr/bin/env bash
# 一条命令启动《续禾杀》本地对战：房间服务 + 网页（同一端口）
# 用法：./start.sh            → http://127.0.0.1:8787/
#      PORT=9000 ./start.sh   → 换端口；HOST=0.0.0.0 ./start.sh → 局域网里别的电脑也能连
set -e
cd "$(dirname "$0")/server"
[ -d node_modules ] || npm install --silent
exec node src/main.ts
