#!/usr/bin/env bash
# setup.sh — Instala todas las dependencias necesarias para moshiClaw Panel
# Ejecutar una sola vez: chmod +x setup.sh && ./setup.sh

set -e
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
step()    { echo -e "\n${GREEN}►${NC} $1"; }
fail()    { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║     🦅  MOSHICLAW PANEL — SETUP  🦅         ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

# ─── Verificar que estamos en Ubuntu ─────────────────────────────────────────
if ! command -v apt &>/dev/null; then
  fail "Este script requiere Ubuntu/Debian (apt)."
fi

step "Actualizando paquetes del sistema..."
sudo apt update -qq

# ─── Node.js (verificar versión) ──────────────────────────────────────────────
step "Verificando Node.js..."
NODE_VER=$(node --version 2>/dev/null | cut -d. -f1 | tr -d 'v' || echo 0)
if [ "$NODE_VER" -lt 18 ]; then
  warn "Node.js no encontrado o versión < 18. Instalando via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"
  nvm install 22
  nvm use 22
else
  info "Node.js $(node --version) ya instalado"
fi

# ─── Dependencias del sistema ─────────────────────────────────────────────────
step "Instalando dependencias del sistema..."

# node-pty necesita python3 y build-essential
sudo apt install -y -qq \
  build-essential \
  python3 \
  python3-pip \
  git \
  curl \
  wget \
  xdotool \
  x11-utils \
  scrot \
  ffmpeg \
  gnome-screenshot

info "Dependencias del sistema instaladas"

# ─── Ngrok ───────────────────────────────────────────────────────────────────
step "Verificando ngrok..."
if ! command -v ngrok &>/dev/null; then
  warn "Instalando ngrok..."
  curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
    | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
  echo "deb https://ngrok-agent.s3.amazonaws.com buster main" \
    | sudo tee /etc/apt/sources.list.d/ngrok.list
  sudo apt update -qq
  sudo apt install -y -qq ngrok
  info "ngrok instalado"
else
  info "ngrok $(ngrok --version) ya instalado"
fi

# ─── NPM packages ────────────────────────────────────────────────────────────
step "Instalando dependencias npm..."
cd "$(dirname "$0")"
npm install --production

info "npm packages instalados"

# ─── Configurar DISPLAY ──────────────────────────────────────────────────────
step "Configurando variables de entorno..."
if [ ! -f .env ]; then
  cp .env.example .env
  # Detectar display activo (método robusto)
  # 1. Buscar sockets X11 reales en /tmp/.X11-unix/
  ACTIVE_DISPLAY=$(ls /tmp/.X11-unix/ 2>/dev/null | grep -E '^X[0-9]+$' | head -1 | sed 's/^X/:/')
  # 2. Si no hay sockets, buscar en la columna TTY de 'w' (solo :[0-9]+)
  if [ -z "$ACTIVE_DISPLAY" ]; then
    ACTIVE_DISPLAY=$(w -h 2>/dev/null | awk '{print $2}' | grep -E '^\:[0-9]+$' | head -1)
  fi
  # 3. Usar variable de entorno DISPLAY si existe
  if [ -z "$ACTIVE_DISPLAY" ] && [ -n "$DISPLAY" ]; then
    ACTIVE_DISPLAY="$DISPLAY"
  fi
  # 4. Fallback a :0
  ACTIVE_DISPLAY="${ACTIVE_DISPLAY:-:0}"
  sed -i "s/DISPLAY=:0/DISPLAY=${ACTIVE_DISPLAY}/" .env
  info "Archivo .env creado (display: ${ACTIVE_DISPLAY})"
else
  info ".env ya existe"
fi

# ─── PM2 (opcional, para que arranque automáticamente) ────────────────────────
step "Instalando PM2 (gestor de procesos)..."
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2
  info "PM2 instalado"
else
  info "PM2 ya instalado"
fi

# ─── Permisos ─────────────────────────────────────────────────────────────────
chmod +x start.sh 2>/dev/null || true
chmod +x setup.sh 2>/dev/null || true

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║           ✅  SETUP COMPLETO               ║"
echo "╚═══════════════════════════════════════════╝"
echo ""
echo "  Para arrancar el servidor:"
echo "  $ ./start.sh"
echo ""
echo "  Para correr con PM2 (persiste si cerrás terminal):"
echo "  $ pm2 start server.js --name moshiClaw"
echo "  $ pm2 startup && pm2 save"
echo ""
echo "  Para el túnel ngrok:"
echo "  $ ngrok config add-authtoken TU_TOKEN"
echo "  $ ngrok http 3000"
echo ""
