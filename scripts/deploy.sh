#!/bin/bash
# Agent Link 部署脚本

set -e

# 配置
ENVIRONMENT="${1:-staging}"
BACKEND_URL=""

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

# 检查依赖
check_deps() {
  log_info "检查依赖..."
  
  if ! command -v node &> /dev/null; then
    log_error "需要安装 Node.js"
    exit 1
  fi
  
  if ! command -v npx &> /dev/null; then
    log_error "需要安装 npx"
    exit 1
  fi
  
  log_success "依赖检查通过"
}

# 部署后端
deploy_backend() {
  log_info "部署后端服务..."
  
  cd backend
  
  # 安装依赖
  npm install
  
  # 根据环境选择配置
  if [ "$ENVIRONMENT" = "production" ]; then
    log_info "使用生产环境配置"
    npx wrangler deploy --env production
  else
    log_info "使用预发布环境配置"
    npx wrangler deploy --env staging
  fi
  
  cd ..
  log_success "后端部署完成"
}

# 部署 Skill
deploy_skill() {
  log_info "部署 Skill..."
  
  cd skill
  
  # 安装依赖
  npm install
  
  # 构建
  npm run build
  
  # 发布到 npm（可选）
  if [ "$ENVIRONMENT" = "production" ]; then
    log_info "发布到 npm..."
    npm publish --access public
  fi
  
  cd ..
  log_success "Skill 部署完成"
}

# 部署前端
deploy_frontend() {
  log_info "部署前端页面..."
  
  cd website
  
  if [ "$ENVIRONMENT" = "production" ]; then
    npx wrangler pages deploy . --project-name=agent-link-prod
  else
    npx wrangler pages deploy . --project-name=agent-link-staging
  fi
  
  cd ..
  log_success "前端部署完成"
}

# 运行测试
run_tests() {
  log_info "运行端到端测试..."
  
  if [ -f scripts/test-e2e.sh ]; then
    BACKEND_URL="$BACKEND_URL" ./scripts/test-e2e.sh
  else
    log_warn "测试脚本不存在，跳过"
  fi
}

# 显示部署信息
show_info() {
  echo
  echo "================================"
  echo "部署完成"
  echo "================================"
  echo "环境: $ENVIRONMENT"
  echo
  
  if [ "$ENVIRONMENT" = "production" ]; then
    echo "后端: https://agent-link.your-subdomain.workers.dev"
    echo "前端: https://link.openclaw.ai"
  else
    echo "后端: https://agent-link-staging.your-subdomain.workers.dev"
    echo "前端: https://staging-link.openclaw.ai"
  fi
  
  echo
  echo "测试命令:"
  echo "  ./scripts/test-e2e.sh"
  echo
  echo "查看日志:"
  echo "  cd backend && npx wrangler tail"
  echo "================================"
}

# 主函数
main() {
  echo "================================"
  echo "Agent Link 部署脚本"
  echo "================================"
  echo
  
  # 验证环境参数
  if [ "$ENVIRONMENT" != "staging" ] && [ "$ENVIRONMENT" != "production" ]; then
    log_error "用法: $0 [staging|production]"
    exit 1
  fi
  
  log_info "部署环境: $ENVIRONMENT"
  
  # 检查依赖
  check_deps
  
  # 确认部署
  if [ "$ENVIRONMENT" = "production" ]; then
    log_warn "即将部署到生产环境！"
    read -p "确认继续? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
      log_info "取消部署"
      exit 0
    fi
  fi
  
  # 部署各组件
  deploy_backend
  deploy_skill
  deploy_frontend
  
  # 运行测试
  run_tests
  
  # 显示信息
  show_info
  
  log_success "部署完成！"
}

# 运行
main "$@"