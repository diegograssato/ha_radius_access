"""Internal API views for FreeRADIUS manager panel."""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

import voluptuous as vol

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import (
    API_BASE,
    AUTH_TYPE_ACCEPT,
    AUTH_TYPE_REJECT,
    DEFAULT_OP_EQUAL,
    ENABLE_OFF,
    ENABLE_ON,
    ENTITY_TYPE_MAC,
    ENTITY_TYPE_USER,
    ENTITY_TYPES,
    GROUP_ALLOWED_ATTRIBUTES,
)
from .mysql_client import FreeRadiusDBError, FreeRadiusMySQLClient

_LOGGER = logging.getLogger(__name__)


def _sanitize_text(value: Any, field: str, max_len: int = 128) -> str:
    """Normalize and validate text input."""
    text = str(value).strip()
    if not text:
        raise vol.Invalid(f"{field} is required")
    if len(text) > max_len:
        raise vol.Invalid(f"{field} max length is {max_len}")
    return text


def _sanitize_username(value: Any) -> str:
    """Validate username/MAC key shape for FreeRADIUS rows."""
    username = _sanitize_text(value, "username", max_len=64)
    if any(c in username for c in ["'", '"', " ", "\t", "\n", "\r"]):
        raise vol.Invalid("username contains invalid characters")
    return username


def _safe_int(value: Any, fallback: int, min_value: int = 1, max_value: int = 1000) -> int:
    """Convert bounded integer from query string."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(min_value, min(max_value, parsed))


def _sanitize_optional_text(value: Any, field: str, max_len: int = 255) -> str | None:
    """Normalize optional text field where blank maps to null."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if len(text) > max_len:
        raise vol.Invalid(f"{field} max length is {max_len}")
    return text


def _sanitize_nas_type(value: Any) -> str:
    """Validate NAS type."""
    nas_type = _sanitize_text(value, "type", max_len=32).lower()
    if nas_type not in {"other", "mikrotik"}:
        raise vol.Invalid("type must be other or mikrotik")
    return nas_type


def _sanitize_nas_ports(value: Any) -> int | None:
    """Validate NAS ports field (NULL or 0)."""
    if value is None:
        return None

    text = str(value).strip()
    if not text or text.upper() == "NULL":
        return None
    if text == "0":
        return 0
    raise vol.Invalid("ports must be NULL or 0")


class FreeRadiusAPIBaseView(HomeAssistantView):
    """Common helpers for API views."""

    requires_auth = True

    def __init__(self, hass: HomeAssistant, client: FreeRadiusMySQLClient) -> None:
        self.hass = hass
        self.client = client

    def _ok(self, data: Any, status_code: int = 200):
        return self.json({"ok": True, "data": data}, status_code=status_code)

    def _error(self, message: str, status_code: int = 400):
        return self.json({"ok": False, "error": message}, status_code=status_code)


class FreeRadiusGroupsView(FreeRadiusAPIBaseView):
    """CRUD for radgroupreply."""

    url = f"{API_BASE}/groups"
    name = "api:ha_radius_access:groups"

    async def get(self, request):
        """List groups and attributes."""
        try:
            groups = await self.client.get_groups()
            return self._ok(groups)
        except FreeRadiusDBError as err:
            _LOGGER.exception("Failed listing groups")
            return self._error(str(err), 500)

    async def post(self, request):
        """Create group with multiple attributes."""
        try:
            payload = await request.json()
            groupname = _sanitize_text(payload.get("groupname"), "groupname", 64)
            attributes = payload.get("attributes", [])
            cleaned = []
            for item in attributes:
                attribute = _sanitize_text(item.get("attribute"), "attribute", 64)
                if attribute not in GROUP_ALLOWED_ATTRIBUTES:
                    raise vol.Invalid(f"attribute {attribute} is not allowed for group")
                cleaned.append(
                    {
                        "attribute": attribute,
                        "op": _sanitize_text(item.get("op", DEFAULT_OP_EQUAL), "op", 4),
                        "value": _sanitize_text(item.get("value"), "value", 255),
                    }
                )
            await self.client.create_group(groupname, cleaned)
            return self._ok({"groupname": groupname}, 201)
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)

    async def put(self, request):
        """Update group attributes by groupname."""
        try:
            payload = await request.json()
            groupname = _sanitize_text(payload.get("groupname"), "groupname", 64)
            attributes = payload.get("attributes", [])
            cleaned = []
            for item in attributes:
                attribute = _sanitize_text(item.get("attribute"), "attribute", 64)
                if attribute not in GROUP_ALLOWED_ATTRIBUTES:
                    raise vol.Invalid(f"attribute {attribute} is not allowed for group")
                cleaned.append(
                    {
                        "attribute": attribute,
                        "op": _sanitize_text(item.get("op", DEFAULT_OP_EQUAL), "op", 4),
                        "value": _sanitize_text(item.get("value"), "value", 255),
                    }
                )
            await self.client.update_group(groupname, cleaned)
            return self._ok({"groupname": groupname})
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)

    async def delete(self, request):
        """Delete group and links."""
        groupname = request.query.get("groupname", "")
        try:
            groupname = _sanitize_text(groupname, "groupname", 64)
            await self.client.delete_group(groupname)
            return self._ok({"groupname": groupname})
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)


