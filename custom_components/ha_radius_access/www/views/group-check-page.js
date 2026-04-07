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
  throw new Error("Unable to resolve Lit runtime for group-check-page");
}

class GroupCheckPage extends LitElement {
  static properties = {
    hass: { attribute: false },
    _rows: { state: true },
    _error: { state: true },
    _loading: { state: true },
    _form: { state: true },
    _editingId: { state: true },
  };

  static styles = css`
    :host {
      display: grid;
      gap: 12px;
    }

    .card {
      background: #fff;
      border: 1px solid #dbe4ee;
      border-radius: 12px;
      padding: 12px;
    }

    .row {
      display: grid;
      grid-template-columns: 1fr 1fr 90px 1fr auto;
      gap: 8px;
      margin-bottom: 8px;
      align-items: center;
    }

    input {
      border: 1px solid #ccd5de;
      border-radius: 8px;
      padding: 8px;
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

    .error {
      color: #b3261e;
    }

    @media (max-width: 960px) {
      .row {
        grid-template-columns: 1fr;
      }
    }
  `;

  constructor() {
    super();
    this._rows = [];
    this._error = "";
    this._loading = false;
    this._editingId = null;
    this._form = { groupname: "", attribute: "", op: ":=", value: "" };
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  async _load() {
    this._loading = true;
    this._error = "";
    try {
      this._rows = await apiCall("/api/ha_radius_access/group_checks");
    } catch (err) {
      this._error = err.message;
    } finally {
      this._loading = false;
    }
  }

  _resetForm() {
    this._editingId = null;
    this._form = { groupname: "", attribute: "", op: ":=", value: "" };
  }

  _edit(row) {
    this._editingId = row.id;
    this._form = {
      groupname: row.groupname,
      attribute: row.attribute,
      op: row.op,
      value: row.value,
    };
  }

  async _save() {
    this._error = "";
    try {
      if (this._editingId) {
        await apiCall("/api/ha_radius_access/group_checks", {
          method: "PUT",
          body: JSON.stringify({ id: this._editingId, ...this._form }),
        });
      } else {
        await apiCall("/api/ha_radius_access/group_checks", {
          method: "POST",
          body: JSON.stringify(this._form),
        });
      }
      this._resetForm();
      await this._load();
    } catch (err) {
      this._error = err.message;
    }
  }

  async _delete(id) {
    if (!window.confirm("Delete this check rule?")) {
      return;
    }
    this._error = "";
    try {
      await apiCall(`/api/ha_radius_access/group_checks?id=${id}`, { method: "DELETE" });
      await this._load();
    } catch (err) {
      this._error = err.message;
    }
  }

  render() {
    return html`
      <section class="card">
        <h3>Group Checks (radgroupcheck)</h3>
        <div class="row">
          <input
            placeholder="groupname"
            .value=${this._form.groupname}
            @input=${(ev) => (this._form = { ...this._form, groupname: ev.target.value })}
          />
          <input
            placeholder="attribute"
            .value=${this._form.attribute}
            @input=${(ev) => (this._form = { ...this._form, attribute: ev.target.value })}
          />
          <input
            placeholder=":="
            .value=${this._form.op}
            @input=${(ev) => (this._form = { ...this._form, op: ev.target.value })}
          />
          <input
            placeholder="value"
            .value=${this._form.value}
            @input=${(ev) => (this._form = { ...this._form, value: ev.target.value })}
          />
          <div>
            <button class="ok" @click=${this._save}>${this._editingId ? "Update" : "Add"}</button>
            ${this._editingId ? html`<button @click=${this._resetForm}>Cancel</button>` : ""}
          </div>
        </div>

        ${this._error ? html`<p class="error">${this._error}</p>` : ""}

        ${this._loading
          ? html`<div>Loading...</div>`
          : this._rows.map(
              (row) => html`
                <div class="row">
                  <div>${row.groupname}</div>
                  <div>${row.attribute}</div>
                  <div>${row.op}</div>
                  <div>${row.value}</div>
                  <div>
                    <button @click=${() => this._edit(row)}>Edit</button>
                    <button class="danger" @click=${() => this._delete(row.id)}>Delete</button>
                  </div>
                </div>
              `
            )}
      </section>
    `;
  }
}

customElements.define("group-check-page", GroupCheckPage);
