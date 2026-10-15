"""
backend/auth.py — autenticación mínima por API key, una por equipo/cátedra.

Esto es lo mínimo que pide ARCHITECTURE.md §6 ítem 1 ("Autenticación mínima
en la API antes de exponerla públicamente vía Cloudflare Tunnel, al menos
una API key por equipo/cátedra") -- no es OAuth ni JWT, es deliberadamente
simple: un header `X-API-Key`, buscado contra el mapa que arma config.py
desde la variable de entorno FODA_API_KEYS.

Por qué una API key por equipo y no una sola global: así una evaluación
queda asociada a qué equipo/cátedra la cargó (campo `equipo_id` en
models.Assessment), y si una clave se filtra o hay que darla de baja, se
revoca solo esa sin afectar a los demás equipos.
"""

from __future__ import annotations

from fastapi import Header, HTTPException, status

from config import api_keys


def equipo_actual(x_api_key: str = Header(..., alias="X-API-Key")) -> str:
    """Dependency de FastAPI: valida `X-API-Key` y devuelve el equipo_id
    asociado. 401 si falta o no coincide con ninguna clave configurada."""
    claves = api_keys()
    equipo_id = claves.get(x_api_key)
    if equipo_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key inválida o ausente (header X-API-Key).",
        )
    return equipo_id