class FreeRadiusGroupNamesView(FreeRadiusAPIBaseView):
    """Get list of group names for dropdown/select."""

    url = f"{API_BASE}/group_names"
    name = "api:ha_radius_access:group_names"

    async def get(self, request):
        """List unique group names."""
        try:
            names = await self.client.get_group_names()
            return self._ok(names)
        except FreeRadiusDBError as err:
            _LOGGER.exception("Failed listing group names")
            return self._error(str(err), 500)


class FreeRadiusGroupChecksView(FreeRadiusAPIBaseView):
    """CRUD for radgroupcheck."""

    url = f"{API_BASE}/group_checks"
    name = "api:ha_radius_access:group_checks"

    async def get(self, request):
        """List check rules."""
        groupname = request.query.get("groupname")
        try:
            rows = await self.client.get_group_checks(groupname)
            return self._ok(rows)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)

    async def post(self, request):
        """Create rule."""
        try:
            payload = await request.json()
            groupname = _sanitize_text(payload.get("groupname"), "groupname", 64)
            attribute = _sanitize_text(payload.get("attribute"), "attribute", 64)
            op = _sanitize_text(payload.get("op", DEFAULT_OP_EQUAL), "op", 4)
            value = _sanitize_text(payload.get("value"), "value", 255)
            await self.client.create_group_check(groupname, attribute, op, value)
            return self._ok({"groupname": groupname}, 201)
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)

    async def put(self, request):
        """Update rule by id."""
        try:
            payload = await request.json()
            rule_id = int(payload.get("id"))
            attribute = _sanitize_text(payload.get("attribute"), "attribute", 64)
            op = _sanitize_text(payload.get("op", DEFAULT_OP_EQUAL), "op", 4)
            value = _sanitize_text(payload.get("value"), "value", 255)
            await self.client.update_group_check(rule_id, attribute, op, value)
            return self._ok({"id": rule_id})
        except (ValueError, TypeError):
            return self._error("invalid rule id", 422)
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)

    async def delete(self, request):
        """Delete rule."""
        try:
            rule_id = int(request.query.get("id"))
            await self.client.delete_group_check(rule_id)
            return self._ok({"id": rule_id})
        except (ValueError, TypeError):
            return self._error("invalid rule id", 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)


class FreeRadiusToggleGroupView(FreeRadiusAPIBaseView):
    """Enable/disable group endpoint."""

    url = f"{API_BASE}/groups/toggle"
    name = "api:ha_radius_access:groups_toggle"

    async def post(self, request):
        """Toggle group Auth-Type between Accept/Reject."""
        try:
            payload = await request.json()
            groupname = _sanitize_text(payload.get("groupname"), "groupname", 64)
            value = await self.client.toggle_group_enable(groupname)
            return self._ok({"groupname": groupname, "auth_type": value, "enabled": value == AUTH_TYPE_ACCEPT})
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)


