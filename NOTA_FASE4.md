# Fase 4 — Backend y persistencia

## Dónde va cada archivo

```
backend/                  → carpeta nueva completa (main.py, config.py, database.py, models.py,
                            schemas.py, auth.py, cuestionario.py, engine_replica.py, routers/,
                            tests/, deploy/, scripts/, requirements.txt, pytest.ini, README_DEPLOY.md)
frontend/src/api.js       → nuevo (cliente de la API + cola de reintento)
frontend/src/app.js       → reemplaza el de Fase 3 (botón "Guardar en servidor", Configuración, cola)
frontend/index.html       → reemplaza el de Fase 3 (botones y panel de Configuración)
tests/api.test.mjs        → nuevo
ARCHITECTURE.md           → reemplaza el que tenías (§0, §4.2, §4.3 y §7)
data/schema/assessment.schema.json → reemplaza el de Fase 1 (forma anidada `resultados.matrizFoda`)
backend/tests/test_schema.py       → nuevo (ya incluido en backend/)
```

Agregá a `.gitignore` (si no está): `*.db`, `.env`, `venv/`, `__pycache__/`, `.pytest_cache/`.

## Qué hace

- `POST /assessments`: el frontend manda empresa + respuestas; **el servidor recalcula todo con `engine_replica.py`** y persiste. Si el cliente manda un `resultados` inventado, se ignora (hay un test que lo verifica).
- `GET /assessments` y `GET /assessments/{id}`: solo ven lo de su propio equipo (API key por equipo en el header `X-API-Key`).
- CORS restringido al dominio de Netlify por variable de entorno; `/health` para chequear el proceso.
- Frontend: si no hay API configurada o no hay red, la evaluación queda en una **cola local** y se reintenta (al apretar el botón o al volver la conexión). Un error 401/422 queda en la cola marcado, sin perderse.
- Deploy: servicio systemd con `MemoryMax=200M`/`CPUQuota=40%`, swap, Quick Tunnel, backup diario con `sqlite3 .backup`.

## Qué se verificó (y qué no)

Verificado acá: `node --test tests/*.mjs` → 21/21 (14 motor + 7 cliente API); `pytest` en `backend/` → 28/28 (15 golden del motor Python contra el mismo `golden.demo.json` + 8 de API + 5 de schema; los de schema necesitan `jsonschema`, incluido en requirements); prueba end-to-end con navegador real: cargar el DEMO por la UI → guardar en servidor → queda en SQLite con `VIABLE_CON_CONDICIONES` y cuadrante `DA`, más los tres casos de falla (API caída → cola, reintento OK, API key mala → 401 en cola). Consumo local ≈ 67 MB RSS.

**No verificado: nada de lo que corre en la VM** (systemd, túnel, swap, backup, consumo junto al bot). Eso es el cierre real de Fase 4: seguí `backend/README_DEPLOY.md` y avisame los números.

## Schema alineado (resuelto 15/10/2026)

`assessment.schema.json` ahora describe la forma real del motor: `resultados.matrizFoda` anidado (cruces, sinConsiderar, totalCruces, porcentajes, cuadranteDominante, orientacionEstrategica, burbujas). Se quitó `situacionPonderada` (no existe en el Excel) y se agregó `itemsTotales`. `backend/tests/test_schema.py` valida la salida real del motor contra el schema. Total `pytest`: 28/28. Detalle en `ARCHITECTURE.md §7`.

## Aviso de privacidad

Antes del piloto (Fase 5) con pymes reales: la API guarda razón social y respuestas. Hace falta consentimiento informado y que la VM/backups queden fuera del repo público. Los campos `empresaId` y `autorizaRecontacto` ya existen pero no se usan.

## Mejoras (diferidas, como pediste)

Pulido visual/UX queda para después de confirmar este MVP completo.
