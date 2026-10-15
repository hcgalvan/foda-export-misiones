"""
backend/routers/assessments.py — POST/GET de evaluaciones.

POST /assessments
    Recibe empresa + respuestas (crudas) del frontend, RECALCULA el
    resultado completo server-side con engine_replica.py (nunca confía en
    el `resultados` que calculó el JS del cliente -- ni siquiera se acepta
    en el body, ver schemas.AssessmentIn) y persiste. Esto es el "control
    de integridad" de ARCHITECTURE.md §1: el dato guardado no depende de
    que el JS del cliente no haya sido alterado.

GET /assessments
    Lista las evaluaciones del equipo autenticado (nunca las de otro
    equipo -- filtra siempre por `equipo_id` de la API key).

GET /assessments/{id}
    Una evaluación puntual, 404 si no existe o no es de este equipo.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from auth import equipo_actual
from config import VERSION_MOTOR
from cuestionario import dependencias_foda, questionnaire, respuestas_a_mapa
from database import obtener_sesion
from engine_replica import calcular_assessment
from models import Assessment
from schemas import AssessmentIn, AssessmentOut

router = APIRouter(prefix="/assessments", tags=["assessments"])


def _a_out(a: Assessment) -> AssessmentOut:
    return AssessmentOut(
        id=a.id,
        empresa=a.empresa,
        respuestas=a.respuestas,
        resultados=a.resultados,
        metadata={
            "versionMotor": a.version_motor,
            "versionCuestionario": a.version_cuestionario,
            "creadoEn": a.creado_en.isoformat(),
            "actualizadoEn": a.actualizado_en.isoformat(),
        },
    )


@router.post("", response_model=AssessmentOut, status_code=status.HTTP_201_CREATED)
def crear_assessment(
    body: AssessmentIn,
    equipo_id: str = Depends(equipo_actual),
    session: Session = Depends(obtener_sesion),
) -> AssessmentOut:
    respuestas_mapa = respuestas_a_mapa(body.respuestas)
    resultados = calcular_assessment(
        questionnaire(), respuestas_mapa, dependencias_foda=dependencias_foda()
    )

    ahora = datetime.now(timezone.utc)
    registro = Assessment(
        equipo_id=equipo_id,
        empresa=body.empresa.model_dump(mode="json"),
        respuestas=[r.model_dump() for r in body.respuestas],
        resultados=resultados,
        version_motor=VERSION_MOTOR,
        version_cuestionario=body.versionCuestionario,
        creado_en=ahora,
        actualizado_en=ahora,
    )
    session.add(registro)
    session.commit()
    session.refresh(registro)
    return _a_out(registro)


@router.get("", response_model=list[AssessmentOut])
def listar_assessments(
    limit: int = 50,
    offset: int = 0,
    equipo_id: str = Depends(equipo_actual),
    session: Session = Depends(obtener_sesion),
) -> list[AssessmentOut]:
    limit = max(1, min(limit, 200))
    consulta = (
        select(Assessment)
        .where(Assessment.equipo_id == equipo_id)
        .order_by(Assessment.creado_en.desc())
        .offset(offset)
        .limit(limit)
    )
    registros = session.exec(consulta).all()
    return [_a_out(r) for r in registros]


@router.get("/{assessment_id}", response_model=AssessmentOut)
def obtener_assessment(
    assessment_id: str,
    equipo_id: str = Depends(equipo_actual),
    session: Session = Depends(obtener_sesion),
) -> AssessmentOut:
    registro = session.get(Assessment, assessment_id)
    if registro is None or registro.equipo_id != equipo_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evaluación no encontrada.")
    return _a_out(registro)
