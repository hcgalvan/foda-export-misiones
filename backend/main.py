"""
backend/main.py — instancia de FastAPI.

Corre con un solo worker de Uvicorn detrás del Quick Tunnel de Cloudflare
(ARCHITECTURE.md §1.1/§1.2): `uvicorn main:app --host 127.0.0.1 --port 8000
--workers 1`, nunca `--reload` en producción.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import CORS_ORIGINS, VERSION_MOTOR
from database import crear_tablas
from routers.assessments import router as assessments_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    crear_tablas()
    yield


app = FastAPI(
    title="FODA Export Misiones — API",
    description=(
        "Persistencia de evaluaciones FODA Export Misiones. El motor de "
        "cálculo real corre en el cliente (JS); esta API recalcula con una "
        "réplica Python (engine_replica.py) antes de guardar, como control "
        "de integridad (ver ARCHITECTURE.md §1)."
    ),
    version=VERSION_MOTOR,
    lifespan=lifespan,
)

# CORS restringido al dominio de Netlify (ARCHITECTURE.md §1.1) -- NUNCA
# "*" acá, porque la API guarda datos de evaluaciones reales de empresas.
# El valor real se setea con la variable de entorno FODA_CORS_ORIGINS en
# la VM; el default de config.py es solo para desarrollo local.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["X-API-Key", "Content-Type"],
)

app.include_router(assessments_router)


@app.get("/health")
def health() -> dict:
    """Usado por el script de la VM para confirmar que el proceso está
    vivo, y que el equipo pueda chequear rápido si la API responde antes
    de una sesión de entrevistas (ARCHITECTURE.md §1.1, punto 3)."""
    return {"status": "ok", "versionMotor": VERSION_MOTOR}
