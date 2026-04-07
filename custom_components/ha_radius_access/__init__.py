"""FreeRADIUS Manager integration setup."""

from __future__ import annotations

import logging
import inspect
from pathlib import Path
from typing import TYPE_CHECKING, Any

import voluptuous as vol

from homeassistant.components import panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, CONF_USERNAME
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.helpers import config_validation as cv

from .const import (
    CONF_DATABASE,
    CONF_POLL_INTERVAL,
    DATA_CLIENT,
    DATA_COORDINATOR,
    DOMAIN,
    PANEL_FRONTEND_URL_PATH,
    PANEL_ICON,
    PANEL_MODULE_URL,
    PANEL_TITLE,
    PANEL_WEBCOMPONENT_NAME,
    PLATFORMS,
)

if TYPE_CHECKING:
    from .coordinator import FreeRadiusCoordinator
    from .mysql_client import DBConfig, FreeRadiusDBError, FreeRadiusMySQLClient

_LOGGER = logging.getLogger(__name__)

SERVICE_SYNC_USERS = "sync_users"
SERVICE_DISCONNECT_USER = "disconnect_user"
DATA_PANEL_REGISTERED = "panel_registered"
DATA_SERVICES_REGISTERED = "services_registered"

SERVICE_DISCONNECT_USER_SCHEMA = vol.Schema({vol.Required("username"): str})

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Set up integration from yaml (unused)."""
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN].setdefault(DATA_PANEL_REGISTERED, False)
    hass.data[DOMAIN].setdefault(DATA_SERVICES_REGISTERED, False)
    return True


async def _register_panel_and_assets(hass: HomeAssistant) -> None:
    """Register static JS files and sidebar panel."""
    integration_dir = Path(__file__).parent
    www_path = integration_dir / "www"
    static_url = "/ha_radius_access_static"
    static_path = str(www_path)

    if hasattr(hass.http, "async_register_static_paths"):
        try:
            static_config = StaticPathConfig(static_url, static_path, False)
        except TypeError:
            static_config = StaticPathConfig(static_url, static_path)

        await hass.http.async_register_static_paths([static_config])
    else:
        try:
            hass.http.register_static_path(static_url, static_path, False)
        except TypeError:
            hass.http.register_static_path(static_url, static_path)

    register_result = panel_custom.async_register_panel(
        hass,
        webcomponent_name=PANEL_WEBCOMPONENT_NAME,
        frontend_url_path=PANEL_FRONTEND_URL_PATH,
        module_url=PANEL_MODULE_URL,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        require_admin=True,
        config={},
    )
    if inspect.isawaitable(register_result):
        await register_result


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up FreeRADIUS Manager from config entry."""
    from .api import register_views
    from .coordinator import FreeRadiusCoordinator
    from .mysql_client import DBConfig, FreeRadiusDBError, FreeRadiusMySQLClient

    hass.data.setdefault(DOMAIN, {})

    merged = {**entry.data, **entry.options}
    config = DBConfig(
        host=merged[CONF_HOST],
        port=merged[CONF_PORT],
        username=merged[CONF_USERNAME],
        password=merged[CONF_PASSWORD],
        database=merged[CONF_DATABASE],
    )

    client = FreeRadiusMySQLClient(config)
    try:
        await client.connect()
    except FreeRadiusDBError as err:
        raise ConfigEntryNotReady(str(err)) from err

    poll_interval = int(merged.get(CONF_POLL_INTERVAL, 20))
    coordinator = FreeRadiusCoordinator(hass, client, poll_interval=poll_interval)
    await coordinator.async_config_entry_first_refresh()

    hass.data[DOMAIN][entry.entry_id] = {
        DATA_CLIENT: client,
        DATA_COORDINATOR: coordinator,
    }

    register_views(hass, client)

    if not hass.data[DOMAIN][DATA_PANEL_REGISTERED]:
        await _register_panel_and_assets(hass)
        hass.data[DOMAIN][DATA_PANEL_REGISTERED] = True

    async def _service_sync_users(call: ServiceCall) -> None:
        """Run DB sync diagnostics and refresh coordinator for active entries."""
        _LOGGER.info("Service sync_users called")
        for entry_data in hass.data[DOMAIN].values():
            if not isinstance(entry_data, dict) or DATA_CLIENT not in entry_data:
                continue
            c: FreeRadiusMySQLClient = entry_data[DATA_CLIENT]
            d: FreeRadiusCoordinator = entry_data[DATA_COORDINATOR]
            result = await c.sync_users()
            await d.async_request_refresh()
            _LOGGER.info("sync_users result=%s", result)

    async def _service_disconnect_user(call: ServiceCall) -> None:
        """Disconnect active user sessions from all active entries."""
        username = call.data["username"]
        total_affected = 0
        for entry_data in hass.data[DOMAIN].values():
            if not isinstance(entry_data, dict) or DATA_CLIENT not in entry_data:
                continue
            c: FreeRadiusMySQLClient = entry_data[DATA_CLIENT]
            d: FreeRadiusCoordinator = entry_data[DATA_COORDINATOR]
            total_affected += await c.disconnect_user(username)
            await d.async_request_refresh()
        _LOGGER.info("disconnect_user username=%s affected=%s", username, total_affected)

    if not hass.data[DOMAIN][DATA_SERVICES_REGISTERED]:
        hass.services.async_register(DOMAIN, SERVICE_SYNC_USERS, _service_sync_users)
        hass.services.async_register(
            DOMAIN,
            SERVICE_DISCONNECT_USER,
            _service_disconnect_user,
            schema=SERVICE_DISCONNECT_USER_SCHEMA,
        )
        hass.data[DOMAIN][DATA_SERVICES_REGISTERED] = True

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    entry.async_on_unload(entry.add_update_listener(async_reload_entry))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload FreeRADIUS entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    data = hass.data[DOMAIN].pop(entry.entry_id, None)
    if data:
        client: FreeRadiusMySQLClient = data[DATA_CLIENT]
        await client.close()

    return unload_ok


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload config entry after options update."""
    await async_unload_entry(hass, entry)
    await async_setup_entry(hass, entry)
