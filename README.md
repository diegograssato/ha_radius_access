<img align="left" width="90" height="90" src="icon.png" alt="App icon">

# HA Radius Access (Home Assistant Custom Component)


_Painel administrativo para Home Assistant para gerenciar usuários, grupos, NAS e MAC no FreeRADIUS com Mysql/Postgres/SQLite._


**This component will set up the following platforms.**

Platform | Description
-- | --
`ha_radius_access` | Painel administrativo para Home Assistant.



## Recursos

- Configuração de conexão via `config_flow` (host, porta, usuário, senha, database).
- CRUD de grupos (`radgroupreply`) com múltiplos atributos e atributos repetidos.
- CRUD de regras de grupo (`radgroupcheck`).
- CRUD de NAS (`nas`) com `type` (`other`/`mikrotik`) e `ports` (`NULL`/`0`).
- CRUD de usuários e MACs (`radcheck`, `radreply`, `radusergroup`).
- Busca e paginação em listagens (`10`, `25`, `50`, `100`, `200`, `500`).
- Ajuda contextual de atributos no formulário (popup + descrição dos atributos selecionados).
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
	description VARCHAR(255) NULL,
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

- Usuários & MAC
- Grupo
- NAS
- Configurações

### Busca, Paginação e Ajuda de Atributos

- Listagens de Usuários, Grupos e NAS com paginação: `10`, `25`, `50`, `100`, `200`, `500` itens por página.
- Filtros de busca por listagem (ex.: grupos por nome, NAS por `nasname`/`shortname`).
- Formulários de Grupo e Usuário/MAC com:
	- botão de ajuda de atributo (popup com descrição),
	- bloco de resumo com descrição dos atributos já selecionados/adicionados.

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

## Atributos permitidos