class FreeRadiusUsersView(FreeRadiusAPIBaseView):
    """CRUD for users and MACs."""

    url = f"{API_BASE}/users"
    name = "api:ha_radius_access:users"

    async def get(self, request):
        """List users or MACs with pagination/search/sort."""
        entity_type = request.query.get("entity_type")
        groupname = request.query.get("groupname")
        search = request.query.get("search")
        page = _safe_int(request.query.get("page"), fallback=1, min_value=1, max_value=100000)
        page_size = _safe_int(request.query.get("page_size"), fallback=25, min_value=1, max_value=200)
        sort_by = request.query.get("sort_by", "username")
        sort_order = request.query.get("sort_order", "asc")

        if groupname is not None and str(groupname).strip():
            try:
                groupname = _sanitize_text(groupname, "groupname", 64)
            except vol.Invalid as err:
                return self._error(str(err), 422)
        else:
            groupname = None

        if entity_type and entity_type not in ENTITY_TYPES:
            return self._error("invalid entity_type", 422)

        try:
            data = await self.client.get_users(
                entity_type=entity_type,
                groupname=groupname,
                search=search,
                page=page,
                page_size=page_size,
                sort_by=sort_by,
                sort_order=sort_order,
            )
            return self._ok(data)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)

    async def post(self, request):
        """Create user or MAC entity."""
        try:
            payload = await request.json()
            username = _sanitize_username(payload.get("username"))
            entity_type = _sanitize_text(payload.get("entity_type"), "entity_type", 8)
            if entity_type not in ENTITY_TYPES:
                raise vol.Invalid("entity_type must be user or mac")

            password = payload.get("password")
            if password is not None:
                password = _sanitize_text(password, "password", 255)

            enable = _sanitize_text(payload.get("enable", ENABLE_ON), "enable", 1).upper()
            if enable not in {ENABLE_ON, ENABLE_OFF}:
                raise vol.Invalid("enable must be Y or N")

            groups = payload.get("groups")
            if groups is None:
                groups = []
            if not isinstance(groups, list):
                raise vol.Invalid("groups must be a list")
            clean_groups = [_sanitize_text(item, "group", 64) for item in groups]
            description = _sanitize_optional_text(payload.get("description"), "description", 255)

            reply_attributes = payload.get("reply_attributes")
            if reply_attributes is None:
                reply_attributes = []
            if not isinstance(reply_attributes, list):
                raise vol.Invalid("reply_attributes must be a list")
            clean_reply = [
                {
                    "attribute": _sanitize_text(item.get("attribute"), "attribute", 64),
                    "op": _sanitize_text(item.get("op", DEFAULT_OP_EQUAL), "op", 4),
                    "value": _sanitize_text(item.get("value"), "value", 255),
                }
                for item in reply_attributes
            ]

            await self.client.create_user(
                username=username,
                password=password,
                enable=enable,
                entity_type=entity_type,
                description=description,
                groups=clean_groups,
                reply_attributes=clean_reply,
            )
            return self._ok({"username": username, "entity_type": entity_type}, 201)
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)

    async def put(self, request):
        """Update existing entity."""
        try:
            payload = await request.json()
            username = _sanitize_username(payload.get("username"))
            enable = _sanitize_text(payload.get("enable", ENABLE_ON), "enable", 1).upper()
            if enable not in {ENABLE_ON, ENABLE_OFF}:
                raise vol.Invalid("enable must be Y or N")

            password = payload.get("password")
            if password:
                password = _sanitize_text(password, "password", 255)
            else:
                password = None

            groups = payload.get("groups")
            if groups is None:
                groups = []
            if not isinstance(groups, list):
                raise vol.Invalid("groups must be a list")
            clean_groups = [_sanitize_text(item, "group", 64) for item in groups]
            description = _sanitize_optional_text(payload.get("description"), "description", 255)

            reply_attributes = payload.get("reply_attributes")
            if reply_attributes is None:
                reply_attributes = []
            if not isinstance(reply_attributes, list):
                raise vol.Invalid("reply_attributes must be a list")
            clean_reply = [
                {
                    "attribute": _sanitize_text(item.get("attribute"), "attribute", 64),
                    "op": _sanitize_text(item.get("op", DEFAULT_OP_EQUAL), "op", 4),
                    "value": _sanitize_text(item.get("value"), "value", 255),
                }
                for item in reply_attributes
            ]

            await self.client.update_user(
                username=username,
                password=password,
                enable=enable,
                description=description,
                groups=clean_groups,
                reply_attributes=clean_reply,
            )
            return self._ok({"username": username})
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)

    async def delete(self, request):
        """Delete entity and all managed rows."""
        username = request.query.get("username", "")
        try:
            username = _sanitize_username(username)
            await self.client.delete_user(username)
            return self._ok({"username": username})
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)


