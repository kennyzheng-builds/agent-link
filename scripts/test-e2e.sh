#!/bin/bash
# Agent Link 端到端测试脚本

set -e

# 配置
BACKEND_URL="${BACKEND_URL:-http://localhost:8787}"
TEST_TIMEOUT=30

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 计数器
PASSED=0
FAILED=0

# 辅助函数
log_info() {
  echo -e "${YELLOW}[INFO]${NC} $1"
}

log_pass() {
  echo -e "${GREEN}[PASS]${NC} $1"
  ((PASSED++))
}

log_fail() {
  echo -e "${RED}[FAIL]${NC} $1"
  ((FAILED++))
}

# 测试 1: 健康检查
test_health() {
  log_info "测试 1: 健康检查"
  
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/health" || echo "000")
  
  if [ "$RESPONSE" = "200" ]; then
    log_pass "健康检查通过"
  else
    log_fail "健康检查失败 (HTTP $RESPONSE)"
  fi
}

# 测试 2: 创建会话
test_create_session() {
  log_info "测试 2: 创建会话"
  
  RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/session/create" \
    -H "Content-Type: application/json" \
    -d '{"participantId": "test-agent-a"}' 2>/dev/null || echo '{}')
  
  CODE=$(echo "$RESPONSE" | jq -r '.code // empty')
  
  if [ -n "$CODE" ] && [ ${#CODE} -eq 6 ]; then
    log_pass "创建会话成功，连接码: $CODE"
    echo "$CODE" > /tmp/test_session_code
  else
    log_fail "创建会话失败: $RESPONSE"
  fi
}

# 测试 3: 加入会话
test_join_session() {
  log_info "测试 3: 加入会话"
  
  CODE=$(cat /tmp/test_session_code 2>/dev/null || echo "")
  
  if [ -z "$CODE" ]; then
    log_fail "无可用连接码，跳过"
    return
  fi
  
  RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/session/$CODE/join" \
    -H "Content-Type: application/json" \
    -d '{"participantId": "test-agent-b"}' 2>/dev/null || echo '{}')
  
  STATUS=$(echo "$RESPONSE" | jq -r '.status // empty')
  
  if [ "$STATUS" = "connected" ]; then
    log_pass "加入会话成功"
  else
    log_fail "加入会话失败: $RESPONSE"
  fi
}

# 测试 4: 获取会话状态
test_session_status() {
  log_info "测试 4: 获取会话状态"
  
  CODE=$(cat /tmp/test_session_code 2>/dev/null || echo "")
  
  if [ -z "$CODE" ]; then
    log_fail "无可用连接码，跳过"
    return
  fi
  
  RESPONSE=$(curl -s "$BACKEND_URL/api/session/$CODE/status" 2>/dev/null || echo '{}')
  
  SESSION_CODE=$(echo "$RESPONSE" | jq -r '.code // empty')
  
  if [ "$SESSION_CODE" = "$CODE" ]; then
    log_pass "获取状态成功"
  else
    log_fail "获取状态失败: $RESPONSE"
  fi
}

# 测试 5: 过期连接码
test_expired_code() {
  log_info "测试 5: 过期连接码处理"
  
  RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/session/EXPIRED/join" \
    -H "Content-Type: application/json" \
    -d '{"participantId": "test-agent-c"}' 2>/dev/null || echo '{}')
  
  ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')
  
  if [ -n "$ERROR" ]; then
    log_pass "正确返回错误: $ERROR"
  else
    log_fail "未返回预期错误"
  fi
}

# 测试 6: WebSocket 连接（如果 wscat 可用）
test_websocket() {
  log_info "测试 6: WebSocket 连接"
  
  if ! command -v wscat &> /dev/null; then
    log_info "wscat 未安装，跳过 WebSocket 测试"
    return
  fi
  
  CODE=$(cat /tmp/test_session_code 2>/dev/null || echo "")
  
  if [ -z "$CODE" ]; then
    log_fail "无可用连接码，跳过"
    return
  fi
  
  # 尝试连接 WebSocket（5秒后断开）
  timeout 5 wscat -c "${BACKEND_URL/ws:/wss:}/api/session/$CODE/ws" 2>/dev/null &
  WS_PID=$!
  
  sleep 2
  
  if kill -0 $WS_PID 2>/dev/null; then
    log_pass "WebSocket 连接成功"
    kill $WS_PID 2>/dev/null
  else
    log_fail "WebSocket 连接失败"
  fi
}

# 清理
cleanup() {
  rm -f /tmp/test_session_code
}

# 主函数
main() {
  echo "================================"
  echo "Agent Link 端到端测试"
  echo "后端地址: $BACKEND_URL"
  echo "================================"
  echo
  
  # 检查依赖
  if ! command -v curl &> /dev/null; then
    echo "错误: 需要安装 curl"
    exit 1
  fi
  
  if ! command -v jq &> /dev/null; then
    echo "错误: 需要安装 jq"
    exit 1
  fi
  
  # 运行测试
  test_health
  test_create_session
  test_join_session
  test_session_status
  test_expired_code
  test_websocket
  
  # 清理
  cleanup
  
  # 总结
  echo
  echo "================================"
  echo "测试完成"
  echo "通过: $PASSED"
  echo "失败: $FAILED"
  echo "================================"
  
  if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}所有测试通过!${NC}"
    exit 0
  else
    echo -e "${RED}有测试失败${NC}"
    exit 1
  fi
}

# 捕获中断信号
trap cleanup EXIT

# 运行
main "$@"