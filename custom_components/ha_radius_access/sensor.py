"""Sensors for FreeRADIUS manager."""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DATA_COORDINATOR, DOMAIN
from .coordinator import FreeRadiusCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up sensors from config entry."""
    coordinator: FreeRadiusCoordinator = hass.data[DOMAIN][entry.entry_id][DATA_COORDINATOR]
    async_add_entities([FreeRadiusActiveSessionsSensor(coordinator, entry.entry_id)])


class FreeRadiusActiveSessionsSensor(CoordinatorEntity[FreeRadiusCoordinator], SensorEntity):
    """Expose active sessions count from coordinator."""

    _attr_icon = "mdi:account-network"
    _attr_native_unit_of_measurement = "sessions"

    def __init__(self, coordinator: FreeRadiusCoordinator, entry_id: str) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry_id}_active_sessions"
        self._attr_name = "FreeRADIUS Active Sessions"

    @property
    def native_value(self) -> int:
        """Return active sessions count."""
        data = self.coordinator.data or {}
        return int(data.get("active_count", 0))
