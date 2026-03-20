#!/usr/bin/env bash
# start.sh — Arrancar moshiClaw Panel
cd "$(dirname "$0")"

# Cargar variables de entorno
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Detectar display X11 si no está seteado
if [ -z "$DISPLAY" ]; then
  # 1. Buscar sockets X11 reales
  _D=$(ls /tmp/.X11-unix/ 2>/dev/null | grep -E '^X[0-9]+$' | head -1 | sed 's/^X/:/')
  # 2. Fallback: columna TTY de 'w' (solo formato :[dígitos])
  [ -z "$_D" ] && _D=$(w -h 2>/dev/null | awk '{print $2}' | grep -E '^\:[0-9]+$' | head -1)
  export DISPLAY="${_D:-:0}"
fi

# Detectar y exportar tipo de sesión gráfica
SESSION_TYPE="${XDG_SESSION_TYPE:-$(loginctl show-session $(loginctl | grep $(whoami) | awk '{print $1}') -p Type --value 2>/dev/null || echo 'x11')}"
export XDG_SESSION_TYPE="$SESSION_TYPE"
[ -n "$WAYLAND_DISPLAY" ]       && export WAYLAND_DISPLAY="$WAYLAND_DISPLAY"
[ -n "$XDG_CURRENT_DESKTOP" ]   && export XDG_CURRENT_DESKTOP="$XDG_CURRENT_DESKTOP"
[ -n "$DESKTOP_SESSION" ]       && export DESKTOP_SESSION="$DESKTOP_SESSION"
[ -n "$GNOME_DESKTOP_SESSION_ID" ] && export GNOME_DESKTOP_SESSION_ID="$GNOME_DESKTOP_SESSION_ID"
[ -n "$DBUS_SESSION_BUS_ADDRESS" ] && export DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS"

# Matar instancias anteriores en el puerto
fuser -k ${PORT:-3000}/tcp 2>/dev/null && sleep 1

# Generar certificados HTTPS con TODAS las IPs del sistema
echo "🔐 Generando/actualizando certificados HTTPS..."
mkdir -p certs
# Construir lista de SANs con todas las IPs activas
ALL_IPS=$(hostname -I | tr ' ' '\n' | grep -E '^[0-9]+\.' | head -10)
SAN="IP:127.0.0.1,DNS:localhost"
for ip in $ALL_IPS; do
  SAN="${SAN},IP:${ip}"
done
openssl req -x509 -newkey rsa:2048 \
  -keyout certs/key.pem -out certs/cert.pem \
  -days 3650 -nodes \
  -subj "/CN=moshiclaw" \
  -addext "subjectAltName=${SAN}" 2>/dev/null \
  && echo "✅ Certificados generados para: ${SAN}" \
  || echo "⚠️  No se pudo generar cert. Continuando en HTTP..."

echo "🦅 Iniciando moshiClaw Panel..."
echo "   Puerto:  ${PORT:-3000}"
echo "   Display: ${DISPLAY}"
echo "   Sesión:  ${XDG_SESSION_TYPE}"
[ "${XDG_SESSION_TYPE}" = "wayland" ] && echo "   ⚠️  Wayland detectado — stream de pantalla usará capturas (~5fps)"
echo ""

# ─── N8N (Automatización de flujos) ─────────────────────────────────────────
N8N_PORT=${N8N_PORT:-5678}
N8N_PID_FILE="/tmp/moshiclaw_n8n.pid"

start_n8n() {
  if [ -f "$N8N_PID_FILE" ] && kill -0 "$(cat $N8N_PID_FILE)" 2>/dev/null; then
    echo "✅ n8n ya está corriendo (PID $(cat $N8N_PID_FILE))"
  else
    echo "⚙️  Iniciando n8n en puerto $N8N_PORT..."
    N8N_PORT=$N8N_PORT \
    N8N_BASIC_AUTH_ACTIVE=false \
    N8N_SECURE_COOKIE=false \
    WEBHOOK_URL=http://localhost:$N8N_PORT/ \
    npx n8n start > /tmp/moshiclaw_n8n.log 2>&1 &
    echo $! > "$N8N_PID_FILE"
    echo "✅ n8n iniciado (PID $!) — http://localhost:$N8N_PORT"
    echo "   Logs: tail -f /tmp/moshiclaw_n8n.log"
  fi
}

stop_n8n() {
  if [ -f "$N8N_PID_FILE" ]; then
    kill "$(cat $N8N_PID_FILE)" 2>/dev/null && echo "🛑 n8n detenido"
    rm -f "$N8N_PID_FILE"
  fi
}

stop_ollama() {
  : # Ollama es un servicio del sistema, no lo detenemos al cerrar el panel
}

start_ollama() {
  if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "✅ Ollama ya está corriendo"
  elif sudo systemctl is-enabled ollama > /dev/null 2>&1; then
    echo "🤖 Iniciando Ollama (GPU ROCm)..."
    sudo systemctl start ollama
    # Esperar hasta 15s a que levante
    for i in $(seq 1 15); do
      sleep 1
      if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo "✅ Ollama listo en http://localhost:11434"
        break
      fi
      [ $i -eq 15 ] && echo "⚠️  Ollama tardó en responder — continuando igual"
    done
  else
    echo "⚠️  Servicio ollama no encontrado — saltando"
  fi
}

trap stop_n8n EXIT INT TERM
start_ollama
echo ""
start_n8n
echo ""

while true; do
  echo "🚀 Iniciando servidor Node.js..."
  node server.js
  EXIT_CODE=$?
  if [ $EXIT_CODE -ne 0 ]; then
    echo "❌ El servidor Node.js terminó con código de error $EXIT_CODE. Reiniciando en 5 segundos..."
    sleep 5
  else
    echo "✅ El servidor Node.js se cerró limpiamente."
    break # Exit the loop if the server exits cleanly
  fi
done
