"""
backend/schemas.py — formas de entrada/salida de la API (Pydantic).

Separado de models.py (la tabla SQLModel) a propósito: lo que el cliente
puede ENVIAR (EmpresaIn/RespuestaIn/AssessmentIn) es un subconjunto de lo
que queda guardado -- `id`, `equipo_id`, `resultados`, `version_motor` y
las fechas los decide siempre el servidor, nunca el cliente (ver
routers/assessments.py: es la base del "control de integridad" de
ARCHITECTURE.md §1).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class EmpresaIn(BaseModel):
    nombre: str
    empresaId: Optional[str] = None
    rubro: str
    mercadosObjetivo: list[str] = Field(default_factory=list)
    perfil: Literal["exporta_actualmente", "no_exporta_evalua_iniciar"]
    relevadoPor: Optional[str] = None
    fecha: date
    autorizaRecontacto: bool = False


class RespuestaIn(BaseModel):
    itemId: str
    situacion: Optional[int] = Field(default=None, ge=0, le=4)
    impacto: Optional[int] = Field(default=None, ge=0, le=3)
    observacion: str = ""


class AssessmentIn(BaseModel):
    """Lo que manda el frontend al guardar una evaluación. `resultados` NO
    se acepta acá -- el servidor siempre recalcula con engine_replica.py
    antes de persistir (ARCHITECTURE.md §1: "la API recalcula con una
    réplica Python antes de persistir", como control de integridad)."""

    empresa: EmpresaIn
    respuestas: list[RespuestaIn]
    versionCuestionario: str


class AssessmentOut(BaseModel):
    """Lo que devuelve la API -- misma forma que assessment.schema.json."""

    id: str
    empresa: dict[str, Any]
    respuestas: list[dict[str, Any]]
    resultados: dict[str, Any]
    metadata: dict[str, Any]

    model_config = {"from_attributes": True}


class AssessmentResumen(BaseModel):
    """Fila liviana para listar (sin las 110 respuestas ni los resultados
    completos): lo justo para elegir cuál abrir."""

    id: str
    nombre: str
    rubro: str
    perfil: str
    fecha: str
    veredicto: str
    indiceInterno: float
    indiceExterno: float
    cuadranteDominante: Optional[str] = None
    creadoEn: str
    actualizadoEn: str
