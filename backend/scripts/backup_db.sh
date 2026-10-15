#!/usr/bin/env bash
# backend/scripts/backup_db.sh — backup diario de foda.db.
#
# SQLite hace que "backup" sea literalmente "copiar el archivo"
# (ARCHITECTURE.md §2), pero NO alcanza con un `cp` directo mientras la API
# puede estar escribiendo: se usa `sqlite3 .backup`, que toma un snapshot
# consistente incluso con el archivo en uso (usa el mismo mecanismo que un
# backup "en caliente" de SQLite).
#
# Guarda los últimos N días (default 14) y borra los más viejos, para no
# llenar el disco de la e2-micro con backups eternos.
#
# Uso manual:
#   ./backup_db.sh /ruta/a/foda.db /ruta/a/backups
#
# Uso recomendado: cronjob diario, por ejemplo a las 3am.
#   crontab -e
#   0 3 * * * /home/tuusuario/foda-export-misiones/backend/scripts/backup_db.sh \
#       /home/tuusuario/foda-export-misiones/backend/foda.db \
#       /home/tuusuario/foda-backups >> /home/tuusuario/foda-backups/backup.log 2>&1

set -euo pipefail

DB_PATH="${1:?Uso: backup_db.sh <ruta-a-foda.db> <carpeta-de-backups>}"
BACKUP_DIR="${2:?Uso: backup_db.sh <ruta-a-foda.db> <carpeta-de-backups>}"
DIAS_A_CONSERVAR="${DIAS_A_CONSERVAR:-14}"

if [ ! -f "$DB_PATH" ]; then
  echo "No existe $DB_PATH -- ¿la API ya corrió al menos una vez (se crea sola al arrancar)?"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

FECHA=$(date +%Y%m%d_%H%M%S)
DESTINO="$BACKUP_DIR/foda_${FECHA}.db"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$DESTINO'"
else
  echo "sqlite3 no está instalado -- usando cp como fallback (menos seguro si hay escrituras concurrentes)."
  cp "$DB_PATH" "$DESTINO"
fi

echo "Backup creado: $DESTINO"

find "$BACKUP_DIR" -name 'foda_*.db' -mtime "+${DIAS_A_CONSERVAR}" -print -delete
