"""Asynchronous MySQL client for FreeRADIUS tables."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
import logging
from typing import Any

import aiomysql

from .const import (
    AUTH_TYPE_ACCEPT,
    AUTH_TYPE_ATTRIBUTE,
    AUTH_TYPE_DROP,
    AUTH_TYPE_REJECT,
    DEFAULT_OP_EQUAL,
    ENABLE_OFF,
    ENABLE_ON,
    ENTITY_TYPE_MAC,
    ENTITY_TYPE_USER,
    ENTITY_TYPES,
    PASSWORD_ATTRIBUTE,
    TABLE_ENTITY_TYPE,
)

_LOGGER = logging.getLogger(__name__)


class FreeRadiusDBError(Exception):
    """Custom DB error for normalized API behavior."""


@dataclass(slots=True)
class DBConfig:
    """DB settings used by aiomysql pool."""

    host: str
    port: int
    username: str
    password: str
    database: str


class FreeRadiusMySQLClient:
    """Repository-style access to FreeRADIUS tables."""

    def __init__(self, config: DBConfig) -> None:
        self._config = config
        self._pool: aiomysql.Pool | None = None

    async def connect(self) -> None:
        """Create a connection pool if not connected."""
        if self._pool is not None:
            return

        try:
            self._pool = await aiomysql.create_pool(
                host=self._config.host,
                port=self._config.port,
                user=self._config.username,
                password=self._config.password,
                db=self._config.database,
                autocommit=False,
                minsize=1,
                maxsize=10,
                charset="utf8mb4",
            )
        except Exception as err:  # noqa: BLE001
            raise FreeRadiusDBError(f"Could not connect to MySQL: {err}") from err

        await self.validate_schema()

    async def close(self) -> None:
        """Close pool gracefully."""
        if self._pool is None:
            return

        self._pool.close()
        await self._pool.wait_closed()
        self._pool = None

    async def validate_schema(self) -> None:
        """Validate mandatory tables and fail fast with actionable errors."""
        sql = (
            "SELECT COUNT(*) AS total FROM information_schema.tables "
            "WHERE table_schema=%s AND table_name=%s"
        )
        row = await self.fetch_one(sql, (self._config.database, TABLE_ENTITY_TYPE))
        if not row or int(row["total"]) == 0:
            raise FreeRadiusDBError(
                f"Required table '{TABLE_ENTITY_TYPE}' does not exist in schema "
                f"'{self._config.database}'."
            )

        # Backward compatible migration for integrations already running in production.
        await self._ensure_entity_type_description_column()

    async def _ensure_entity_type_description_column(self) -> None:
        """Ensure fr_entity_type has an optional description column."""
        row = await self.fetch_one(
            "SELECT COUNT(*) AS total FROM information_schema.columns "
            "WHERE table_schema=%s AND table_name=%s AND column_name='description'",
            (self._config.database, TABLE_ENTITY_TYPE),
        )
        if row and int(row["total"]) > 0:
            return

        await self.execute(
            "ALTER TABLE fr_entity_type "
            "ADD COLUMN description VARCHAR(255) NULL DEFAULT NULL AFTER entity_type"
        )

    async def fetch_all(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        """Run SELECT query and return all rows as dicts."""
        if self._pool is None:
            raise FreeRadiusDBError("MySQL pool is not initialized")

        try:
            async with self._pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    await cur.execute(sql, params)
                    return list(await cur.fetchall())
        except Exception as err:  # noqa: BLE001
            raise FreeRadiusDBError(str(err)) from err

    async def fetch_one(self, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        """Run SELECT query and return first row."""
        rows = await self.fetch_all(sql, params)
        return rows[0] if rows else None

    async def execute(self, sql: str, params: tuple[Any, ...] = ()) -> int:
        """Run INSERT/UPDATE/DELETE query and commit transaction."""
        if self._pool is None:
            raise FreeRadiusDBError("MySQL pool is not initialized")

        try:
            async with self._pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(sql, params)
                    await conn.commit()
                    return cur.rowcount
        except Exception as err:  # noqa: BLE001
            raise FreeRadiusDBError(str(err)) from err

    async def execute_many(self, sql: str, params_list: Iterable[tuple[Any, ...]]) -> int:
        """Run bulk operation and commit transaction."""
        if self._pool is None:
            raise FreeRadiusDBError("MySQL pool is not initialized")

        try:
            async with self._pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.executemany(sql, list(params_list))
                    await conn.commit()
                    return cur.rowcount
        except Exception as err:  # noqa: BLE001
            raise FreeRadiusDBError(str(err)) from err

    async def transaction(self, statements: list[tuple[str, tuple[Any, ...]]]) -> None:
        """Execute multiple SQL statements in a single transaction."""
        if self._pool is None:
            raise FreeRadiusDBError("MySQL pool is not initialized")

        conn = None
        try:
            async with self._pool.acquire() as conn:
                async with conn.cursor() as cur:
                    for sql, params in statements:
                        await cur.execute(sql, params)
                    await conn.commit()
        except Exception as err:  # noqa: BLE001
            if conn is not None:
                await conn.rollback()
            raise FreeRadiusDBError(str(err)) from err

    async def get_groups(self) -> list[dict[str, Any]]:
        """Return groups with all reply attributes and auth-type status."""
        sql = (
            "SELECT r.id, r.groupname, r.attribute, r.op, r.value, "
            "COALESCE(c.value, %s) as auth_type "
            "FROM radgroupreply r "
            "LEFT JOIN radgroupcheck c ON r.groupname = c.groupname "
            "AND c.attribute = %s "
            "ORDER BY r.groupname, r.id"
        )
        return await self.fetch_all(sql, (AUTH_TYPE_ACCEPT, AUTH_TYPE_ATTRIBUTE))

    async def get_group_names(self) -> list[str]:
        """Return list of unique group names for dropdown/select."""
        sql = (
            "SELECT DISTINCT groupname FROM radgroupreply "
            "UNION "
            "SELECT DISTINCT groupname FROM radgroupcheck "
            "ORDER BY groupname"
        )
        rows = await self.fetch_all(sql)
        return [row["groupname"] for row in rows]

    async def create_group(self, groupname: str, attributes: list[dict[str, str]]) -> None:
        """Create group rows in radgroupreply and default Auth-Type in radgroupcheck."""
        if not attributes:
            raise FreeRadiusDBError("Group must contain at least one attribute")

        statements = []
        for item in attributes:
            statements.append(
                (
                    "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (%s, %s, %s, %s)",
                    (groupname, item["attribute"], item.get("op", DEFAULT_OP_EQUAL), item["value"]),
                )
            )

        # Create default Auth-Type = Accept in radgroupcheck
        statements.append(
            (
                "INSERT INTO radgroupcheck (groupname, attribute, op, value) VALUES (%s, %s, %s, %s)",
                (groupname, AUTH_TYPE_ATTRIBUTE, DEFAULT_OP_EQUAL, AUTH_TYPE_ACCEPT),
            )
        )

        await self.transaction(statements)

    async def update_group(self, groupname: str, attributes: list[dict[str, str]]) -> None:
        """Replace group reply attributes."""
        if not attributes:
            raise FreeRadiusDBError("Group must contain at least one attribute")

        statements = [
            ("DELETE FROM radgroupreply WHERE groupname=%s", (groupname,)),
        ]
        for item in attributes:
            statements.append(
                (
                    "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (%s, %s, %s, %s)",
                    (groupname, item["attribute"], item.get("op", DEFAULT_OP_EQUAL), item["value"]),
                )
            )
        await self.transaction(statements)

    async def delete_group(self, groupname: str) -> None:
        """Delete group reply/check rules and links."""
        await self.transaction(
            [
                ("DELETE FROM radgroupreply WHERE groupname=%s", (groupname,)),
                ("DELETE FROM radgroupcheck WHERE groupname=%s", (groupname,)),
                ("DELETE FROM radusergroup WHERE groupname=%s", (groupname,)),
            ]
        )

    async def get_group_checks(self, groupname: str | None = None) -> list[dict[str, Any]]:
        """Return group check rules."""
        base_sql = (
            "SELECT id, groupname, attribute, op, value "
            "FROM radgroupcheck"
        )
        if groupname:
            return await self.fetch_all(f"{base_sql} WHERE groupname=%s ORDER BY id", (groupname,))
        return await self.fetch_all(f"{base_sql} ORDER BY groupname, id")

    async def create_group_check(self, groupname: str, attribute: str, op: str, value: str) -> None:
        """Insert a group check rule."""
        sql = (
            "INSERT INTO radgroupcheck (groupname, attribute, op, value) "
            "VALUES (%s, %s, %s, %s)"
        )
        await self.execute(sql, (groupname, attribute, op, value))

    async def update_group_check(self, rule_id: int, attribute: str, op: str, value: str) -> None:
        """Update a group check rule by id."""
        sql = "UPDATE radgroupcheck SET attribute=%s, op=%s, value=%s WHERE id=%s"
        await self.execute(sql, (attribute, op, value, rule_id))

    async def delete_group_check(self, rule_id: int) -> None:
        """Delete a group check rule."""
        await self.execute("DELETE FROM radgroupcheck WHERE id=%s", (rule_id,))

    async def set_group_enable(self, groupname: str, enabled: bool) -> None:
        """Set group Auth-Type to Accept (enabled) or Reject (disabled)."""
        new_value = AUTH_TYPE_ACCEPT if enabled else AUTH_TYPE_REJECT
        exists = await self.fetch_one(
            "SELECT 1 AS ok FROM radgroupcheck WHERE groupname=%s AND attribute=%s LIMIT 1",
            (groupname, AUTH_TYPE_ATTRIBUTE),
        )
        if not exists:
            raise FreeRadiusDBError(f"Group '{groupname}' not found in radgroupcheck")
        await self.execute(
            "UPDATE radgroupcheck SET value=%s WHERE groupname=%s AND attribute=%s",
            (new_value, groupname, AUTH_TYPE_ATTRIBUTE),
        )

    async def toggle_group_enable(self, groupname: str) -> str:
        """Toggle group Auth-Type between Accept/Reject and return new value."""
        row = await self.fetch_one(
            "SELECT value FROM radgroupcheck WHERE groupname=%s AND attribute=%s LIMIT 1",
            (groupname, AUTH_TYPE_ATTRIBUTE),
        )
        current = str(row["value"]).strip() if row and row.get("value") else AUTH_TYPE_ACCEPT
        new_value = AUTH_TYPE_REJECT if current == AUTH_TYPE_ACCEPT else AUTH_TYPE_ACCEPT
        await self.set_group_enable(groupname, new_value == AUTH_TYPE_ACCEPT)
        return new_value

    async def get_users(
        self,
        entity_type: str | None = None,
        groupname: str | None = None,
        search: str | None = None,
        page: int = 1,
        page_size: int = 25,
        sort_by: str = "username",
        sort_order: str = "asc",
    ) -> dict[str, Any]:
        """Return users and MACs with group and enable status."""
        if entity_type and entity_type not in ENTITY_TYPES:
            raise FreeRadiusDBError("Invalid entity_type")

        allowed_sort = {"username", "groupname", "groupnames", "entity_type", "enable", "description"}
        if sort_by not in allowed_sort:
            sort_by = "username"
        if sort_by == "groupname":
            sort_by = "groupnames"
        if sort_order.lower() not in {"asc", "desc"}:
            sort_order = "asc"

        where_parts: list[str] = [
            "EXISTS (SELECT 1 FROM radcheck rcx WHERE rcx.username=et.username)"
        ]
        params: list[Any] = []

        if entity_type:
            where_parts.append("et.entity_type=%s")
            params.append(entity_type)

        if groupname:
            where_parts.append(
                "EXISTS ("
                "SELECT 1 FROM radusergroup ugf "
                "WHERE ugf.username=et.username AND ugf.groupname=%s"
                ")"
            )
            params.append(groupname)

        if search:
            where_parts.append("(et.username LIKE %s OR COALESCE(et.description, '') LIKE %s)")
            search_like = f"%{search}%"
            params.extend([search_like, search_like])

        where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

        count_sql = (
            "SELECT COUNT(DISTINCT et.username) AS total "
            "FROM fr_entity_type et "
            f"{where_clause}"
        )
        total_row = await self.fetch_one(count_sql, tuple(params))
        total = int(total_row["total"]) if total_row else 0

        offset = max(0, (page - 1) * page_size)
        sql = (
            "SELECT et.username, et.entity_type, COALESCE(et.description, '') AS description, "
            "COALESCE(MAX(CASE "
            "WHEN rc.attribute=%s AND LOWER(TRIM(rc.value))=LOWER(%s) THEN %s "
            "WHEN rc.attribute=%s AND LOWER(TRIM(rc.value))=LOWER(%s) THEN %s "
            "WHEN rc.attribute=%s AND LOWER(TRIM(rc.value))=LOWER(%s) THEN %s "
            "ELSE NULL END), %s) AS enable, "
            "COALESCE(GROUP_CONCAT(DISTINCT g.groupname ORDER BY g.groupname SEPARATOR ', '), '') AS groupnames "
            "FROM fr_entity_type et "
            "LEFT JOIN radcheck rc ON rc.username=et.username "
            "LEFT JOIN radusergroup g ON g.username=et.username "
            f"{where_clause} "
            "GROUP BY et.username, et.entity_type, et.description "
            f"ORDER BY {sort_by} {sort_order.upper()} "
            "LIMIT %s OFFSET %s"
        )
        query_params = [
            AUTH_TYPE_ATTRIBUTE,
            AUTH_TYPE_ACCEPT,
            ENABLE_ON,
            AUTH_TYPE_ATTRIBUTE,
            AUTH_TYPE_REJECT,
            ENABLE_OFF,
            AUTH_TYPE_ATTRIBUTE,
            AUTH_TYPE_DROP,
            ENABLE_OFF,
            ENABLE_ON,
            *params,
            page_size,
            offset,
        ]
        rows = await self.fetch_all(sql, tuple(query_params))
        return {
            "items": rows,
            "page": page,
            "page_size": page_size,
            "total": total,
        }

    async def get_nas(self) -> list[dict[str, Any]]:
        """Return NAS rows from nas table."""
        sql = (
            "SELECT nasname, shortname, type, ports, secret, server, community, "
            "COALESCE(description, '') AS description "
            "FROM nas ORDER BY nasname"
        )
        return await self.fetch_all(sql)

    async def create_nas(
        self,
        nasname: str,
        shortname: str,
        nas_type: str,
        ports: int | None,
        secret: str,
        server: str | None,
        community: str | None,
        description: str | None,
    ) -> None:
        """Insert one NAS row."""
        await self.execute(
            "INSERT INTO nas "
            "(nasname, shortname, type, ports, secret, server, community, description) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (nasname, shortname, nas_type, ports, secret, server, community, description),
        )

    async def update_nas(
        self,
        nasname: str,
        shortname: str,
        nas_type: str,
        ports: int | None,
        secret: str,
        server: str | None,
        community: str | None,
        description: str | None,
    ) -> None:
        """Update NAS row identified by nasname."""
        affected = await self.execute(
            "UPDATE nas "
            "SET shortname=%s, type=%s, ports=%s, secret=%s, server=%s, community=%s, description=%s "
            "WHERE nasname=%s",
            (shortname, nas_type, ports, secret, server, community, description, nasname),
        )
        if affected == 0:
            raise FreeRadiusDBError("NAS not found")

    async def delete_nas(self, nasname: str) -> None:
        """Delete NAS row by nasname."""
        await self.execute("DELETE FROM nas WHERE nasname=%s", (nasname,))

    async def _set_entity_type(self, username: str, entity_type: str, description: str | None = None) -> None:
        sql = (
            "INSERT INTO fr_entity_type (username, entity_type, description) VALUES (%s, %s, %s) "
            "ON DUPLICATE KEY UPDATE "
            "entity_type=VALUES(entity_type), description=VALUES(description)"
        )
        await self.execute(sql, (username, entity_type, description))

    async def _replace_radreply(self, username: str, attributes: list[dict[str, str]]) -> None:
        statements: list[tuple[str, tuple[Any, ...]]] = [
            ("DELETE FROM radreply WHERE username=%s", (username,)),
        ]
        for item in attributes:
            statements.append(
                (
                    "INSERT INTO radreply (username, attribute, op, value) VALUES (%s, %s, %s, %s)",
                    (username, item["attribute"], item.get("op", DEFAULT_OP_EQUAL), item["value"]),
                )
            )
        await self.transaction(statements)

    async def _replace_group_links(self, username: str, groups: list[str]) -> None:
        statements: list[tuple[str, tuple[Any, ...]]] = [
            ("DELETE FROM radusergroup WHERE username=%s", (username,)),
        ]
        for priority, group_name in enumerate(groups, start=1):
            statements.append(
                (
                    "INSERT INTO radusergroup (username, groupname, priority) VALUES (%s, %s, %s)",
                    (username, group_name, priority),
                )
            )
        await self.transaction(statements)

    async def create_user(
        self,
        username: str,
        password: str | None,
        enable: str,
        entity_type: str,
        description: str | None,
        groups: list[str],
        reply_attributes: list[dict[str, str]],
    ) -> None:
        """Create user or MAC entity and related rows."""
        if entity_type not in ENTITY_TYPES:
            raise FreeRadiusDBError("Invalid entity_type")

        # Prevent accidental overwrite when username/MAC already exists.
        existing_type = await self.fetch_one(
            "SELECT 1 AS ok FROM fr_entity_type WHERE username=%s LIMIT 1",
            (username,),
        )
        existing_check = await self.fetch_one(
            "SELECT 1 AS ok FROM radcheck WHERE username=%s LIMIT 1",
            (username,),
        )
        if existing_type or existing_check:
            raise FreeRadiusDBError("User/MAC already exists")

        statements: list[tuple[str, tuple[Any, ...]]] = [
            ("DELETE FROM radcheck WHERE username=%s", (username,)),
            ("DELETE FROM radreply WHERE username=%s", (username,)),
            ("DELETE FROM radusergroup WHERE username=%s", (username,)),
        ]

        if entity_type == ENTITY_TYPE_USER:
            if not password:
                raise FreeRadiusDBError("Password is required for users")
            statements.append(
                (
                    "INSERT INTO radcheck (username, attribute, op, value) VALUES (%s, %s, %s, %s)",
                    (username, PASSWORD_ATTRIBUTE, DEFAULT_OP_EQUAL, password),
                )
            )

            if enable == ENABLE_OFF:
                statements.append(
                    (
                        "INSERT INTO radcheck (username, attribute, op, value) VALUES (%s, %s, %s, %s)",
                        (username, AUTH_TYPE_ATTRIBUTE, DEFAULT_OP_EQUAL, AUTH_TYPE_REJECT),
                    )
                )
        else:
            auth_type_value = AUTH_TYPE_ACCEPT if enable == ENABLE_ON else AUTH_TYPE_DROP
            statements.append(
                (
                    "INSERT INTO radcheck (username, attribute, op, value) VALUES (%s, %s, %s, %s)",
                    (username, AUTH_TYPE_ATTRIBUTE, DEFAULT_OP_EQUAL, auth_type_value),
                )
            )

        for item in reply_attributes:
            statements.append(
                (
                    "INSERT INTO radreply (username, attribute, op, value) VALUES (%s, %s, %s, %s)",
                    (username, item["attribute"], item.get("op", DEFAULT_OP_EQUAL), item["value"]),
                )
            )

        for priority, group_name in enumerate(groups, start=1):
            statements.append(
                (
                    "INSERT INTO radusergroup (username, groupname, priority) VALUES (%s, %s, %s)",
                    (username, group_name, priority),
                )
            )

        await self.transaction(statements)
        await self._set_entity_type(username, entity_type, description)

    async def update_user(
        self,
        username: str,
        password: str | None,
        enable: str,
        description: str | None,
        groups: list[str],
        reply_attributes: list[dict[str, str]],
    ) -> None:
        """Update user check/reply/group rows while preserving type."""
        entity_row = await self.fetch_one(
            "SELECT entity_type FROM fr_entity_type WHERE username=%s", (username,)
        )
        if entity_row is None:
            raise FreeRadiusDBError("User not found")

        entity_type = entity_row["entity_type"]

        statements: list[tuple[str, tuple[Any, ...]]] = [
            ("DELETE FROM radreply WHERE username=%s", (username,)),
            ("DELETE FROM radusergroup WHERE username=%s", (username,)),
            (
                "DELETE FROM radcheck WHERE username=%s AND attribute=%s",
                (username, AUTH_TYPE_ATTRIBUTE),
            ),
            ("UPDATE fr_entity_type SET description=%s WHERE username=%s", (description, username)),
        ]

        if entity_type == ENTITY_TYPE_USER:
            if enable == ENABLE_OFF:
                statements.append(
                    (
                        "INSERT INTO radcheck (username, attribute, op, value) VALUES (%s, %s, %s, %s)",
                        (username, AUTH_TYPE_ATTRIBUTE, DEFAULT_OP_EQUAL, AUTH_TYPE_REJECT),
                    )
                )
        else:
            auth_type_value = AUTH_TYPE_ACCEPT if enable == ENABLE_ON else AUTH_TYPE_DROP
            statements.append(
                (
                    "INSERT INTO radcheck (username, attribute, op, value) VALUES (%s, %s, %s, %s)",
                    (username, AUTH_TYPE_ATTRIBUTE, DEFAULT_OP_EQUAL, auth_type_value),
                )
            )

        if entity_type == ENTITY_TYPE_USER and password:
            statements.append(
                (
                    "DELETE FROM radcheck WHERE username=%s AND attribute=%s",
                    (username, PASSWORD_ATTRIBUTE),
                )
            )
            statements.append(
                (
                    "INSERT INTO radcheck (username, attribute, op, value) VALUES (%s, %s, %s, %s)",
                    (username, PASSWORD_ATTRIBUTE, DEFAULT_OP_EQUAL, password),
                )
            )

        for item in reply_attributes:
            statements.append(
                (
                    "INSERT INTO radreply (username, attribute, op, value) VALUES (%s, %s, %s, %s)",
                    (username, item["attribute"], item.get("op", DEFAULT_OP_EQUAL), item["value"]),
                )
            )

        for priority, group_name in enumerate(groups, start=1):
            statements.append(
                (
                    "INSERT INTO radusergroup (username, groupname, priority) VALUES (%s, %s, %s)",
                    (username, group_name, priority),
                )
            )

        await self.transaction(statements)

    async def get_user_entity(self, username: str) -> dict[str, Any] | None:
        """Return entity metadata from fr_entity_type for a username."""
        return await self.fetch_one(
            "SELECT username, entity_type, COALESCE(description, '') AS description "
            "FROM fr_entity_type WHERE username=%s LIMIT 1",
            (username,),
        )

    async def delete_user(self, username: str) -> None:
        """Delete entity from all managed tables."""
        await self.transaction(
            [
                ("DELETE FROM radcheck WHERE username=%s", (username,)),
                ("DELETE FROM radreply WHERE username=%s", (username,)),
                ("DELETE FROM radusergroup WHERE username=%s", (username,)),
                ("DELETE FROM fr_entity_type WHERE username=%s", (username,)),
            ]
        )

    async def set_user_enable(self, username: str, enabled: bool) -> None:
        """Set enable state: user uses Reject-or-delete, MAC uses Accept/Reject."""
        exists = await self.fetch_one("SELECT 1 AS ok FROM radcheck WHERE username=%s LIMIT 1", (username,))
        if not exists:
            raise FreeRadiusDBError("User not found in radcheck")

        entity_row = await self.fetch_one(
            "SELECT entity_type FROM fr_entity_type WHERE username=%s LIMIT 1",
            (username,),
        )
        if not entity_row:
            raise FreeRadiusDBError("User type not found")

        entity_type = str(entity_row["entity_type"]).strip().lower()

        if entity_type == ENTITY_TYPE_USER:
            if enabled:
                await self.execute(
                    "DELETE FROM radcheck WHERE username=%s AND attribute=%s",
                    (username, AUTH_TYPE_ATTRIBUTE),
                )
                return

            auth_type_row = await self.fetch_one(
                "SELECT id FROM radcheck WHERE username=%s AND attribute=%s LIMIT 1",
                (username, AUTH_TYPE_ATTRIBUTE),
            )
            if auth_type_row:
                await self.execute(
                    "UPDATE radcheck SET op=%s, value=%s WHERE id=%s",
                    (DEFAULT_OP_EQUAL, AUTH_TYPE_REJECT, int(auth_type_row["id"])),
                )
                return

            await self.execute(
                "INSERT INTO radcheck (username, attribute, op, value) VALUES (%s, %s, %s, %s)",
                (username, AUTH_TYPE_ATTRIBUTE, DEFAULT_OP_EQUAL, AUTH_TYPE_REJECT),
            )
            return

        value = AUTH_TYPE_ACCEPT if enabled else AUTH_TYPE_DROP
        auth_type_row = await self.fetch_one(
            "SELECT id FROM radcheck WHERE username=%s AND attribute=%s LIMIT 1",
            (username, AUTH_TYPE_ATTRIBUTE),
        )
        if auth_type_row:
            await self.execute(
                "UPDATE radcheck SET op=%s, value=%s WHERE id=%s",
                (DEFAULT_OP_EQUAL, value, int(auth_type_row["id"])),
            )
            return

        await self.execute(
            "INSERT INTO radcheck (username, attribute, op, value) VALUES (%s, %s, %s, %s)",
            (username, AUTH_TYPE_ATTRIBUTE, DEFAULT_OP_EQUAL, value),
        )

    async def toggle_user_enable(self, username: str) -> str:
        """Toggle enable state and return Y/N compatibility value.

        User:  disabled = Auth-Type := Reject row present; enable by deleting it.
               enabled  = no Auth-Type row; disable by inserting Reject.
        MAC:   disabled = Auth-Type := Drop; enable by updating to Accept.
               enabled  = Auth-Type := Accept; disable by updating to Drop.
        """
        entity_row = await self.fetch_one(
            "SELECT entity_type FROM fr_entity_type WHERE username=%s LIMIT 1",
            (username,),
        )
        if not entity_row:
            raise FreeRadiusDBError("User not found")

        entity_type = str(entity_row["entity_type"]).strip().lower()

        if entity_type == ENTITY_TYPE_USER:
            reject_row = await self.fetch_one(
                "SELECT id FROM radcheck "
                "WHERE username=%s AND attribute=%s AND LOWER(TRIM(value))=LOWER(%s) LIMIT 1",
                (username, AUTH_TYPE_ATTRIBUTE, AUTH_TYPE_REJECT),
            )
            if reject_row:
                # Currently disabled → enable: remove Reject row
                await self.execute(
                    "DELETE FROM radcheck WHERE username=%s AND attribute=%s",
                    (username, AUTH_TYPE_ATTRIBUTE),
                )
                return ENABLE_ON

            # Currently enabled → disable: upsert Reject
            auth_type_row = await self.fetch_one(
                "SELECT id FROM radcheck WHERE username=%s AND attribute=%s LIMIT 1",
                (username, AUTH_TYPE_ATTRIBUTE),
            )
            if auth_type_row:
                await self.execute(
                    "UPDATE radcheck SET op=%s, value=%s WHERE id=%s",
                    (DEFAULT_OP_EQUAL, AUTH_TYPE_REJECT, int(auth_type_row["id"])),
                )
            else:
                await self.execute(
                    "INSERT INTO radcheck (username, attribute, op, value) VALUES (%s, %s, %s, %s)",
                    (username, AUTH_TYPE_ATTRIBUTE, DEFAULT_OP_EQUAL, AUTH_TYPE_REJECT),
                )
            return ENABLE_OFF

        # MAC path
        auth_type_row = await self.fetch_one(
            "SELECT id, LOWER(TRIM(value)) AS val "
            "FROM radcheck WHERE username=%s AND attribute=%s LIMIT 1",
            (username, AUTH_TYPE_ATTRIBUTE),
        )
        current_val = str(auth_type_row["val"]).strip().lower() if auth_type_row else AUTH_TYPE_ACCEPT.lower()

        if current_val == AUTH_TYPE_DROP.lower():
            # Currently disabled → enable: set Accept
            await self.execute(
                "UPDATE radcheck SET op=%s, value=%s WHERE id=%s",
                (DEFAULT_OP_EQUAL, AUTH_TYPE_ACCEPT, int(auth_type_row["id"])),
            )
            return ENABLE_ON

        # Currently enabled (Accept or anything else) → disable: upsert Drop
        if auth_type_row:
            await self.execute(
                "UPDATE radcheck SET op=%s, value=%s WHERE id=%s",
                (DEFAULT_OP_EQUAL, AUTH_TYPE_DROP, int(auth_type_row["id"])),
            )
        else:
            await self.execute(
                "INSERT INTO radcheck (username, attribute, op, value) VALUES (%s, %s, %s, %s)",
                (username, AUTH_TYPE_ATTRIBUTE, DEFAULT_OP_EQUAL, AUTH_TYPE_DROP),
            )
        return ENABLE_OFF

    async def enable_user(self, username: str) -> None:
        """Enable entity."""
        await self.set_user_enable(username, True)

    async def disable_user(self, username: str) -> None:
        """Disable entity."""
        await self.set_user_enable(username, False)

    async def get_user_reply_attributes(self, username: str) -> list[dict[str, Any]]:
        """List radreply attributes for a username."""
        return await self.fetch_all(
            "SELECT id, attribute, op, value FROM radreply WHERE username=%s ORDER BY id",
            (username,),
        )

    async def add_user_reply_attribute(self, username: str, attribute: str, op: str, value: str) -> int:
        """Insert a single radreply row linked to a username."""
        return await self.execute(
            "INSERT INTO radreply (username, attribute, op, value) VALUES (%s, %s, %s, %s)",
            (username, attribute, op, value),
        )

    async def update_user_reply_attribute(
        self,
        username: str,
        reply_id: int,
        attribute: str,
        op: str,
        value: str,
    ) -> None:
        """Update a single radreply row for a username by id."""
        exists = await self.fetch_one(
            "SELECT 1 AS ok FROM radreply WHERE id=%s AND username=%s LIMIT 1",
            (reply_id, username),
        )
        if not exists:
            raise FreeRadiusDBError("Reply attribute not found")

        await self.execute(
            "UPDATE radreply SET attribute=%s, op=%s, value=%s WHERE id=%s AND username=%s",
            (attribute, op, value, reply_id, username),
        )

    async def delete_user_reply_attribute(self, username: str, reply_id: int) -> None:
        """Delete a single radreply row for a username by id."""
        rowcount = await self.execute(
            "DELETE FROM radreply WHERE id=%s AND username=%s",
            (reply_id, username),
        )
        if rowcount == 0:
            raise FreeRadiusDBError("Reply attribute not found")

    async def get_user_groups(self, username: str) -> list[dict[str, Any]]:
        """List group links for a username."""
        return await self.fetch_all(
            "SELECT groupname, priority FROM radusergroup WHERE username=%s ORDER BY priority",
            (username,),
        )

    async def get_user_stats(
        self,
        username: str,
        history_limit: int = 50,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> dict[str, Any]:
        """Return usage counters and recent sessions."""
        where_parts = ["username=%s"]
        params: list[Any] = [username]

        if start_date and end_date:
            where_parts.append("DATE(acctstarttime) BETWEEN %s AND %s")
            params.extend([start_date, end_date])
        elif start_date:
            where_parts.append("DATE(acctstarttime) >= %s")
            params.append(start_date)
        elif end_date:
            where_parts.append("DATE(acctstarttime) <= %s")
            params.append(end_date)

        where_clause = " AND ".join(where_parts)

        totals = await self.fetch_one(
            "SELECT "
            "COALESCE(SUM(acctinputoctets), 0) AS download, "
            "COALESCE(SUM(acctoutputoctets), 0) AS upload "
            f"FROM radacct WHERE {where_clause}",
            tuple(params),
        )

        history_params = [*params, history_limit]
        history = await self.fetch_all(
            "SELECT radacctid, acctsessionid, nasipaddress, "
            "acctstarttime, acctstoptime, acctsessiontime, "
            "acctinputoctets, acctoutputoctets "
            f"FROM radacct WHERE {where_clause} "
            "ORDER BY acctstarttime DESC LIMIT %s",
            tuple(history_params),
        )
        online_row = await self.fetch_one(
            "SELECT COUNT(*) AS total FROM radacct "
            "WHERE username=%s AND acctstoptime IS NULL",
            (username,),
        )
        return {
            "download": int(totals["download"]) if totals else 0,
            "upload": int(totals["upload"]) if totals else 0,
            "online": bool(online_row and int(online_row["total"]) > 0),
            "history": history,
        }

    async def get_active_sessions(self) -> list[dict[str, Any]]:
        """Return active sessions where stop time is null."""
        return await self.fetch_all(
            "SELECT radacctid, username, acctsessionid, framedipaddress, "
            "nasipaddress, callingstationid, acctstarttime "
            "FROM radacct WHERE acctstoptime IS NULL "
            "ORDER BY acctstarttime DESC"
        )

    async def disconnect_user(self, username: str) -> int:
        """Close active sessions by setting stop time."""
        sql = (
            "UPDATE radacct SET acctstoptime=NOW(), acctterminatecause='Admin-Reset' "
            "WHERE username=%s AND acctstoptime IS NULL"
        )
        return await self.execute(sql, (username,))

    async def sync_users(self) -> dict[str, int]:
        """Basic sync routine validating type table references."""
        rows = await self.fetch_one(
            "SELECT COUNT(*) AS total FROM fr_entity_type et "
            "LEFT JOIN radcheck rc ON rc.username=et.username "
            "WHERE rc.username IS NULL"
        )
        dangling = int(rows["total"]) if rows else 0
        if dangling:
            _LOGGER.warning("Found %s entries in fr_entity_type without radcheck rows", dangling)
        return {"dangling_type_rows": dangling}
