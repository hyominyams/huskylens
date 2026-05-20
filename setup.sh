#!/usr/bin/env bash
# HUSKYLENS Vision · 자동 설치 스크립트 (macOS / Linux)
# 사용법:  bash setup.sh

set -e

REQUIRED_MAJOR=20

print_header() {
  echo ""
  echo "═══════════════════════════════════════════════"
  echo " HUSKYLENS Vision · Setup"
  echo "═══════════════════════════════════════════════"
}

print_step() {
  echo ""
  echo "▸ $1"
}

current_node_major() {
  if command -v node >/dev/null 2>&1; then
    node -v | sed 's/^v//' | cut -d. -f1
  else
    echo 0
  fi
}

ensure_node() {
  local current
  current=$(current_node_major)

  if [ "${current:-0}" -ge "$REQUIRED_MAJOR" ]; then
    echo "✓ Node.js $(node -v) 확인됨"
    return 0
  fi

  print_step "Node.js ${REQUIRED_MAJOR}+ 가 없습니다. fnm 으로 자동 설치합니다."

  # 1) fnm 설치 (사용자 홈에만 — sudo 불필요)
  if ! command -v fnm >/dev/null 2>&1; then
    echo "  · fnm 다운로드 중..."
    curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell --install-dir "$HOME/.local/share/fnm" >/dev/null
  fi

  export PATH="$HOME/.local/share/fnm:$PATH"

  if ! command -v fnm >/dev/null 2>&1; then
    echo ""
    echo "✗ fnm 자동 설치 실패."
    echo "  → https://nodejs.org/ 에서 Node.js LTS 를 직접 설치한 뒤 이 스크립트를 다시 실행하세요."
    exit 1
  fi

  eval "$(fnm env --shell bash)"

  echo "  · Node.js ${REQUIRED_MAJOR} 설치 중..."
  fnm install "$REQUIRED_MAJOR" >/dev/null
  fnm use "$REQUIRED_MAJOR" >/dev/null
  fnm default "$REQUIRED_MAJOR" >/dev/null 2>&1 || true

  # 2) 셸 프로필에 fnm 활성화 라인 추가 (다음 터미널에서도 자동 인식)
  local profile=""
  if [ -n "${ZSH_VERSION:-}" ] || [ -f "$HOME/.zshrc" ]; then
    profile="$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then
    profile="$HOME/.bashrc"
  elif [ -f "$HOME/.bash_profile" ]; then
    profile="$HOME/.bash_profile"
  fi

  if [ -n "$profile" ] && ! grep -q 'fnm env' "$profile" 2>/dev/null; then
    {
      echo ""
      echo "# fnm (Node version manager) — added by HUSKYLENS setup"
      echo 'export PATH="$HOME/.local/share/fnm:$PATH"'
      echo 'eval "$(fnm env --use-on-cd)"'
    } >> "$profile"
    echo "  · $profile 에 fnm 활성화 라인 추가됨"
  fi

  echo "✓ Node.js $(node -v) 설치 완료"
}

print_header
ensure_node

print_step "프로젝트 의존성 설치 (npm install)..."
npm install --no-fund --no-audit

if [ ! -f .env ]; then
  cp .env.example .env
  print_step ".env 파일을 생성했습니다."
  echo "  → 에디터로 .env 를 열어 OPENAI_API_KEY=sk-... 를 채워주세요."
fi

echo ""
echo "═══════════════════════════════════════════════"
echo " ✓ 설치 완료"
echo "═══════════════════════════════════════════════"
echo ""
echo " 다음 단계:"
echo "   1. .env 파일을 열어 OPENAI_API_KEY 를 채웁니다."
echo "   2. 실행:  npm start"
echo "   3. 브라우저:  http://localhost:5173"
echo ""
