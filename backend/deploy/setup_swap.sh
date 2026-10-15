#!/usr/bin/env bash
# backend/deploy/setup_swap.sh — crea 2 GB de swap en la VM (ARCHITECTURE.md
# §1.2, punto 4): colchón de memoria ante picos simultáneos del bot de
# Discord y la API, en una e2-micro de 1 GB de RAM.
#
# Se corre UNA sola vez, a mano, en la VM (no en CI ni en el deploy
# automático de nada): requiere sudo y toca /etc/fstab.
#
# Uso:
#   chmod +x setup_swap.sh
#   sudo ./setup_swap.sh

set -euo pipefail

SWAPFILE="/swapfile"
TAMANO="2G"

if swapon --show | grep -q "$SWAPFILE"; then
  echo "Ya existe swap activo en $SWAPFILE -- no se hace nada."
  exit 0
fi

if [ -f "$SWAPFILE" ]; then
  echo "Ya existe el archivo $SWAPFILE pero no está activo. Revisá a mano antes de seguir."
  exit 1
fi

echo "Creando $SWAPFILE de $TAMANO..."
fallocate -l "$TAMANO" "$SWAPFILE"
chmod 600 "$SWAPFILE"
mkswap "$SWAPFILE"
swapon "$SWAPFILE"

if ! grep -q "^$SWAPFILE " /etc/fstab; then
  echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab
  echo "Agregado a /etc/fstab para que persista tras reiniciar la VM."
fi

echo "Listo. Estado actual:"
swapon --show
free -h
