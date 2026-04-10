"""Constants for the FreeRADIUS Manager integration."""

from __future__ import annotations

DOMAIN = "ha_radius_access"
PLATFORMS = ["sensor"]

CONF_HOST = "host"
CONF_PORT = "port"
CONF_USERNAME = "username"
CONF_PASSWORD = "password"
CONF_DATABASE = "database"
CONF_POLL_INTERVAL = "poll_interval"

DEFAULT_PORT = 3306
DEFAULT_POLL_INTERVAL = 20

DATA_CLIENT = "client"
DATA_COORDINATOR = "coordinator"

PANEL_FRONTEND_URL_PATH = "ha-radius-access"
PANEL_WEBCOMPONENT_NAME = "ha-radius-access-panel"
PANEL_TITLE = "HA Radius Access"
PANEL_ICON = "mdi:account-network"
PANEL_MODULE_URL = "/ha_radius_access_static/index.js?v=20260410b"

ENTITY_TYPE_USER = "user"
ENTITY_TYPE_MAC = "mac"
ENTITY_TYPES = {ENTITY_TYPE_USER, ENTITY_TYPE_MAC}

TABLE_ENTITY_TYPE = "fr_entity_type"

GROUP_ALLOWED_ATTRIBUTES = [
   "Framed-IP-Address",
    "Framed-Pool",
    "Framed-Route",
    "Mikrotik-Rate-Limit",
    "Mikrotik-Group",
    "Session-Timeout",
    "Idle-Timeout",
    "Acct-Interim-Interval",
    "MS-Primary-DNS-Server",
    "MS-Secondary-DNS-Server",
    "Tunnel-Type",
    "Tunnel-Medium-Type",
    "Tunnel-Private-Group-Id",
]

ENABLE_ON = "Y"
ENABLE_OFF = "N"

DEFAULT_OP_EQUAL = ":="
PASSWORD_ATTRIBUTE = "Cleartext-Password"
AUTH_TYPE_ATTRIBUTE = "Auth-Type"
AUTH_TYPE_ACCEPT = "Accept"
AUTH_TYPE_REJECT = "Reject"
AUTH_TYPE_DROP = "Drop"

API_BASE = "/api/ha_radius_access"
