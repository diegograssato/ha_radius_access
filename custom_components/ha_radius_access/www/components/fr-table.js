class FrTable extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) {
      return;
    }

    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
        }
        .placeholder {
          padding: 10px;
          border: 1px dashed #b5c2d1;
          border-radius: 8px;
          color: #526173;
          font-size: 0.9rem;
          background: #fff;
        }
      </style>
      <div class="placeholder">Tabela carregada em modo de compatibilidade.</div>
    `;
  }
}

if (!customElements.get("fr-table")) {
  customElements.define("fr-table", FrTable);
}
