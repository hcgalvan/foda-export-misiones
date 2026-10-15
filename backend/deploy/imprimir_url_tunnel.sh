#!/usr/bin/env bash
# backend/deploy/imprimir_url_tunnel.sh — imprime la URL pública activa del
# Quick Tunnel de Cloudflare (ARCHITECTURE.md §1.1, punto 3: "antes de cada
# sesión de entrevistas, quien gestiona la VM corre un script corto que
# imprime la URL activa del túnel... y la comparte con el equipo si
# cambió").
#
# El Quick Tunnel no tiene una URL fija -- Cloudflare le asigna una nueva
# cada vez que el proceso arranca, y la única forma de conocerla es leerla
# de los logs del propio proceso.
#
# Uso: ./imprimir_url_tunnel.sh

set -euo pipefail

URL=$(journalctl -u foda-tunnel --no-pager | grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' | tail -1 || true)

if [ -z "$URL" ]; then
  echo "No se encontró ninguna URL de trycloudflare.com en los logs de foda-tunnel."
  echo "¿Está corriendo el servicio? -> systemctl status foda-tunnel"
  exit 1
fi

echo "URL pública activa de la API: $URL"
echo "(Pegarla en la pantalla de Configuración del frontend si cambió)"
