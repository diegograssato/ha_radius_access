import { apiCall } from "./api-client.js";

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
  throw new Error("Unable to resolve Lit runtime for groups-page");
}

class GroupsPage extends LitElement {
  static properties = {
    hass: { attribute: false },
    _rows: { state: true },
    _error: { state: true },
    _loading: { state: true },
    _modalOpen: { state: true },
    _form: { state: true },
    _groupAttrs: { state: true },
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
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
    }

    button {
      border: 1px solid #a9b8c8;
      border-radius: 8px;
      background: #fff;
      padding: 8px 10px;
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

    .error {
      color: #b3261e;
      font-size: 0.9rem;
      margin: 0;
    }

    .list {
      display: grid;
      gap: 8px;
    }

    .group-item {
      border: 1px solid #ebedf0;
      border-radius: 10px;
      padding: 10px;
      display: grid;
      gap: 8px;
    }

    .attr-row {
      display: grid;
      grid-template-columns: 1fr 80px 1fr auto;
      gap: 6px;
      margin-bottom: 6px;
    }

    input,
    select {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #ccd5de;
      border-radius: 8px;
      padding: 8px;
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    @media (max-width: 760px) {
      .attr-row {
        grid-template-columns: 1fr;
      }
    }
  `;

  constructor() {
    super();
    this._rows = [];
    this._loading = false;
    this._error = "";
    this._modalOpen = false;
    this._groupAttrs = [];
    this._form = { groupname: "", attributes: [{ attribute: "", op: ":=", value: "" }] };
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
    this._loadMeta();
  }

  async _loadMeta() {
    try {
      const meta = await apiCall("/api/ha_radius_access/meta");
      this._groupAttrs = meta.group_allowed_attributes || [];
      if (!this._form.attributes[0].attribute && this._groupAttrs[0]) {
        this._form = {
          ...this._form,
          attributes: [{ attribute: this._groupAttrs[0], op: ":=", value: "" }],
        };
      }
    } catch (err) {
      this._error = err.message;
    }
  }

  async _load() {
    this._loading = true;
    this._error = "";
    try {
      const rows = await apiCall("/api/ha_radius_access/groups");
      const grouped = new Map();
      rows.forEach((row) => {
        if (!grouped.has(row.groupname)) {
          grouped.set(row.groupname, []);
        }
        grouped.get(row.groupname).push({
          attribute: row.attribute,
          op: row.op,
          value: row.value,
        });
      });
      this._rows = Array.from(grouped.entries()).map(([groupname, attributes]) => ({
        groupname,
        attributes,
      }));
    } catch (err) {
      this._error = err.message;
    } finally {
      this._loading = false;
    }
  }

  _newForm() {
    return {
      groupname: "",
      attributes: [{ attribute: this._groupAttrs[0] || "", op: ":=", value: "" }],
    };
  }

  _openCreate() {
    this._form = this._newForm();
    this._modalOpen = true;
  }

  _openEdit(row) {
    this._form = {
      groupname: row.groupname,
      attributes: row.attributes.map((item) => ({ ...item })),
    };
    this._modalOpen = true;
  }

  _closeModal() {
    this._modalOpen = false;
  }

  _updateAttr(index, field, value) {
    const attrs = this._form.attributes.map((item, idx) => {
      if (idx !== index) {
        return item;
      }
      return { ...item, [field]: value };
    });
    this._form = { ...this._form, attributes: attrs };
  }

  _addAttrRow() {
    const attrs = [...this._form.attributes, { attribute: this._groupAttrs[0] || "", op: ":=", value: "" }];
    this._form = { ...this._form, attributes: attrs };
  }

  _removeAttrRow(index) {
    const attrs = this._form.attributes.filter((_, idx) => idx !== index);
    this._form = {
      ...this._form,
      attributes: attrs.length ? attrs : [{ attribute: this._groupAttrs[0] || "", op: ":=", value: "" }],
    };
  }

  async _save() {
    this._error = "";
    const method = this._rows.some((r) => r.groupname === this._form.groupname) ? "PUT" : "POST";
    try {
      await apiCall("/api/ha_radius_access/groups", {
        method,
        body: JSON.stringify(this._form),
      });
      this._modalOpen = false;
      await this._load();
    } catch (err) {
      this._error = err.message;
    }
  }

  async _delete(groupname) {
    if (!window.confirm(`Delete group ${groupname}?`)) {
      return;
    }

    this._error = "";
    try {
      await apiCall(`/api/ha_radius_access/groups?groupname=${encodeURIComponent(groupname)}`, {
        method: "DELETE",
      });
      await this._load();
    } catch (err) {
      this._error = err.message;
    }
  }

  render() {
    return html`
      <section class="toolbar">
        <div>
          <strong>Groups (radgroupreply)</strong>
          <div>Multiple and repeated attributes are supported.</div>
        </div>
        <button class="ok" @click=${this._openCreate}>New Group</button>
      </section>

      ${this._error ? html`<p class="error">${this._error}</p>` : ""}

      <section class="card list">
        ${this._loading
          ? html`<div>Loading...</div>`
          : this._rows.map(
              (row) => html`
                <article class="group-item">
                  <div class="actions">
                    <strong>${row.groupname}</strong>
                    <button @click=${() => this._openEdit(row)}>Edit</button>
                    <button class="danger" @click=${() => this._delete(row.groupname)}>Delete</button>
                  </div>
                  <ul>
                    ${row.attributes.map(
                      (attr) => html`<li>${attr.attribute} ${attr.op} ${attr.value}</li>`
                    )}
                  </ul>
                </article>
              `
            )}
      </section>

      <fr-modal .open=${this._modalOpen} title="Group" @close=${this._closeModal}>
        <label>
          Group Name
          <input
            .value=${this._form.groupname}
            @input=${(ev) => (this._form = { ...this._form, groupname: ev.target.value })}
          />
        </label>
        <div style="margin-top: 10px">
          <strong>Attributes</strong>
          ${this._form.attributes.map(
            (item, index) => html`
              <div class="attr-row">
                <select .value=${item.attribute} @change=${(ev) => this._updateAttr(index, "attribute", ev.target.value)}>
                  ${this._groupAttrs.map(
                    (attr) => html`<option value=${attr}>${attr}</option>`
                  )}
                </select>
                <input
                  .value=${item.op}
                  @input=${(ev) => this._updateAttr(index, "op", ev.target.value)}
                />
                <input
                  .value=${item.value}
                  @input=${(ev) => this._updateAttr(index, "value", ev.target.value)}
                />
                <button class="danger" @click=${() => this._removeAttrRow(index)}>X</button>
              </div>
            `
          )}
        </div>
        <button @click=${this._addAttrRow}>Add Attribute</button>

        <button slot="actions" class="ok" @click=${this._save}>Save</button>
      </fr-modal>
    `;
  }
}

customElements.define("groups-page", GroupsPage);
