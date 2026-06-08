#!/usr/bin/env bash
#
# start.sh — 生产环境启动脚本
# 在云服务器上启动后端（Express）和前端（Vite Preview）
#

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGS_DIR="$PROJECT_ROOT/logs"

# ---------- 端口配置 ----------
BACKEND_PORT="${BACKEND_PORT:-3001}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

# ---------- 颜色输出 ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ---------- 准备日志目录 ----------
mkdir -p "$LOGS_DIR"

# ============================================================
# 1. 检查端口是否已被占用
# ============================================================
check_port() {
  local port="$1" name="$2"
  if lsof -i :"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    log_warn "端口 $port 已被占用（$name），尝试停止旧进程..."
    lsof -i :"$port" -sTCP:LISTEN -t | xargs kill 2>/dev/null || true
    sleep 1
    if lsof -i :"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
      log_error "端口 $port 仍被占用，无法启动 $name"
      return 1
    fi
  fi
}

# ============================================================
# 2. 安装依赖
# ============================================================
log_info "检查后端依赖..."
cd "$PROJECT_ROOT/backend"
if [ ! -d "node_modules" ]; then
  log_info "安装后端依赖..."
  npm install --production
else
  log_info "后端依赖已存在"
fi

log_info "检查前端依赖..."
cd "$PROJECT_ROOT/frontend"
if [ ! -d "node_modules" ]; then
  log_info "安装前端依赖..."
  npm install
else
  log_info "前端依赖已存在"
fi

# ============================================================
# 3. 构建
# ============================================================
log_info "构建后端..."
cd "$PROJECT_ROOT/backend"
npm run build

log_info "构建前端..."
cd "$PROJECT_ROOT/frontend"
npm run build

# ============================================================
# 4. 启动后端
# ============================================================
check_port "$BACKEND_PORT" "后端" || exit 1

log_info "启动后端（端口 $BACKEND_PORT）..."
cd "$PROJECT_ROOT/backend"
nohup node dist/index.js \
  > "$LOGS_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$LOGS_DIR/backend.pid"

# 等待后端就绪
for i in $(seq 1 15); do
  if curl -s "http://localhost:$BACKEND_PORT" >/dev/null 2>&1; then
    log_info "后端启动成功（PID: $BACKEND_PID）"
    break
  fi
  if [ "$i" -eq 15 ]; then
    log_error "后端启动超时，请查看日志: $LOGS_DIR/backend.log"
    exit 1
  fi
  sleep 1
done

# ============================================================
# 5. 启动前端
# ============================================================
check_port "$FRONTEND_PORT" "前端" || exit 1

log_info "启动前端（端口 $FRONTEND_PORT）..."
cd "$PROJECT_ROOT/frontend"
nohup npx vite preview --port "$FRONTEND_PORT" --host 0.0.0.0 \
  > "$LOGS_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$LOGS_DIR/frontend.pid"

for i in $(seq 1 10); do
  if curl -s "http://localhost:$FRONTEND_PORT" >/dev/null 2>&1; then
    log_info "前端启动成功（PID: $FRONTEND_PID）"
    break
  fi
  if [ "$i" -eq 10 ]; then
    log_error "前端启动超时，请查看日志: $LOGS_DIR/frontend.log"
    exit 1
  fi
  sleep 1
done

# ============================================================
# 完成
# ============================================================
echo ""
log_info "============================================"
log_info "  前后端已全部启动"
log_info "  后端 API:  http://0.0.0.0:$BACKEND_PORT"
log_info "  前端页面:  http://0.0.0.0:$FRONTEND_PORT"
log_info "  后端日志:  $LOGS_DIR/backend.log"
log_info "  前端日志:  $LOGS_DIR/frontend.log"
log_info "  停止服务:  $PROJECT_ROOT/stop.sh"
log_info "============================================"
