import { apiCall, bytesToHuman } from "./api-client.js";

const Lit = window.Lit || window.litElement || window.litHtml || {};
const HaPanel = customElements.get("ha-panel-lovelace");
const HaLitElement = HaPanel ? Object.getPrototypeOf(HaPanel) : undefined;
const LitElement =
  Lit.LitElement ||
  (window.litElement && window.litElement.LitElement) ||
  window.LitElement ||
  HaLitElement;
const html =
  Lit.html ||
  (window.litHtml && window.litHtml.html) ||
  window.html ||
  (HaLitElement && HaLitElement.prototype && HaLitElement.prototype.html);
const css =
  Lit.css ||
  (window.litHtml && window.litHtml.css) ||
  window.css ||
  (HaLitElement && HaLitElement.prototype && HaLitElement.prototype.css);

if (!LitElement || !html || !css) {
  throw new Error("Unable to resolve Lit runtime for users-page");
}

class UsersPage extends LitElement {
  static properties = {
    hass: { attribute: false },
    _rows: { state: true },
    _groups: { state: true },
    _error: { state: true },
    _loading: { state: true },
    _query: { state: true },
    _entityTypeFilter: { state: true },
    _page: { state: true },
    _pageSize: { state: true },
    _total: { state: true },
    _modalOpen: { state: true },
    _detailOpen: { state: true },
    _form: { state: true },
    _editingUsername: { state: true },
    _details: { state: true },
  };

  static styles = css`
    :host {
      display: grid;
      gap: 12px;
    }

    .toolbar,
    .card {
      background: #fff;
      border: 1px solid #dbe4ee;
      border-radius: 12px;
      padding: 12px;
    }

    .toolbar {
      display: grid;
      gap: 8px;
    }

    .toolbar-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
    }

    .left,
    .right {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    input,
    select {
      border: 1px solid #ccd5de;
      border-radius: 8px;
      padding: 8px;
      min-width: 140px;
    }

    button {
      border: 1px solid #a9b8c8;
      border-radius: 8px;
      background: #fff;
      padding: 7px 10px;
      cursor: pointer;
      font-weight: 600;
    }

    .danger {
      color: #b3261e;
      border-color: #d8a7a3;
    }

    .ok {
      color: #0c7a69;
      border-color: #88c0b6;
    }

    .status {
      font-weight: 700;
    }

    .status.online {
      color: #0c7a69;
    }

    .status.offline {
      color: #7a8794;
    }

    .error {
      color: #b3261e;
      font-size: 0.9rem;
      margin: 0;
    }

    .list-row {
      display: grid;
      grid-template-columns: 1.1fr 1.1fr 0.7fr 0.9fr 1.1fr auto;
      gap: 8px;
      align-items: center;
      border-bottom: 1px solid #eef2f5;
      padding: 8px 0;
    }

    .list-row.head {
      font-weight: 700;
      color: #42566d;
      text-transform: uppercase;
      font-size: 0.82rem;
      letter-spacing: 0.04em;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .attr-row {
      display: grid;
      grid-template-columns: 1fr 80px 1fr auto;
      gap: 6px;
      margin-bottom: 6px;
    }

    .inline-fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .chips {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 4px;
    }

    .chip {
      border: 1px solid #ccd5de;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 0.8rem;
    }

    @media (max-width: 980px) {
      .list-row,
      .list-row.head {
        grid-template-columns: 1fr;
      }

      .attr-row {
        grid-template-columns: 1fr;
      }

      .inline-fields {
        grid-template-columns: 1fr;
      }
    }
  `;

  constructor() {
    super();
    this._loadSeq = 0;
    this._rows = [];
    this._groups = [];
    this._loading = false;
    this._error = "";
    this._query = "";
    this._entityTypeFilter = "";
    this._page = 1;
    this._pageSize = 25;
    this._total = 0;
    this._modalOpen = false;
    this._detailOpen = false;
    this._editingUsername = null;
    this._details = null;
    this._form = this._emptyForm();
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
    this._loadGroups();
  }

