# Despliegue del backend en la VM e2-micro (GCP)

> Estos pasos **no se ejecutaron en la VM real** (se probó todo localmente). Hacelos en orden y anotá qué mide cada comando: el criterio de cierre de Fase 4 pide consumo medido junto al bot de Discord.

Reemplazá `tuusuario` por tu usuario real en la VM.

## 1. Código y entorno Python

```bash
cd ~
git clone https://github.com/<tu-usuario>/foda-export-misiones.git
cd foda-export-misiones/backend
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

El backend lee `questionnaire.json` y `dependenciasFoda.json` de `../frontend/src/data/` (por eso se clona el repo entero).

## 2. Swap de 2 GB (una sola vez)

```bash
chmod +x deploy/setup_swap.sh deploy/imprimir_url_tunnel.sh
sudo ./deploy/setup_swap.sh
```

## 3. Variables de entorno (fuera del repo)

Creá `/etc/foda-api.env` (permisos 600). **Las API keys reales van acá, nunca en git.**

```bash
sudo tee /etc/foda-api.env >/dev/null <<'EOF'
FODA_DATABASE_URL=sqlite:////home/tuusuario/foda-export-misiones/backend/foda.db
FODA_CORS_ORIGINS=https://TU-SITIO.netlify.app
FODA_API_KEYS=tecnicatura-2026:CLAVE-LARGA-ALEATORIA
EOF
sudo chmod 600 /etc/foda-api.env
```

Generar una clave: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`. Una por equipo/cátedra, separadas por coma (`equipoA:clave1,equipoB:clave2`).

## 4. Servicio de la API

```bash
sudo cp deploy/foda-api.service /etc/systemd/system/
sudo nano /etc/systemd/system/foda-api.service   # ajustar usuario y rutas
sudo systemctl daemon-reload
sudo systemctl enable --now foda-api
curl http://127.0.0.1:8000/health                 # debe responder {"status":"ok",...}
```

## 5. Quick Tunnel de Cloudflare

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
sudo mv cloudflared /usr/local/bin/ && sudo chmod +x /usr/local/bin/cloudflared
sudo cp deploy/foda-tunnel.service /etc/systemd/system/
sudo nano /etc/systemd/system/foda-tunnel.service  # ajustar usuario
sudo systemctl daemon-reload && sudo systemctl enable --now foda-tunnel
./deploy/imprimir_url_tunnel.sh                    # imprime la URL https://....trycloudflare.com
```

La URL cambia cada vez que el túnel arranca. Antes de cada jornada de entrevistas corré `imprimir_url_tunnel.sh` y, si cambió, cada equipo la actualiza en la app (⚙ Configuración). No hace falta re-deploy de Netlify.

## 6. Backup diario a Google Cloud Storage + restauración probada

Los scripts (`scripts/backup_db.py`, `scripts/restore_db.py`) usan solo Python estándar: **no necesitan el comando `sqlite3`**. Sí necesitan `gcloud` en la VM (en una VM de GCP ya viene instalado).

**Qué hace el backup:** copia consistente de la base (aunque la API esté escribiendo) → verifica `integrity_check` y que el JSON de todas las filas sea válido → comprime → manifiesto con SHA-256 → sube a `gs://backup-bot-academico/foda/` y comprueba el tamaño remoto. Si algo falla, sale con código ≠ 0 y queda escrito en el log. Código 2 = el backup local está bien pero falló la subida.

### 6.1 Verificar que la VM puede escribir en el bucket (una vez)

```bash
gcloud storage ls gs://backup-bot-academico/
echo prueba > /tmp/prueba.txt
gcloud storage cp /tmp/prueba.txt gs://backup-bot-academico/foda/prueba.txt
gcloud storage rm gs://backup-bot-academico/foda/prueba.txt
```

Si da `403` o "insufficient scopes": la cuenta de servicio de la VM no tiene permiso de escritura. Es **permiso de la VM** (no del script). Se arregla en Compute Engine → editar la VM (apagada) → "Acceso a las API de Cloud" → Storage: *Lectura y escritura*, y en el bucket dar a esa cuenta de servicio el rol *Storage Object Admin* (o *Creator + Viewer*). Como el bucket lo usa tu bot, probablemente ya está resuelto: confirmalo con el comando anterior.

Además, en la consola → bucket → pestaña *Permisos*, comprobá que **no** esté público (`allUsers`/`allAuthenticatedUsers`): tendrá datos de empresas.

### 6.2 Primer backup manual

```bash
mkdir -p ~/foda-backups
cd ~/foda-export-misiones/backend/scripts
python3 backup_db.py --db ~/foda-export-misiones/backend/foda.db --dir ~/foda-backups --gcs gs://backup-bot-academico/foda
echo "código de salida: $?"          # debe ser 0
gcloud storage ls gs://backup-bot-academico/foda/
```

