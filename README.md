# FreeRADIUS Manager (Home Assistant Custom Component)

Painel administrativo para Home Assistant com backend em Python para gerenciar MySQL do FreeRADIUS.

## Recursos

- Configuração de conexão via `config_flow` (host, porta, usuário, senha, database).
- CRUD de grupos (`radgroupreply`) com múltiplos atributos e atributos repetidos.
- CRUD de regras de grupo (`radgroupcheck`).
- CRUD de usuários e MACs (`radcheck`, `radreply`, `radusergroup`).
- Controle de enable/disable usando a coluna `enable` em `radcheck` (`Y`/`N`).
- Criação de MAC com `Auth-Type := Accept` automático.
- Detalhes de consumo e histórico por usuário/MAC a partir de `radacct`.
- Status online em tempo real (`acctstoptime IS NULL`) com `DataUpdateCoordinator`.
- Serviços HA: `ha_radius_access.sync_users` e `ha_radius_access.disconnect_user`.

## Estrutura

```text
custom_components/ha_radius_access/
├── __init__.py
├── manifest.json
├── config_flow.py
├── const.py
├── api.py
├── coordinator.py
├── mysql_client.py
├── services.yaml
├── sensor.py
└── www/
		├── index.js
		├── components/
		│   ├── fr-table.js
		│   └── fr-modal.js
		└── views/
				├── api-client.js
				├── config-page.js
				├── groups-page.js
				├── group-check-page.js
				└── users-page.js
```

## Pré-requisitos

1. Home Assistant com suporte a custom components.
2. Tabelas FreeRADIUS padrão já existentes:
	 - `radcheck`
	 - `radreply`
	 - `radgroupreply`
	 - `radgroupcheck`
	 - `radusergroup`
	 - `radacct`
3. Tabela auxiliar obrigatória para tipo de entidade (`user`/`mac`).

### SQL da tabela auxiliar obrigatória

```sql
CREATE TABLE fr_entity_type (
	username VARCHAR(64) NOT NULL PRIMARY KEY,
	entity_type ENUM('user', 'mac') NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Importante: a integração **não cria schema automaticamente**. Se faltar a tabela, o setup falha com erro explícito.

## Instalação

1. Copie `custom_components/ha_radius_access` para o diretório `config/custom_components/` do Home Assistant.
2. Reinicie o Home Assistant.
3. Vá em **Settings > Devices & Services > Add Integration**.
4. Selecione **FreeRADIUS Manager**.
5. Informe host, porta, usuário, senha e database do MySQL.

## Painel Web

Após configurar a integração, o painel aparece na barra lateral como **FreeRADIUS**.

Páginas:

- Users & MAC
- Groups
- Group Checks
- Config

## Regras de Negócio Implementadas

- Online: `radacct.acctstoptime IS NULL`.
- Download: soma de `acctinputoctets`.
- Upload: soma de `acctoutputoctets`.
- Usuário (`entity_type=user`) cria `Cleartext-Password := <senha>` em `radcheck`.
- MAC (`entity_type=mac`) cria `Auth-Type := Accept` em `radcheck`.

## Segurança

- Queries SQL parametrizadas (prepared statements).
- Sanitização de payloads nos endpoints.
- Password não é retornada na listagem de usuários/MACs.
- Logs sem exposição de credenciais.

## Serviços

### `ha_radius_access.sync_users`

Executa checagem de consistência entre `fr_entity_type` e `radcheck` e força refresh do coordinator.

### `ha_radius_access.disconnect_user`

Fecha sessões ativas no `radacct` para um username/MAC.

Exemplo:

```yaml
service: ha_radius_access.disconnect_user
data:
	username: "AA:BB:CC:DD:EE:FF"
```

## Atributos permitidos para grupos

- Framed-IP-Address
- Framed-Pool
- Framed-Route
- Mikrotik-Rate-Limit
- Mikrotik-Group
- Session-Timeout
- Idle-Timeout
- Acct-Interim-Interval
- MS-Primary-DNS-Server
- MS-Secondary-DNS-Server
- Tunnel-Type
- Tunnel-Medium-Type
- Tunnel-Private-Group-Id