  _emptyForm() {
    return {
      username: "",
      password: "",
      description: "",
      enable: "Y",
      entity_type: "user",
      groups: [],
      reply_attributes: [{ attribute: "", op: ":=", value: "" }],
    };
  }

  async _loadGroups() {
    try {
      const groups = await apiCall("/api/ha_radius_access/groups");
      const names = new Set(groups.map((x) => x.groupname));
      this._groups = Array.from(names.values()).sort();
    } catch (err) {
      this._error = err.message;
    }
  }

  async _load() {
    this._loading = true;
    this._error = "";
    const loadSeq = ++this._loadSeq;
    const params = new URLSearchParams({
      page: String(this._page),
      page_size: String(this._pageSize),
      sort_by: "username",
      sort_order: "asc",
    });
    if (this._query) {
      params.set("search", this._query);
    }
    if (this._entityTypeFilter) {
      params.set("entity_type", this._entityTypeFilter);
    }

    try {
      const data = await apiCall(`/api/ha_radius_access/users?${params.toString()}`);
      if (loadSeq !== this._loadSeq) {
        return;
      }
      this._rows = data.items || [];
      this._total = data.total || 0;
    } catch (err) {
      this._error = err.message;
    } finally {
      this._loading = false;
    }
  }

  _openCreate() {
    this._editingUsername = null;
    this._form = this._emptyForm();
    this._modalOpen = true;
  }

  async _openEdit(row) {
    this._editingUsername = row.username;
    this._error = "";
    try {
      const details = await apiCall(`/api/ha_radius_access/users/details?username=${encodeURIComponent(row.username)}`);
      this._form = {
        username: row.username,
        password: "",
        description: (typeof details.description === "string" ? details.description : row.description) || "",
        enable: row.enable || "Y",
        entity_type: row.entity_type,
        groups: (details.groups || []).map((g) => g.groupname),
        reply_attributes:
          details.reply_attributes?.length > 0
            ? details.reply_attributes.map((r) => ({
                attribute: r.attribute,
                op: r.op,
                value: r.value,
              }))
            : [{ attribute: "", op: ":=", value: "" }],
      };
      this._modalOpen = true;
    } catch (err) {
      this._error = err.message;
    }
  }

  _closeModal() {
    this._modalOpen = false;
  }

  _updateAttr(index, field, value) {
    const attrs = this._form.reply_attributes.map((item, idx) => {
      if (idx !== index) {
        return item;
      }
      return { ...item, [field]: value };
    });
    this._form = { ...this._form, reply_attributes: attrs };
  }

  _addAttrRow() {
    const attrs = [...this._form.reply_attributes, { attribute: "", op: ":=", value: "" }];
    this._form = { ...this._form, reply_attributes: attrs };
  }

  _removeAttrRow(index) {
    const attrs = this._form.reply_attributes.filter((_, idx) => idx !== index);
    this._form = {
      ...this._form,
      reply_attributes: attrs.length ? attrs : [{ attribute: "", op: ":=", value: "" }],
    };
  }

  _toggleGroup(group) {
    const hasGroup = this._form.groups.includes(group);
    const groups = hasGroup
      ? this._form.groups.filter((g) => g !== group)
      : [...this._form.groups, group];
    this._form = { ...this._form, groups };
  }