class FreeRadiusNasView(FreeRadiusAPIBaseView):
    """CRUD for nas table."""

    url = f"{API_BASE}/nas"
    name = "api:ha_radius_access:nas"

    async def get(self, request):
        """List NAS entries."""
        try:
            rows = await self.client.get_nas()
            return self._ok(rows)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)

    async def post(self, request):
        """Create NAS entry."""
        try:
            payload = await request.json()
            nasname = _sanitize_text(payload.get("nasname"), "nasname", 128)
            shortname = _sanitize_text(payload.get("shortname"), "shortname", 128)
            nas_type = _sanitize_nas_type(payload.get("type"))
            ports = _sanitize_nas_ports(payload.get("ports"))
            secret = _sanitize_text(payload.get("secret"), "secret", 255)
            description = _sanitize_optional_text(payload.get("description"), "description", 255)

            # server/community are intentionally fixed as NULL.
            await self.client.create_nas(
                nasname=nasname,
                shortname=shortname,
                nas_type=nas_type,
                ports=ports,
                secret=secret,
                server=None,
                community=None,
                description=description,
            )
            return self._ok({"nasname": nasname}, 201)
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)

    async def put(self, request):
        """Update NAS entry by nasname."""
        try:
            payload = await request.json()
            nasname = _sanitize_text(payload.get("nasname"), "nasname", 128)
            shortname = _sanitize_text(payload.get("shortname"), "shortname", 128)
            nas_type = _sanitize_nas_type(payload.get("type"))
            ports = _sanitize_nas_ports(payload.get("ports"))
            secret = _sanitize_text(payload.get("secret"), "secret", 255)
            description = _sanitize_optional_text(payload.get("description"), "description", 255)

            # server/community are intentionally fixed as NULL.
            await self.client.update_nas(
                nasname=nasname,
                shortname=shortname,
                nas_type=nas_type,
                ports=ports,
                secret=secret,
                server=None,
                community=None,
                description=description,
            )
            return self._ok({"nasname": nasname})
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)

    async def delete(self, request):
        """Delete NAS entry by nasname."""
        nasname = request.query.get("nasname", "")
        try:
            nasname = _sanitize_text(nasname, "nasname", 128)
            await self.client.delete_nas(nasname)
            return self._ok({"nasname": nasname})
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)


class FreeRadiusToggleUserView(FreeRadiusAPIBaseView):
    """Enable/disable endpoints."""

    url = f"{API_BASE}/users/toggle"
    name = "api:ha_radius_access:users_toggle"

    async def post(self, request):
        """Toggle user Auth-Type between Accept/Reject and return Y/N compatibility."""
        try:
            payload = await request.json()
            username = _sanitize_username(payload.get("username"))
            value = await self.client.toggle_user_enable(username)
            return self._ok({"username": username, "enable": value, "enabled": value == ENABLE_ON})
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)


class FreeRadiusUserDetailsView(FreeRadiusAPIBaseView):
    """User details and stats endpoint."""

    url = f"{API_BASE}/users/details"
    name = "api:ha_radius_access:users_details"

    async def get(self, request):
        """Return group links, reply attrs and traffic/history."""
        username = request.query.get("username", "")
        history_limit = _safe_int(request.query.get("history_limit"), fallback=50, min_value=1, max_value=500)
        start_date = request.query.get("start_date")
        end_date = request.query.get("end_date")
        try:
            username = _sanitize_username(username)

            if start_date is not None and str(start_date).strip():
                start_date = date.fromisoformat(str(start_date).strip()).isoformat()
            else:
                start_date = None

            if end_date is not None and str(end_date).strip():
                end_date = date.fromisoformat(str(end_date).strip()).isoformat()
            else:
                end_date = None

            if start_date and end_date and start_date > end_date:
                return self._error("start_date must be <= end_date", 422)

            stats = await self.client.get_user_stats(
                username,
                history_limit=history_limit,
                start_date=start_date,
                end_date=end_date,
            )
            entity = await self.client.get_user_entity(username)
            replies = await self.client.get_user_reply_attributes(username)
            groups = await self.client.get_user_groups(username)
            return self._ok(
                {
                    "username": username,
                    "entity_type": entity["entity_type"] if entity else None,
                    "description": entity["description"] if entity else "",
                    "start_date": start_date,
                    "end_date": end_date,
                    "stats": stats,
                    "reply_attributes": replies,
                    "groups": groups,
                }
            )
        except (vol.Invalid, ValueError) as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)


