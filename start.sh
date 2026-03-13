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
