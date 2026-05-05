"""Compatibility module for legacy imports."""

from .db_client import DBConfig, FreeRadiusDBError, FreeRadiusMySQLClient

__all__ = ["DBConfig", "FreeRadiusDBError", "FreeRadiusMySQLClient"]
