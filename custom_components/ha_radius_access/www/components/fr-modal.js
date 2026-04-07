class FrModal extends HTMLElement {
  constructor() {
    super();
    this._open = false;
    this._title = "";
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._render();
  }

  set open(value) {
    this._open = Boolean(value);
    if (this._open) {
      this.setAttribute("open", "");
    } else {
      this.removeAttribute("open");
    }
    this._render();
  }

  get open() {
    return this._open;
  }

  set title(value) {
    this._title = String(value || "");
    this._render();
  }

  get title() {
    return this._title;
  }

  static get observedAttributes() {
    return ["open", "title"];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) {
      return;
    }

    if (name === "open") {
      this._open = newValue !== null;
    }
    if (name === "title") {
      this._title = newValue || "";
    }
    this._render();
  }

  _emitClose() {
    this.open = false;
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  _render() {
    if (!this.shadowRoot) {
      return;
    }

    if (!this._open) {
      this.shadowRoot.innerHTML = "";
      return;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed;
          inset: 0;
          z-index: 1000;
        }
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(8, 18, 30, 0.45);
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 12px;
        }
        .box {
          background: #fff;
          border-radius: 12px;
          max-width: 760px;
          width: 100%;
          max-height: 95vh;
          overflow: auto;
          box-shadow: 0 25px 50px rgba(5, 20, 36, 0.35);
        }
        header,
        footer {
          padding: 12px;
          border-bottom: 1px solid #edf1f4;
        }
        footer {
          border-bottom: 0;
          border-top: 1px solid #edf1f4;
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        .body {
          padding: 12px;
        }
      </style>
      <div class="overlay" id="overlay">
        <section class="box" id="box">
          <header><strong>${this._title}</strong></header>
          <div class="body"><slot></slot></div>
          <footer>
            <button id="closeBtn">Close</button>
            <slot name="actions"></slot>
          </footer>
        </section>
      </div>
    `;

    const overlay = this.shadowRoot.getElementById("overlay");
    const box = this.shadowRoot.getElementById("box");
    const closeBtn = this.shadowRoot.getElementById("closeBtn");

    if (overlay) {
      overlay.addEventListener("click", () => this._emitClose());
    }
    if (box) {
      box.addEventListener("click", (ev) => ev.stopPropagation());
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this._emitClose());
    }
  }
}

if (!customElements.get("fr-modal")) {
  customElements.define("fr-modal", FrModal);
}
