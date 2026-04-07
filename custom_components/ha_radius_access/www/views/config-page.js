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
  throw new Error("Unable to resolve Lit runtime for config-page");
}

class ConfigPage extends LitElement {
  static properties = {
    hass: { attribute: false },
  };

  static styles = css`
    :host {
      display: block;
    }

    .box {
      background: #fff;
      border-radius: 12px;
      border: 1px solid #dbe4ee;
      padding: 14px;
      line-height: 1.5;
    }

    ul {
      margin: 0;
      padding-left: 18px;
    }
  `;

  render() {
    return html`
      <div class="box">
        <h3>Integration Config</h3>
        <p>
          Configure host, port, username, password and database in the integration config flow:
          <strong>Settings > Devices & Services > FreeRADIUS Manager > Configure</strong>
        </p>
        <p>Required schema assumptions:</p>
        <ul>
          <li>FreeRADIUS default tables (radcheck, radreply, radgroupreply, radgroupcheck, radusergroup, radacct)</li>
          <li>Auxiliary table <strong>fr_entity_type</strong> for user/mac type</li>
        </ul>
      </div>
    `;
  }
}

customElements.define("config-page", ConfigPage);