  async _save() {
    this._error = "";
    const payload = {
      ...this._form,
      reply_attributes: this._form.reply_attributes.filter((x) => x.attribute && x.value),
    };

    if (this._editingUsername) {
      delete payload.entity_type;
    }

    try {
      await apiCall("/api/ha_radius_access/users", {
        method: this._editingUsername ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      this._modalOpen = false;
      await this._load();
    } catch (err) {
      this._error = err.message;
    }
  }

  async _delete(username) {
    if (!window.confirm(`Delete ${username}?`)) {
      return;
    }

    this._error = "";
    try {
      await apiCall(`/api/ha_radius_access/users?username=${encodeURIComponent(username)}`, {
        method: "DELETE",
      });
      await this._load();
    } catch (err) {
      this._error = err.message;
    }
  }

  async _toggleEnable(row) {
    this._error = "";
    try {
      await apiCall("/api/ha_radius_access/users/toggle", {
        method: "POST",
        body: JSON.stringify({ username: row.username, enabled: row.enable !== "Y" }),
      });
      await this._load();
    } catch (err) {
      this._error = err.message;
    }
  }

  async _openDetails(row) {
    this._error = "";
    try {
      this._details = await apiCall(`/api/ha_radius_access/users/details?username=${encodeURIComponent(row.username)}`);
      this._detailOpen = true;
    } catch (err) {
      this._error = err.message;
    }
  }

  _closeDetails() {
    this._detailOpen = false;
    this._details = null;
  }

  _onSearchInput(ev) {
    this._query = ev.target.value;
  }

  async _search() {
    this._page = 1;
    await this._load();
  }

  async _changePage(ev) {
    this._page = ev.detail.page;
    await this._load();
  }

  render() {
    const totalPages = Math.max(1, Math.ceil(this._total / this._pageSize));

    return html`
      <section class="toolbar">
        <div class="toolbar-row">
          <div class="left">
            <strong>Users and MACs</strong>
            <input placeholder="Search username" .value=${this._query} @input=${this._onSearchInput} />
            <select
              .value=${this._entityTypeFilter}
              @change=${async (ev) => {
                this._entityTypeFilter = ev.target.value;
                this._page = 1;
                await this._load();
              }}
            >
              <option value="">All types</option>
              <option value="user">Users</option>
              <option value="mac">MACs</option>
            </select>
            <button @click=${this._search}>Search</button>
          </div>
          <div class="right">
            <button class="ok" @click=${this._openCreate}>New User/MAC</button>
          </div>
        </div>
        <div>Page ${this._page}/${totalPages} | Total ${this._total}</div>
      </section>

      ${this._error ? html`<p class="error">${this._error}</p>` : ""}

      <section class="card">
        <div class="list-row head">
          <div>Username</div>
          <div>Description</div>
          <div>Type</div>
          <div>Enable</div>
          <div>Group</div>
          <div>Actions</div>
        </div>

        ${this._loading
          ? html`<div>Loading...</div>`
          : this._rows.map(
              (row) => html`
                <div class="list-row">
                  <div>${row.username}</div>
                  <div>${row.description || "-"}</div>
                  <div>${row.entity_type}</div>
                  <div>${row.enable}</div>
                  <div>${row.groupnames || "-"}</div>
                  <div class="actions">
                    <button @click=${() => this._openEdit(row)}>Edit</button>
                    <button @click=${() => this._openDetails(row)}>Details</button>
                    <button class="ok" @click=${() => this._toggleEnable(row)}>
                      ${row.enable === "Y" ? "Disable" : "Enable"}
                    </button>
                    <button class="danger" @click=${() => this._delete(row.username)}>Delete</button>
                  </div>
                </div>
              `
            )}

        <div class="actions" style="margin-top: 8px">
          <button ?disabled=${this._page <= 1} @click=${async () => {
            this._page -= 1;
            await this._load();
          }}>Previous</button>
          <button ?disabled=${this._page >= totalPages} @click=${async () => {
            this._page += 1;
            await this._load();
          }}>Next</button>
        </div>
      </section>

      <fr-modal .open=${this._modalOpen} title=${this._editingUsername ? "Edit User/MAC" : "New User/MAC"} @close=${this._closeModal}>
        <div class="inline-fields">
          <label>
            Username / MAC
            <input
              .value=${this._form.username}
              ?disabled=${Boolean(this._editingUsername)}
              @input=${(ev) => (this._form = { ...this._form, username: ev.target.value })}
            />
          </label>

          <label>
            Type
            <select
              .value=${this._form.entity_type}
              ?disabled=${Boolean(this._editingUsername)}
              @change=${(ev) => (this._form = { ...this._form, entity_type: ev.target.value })}
            >
              <option value="user">User</option>
              <option value="mac">MAC</option>
            </select>
          </label>

          <label>
            Password ${this._editingUsername ? "(leave blank to keep)" : ""}
            <input
              type="password"
              .value=${this._form.password}
              @input=${(ev) => (this._form = { ...this._form, password: ev.target.value })}
            />
          </label>

          <label>
            Description
            <input
              .value=${this._form.description || ""}
              @input=${(ev) => (this._form = { ...this._form, description: ev.target.value })}
            />
          </label>

          <label>
            Enable
            <select
              .value=${this._form.enable}
              @change=${(ev) => (this._form = { ...this._form, enable: ev.target.value })}
            >
              <option value="Y">Y</option>
              <option value="N">N</option>
            </select>
          </label>
        </div>

        <div style="margin-top: 10px">
          <strong>Groups</strong>
          <div class="chips">
            ${this._groups.map(
              (group) => html`
                <button class=${this._form.groups.includes(group) ? "ok" : ""} @click=${() => this._toggleGroup(group)}>
                  ${group}
                </button>
              `
            )}
          </div>
        </div>

        <div style="margin-top: 10px">
          <strong>Reply Attributes (radreply)</strong>
          ${this._form.reply_attributes.map(
            (item, index) => html`
              <div class="attr-row">
                <input
                  placeholder="attribute"
                  .value=${item.attribute}
                  @input=${(ev) => this._updateAttr(index, "attribute", ev.target.value)}
                />
                <input
                  placeholder=":="
                  .value=${item.op}
                  @input=${(ev) => this._updateAttr(index, "op", ev.target.value)}
                />
                <input
                  placeholder="value"
                  .value=${item.value}
                  @input=${(ev) => this._updateAttr(index, "value", ev.target.value)}
                />
                <button class="danger" @click=${() => this._removeAttrRow(index)}>X</button>
              </div>
            `
          )}
          <button @click=${this._addAttrRow}>Add Attribute</button>
        </div>

        <button slot="actions" class="ok" @click=${this._save}>Save</button>
      </fr-modal>

      <fr-modal .open=${this._detailOpen} title="User Details" @close=${this._closeDetails}>
        ${!this._details
          ? html`<div>Loading...</div>`
          : html`
              <div><strong>Username:</strong> ${this._details.username}</div>
              <div><strong>Status:</strong>
                <span class="status ${this._details.stats.online ? "online" : "offline"}">
                  ${this._details.stats.online ? "Online" : "Offline"}
                </span>
              </div>
              <div><strong>Download:</strong> ${bytesToHuman(this._details.stats.download)}</div>
              <div><strong>Upload:</strong> ${bytesToHuman(this._details.stats.upload)}</div>

              <div style="margin-top: 10px">
                <strong>Access History</strong>
                <div class="card" style="margin-top: 6px; padding: 8px">
                  ${(this._details.stats.history || []).map(
                    (h) => html`
                      <div style="border-bottom: 1px solid #eef2f5; padding: 6px 0;">
                        <div>Session: ${h.acctsessionid || "-"}</div>
                        <div>Start: ${h.acctstarttime || "-"} | Stop: ${h.acctstoptime || "active"}</div>
                        <div>
                          In: ${bytesToHuman(h.acctinputoctets)} | Out: ${bytesToHuman(h.acctoutputoctets)}
                        </div>
                      </div>
                    `
                  )}
                </div>
              </div>
            `}
      </fr-modal>
    `;
  }
}

customElements.define("users-page", UsersPage);
