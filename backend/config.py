"""
backend/config.py — configuración centralizada vía variables de entorno.

Todo lo que cambia entre "mi máquina" y "la VM de producción" (dónde está
la base SQLite, qué dominio de Netlify puede llamar a la API, qué API keys
son válidas) vive acá, leído de variables de entorno con defaults
razonables para desarrollo local. Nada de esto se hardcodea en el código
de los routers.

Variables soportadas (todas opcionales, con default de desarrollo):

- FODA_DATABASE_URL        (default: "sqlite:///./foda.db")
- FODA_CORS_ORIGINS        (default: "http://localhost:8000,http://127.0.0.1:8000")
                            lista separada por comas de orígenes permitidos.
                            En producción: el dominio real de Netlify
                            (ARCHITECTURE.md §1.1) -- nunca "*".
- FODA_API_KEYS            (default: "equipo-demo:clave-demo-insegura")
                            lista separada por comas de "equipo:clave".
                            CADA equipo/cátedra tiene su propia clave (ver
                            ARCHITECTURE.md §6, ítem 1). NO se commitea un
                            valor real -- se setea en el entorno de la VM
                            (o en un .env que está en .gitignore).
- FODA_QUESTIONNAIRE_PATH  (default: "../frontend/src/data/questionnaire.json")
- FODA_DEPENDENCIAS_PATH   (default: "../frontend/src/data/dependenciasFoda.json")
                            Se leen del frontend (no se duplican a mano) porque
                            backend/ y frontend/ viven en el mismo repo, como
                            hermanos (ARCHITECTURE.md §4.3). Si se despliega el
                            backend solo, sin el repo completo, hay que copiar
                            esos dos archivos y apuntar acá a la copia.
- FODA_VERSION_MOTOR       (default: "1.0.0-fase4") -- se guarda en cada
                            assessment persistido, para poder saber con qué
                            versión del motor se calculó (ARCHITECTURE.md §6,
                            ítem 4).
"""

from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _lista_desde_env(nombre: str, default: str) -> list[str]:
    valor = os.environ.get(nombre, default)
    return [v.strip() for v in valor.split(",") if v.strip()]


DATABASE_URL = os.environ.get("FODA_DATABASE_URL", "sqlite:///./foda.db")

CORS_ORIGINS = _lista_desde_env(
    "FODA_CORS_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000"
)

VERSION_MOTOR = os.environ.get("FODA_VERSION_MOTOR", "1.0.0-fase4")

QUESTIONNAIRE_PATH = Path(
    os.environ.get(
        "FODA_QUESTIONNAIRE_PATH", str(BASE_DIR / ".." / "frontend" / "src" / "data" / "questionnaire.json")
    )
).resolve()

DEPENDENCIAS_PATH = Path(
    os.environ.get(
        "FODA_DEPENDENCIAS_PATH",
        str(BASE_DIR / ".." / "frontend" / "src" / "data" / "dependenciasFoda.json"),
    )
).resolve()


def api_keys() -> dict[str, str]:
    """{clave: equipo_id}. Default inseguro SOLO para desarrollo local --
    en producción se sobreescribe con FODA_API_KEYS (ver docstring arriba)."""
    pares = _lista_desde_env("FODA_API_KEYS", "equipo-demo:clave-demo-insegura")
    resultado: dict[str, str] = {}
    for par in pares:
        if ":" not in par:
            continue
        equipo_id, clave = par.split(":", 1)
        resultado[clave] = equipo_id
    return resultado
