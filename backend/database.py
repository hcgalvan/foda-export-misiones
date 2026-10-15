"""
backend/database.py — motor de base de datos SQLite + sesión por request.

SQLite por decisión de ARCHITECTURE.md §1.2/§2: un solo archivo, cero
administración, backup = copiar el archivo. `check_same_thread=False` es
necesario porque Uvicorn con un solo worker igual puede atender requests
en threads distintos del pool de FastAPI/Starlette; SQLModel/SQLAlchemy
maneja el acceso concurrente de forma segura con esta opción para SQLite.
"""

from __future__ import annotations

from collections.abc import Generator

from sqlmodel import Session, SQLModel, create_engine

from config import DATABASE_URL

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)


def crear_tablas() -> None:
    """Se llama una vez al arrancar la app (ver main.py). Si las tablas ya
    existen, SQLModel/SQLAlchemy no las toca -- esto no es una migración."""
    import models  # noqa: F401  (registra los modelos en SQLModel.metadata)

    SQLModel.metadata.create_all(engine)


def obtener_sesion() -> Generator[Session, None, None]:
    """Dependency de FastAPI: una sesión por request, cerrada al final."""
    with Session(engine) as session:
        yield session