class FreeRadiusUserReplyAttrsView(FreeRadiusAPIBaseView):
    """CRUD for single user reply attributes."""

    url = f"{API_BASE}/users/reply_attrs"
    name = "api:ha_radius_access:users_reply_attrs"

    async def post(self, request):
        """Create one reply attribute linked to a username."""
        try:
            payload = await request.json()
            username = _sanitize_username(payload.get("username"))
            attribute = _sanitize_text(payload.get("attribute"), "attribute", 64)
            op = _sanitize_text(payload.get("op", DEFAULT_OP_EQUAL), "op", 4)
            value = _sanitize_text(payload.get("value"), "value", 255)
            await self.client.add_user_reply_attribute(username, attribute, op, value)
            return self._ok({"username": username}, 201)
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)

    async def put(self, request):
        """Update one reply attribute linked to a username."""
        try:
            payload = await request.json()
            username = _sanitize_username(payload.get("username"))
            reply_id = int(payload.get("id"))
            attribute = _sanitize_text(payload.get("attribute"), "attribute", 64)
            op = _sanitize_text(payload.get("op", DEFAULT_OP_EQUAL), "op", 4)
            value = _sanitize_text(payload.get("value"), "value", 255)
            await self.client.update_user_reply_attribute(username, reply_id, attribute, op, value)
            return self._ok({"username": username, "id": reply_id})
        except (ValueError, TypeError):
            return self._error("invalid reply id", 422)
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)

    async def delete(self, request):
        """Delete one reply attribute linked to a username."""
        try:
            username = _sanitize_username(request.query.get("username", ""))
            reply_id = int(request.query.get("id"))
            await self.client.delete_user_reply_attribute(username, reply_id)
            return self._ok({"username": username, "id": reply_id})
        except (ValueError, TypeError):
            return self._error("invalid reply id", 422)
        except vol.Invalid as err:
            return self._error(str(err), 422)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)


class FreeRadiusSessionsView(FreeRadiusAPIBaseView):
    """Active sessions endpoint."""

    url = f"{API_BASE}/sessions/active"
    name = "api:ha_radius_access:sessions_active"

    async def get(self, request):
        """Return currently active sessions."""
        try:
            rows = await self.client.get_active_sessions()
            return self._ok(rows)
        except FreeRadiusDBError as err:
            return self._error(str(err), 500)


class FreeRadiusMetaView(FreeRadiusAPIBaseView):
    """Static metadata endpoint for frontend forms."""

    url = f"{API_BASE}/meta"
    name = "api:ha_radius_access:meta"

    async def get(self, request):
        """Return constants used by frontend."""
        return self._ok(
            {
                "group_allowed_attributes": GROUP_ALLOWED_ATTRIBUTES,
                "entity_types": [ENTITY_TYPE_USER, ENTITY_TYPE_MAC],
            }
        )


def register_views(hass: HomeAssistant, client: FreeRadiusMySQLClient) -> None:
    """Register all views."""
    views = [
        FreeRadiusGroupsView(hass, client),
        FreeRadiusGroupNamesView(hass, client),
        FreeRadiusGroupChecksView(hass, client),
        FreeRadiusToggleGroupView(hass, client),
        FreeRadiusUsersView(hass, client),
        FreeRadiusNasView(hass, client),
        FreeRadiusToggleUserView(hass, client),
        FreeRadiusUserDetailsView(hass, client),
        FreeRadiusUserReplyAttrsView(hass, client),
        FreeRadiusSessionsView(hass, client),
        FreeRadiusMetaView(hass, client),
    ]
    for view in views:
        hass.http.register_view(view)
