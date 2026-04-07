"""Config flow for FreeRADIUS Manager."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, CONF_USERNAME
from homeassistant.core import callback

from .const import CONF_DATABASE, CONF_POLL_INTERVAL, DEFAULT_POLL_INTERVAL, DEFAULT_PORT, DOMAIN


def _schema_with_defaults(data: dict[str, Any] | None = None) -> vol.Schema:
    """Build flow schema with existing values as defaults."""
    data = data or {}
    return vol.Schema(
        {
            vol.Required(CONF_HOST, default=data.get(CONF_HOST, "localhost")): str,
            vol.Required(CONF_PORT, default=data.get(CONF_PORT, DEFAULT_PORT)): int,
            vol.Required(CONF_USERNAME, default=data.get(CONF_USERNAME, "freeradius")): str,
            vol.Required(CONF_PASSWORD, default=data.get(CONF_PASSWORD, "")): str,
            vol.Required(CONF_DATABASE, default=data.get(CONF_DATABASE, "radius")): str,
            vol.Required(
                CONF_POLL_INTERVAL,
                default=data.get(CONF_POLL_INTERVAL, DEFAULT_POLL_INTERVAL),
            ): vol.All(int, vol.Range(min=5, max=300)),
        }
    )


async def _test_connection(user_input: dict[str, Any]) -> None:
    """Validate DB connectivity before saving config entry."""
    import aiomysql

    conn = await aiomysql.connect(
        host=user_input[CONF_HOST],
        port=user_input[CONF_PORT],
        user=user_input[CONF_USERNAME],
        password=user_input[CONF_PASSWORD],
        db=user_input[CONF_DATABASE],
        charset="utf8mb4",
    )
    conn.close()


class FreeRadiusManagerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for FreeRADIUS Manager."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        """Handle initial setup step."""
        errors: dict[str, str] = {}

        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            await self.async_set_unique_id(
                f"{user_input[CONF_HOST]}:{user_input[CONF_PORT]}:{user_input[CONF_DATABASE]}"
            )
            self._abort_if_unique_id_configured()
            try:
                await _test_connection(user_input)
            except Exception:  # noqa: BLE001
                errors["base"] = "cannot_connect"
            else:
                return self.async_create_entry(
                    title=f"FreeRADIUS ({user_input[CONF_DATABASE]})",
                    data=user_input,
                )

        return self.async_show_form(
            step_id="user",
            data_schema=_schema_with_defaults(),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry):
        """Return options flow handler."""
        return FreeRadiusManagerOptionsFlow(config_entry)


class FreeRadiusManagerOptionsFlow(config_entries.OptionsFlow):
    """Handle integration options updates."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        self._config_entry = config_entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        """Handle options step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            merged = {**self._config_entry.data, **user_input}
            try:
                await _test_connection(merged)
            except Exception:  # noqa: BLE001
                errors["base"] = "cannot_connect"
            else:
                return self.async_create_entry(title="", data=user_input)

        defaults = {**self._config_entry.data, **self._config_entry.options}
        return self.async_show_form(
            step_id="init",
            data_schema=_schema_with_defaults(defaults),
            errors=errors,
        )
