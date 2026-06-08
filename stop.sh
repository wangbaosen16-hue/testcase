#!/usr/bin/env bash
#
# stop.sh — 停止前后端服务
#

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGS_DIR="$PROJECT_ROOT/logs"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ---------- 端口（与 start.sh 保持一致）----------
BACKEND_PORT="${BACKEND_PORT:-3001}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

stopped_count=0

# ============================================================
# 按 PID 文件停止
# ============================================================
stop_by_pidfile() {
  local pidfile="$1" name="$2"

  if [ ! -f "$pidfile" ]; then
    log_warn "未找到 $name PID 文件: $pidfile"
    return 1
  fi

  local pid
  pid="$(cat "$pidfile" 2>/dev/null || true)"

  if [ -z "$pid" ]; then
    log_warn "$name PID 文件为空"
    rm -f "$pidfile"
    return 1
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    log_info "$name 进程不存在（PID: $pid），清理 PID 文件"
    rm -f "$pidfile"
    return 0
  fi

  log_info "正在停止 $name（PID: $pid）..."

  # 先发 SIGTERM，优雅关闭
  kill "$pid" 2>/dev/null || true

  # 等待最多 10 秒
  for i in $(seq 1 10); do
    if ! kill -0 "$pid" 2>/dev/null; then
      log_info "$name 已停止"
      rm -f "$pidfile"
      stopped_count=$((stopped_count + 1))
      return 0
    fi
    sleep 1
  done

  # 超时未关闭，强制 SIGKILL
  log_warn "$name 未响应，强制终止..."
  kill -9 "$pid" 2>/dev/null || true
  sleep 1

  if kill -0 "$pid" 2>/dev/null; then
    log_error "$name 无法终止（PID: $pid）"
    return 1
  fi

  log_info "$name 已强制终止"
  rm -f "$pidfile"
  stopped_count=$((stopped_count + 1))
  return 0
}

# ============================================================
# 按端口补刀（防止 PID 文件丢失）
# ============================================================
stop_by_port() {
  local port="$1" name="$2"

  if ! lsof -i :"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    return 0
  fi

  log_info "按端口 $port 清理残留 $name 进程..."
  lsof -i :"$port" -sTCP:LISTEN -t | xargs kill 2>/dev/null || true
  sleep 1

  # 仍有残留则强杀
  if lsof -i :"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    lsof -i :"$port" -sTCP:LISTEN -t | xargs kill -9 2>/dev/null || true
  fi
}

# ============================================================
# 执行停止
# ============================================================
log_info "============================================"
log_info "  停止前后端服务"
log_info "============================================"

stop_by_pidfile "$LOGS_DIR/backend.pid"  "后端"
stop_by_pidfile "$LOGS_DIR/frontend.pid" "前端"

stop_by_port "$BACKEND_PORT"  "后端"
stop_by_port "$FRONTEND_PORT" "前端"

echo ""
log_info "停止完毕，共清理 $stopped_count 个服务"
