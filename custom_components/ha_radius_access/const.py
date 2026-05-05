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

CONF_DATABASE_TYPE = "database_type"

DATABASE_TYPE_MYSQL = "mysql"
DATABASE_TYPE_POSTGRESQL = "postgresql"
DATABASE_TYPES = {DATABASE_TYPE_MYSQL, DATABASE_TYPE_POSTGRESQL}


DEFAULT_DATABASE_TYPE = DATABASE_TYPE_MYSQL
DEFAULT_PORT_MYSQL = 3306
DEFAULT_PORT_POSTGRESQL = 5432
DEFAULT_PORT = DEFAULT_PORT_MYSQL
DEFAULT_POLL_INTERVAL = 20

DATA_CLIENT = "client"
DATA_COORDINATOR = "coordinator"

PANEL_FRONTEND_URL_PATH = "ha-radius-access"
PANEL_WEBCOMPONENT_NAME = "ha-radius-access-panel"
PANEL_TITLE = "HA Radius Access"
PANEL_ICON = "mdi:account-network"
PANEL_MODULE_URL = "/ha_radius_access_static/index.js?v=20260505c"

ENTITY_TYPE_USER = "user"
ENTITY_TYPE_MAC = "mac"
ENTITY_TYPES = {ENTITY_TYPE_USER, ENTITY_TYPE_MAC}

TABLE_ENTITY_TYPE = "userinfo"

GROUP_ALLOWED_ATTRIBUTES = [
    "Session-Timeout",
    "Idle-Timeout",
    "Acct-Interim-Interval",
    "MS-Primary-DNS-Server",
    "MS-Secondary-DNS-Server",
    "Tunnel-Type",
    "Tunnel-Medium-Type",
    "Tunnel-Private-Group-Id",
    "Framed-Route",
    "Framed-Pool",
    "Framed-IP-Address",
    "Filter-Id",
    "Ascend-Data-Rate",
    "Ascend-Xmit-Rate",
    "MS-CHAP2-Success",
    "MS-MPPE-Send-Key",
    "MS-MPPE-Recv-Key",
    "Ascend-Client-Gateway",
    "MS-MPPE-Encryption-Policy",
    "MS-MPPE-Encryption-Types",
    "Mikrotik-Mark-Id",
    "Mikrotik-Recv-Limit",
    "Mikrotik-Recv-Limit-Gigawords",
    "Mikrotik-Xmit-Limit",
    "Mikrotik-Xmit-Limit-Gigawords",
    "Mikrotik-Wireless-Forward",
    "Mikrotik-Wireless-Skip-Dot1x",
    "Mikrotik-Wireless-Enc-Algo",
    "Mikrotik-Wireless-Enc-Key",
    "Mikrotik-Wireless-VLANID",
    "Mikrotik-Wireless-VLANID-type",
    "Mikrotik-Switching-Filter",
    "Mikrotik-Rate-Limit",
    "Mikrotik-Group",
    "Mikrotik-Advertise-URL",
    "Mikrotik-Advertise-Interval",
    "WISPr-Redirection-URL",
    "WISPr-Bandwidth-Min-Up",
    "WISPr-Bandwidth-Min-Down",
    "WISPr-Bandwidth-Max-Up",
    "WISPr-Bandwidth-Max-Down",
    "WISPr-Session-Terminate-Time",
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
