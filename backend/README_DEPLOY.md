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
chmod +x deploy/setup_swap.sh scripts/backup_db.sh deploy/imprimir_url_tunnel.sh
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

## 6. Backup diario

```bash
sudo apt-get install -y sqlite3
mkdir -p ~/foda-backups
crontab -e
# agregar:
0 3 * * * /home/tuusuario/foda-export-misiones/backend/scripts/backup_db.sh /home/tuusuario/foda-export-misiones/backend/foda.db /home/tuusuario/foda-backups >> /home/tuusuario/foda-backups/backup.log 2>&1
```

Conserva 14 días (`DIAS_A_CONSERVAR=30` para cambiarlo). **Probá una restauración** (copiar un backup a otro nombre y abrirlo con `sqlite3`) antes de confiar en él. Los backups tienen datos de empresas: nunca al repo público.

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

Hacé un backup antes de borrar (`scripts/backup_db.sh`).

## Probar localmente (sin VM)

```bash
cd backend && python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
./venv/bin/python -m pytest -q
FODA_CORS_ORIGINS=http://localhost:8000 ./venv/bin/uvicorn main:app --port 8001
# en otra terminal: cd ../frontend && python3 -m http.server 8000
```
