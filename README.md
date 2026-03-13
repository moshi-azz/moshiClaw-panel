# 🦅 moshiClaw Panel

Panel de control remoto para tu PC Ubuntu. Accedé desde el navegador o como PWA instalada en iOS.

## Qué incluye

- **📊 Monitor** — CPU, RAM, disco, temperatura, red en tiempo real con gráficos
- **💻 Terminal** — Shell completo en el navegador (xterm.js + node-pty)
- **🖥️ Pantalla** — Stream en tiempo real de tu pantalla Ubuntu via ffmpeg
- **🤖 Chat IA** — Chat con Gemini o DeepSeek que puede ejecutar comandos en tu PC

## Requisitos

- Ubuntu 20.04+ con Node.js 18+ y Python 3
- Sesión X11 activa (para captura de pantalla)
- Conexión a internet (para ngrok)

---

## Instalación rápida

```bash
# 1. Ir a la carpeta del proyecto
cd moshiClaw-panel

# 2. Instalar todo
chmod +x setup.sh && ./setup.sh

# 3. Arrancar
./start.sh
```

Al primer arranque el servidor genera una **contraseña aleatoria** y la guarda en `.env`.
La verás impresa en la consola:

```
🔑 Contraseña generada automáticamente:
   APP_PASSWORD = abc123def456...
```

---

## Configurar ngrok

```bash
# Autenticar (una sola vez)
ngrok config add-authtoken TU_TOKEN_AQUI

# Abrir túnel al servidor
ngrok http 3000
```

ngrok te dará una URL como `https://xxxx.ngrok-free.app` — usá esa URL desde tu iPhone.

---

## Usar con PM2 (para que no se cierre al cerrar terminal)

```bash
pm2 start server.js --name moshiClaw
pm2 startup    # genera comando para arrancar al inicio del sistema
pm2 save       # guarda la lista de procesos
```

---

## Instalar como app en iOS (PWA)

1. Abrí la URL de ngrok en **Safari** en tu iPhone
2. Tocá el botón de compartir (cuadrado con flecha)
3. Elegí **"Agregar a pantalla de inicio"**
4. La app aparece como icono nativo, sin barra de Safari

---

## Configurar el chat de IA

Dentro de la app, tocá ⚙️ y configurá:

| Proveedor | Dónde conseguir API key |
|-----------|------------------------|
| **Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **DeepSeek** | [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) |

> ⚠️ La API key se guarda **solo en el navegador** (localStorage). Nunca viaja al servidor.

---

## Seguridad

- Autenticación JWT con expiración de 24h
- Contraseña aleatoria generada automáticamente
- HTTPS forzado vía ngrok
- Rate limiting en el login (10 intentos / 15 min)
- Todos los WebSocket requieren token válido
- La IA pide confirmación antes de ejecutar comandos (configurable)

---

## Estructura del proyecto

```
moshiClaw-panel/
├── server.js              # Servidor principal
├── modules/
│   ├── auth.js            # JWT y autenticación
│   ├── monitoring.js      # Stats de hardware
│   ├── terminal.js        # Terminal PTY
│   ├── screen.js          # Streaming de pantalla
│   └── ai.js              # Adaptador Gemini/DeepSeek
├── public/
│   ├── index.html         # App PWA completa
│   ├── manifest.json      # PWA manifest
│   ├── sw.js              # Service Worker
│   └── icons/             # Iconos de la app
├── .env                   # Credenciales (auto-generado)
├── setup.sh               # Instalación
└── start.sh               # Arranque
```

---

## Solución de problemas

**La pantalla no se ve:**
```bash
# Verificar que ffmpeg esté instalado
ffmpeg -version

# Verificar el DISPLAY
echo $DISPLAY
# Si está vacío, agregar al .env: DISPLAY=:0
```

**Error de node-pty al instalar:**
```bash
sudo apt install build-essential python3
npm install
```

**Puerto 3000 ocupado:**
```bash
# Cambiar en .env:
PORT=8080
# Y ngrok: ngrok http 8080
```
