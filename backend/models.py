"""
backend/models.py — modelo SQLModel de una evaluación persistida.

Corresponde a data/schema/assessment.schema.json (§4.2 de ARCHITECTURE.md),
con una diferencia deliberada: `resultados` acá YA incluye `matrizFoda`
(cruces FO/FA/DO/DA, cuadranteDominante, orientacionEstrategica, burbujas)
tal como lo calcula engine_replica.py, aunque el schema JSON todavía
describe una forma más vieja (campos `cuadranteDominante`/
`orientacionEstrategica` sueltos en `resultados`, sin `matrizFoda` anidado).
Esto es una inconsistencia real entre el schema y el motor -- documentada
acá y en NOTA_FASE4.md en vez de "arreglarse" en silencio tocando el schema
sin que el autor lo decida (regla del proyecto).

`empresa`, `respuestas` y `resultados` se guardan como JSON (no se
normalizan en columnas/tablas separadas): no hay necesidad de hacer
queries SQL sobre campos internos todavía, y el dataset completo de cada
evaluación es exactamente lo que se quiere poder exportar tal cual para
Zenodo/OSF (ARCHITECTURE.md §3.5) o analizar con pandas más adelante.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


def _uuid() -> str:
    return str(uuid.uuid4())


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


class Assessment(SQLModel, table=True):
    __tablename__ = "assessments"

    id: str = Field(default_factory=_uuid, primary_key=True)

    # A qué equipo/cátedra pertenece (de la API key usada al crearla, ver
    # auth.py) -- nunca viaja en el body del POST, lo fija el servidor.
    equipo_id: str = Field(index=True)

    # empresa: { nombre, empresaId, rubro, mercadosObjetivo, perfil,
    #            relevadoPor, fecha, autorizaRecontacto }
    empresa: dict[str, Any] = Field(sa_column=Column(JSON))

    # respuestas: [ { itemId, situacion, impacto, observacion }, ... ]
    respuestas: list[dict[str, Any]] = Field(sa_column=Column(JSON))

    # resultados: salida completa de engine_replica.calcular_assessment()
    # (porItem, porArea, indiceInterno, indiceExterno, veredicto, matrizFoda)
    resultados: dict[str, Any] = Field(sa_column=Column(JSON))

    version_motor: str
    version_cuestionario: str

    creado_en: datetime = Field(default_factory=_ahora)
    actualizado_en: datetime = Field(default_factory=_ahora)