### 6.3 Restauración de prueba (no toca la base viva)

```bash
python3 restore_db.py verificar latest --gcs gs://backup-bot-academico/foda
```

Debe terminar con `VERIFICACIÓN OK: N evaluaciones ... integrity_check = ok, JSON válido` y `Modo verificar: no se tocó la base viva`. Esto descarga el último backup **desde Google**, lo descomprime en una carpeta temporal y lo inspecciona. Es la prueba de que el backup sirve de verdad.

### 6.4 Restauración real (ensayo del desastre)

Solo cuando quieras recuperar datos, o una vez para ensayar (no hay riesgo: la base actual se guarda aparte):

```bash
python3 restore_db.py aplicar latest --gcs gs://backup-bot-academico/foda --db ~/foda-export-misiones/backend/foda.db
```

Detiene `foda-api`, mueve la base actual a `foda.db.pre-restore-<fecha>`, instala la restaurada, reinicia y consulta `/health`. Para volver atrás: detener el servicio, mover la `.pre-restore-...` de vuelta a `foda.db` y reiniciar. Para restaurar uno específico en vez de `latest`: `gs://backup-bot-academico/foda/foda_YYYYMMDD_HHMMSS.db.gz`. (`aplicar` usa `sudo systemctl`; hace falta sudo sin contraseña o correrlo con tu usuario habitual en la VM de GCP, que ya lo tiene.)

### 6.5 Programarlo (cron, 03:00 hora de la VM)

```bash
crontab -e
# agregar (una sola línea):
0 3 * * * PATH=/usr/local/bin:/usr/bin:/bin /usr/bin/python3 /home/hcgalvantech/foda-export-misiones/backend/scripts/backup_db.py --db /home/hcgalvantech/foda-export-misiones/backend/foda.db --dir /home/hcgalvantech/foda-backups --gcs gs://backup-bot-academico/foda >> /home/hcgalvantech/foda-backups/backup.log 2>&1
```

Al día siguiente: `tail -5 ~/foda-backups/backup.log` y `gcloud storage ls gs://backup-bot-academico/foda/`. (Si `gcloud` está en otra ruta, mirá `which gcloud` y ajustá el `PATH`.)

### 6.6 Retención

Local: 14 días (`--keep-days 30` para cambiarlo). En Google los archivos **no se borran solos** (pesan unos pocos KB cada uno). Si querés limpieza automática, crear una regla de ciclo de vida **solo para el prefijo `foda/`** (para no tocar los backups del bot): en el bucket → *Ciclo de vida* → agregar regla → Eliminar objetos con antigüedad > 90 días → condición *Prefijo: foda/*. Revisá la vista previa antes de guardar.

Los backups contienen datos de empresas: nunca al repo público.

## 7. Medir el consumo junto al bot (cierre de Fase 4)

```bash
systemctl status foda-api | grep -E "Memory|CPU"
ps -o rss,cmd -C uvicorn          # RSS en KB
free -h
journalctl -u foda-api --since today | tail
```

En la máquina de desarrollo el proceso ocupó ~67 MB de RSS tras guardar una evaluación (la VM puede dar otro número). Si el servicio supera `MemoryMax=200M` systemd lo reinicia: revisá `journalctl` por reinicios.

## 8. Frontend (Netlify)

Publicar la carpeta `frontend/`. En el navegador de cada equipo: ⚙ Configuración → URL del túnel + API key → "Guardar en servidor". Sin configuración la app sigue funcionando offline.

## Actualizar el backend después de un cambio

```bash
cd ~/foda-export-misiones && git pull
cd backend && ./venv/bin/pip install -r requirements.txt
sudo systemctl restart foda-api
curl http://127.0.0.1:8000/health
```

El túnel no hace falta reiniciarlo (la URL no cambia). Las tablas existentes se conservan: este cambio no modifica el esquema de la base.

## Borrar datos de prueba antes del piloto

```bash
sudo apt-get install -y sqlite3
sqlite3 ~/foda-export-misiones/backend/foda.db "select id, json_extract(empresa,'$.nombre'), actualizado_en from assessments;"
sqlite3 ~/foda-export-misiones/backend/foda.db "delete from assessments where id = '<ID>';"
```

Hacé un backup antes de borrar (sección 6.2).

## Probar localmente (sin VM)

```bash
cd backend && python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
./venv/bin/python -m pytest -q
FODA_CORS_ORIGINS=http://localhost:8000 ./venv/bin/uvicorn main:app --port 8001
# en otra terminal: cd ../frontend && python3 -m http.server 8000
```