- `Session-Timeout`: sobrescreve o `session-timeout` da configuração padrão.
- `Idle-Timeout`: sobrescreve o `idle-timeout` da configuração padrão.
- `Acct-Interim-Interval`: intervalo de atualização intermediária para o cliente RADIUS. Em PPP, se for `0`, usa o valor configurado no cliente RADIUS. Em HotSpot, só é respeitado se `radius-interim-update=received` no perfil do servidor HotSpot.
- `MS-Primary-DNS-Server`: servidor DNS primário.
- `MS-Secondary-DNS-Server`: servidor DNS secundário.
- `Tunnel-Type`: o valor deve ser `vlan (13)`. Para atribuir VLAN dinamicamente a um usuário em switch/AP MikroTik, o servidor RADIUS deve retornar os VSAs necessários.
- `Tunnel-Medium-Type`: o valor deve ser `802 (6)`. Para atribuir VLAN dinamicamente a um usuário em switch/AP MikroTik, o servidor RADIUS deve retornar os VSAs necessários.
- `Tunnel-Private-Group-Id`: valor do ID da VLAN (ex.: `10`, `20`). Para atribuir VLAN dinamicamente a um usuário em switch/AP MikroTik, o servidor RADIUS deve retornar os VSAs necessários.
- `Framed-Route`: rotas a serem adicionadas no servidor. O formato é definido na RFC 2865 (cap. 5.22) e pode ser informado várias vezes.
- `Framed-Pool`: nome do pool de IP (no roteador) de onde será obtido o IP do cliente. Se `Framed-IP-Address` for informado, este atributo é ignorado.
- `Framed-IP-Address`: endereço IP do cliente HotSpot após tradução Universal Client.
- `Filter-Id`: nome da chain de filtro no firewall. É usado para criar regra dinâmica. Pode ter sufixo `.in` ou `.out` para aplicar somente entrada/saída. Vários `Filter-Id` podem ser enviados, mas apenas os últimos para entrada e saída são usados. Em PPP, cria regras na chain `ppp`; em HotSpot, na chain `hotspot`.
- `Ascend-Data-Rate`: limitação de taxa tx/rx. Se múltiplos atributos forem enviados, o primeiro limita tx e o segundo rx. Se usado com `Ascend-Xmit-Rate`, define rx. `0` significa ilimitado. Ignorado se `Rate-Limit` estiver presente.
- `Ascend-Xmit-Rate`: limitação de taxa tx. Pode ser usado para definir somente tx em vez de enviar dois `Ascend-Data-Rate` sequenciais (nesse caso, `Ascend-Data-Rate` define rx). `0` significa ilimitado. Ignorado se `Rate-Limit` estiver presente.
- `MS-CHAP2-Success`: resposta de autenticação quando MS-CHAPv2 foi usado (somente PPP).
- `MS-MPPE-Send-Key`: chave de criptografia enviada para PPP criptografado, quando MS-CHAPv2 foi usado (somente PPP).
- `MS-MPPE-Recv-Key`: chave de criptografia recebida para PPP criptografado, quando MS-CHAPv2 foi usado (somente PPP).
- `Ascend-Client-Gateway`: gateway do cliente para método de login HotSpot com pool DHCP (somente HotSpot).
- `MS-MPPE-Encryption-Policy`: propriedade `require-encryption` (somente PPP).
- `MS-MPPE-Encryption-Types`: propriedade `use-encryption`; valor diferente de zero indica uso de criptografia (somente PPP).
- `Mikrotik-Mark-Id`: nome da chain de mangle no firewall (somente HotSpot). Ao receber este atributo, o cliente RADIUS MikroTik cria regra dinâmica de mangle com `action=jump chain=hotspot` e `jump-target` igual ao valor do atributo. Pode usar sufixos `.in` e `.out`; múltiplos valores são permitidos, mas apenas o último de entrada e o último de saída são usados.
- `Mikrotik-Recv-Limit`: limite total de recebimento em bytes para o cliente.
- `Mikrotik-Recv-Limit-Gigawords`: parte alta (4G = 2^32 bytes) do limite total de recebimento (bits 32..63; bits 0..31 em `Mikrotik-Recv-Limit`).
- `Mikrotik-Xmit-Limit`: limite total de transmissão em bytes para o cliente.
- `Mikrotik-Xmit-Limit-Gigawords`: parte alta (4G = 2^32 bytes) do limite total de transmissão (bits 32..63; bits 0..31 em `Mikrotik-Xmit-Limit`).
- `Mikrotik-Wireless-Forward`: não encaminha quadros do cliente de volta para a infraestrutura wireless quando definido como `0` (somente Wireless).
- `Mikrotik-Wireless-Skip-Dot1x`: desabilita autenticação 802.1x para o cliente wireless quando definido com valor diferente de zero (somente Wireless).
- `Mikrotik-Wireless-Enc-Algo`: algoritmo de criptografia WEP: `0` sem criptografia, `1` WEP 40-bit, `2` WEP 104-bit (somente Wireless).
- `Mikrotik-Wireless-Enc-Key`: chave de criptografia WEP do cliente (somente Wireless).
- `Mikrotik-Wireless-VLANID`: ID da VLAN do cliente (somente Wireless).
- `Mikrotik-Wireless-VLANID-type`: tipo de VLAN do cliente: `0` = tag 802.1q, `1` = tag 802.1ad (somente Wireless).
- `Mikrotik-Switching-Filter`: permite criar regras dinâmicas de switch ao autenticar clientes com servidor dot1x.
- `Mikrotik-Rate-Limit`: limitação de taxa para clientes. Formato: `rx-rate[/tx-rate] [rx-burst-rate[/tx-burst-rate] [rx-burst-threshold[/tx-burst-threshold] [rx-burst-time[/tx-burst-time] [priority] [rx-rate-min[/tx-rate-min]]]]` na visão do roteador (`rx` = upload do cliente, `tx` = download do cliente). Taxas podem ter sufixo `k` (mil) ou `M` (milhão). Se `tx-rate` não for informado, usa `rx-rate`; mesmo comportamento para burst e thresholds. Se burst-threshold não for informado, usa `rx-rate/tx-rate`. Se burst-time não for informado, padrão é `1s`. Prioridade vai de `1` (maior) a `8` (menor). Se `rx-rate-min/tx-rate-min` não forem informados, usa `rx-rate/tx-rate`. Valores mínimos não podem exceder os máximos.
- `Mikrotik-Group`: nome de grupo local de usuário no roteador (`/user group`) para usuários locais; profile padrão de HotSpot para usuários HotSpot; profile padrão PPP para usuários PPP.
- `Mikrotik-Advertise-URL`: URL da página de anúncios a ser exibida aos clientes. Se presente, anúncios são habilitados automaticamente (incluindo proxy transparente), mesmo se desabilitados no perfil. Múltiplas ocorrências podem ser enviadas e são escolhidas em round-robin.
- `Mikrotik-Advertise-Interval`: intervalo entre anúncios consecutivos. Múltiplas ocorrências podem ser enviadas; os valores formam uma lista consumida em sequência. Ao fim da lista, o último valor continua sendo usado.
- `WISPr-Redirection-URL`: URL para onde os clientes serão redirecionados após login bem-sucedido.
- `WISPr-Bandwidth-Min-Up`: taxa mínima (CIR) de upload fornecida ao cliente.
- `WISPr-Bandwidth-Min-Down`: taxa mínima (CIR) de download fornecida ao cliente.
- `WISPr-Bandwidth-Max-Up`: taxa máxima (MIR) de upload fornecida ao cliente.
- `WISPr-Bandwidth-Max-Down`: taxa máxima (MIR) de download fornecida ao cliente.
- `WISPr-Session-Terminate-Time`: horário em que o usuário deve ser desconectado, no formato `YYYY-MM-DDThh:mm:ssTZD`, onde `TZD` pode ser `+hh:mm`, `+hhmm`, `-hh:mm` ou `-hhmm`.
