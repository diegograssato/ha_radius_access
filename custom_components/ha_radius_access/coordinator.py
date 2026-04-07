"""DataUpdateCoordinator for online status refresh."""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DEFAULT_POLL_INTERVAL, DOMAIN
from .mysql_client import FreeRadiusMySQLClient, FreeRadiusDBError

_LOGGER = logging.getLogger(__name__)


class FreeRadiusCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinates live data updates for dashboard status."""

    def __init__(
        self,
        hass: HomeAssistant,
        client: FreeRadiusMySQLClient,
        poll_interval: int = DEFAULT_POLL_INTERVAL,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_coordinator",
            update_interval=timedelta(seconds=max(5, poll_interval)),
        )
        self._client = client

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            sessions = await self._client.get_active_sessions()
            online_users = {row["username"] for row in sessions}
            return {
                "active_sessions": sessions,
                "online_users": online_users,
                "active_count": len(sessions),
            }
        except FreeRadiusDBError as err:
            raise UpdateFailed(f"MySQL refresh failed: {err}") from err
