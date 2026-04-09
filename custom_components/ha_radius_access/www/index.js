class HaRadiusAccessPanel extends HTMLElement {
  constructor() {
    super();
    const today = new Date();
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(today.getDate() - 2);

    this._hass = null;
    this._eventsBound = false;
    this._loadedOnce = false;
    this._usersRequestSeq = 0;
    this._groupsRequestSeq = 0;
    this._state = {
      tab: "users",
      usersView: "list",
      groupsView: "list",
      userFormType: "user",
      groupsRaw: [],
      groupNames: [],
      users: [],
      totalUsers: 0,
      usersPage: 1,
      usersPageSize: 25,
      groupsPage: 1,
      groupsPageSize: 10,
      entityTypeFilter: "",
      userGroupFilter: "",
      userDetailsStartDate: this._toIsoDate(twoDaysAgo),
      userDetailsEndDate: this._toIsoDate(today),
      search: "",
      groupsSearchTerm: "",
      groupsSearchDraft: "",
      status: "",
      editingUsername: null,
      editingGroupName: null,
      groupAttributes: [],
      editingGroupAttrIndex: null,
      editingUserEnable: "Y",
      editingDescription: "",
      userDetails: null,
      userReplyAttributes: [],
      editingReplyIndex: null,
    };
  }

  set hass(value) {
    this._hass = value;
    if (this.isConnected && !this._loadedOnce && this._hass) {
      this._loadedOnce = true;
      this._loadAll().catch((err) => this._setStatus(`Erro: ${err.message}`, true));
    }
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }
    this._render();
    if (!this._eventsBound) {
      this._bindEvents();
      this._eventsBound = true;
    }
    if (this._hass && !this._loadedOnce) {
      this._loadedOnce = true;
      this._loadAll().catch((err) => this._setStatus(`Erro: ${err.message}`, true));
    }
  }

  _bindEvents() {
    this.shadowRoot.addEventListener("click", (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const tabTarget = target.closest("[data-tab]");
      const tab = tabTarget ? tabTarget.getAttribute("data-tab") : null;
      if (tab) {
        this._state.tab = tab;
        // Re-render full shell so tab button active styles are recalculated.
        this._render();
        return;
      }

      const actionTarget = target.closest("[data-action]");
      const action = actionTarget ? actionTarget.getAttribute("data-action") : null;
      if (action) {
        this._handleAction(action, actionTarget);
      }
    });

    this.shadowRoot.addEventListener("input", (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (
        target.id === "groups-name" &&
        this._state.tab === "groups" &&
        this._state.groupsView === "edit"
      ) {
        const input = /** @type {HTMLInputElement} */ (target);
        this._state.editingGroupName = input.value;
      }
      if (
        target.id === "users-username" &&
        this._state.tab === "users" &&
        this._state.usersView === "edit" &&
        this._state.userFormType === "mac"
      ) {
        const input = /** @type {HTMLInputElement} */ (target);
        input.value = this._formatMacValue(input.value);
      }
    });

    this.shadowRoot.addEventListener("change", async (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.id === "users-page-size") {
        const select = /** @type {HTMLSelectElement} */ (target);
        const value = Number(select.value);
        if ([10, 25, 50].includes(value)) {
          this._state.usersPageSize = value;
          this._state.usersPage = 1;
          await this._loadUsers();
        }
      }

      if (target.id === "groups-page-size") {
        const select = /** @type {HTMLSelectElement} */ (target);
        const value = Number(select.value);
        if ([10, 25, 50].includes(value)) {
          this._state.groupsPageSize = value;
          this._state.groupsPage = 1;
          this._renderContent();
        }
      }
    });
  }

  _formatMacValue(rawValue) {
    const clean = String(rawValue || "")
      .toUpperCase()
      .replace(/[^0-9A-F]/g, "")
      .slice(0, 12);
    const chunks = clean.match(/.{1,2}/g) || [];
    return chunks.join(":");
  }

  _toIsoDate(dateObj) {
    const date = dateObj instanceof Date ? dateObj : new Date(dateObj);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  _formatMegabytes(value) {
    const bytes = Number(value || 0);
    const megabytes = bytes / (1024 * 1024);
    return `${megabytes.toFixed(2)} MB`;
  }

  _captureUserFormDraft() {
    return {
      username: this._value("users-username"),
      password: this._value("users-password"),
      description: this._value("users-description"),
      groups: this._getMultiSelectValues("users-groups"),
      replyAttribute: this._value("users-reply-attribute"),
      replyValue: this._value("users-reply-value"),
    };
  }

  _restoreUserFormDraft(draft) {
    this._setValue("users-username", draft.username || "");
    this._setValue("users-password", draft.password || "");
    this._setValue("users-description", draft.description || "");
    this._setMultiSelectValues("users-groups", draft.groups || []);
    this._setValue("users-reply-attribute", draft.replyAttribute || "");
    this._setValue("users-reply-value", draft.replyValue || "");
  }

  async _handleAction(action, target) {
    try {
      if (action === "groups-save") {
        await this._saveGroup();
      }
      if (action === "groups-new") {
        this._openNewGroupForm();
      }
      if (action === "groups-back") {
        this._goToGroupsList();
      }
      if (action === "groups-edit") {
        this._editGroup(target.getAttribute("data-group"));
      }
      if (action === "groups-delete") {
        await this._deleteGroup(target.getAttribute("data-group"));
      }
      if (action === "groups-toggle") {
        await this._toggleGroup(target.getAttribute("data-group"));
      }
      if (action === "groups-attr-add") {
        await this._addGroupAttr();
      }
      if (action === "groups-attr-edit") {
        this._editGroupAttr(Number(target.getAttribute("data-index")));
      }
      if (action === "groups-attr-delete") {
        this._deleteGroupAttr(Number(target.getAttribute("data-index")));
      }
      if (action === "groups-page-prev") {
        if (this._state.groupsPage > 1) {
          this._state.groupsPage -= 1;
          this._renderContent();
        }
      }
      if (action === "groups-page-next") {
        const grouped = this._groupMap();
        const filterTerm = (this._state.groupsSearchTerm || "").toLowerCase();
        const totalGroups = Array.from(grouped.keys()).filter((name) =>
          !filterTerm || name.toLowerCase().includes(filterTerm)
        ).length;
        const totalPages = Math.max(1, Math.ceil(totalGroups / this._state.groupsPageSize));
        if (this._state.groupsPage < totalPages) {
          this._state.groupsPage += 1;
          this._renderContent();
        }
      }
      if (action === "groups-search") {
        this._state.groupsSearchDraft = this._value("groups-search");
        this._state.groupsSearchTerm = this._state.groupsSearchDraft;
        this._state.groupsPage = 1;
        this._renderContent();
      }
      if (action === "groups-clear-search") {
        this._state.groupsSearchDraft = "";
        this._state.groupsSearchTerm = "";
        this._state.groupsPage = 1;
        this._renderContent();
      }
      if (action === "users-search") {
        this._state.usersPage = 1;
        await this._loadUsers();
      }
      if (action === "users-clear-filters") {
        this._state.search = "";
        this._state.entityTypeFilter = "";
        this._state.userGroupFilter = "";
        this._state.usersPage = 1;
        this._setValue("users-search", "");
        this._setValue("users-filter", "");
        this._setValue("users-group-filter", "");
        await this._loadUsers();
      }
      if (action === "users-details-apply-filter") {
        const username = target.getAttribute("data-username");
        this._state.userDetailsStartDate = this._value("users-details-start-date");
        this._state.userDetailsEndDate = this._value("users-details-end-date");
        await this._showUserDetails(username, false);
      }
      if (action === "users-details-clear-filter") {
        const username = target.getAttribute("data-username");
        const current = new Date();
        const twoDaysBack = new Date(current);
        twoDaysBack.setDate(current.getDate() - 2);
        this._state.userDetailsStartDate = this._toIsoDate(twoDaysBack);
        this._state.userDetailsEndDate = this._toIsoDate(current);
        await this._showUserDetails(username, false);
      }
      if (action === "users-page-prev") {
        if (this._state.usersPage > 1) {
          this._state.usersPage -= 1;
          await this._loadUsers();
        }
      }
      if (action === "users-page-next") {
        const totalPages = Math.max(1, Math.ceil((this._state.totalUsers || 0) / this._state.usersPageSize));
        if (this._state.usersPage < totalPages) {
          this._state.usersPage += 1;
          await this._loadUsers();
        }
      }
      if (action === "users-new-user") {
        this._openNewUserForm();
      }
      if (action === "users-new-mac") {
        this._openNewMacForm();
      }
      if (action === "users-back") {
        this._goToUsersList();
      }
      if (action === "users-save") {
        await this._saveUser();
      }
      if (action === "users-reply-add") {
        await this._addUserReplyAttr();
      }
      if (action === "users-reply-edit") {
        this._editUserReplyAttr(Number(target.getAttribute("data-index")));
      }
      if (action === "users-reply-delete") {
        this._deleteUserReplyAttr(Number(target.getAttribute("data-index")));
      }
      if (action === "users-edit") {
        await this._editUser(target.getAttribute("data-username"));
      }
      if (action === "users-delete") {
        await this._deleteUser(target.getAttribute("data-username"));
      }
      if (action === "users-toggle") {
        await this._toggleUser(target.getAttribute("data-username"), target.getAttribute("data-enable") === "Y");
      }
      if (action === "users-details") {
        await this._showUserDetails(target.getAttribute("data-username"));
      }
      if (action === "service-sync") {
        await this._callService("sync_users", {});
      }
      if (action === "service-disconnect") {
        const username = this._value("disconnect-username");
        await this._callService("disconnect_user", { username });
      }
    } catch (err) {
      this._setStatus(`Erro: ${err.message}`, true);
    }
  }

  async _callService(service, data) {
    if (!this._hass || !this._hass.callService) {
      throw new Error("Home Assistant service API indisponivel");
    }
    await this._hass.callService("ha_radius_access", service, data);
    this._setStatus(`Servico ${service} executado com sucesso.`, false);
    await this._loadUsers();
  }

  async _api(path, method = "GET", body) {
    const token =
      (this._hass && this._hass.auth && this._hass.auth.data && this._hass.auth.data.access_token) ||
      (this._hass && this._hass.auth && this._hass.auth.accessToken) ||
      (this._hass && this._hass.connection && this._hass.connection.options && this._hass.connection.options.auth && this._hass.connection.options.auth.accessToken);

    if (!token) {
      throw new Error("Token de autenticacao do Home Assistant indisponivel");
    }

    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    };
    if (body) {
      headers["Content-Type"] = "application/json";
    }

    let requestPath = path;
    if (method.toUpperCase() === "GET") {
      const url = new URL(path, window.location.origin);
      url.searchParams.set("_ts", String(Date.now()));
      requestPath = `${url.pathname}?${url.searchParams.toString()}`;
    }

    const response = await fetch(requestPath, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return payload.data;
  }

  _value(id) {
    const el = this.shadowRoot.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }

  _getMultiSelectValues(id) {
    const el = this.shadowRoot.getElementById(id);
    if (!el || !el.options) return [];
    const values = [];
    for (const option of el.options) {
      if (option.selected && option.value) {
        values.push(option.value);
      }
    }
    return values;
  }

  _setValue(id, value) {
    const el = this.shadowRoot.getElementById(id);
    if (el) {
      el.value = value == null ? "" : value;
    }
  }

  _setMultiSelectValues(id, values) {
    const el = this.shadowRoot.getElementById(id);
    if (!el || !el.options) return;
    const valuesSet = new Set(values || []);
    for (const option of el.options) {
      option.selected = valuesSet.has(option.value);
    }
  }

  _clearMultiSelect(id) {
    const el = this.shadowRoot.getElementById(id);
    if (!el || !el.options) return;
    for (const option of el.options) {
      option.selected = false;
    }
  }

  _setStatus(message, isError = false) {
    this._state.status = message;
    const status = this.shadowRoot.getElementById("status");
    if (status) {
      status.textContent = message;
      status.className = isError ? "status error" : "status ok";
    }
  }

  _parseAttributeLines(text) {
    const lines = String(text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.map((line, index) => {
      const parts = line.split("|").map((part) => String(part || "").trim());
      const attribute = parts[0] || "";
      let op = ":=";
      let value = "";

      if (parts.length === 2) {
        value = parts[1] || "";
      } else {
        op = parts[1] || ":=";
        value = parts.slice(2).join("|").trim();
      }

      if (!attribute) {
        throw new Error(`Linha ${index + 1}: attribute é obrigatório`);
      }
      if (!value) {
        throw new Error(`Linha ${index + 1}: value é obrigatório`);
      }

      return {
        attribute,
        op,
        value,
      };
    });
  }

  _formatAttributeLines(items) {
    return (items || []).map((x) => `${x.attribute}|${x.op}|${x.value}`).join("\n");
  }

  _groupMap() {
    const grouped = new Map();
    const groupStatus = {}; // Track auth_type for each group
    for (const row of this._state.groupsRaw) {
      if (!grouped.has(row.groupname)) {
        grouped.set(row.groupname, []);
        groupStatus[row.groupname] = row.auth_type || "Accept"; // Default to Accept
      }
      grouped.get(row.groupname).push({ attribute: row.attribute, op: row.op, value: row.value });
    }
    this._state.groupStatus = groupStatus; // Store for use in rendering
    return grouped;
  }

  async _loadAll() {
    await Promise.all([this._loadGroups(), this._loadGroupNames(), this._loadUsers()]);
    this._setStatus("Painel carregado.", false);
  }

  async _loadGroups() {
    const requestSeq = ++this._groupsRequestSeq;
    const rows = await this._api("/api/ha_radius_access/groups");
    if (requestSeq !== this._groupsRequestSeq) {
      return;
    }
    this._state.groupsRaw = rows;
    const totalGroups = this._groupMap().size;
    const totalPages = Math.max(1, Math.ceil(totalGroups / this._state.groupsPageSize));
    if (this._state.groupsPage > totalPages) {
      this._state.groupsPage = totalPages;
    }
    this._renderContent();
  }

  async _loadGroupNames() {
    this._state.groupNames = await this._api("/api/ha_radius_access/group_names");
  }

  async _loadUsers() {
    const searchEl = this.shadowRoot.getElementById("users-search");
    if (searchEl instanceof HTMLInputElement) {
      this._state.search = String(searchEl.value || "").trim();
    }

    const typeEl = this.shadowRoot.getElementById("users-filter");
    if (typeEl instanceof HTMLSelectElement) {
      this._state.entityTypeFilter = String(typeEl.value || "").trim();
    }

    const groupEl = this.shadowRoot.getElementById("users-group-filter");
    if (groupEl instanceof HTMLSelectElement) {
      this._state.userGroupFilter = String(groupEl.value || "").trim();
    }

    const params = new URLSearchParams({
      page: String(this._state.usersPage || 1),
      page_size: String(this._state.usersPageSize || 25),
      sort_by: "username",
      sort_order: "asc",
    });
    if (this._state.search) {
      params.set("search", this._state.search);
    }
    if (this._state.entityTypeFilter) {
      params.set("entity_type", this._state.entityTypeFilter);
    }
    if (this._state.userGroupFilter) {
      params.set("groupname", this._state.userGroupFilter);
    }

    const requestSeq = ++this._usersRequestSeq;
    const data = await this._api(`/api/ha_radius_access/users?${params.toString()}`);
    if (requestSeq !== this._usersRequestSeq) {
      return;
    }
    this._state.users = data.items || [];
    this._state.totalUsers = data.total || 0;
    const totalPages = Math.max(1, Math.ceil((this._state.totalUsers || 0) / this._state.usersPageSize));
    if (this._state.usersPage > totalPages) {
      this._state.usersPage = totalPages;
    }
    this._renderContent();
  }


  async _refreshAfterUserMutation() {
    await Promise.all([this._loadUsers(), this._loadGroupNames()]);
  }

  async _refreshAfterGroupMutation() {
    await Promise.all([this._loadGroups(), this._loadGroupNames(), this._loadUsers()]);
  }

  async _saveGroup() {
    const groupname = this._value("groups-name");
    if (!groupname) {
      throw new Error("Informe o groupname");
    }
    if (!this._state.groupAttributes || !this._state.groupAttributes.length) {
      throw new Error("Informe pelo menos um atributo");
    }

    const grouped = this._groupMap();
    const isDuplicate = grouped.has(groupname) && groupname !== this._state.editingGroupName;
    if (isDuplicate) {
      throw new Error(`Grupo ${groupname} já existe`);
    }

    const attributes = this._state.groupAttributes;
    const exists = grouped.has(groupname);
    await this._api("/api/ha_radius_access/groups", exists ? "PUT" : "POST", { groupname, attributes });
    this._setStatus(`Grupo ${groupname} salvo.`, false);
    this._state.groupsView = "list";
    this._state.editingGroupName = null;
    this._state.groupAttributes = [];
    this._state.editingGroupAttrIndex = null;
    await this._refreshAfterGroupMutation();
  }

  _openNewGroupForm() {
    this._state.groupsView = "edit";
    this._state.editingGroupName = "";
    this._state.groupAttributes = [];
    this._state.editingGroupAttrIndex = null;
    this._renderContent();
  }

  _goToGroupsList() {
    this._state.groupsView = "list";
    this._state.editingGroupName = null;
    this._state.groupAttributes = [];
    this._state.editingGroupAttrIndex = null;
    this._renderContent();
  }

  _editGroup(groupname) {
    const attrs = this._groupMap().get(groupname) || [];
    this._state.groupsView = "edit";
    this._state.editingGroupName = groupname;
    this._state.groupAttributes = attrs;
    this._state.editingGroupAttrIndex = null;
    this._renderContent();
    this._setStatus(`Editando grupo ${groupname}.`, false);
  }

  async _addGroupAttr() {
    // Keep the current group name typed in the form before re-rendering.
    this._state.editingGroupName = this._value("groups-name");

    const attribute = this._value("groups-attr-attribute");
    const op = this._value("groups-attr-op") || ":=";
    const value = this._value("groups-attr-value");
    if (!attribute) {
      throw new Error("Selecione um atributo");
    }
    if (!value) {
      throw new Error("Informe o valor do atributo");
    }

    const item = { attribute, op, value };

    if (this._state.editingGroupAttrIndex != null) {
      this._state.groupAttributes[this._state.editingGroupAttrIndex] = item;
      this._setStatus(`Atributo ${attribute} atualizado.`, false);
    } else {
      this._state.groupAttributes.push(item);
      this._setStatus(`Atributo ${attribute} adicionado.`, false);
    }

    this._state.editingGroupAttrIndex = null;
    this._setValue("groups-attr-attribute", "");
    this._setValue("groups-attr-op", ":=");
    this._setValue("groups-attr-value", "");
    this._renderContent();
  }

  _editGroupAttr(index) {
    const item = (this._state.groupAttributes || [])[index];
    if (!item) {
      return;
    }
    this._state.editingGroupAttrIndex = index;
    this._setValue("groups-attr-attribute", item.attribute);
    this._setValue("groups-attr-op", item.op || ":=");
    this._setValue("groups-attr-value", item.value);
    this._setStatus(`Editando atributo ${item.attribute}.`, false);
  }

  _deleteGroupAttr(index) {
    if (Number.isNaN(index) || index < 0) {
      return;
    }
    // Keep the current group name typed in the form before re-rendering.
    this._state.editingGroupName = this._value("groups-name");

    const list = this._state.groupAttributes || [];
    if (index >= list.length) {
      return;
    }

    const [removed] = list.splice(index, 1);
    this._state.groupAttributes = list;
    this._state.editingGroupAttrIndex = null;
    this._setValue("groups-attr-attribute", "");
    this._setValue("groups-attr-op", ":=");
    this._setValue("groups-attr-value", "");
    this._setStatus(`Atributo ${removed.attribute} removido.`, false);
    this._renderContent();
  }

  async _deleteGroup(groupname) {
    if (!groupname || !window.confirm(`Excluir grupo ${groupname}?`)) {
      return;
    }
    await this._api(`/api/ha_radius_access/groups?groupname=${encodeURIComponent(groupname)}`, "DELETE");
    this._setStatus(`Grupo ${groupname} excluido.`, false);
    await this._refreshAfterGroupMutation();
  }

  async _toggleGroup(groupname) {
    if (!groupname) {
      return;
    }
    const checks = await this._api(
      `/api/ha_radius_access/group_checks?groupname=${encodeURIComponent(groupname)}`
    );
    const authTypeRule = (checks || []).find(
      (rule) => String(rule.attribute || "").toLowerCase() === "auth-type"
    );

    const currentValue = authTypeRule && authTypeRule.value ? String(authTypeRule.value) : "Accept";
    const nextValue = currentValue === "Accept" ? "Reject" : "Accept";

    if (authTypeRule && authTypeRule.id) {
      await this._api("/api/ha_radius_access/group_checks", "PUT", {
        id: authTypeRule.id,
        groupname,
        attribute: "Auth-Type",
        op: ":=",
        value: nextValue,
      });
    } else {
      await this._api("/api/ha_radius_access/group_checks", "POST", {
        groupname,
        attribute: "Auth-Type",
        op: ":=",
        value: nextValue,
      });
    }

    const newStatus = nextValue === "Accept" ? "Ativo" : "Inativo";
    this._setStatus(`Status de ${groupname} alterado para ${newStatus}.`, false);
    await this._refreshAfterGroupMutation();
  }

  async _saveUser() {
    const replyAttributes = [...(this._state.userReplyAttributes || [])];
    const draftAttribute = this._value("users-reply-attribute");
    const draftValue = this._value("users-reply-value");

    // If user typed a draft reply and clicked save directly, include it automatically.
    if (draftAttribute || draftValue) {
      if (!draftAttribute || !draftValue) {
        throw new Error("Preencha atributo e valor do reply, ou limpe ambos os campos.");
      }
      const draftItem = { attribute: draftAttribute, op: ":=", value: draftValue };
      if (this._state.editingReplyIndex != null) {
        replyAttributes[this._state.editingReplyIndex] = draftItem;
      } else {
        replyAttributes.push(draftItem);
      }
    }

    const groups = this._getMultiSelectValues("users-groups").filter(Boolean);

    const formType = this._state.userFormType === "mac" ? "mac" : "user";
    const payload = {
      username: this._value("users-username"),
      password: formType === "mac" ? null : this._value("users-password"),
      enable: this._state.editingUsername ? (this._state.editingUserEnable || "Y") : "Y",
      entity_type: formType,
      description: this._value("users-description"),
      groups,
      reply_attributes: replyAttributes,
    };

    if (payload.entity_type === "mac") {
      payload.username = this._formatMacValue(payload.username);
    }

    if (payload.entity_type === "user" && !payload.password && !this._state.editingUsername) {
      throw new Error("Password e obrigatorio para cadastro de usuario");
    }

    if (!payload.username) {
      throw new Error("Informe username");
    }

    if (!this._state.editingUsername) {
      const exists = (this._state.users || []).some(
        (u) => String(u.username || "").toUpperCase() === String(payload.username || "").toUpperCase()
      );
      if (exists) {
        throw new Error(`Usuario/MAC ja existe: ${payload.username}`);
      }
    }

    if (this._state.editingUsername) {
      await this._api("/api/ha_radius_access/users", "PUT", payload);
      this._setStatus(`Usuario ${payload.username} atualizado.`, false);
    } else {
      await this._api("/api/ha_radius_access/users", "POST", payload);
      this._setStatus(`Usuario ${payload.username} criado.`, false);
    }

    await this._refreshAfterUserMutation();
    this._resetUserFormState();
    this._state.usersView = "list";
    this._renderContent();
  }

  _openNewUserForm() {
    this._state.userFormType = "user";
    this._state.editingUserEnable = "Y";
    this._resetUserFormState();
    this._state.usersView = "edit";
    this._renderContent();
  }

  _openNewMacForm() {
    this._state.userFormType = "mac";
    this._state.editingUserEnable = "Y";
    this._resetUserFormState();
    this._state.usersView = "edit";
    this._renderContent();
  }

  _goToUsersList() {
    this._state.usersView = "list";
    this._state.userDetails = null;
    this._state.editingReplyIndex = null;
    this._renderContent();
  }

  _resetUserFormState() {
    this._state.editingUsername = null;
    this._state.userReplyAttributes = [];
    this._state.editingReplyIndex = null;
    this._state.userDetails = null;
    this._state.editingUserEnable = "Y";
    this._state.editingDescription = "";
    this._setValue("users-username", "");
    this._setValue("users-password", "");
    this._setValue("users-description", "");
    this._clearMultiSelect("users-groups");
    this._setValue("users-reply-attribute", "");
    this._setValue("users-reply-value", "");
  }

  async _addUserReplyAttr() {
    const attribute = this._value("users-reply-attribute");
    const value = this._value("users-reply-value");
    if (!attribute) {
      throw new Error("Selecione um atributo de reply");
    }
    if (!value) {
      throw new Error("Informe o valor do atributo");
    }

    const item = { attribute, op: ":=", value };

    // Existing user: persist immediately via API (single item CRUD).
    if (this._state.editingUsername) {
      if (this._state.editingReplyIndex != null) {
        const current = this._state.userReplyAttributes[this._state.editingReplyIndex];
        const replyId = current && current.id;
        if (!replyId) {
          throw new Error("Reply selecionado sem id para atualizar");
        }
        await this._api("/api/ha_radius_access/users/reply_attrs", "PUT", {
          username: this._state.editingUsername,
          id: replyId,
          ...item,
        });
        this._setStatus(`Reply ${attribute} atualizado.`, false);
      } else {
        await this._api("/api/ha_radius_access/users/reply_attrs", "POST", {
          username: this._state.editingUsername,
          ...item,
        });
        this._setStatus(`Reply ${attribute} adicionado.`, false);
      }

      await this._editUser(this._state.editingUsername);
      return;
    }

    if (this._state.editingReplyIndex != null) {
      this._state.userReplyAttributes[this._state.editingReplyIndex] = item;
      this._setStatus(`Reply ${attribute} atualizado.`, false);
    } else {
      this._state.userReplyAttributes.push(item);
      this._setStatus(`Reply ${attribute} adicionado.`, false);
    }

    const draft = this._captureUserFormDraft();
    this._state.editingReplyIndex = null;
    draft.replyAttribute = "";
    draft.replyValue = "";
    this._renderContent();
    this._restoreUserFormDraft(draft);
  }

  _editUserReplyAttr(index) {
    const item = (this._state.userReplyAttributes || [])[index];
    if (!item) {
      return;
    }
    this._state.editingReplyIndex = index;
    this._setValue("users-reply-attribute", item.attribute);
    this._setValue("users-reply-value", item.value);
    this._setStatus(`Editando reply ${item.attribute}.`, false);
  }

  async _deleteUserReplyAttr(index) {
    if (Number.isNaN(index) || index < 0) {
      return;
    }
    const list = this._state.userReplyAttributes || [];
    if (index >= list.length) {
      return;
    }

    if (this._state.editingUsername) {
      const current = list[index];
      if (!current || !current.id) {
        throw new Error("Reply selecionado sem id para excluir");
      }
      await this._api(
        `/api/ha_radius_access/users/reply_attrs?username=${encodeURIComponent(this._state.editingUsername)}&id=${current.id}`,
        "DELETE"
      );
      this._setStatus(`Reply ${current.attribute} removido.`, false);
      await this._editUser(this._state.editingUsername);
      return;
    }

    const [removed] = list.splice(index, 1);
    const draft = this._captureUserFormDraft();
    this._state.userReplyAttributes = list;
    this._state.editingReplyIndex = null;
    draft.replyAttribute = "";
    draft.replyValue = "";
    this._setStatus(`Reply ${removed.attribute} removido.`, false);
    this._renderContent();
    this._restoreUserFormDraft(draft);
  }

  async _editUser(username) {
    const details = await this._api(`/api/ha_radius_access/users/details?username=${encodeURIComponent(username)}`);
    const row = this._state.users.find((x) => x.username === username);

    this._state.usersView = "edit";
    this._state.editingUsername = username;
    this._state.userFormType = row && row.entity_type ? row.entity_type : "user";
    this._state.editingUserEnable = row && row.enable ? row.enable : "Y";
    this._state.editingDescription =
      details && typeof details.description === "string"
        ? details.description
        : (row && row.description) || "";

    this._state.userReplyAttributes = (details.reply_attributes || []).map((x) => ({
      id: x.id,
      attribute: x.attribute,
      op: x.op || ":=",
      value: x.value,
    }));
    this._state.editingReplyIndex = null;
    this._renderContent();

    this._setValue("users-username", username);
    this._setValue("users-password", "");
    this._setValue("users-description", this._state.editingDescription || "");
    this._setMultiSelectValues("users-groups", (details.groups || []).map((x) => x.groupname));
    this._setValue("users-reply-attribute", "");
    this._setValue("users-reply-value", "");
    this._setStatus(`Editando usuario ${username}.`, false);
  }

  async _deleteUser(username) {
    if (!username || !window.confirm(`Excluir usuario ${username}?`)) {
      return;
    }
    await this._api(`/api/ha_radius_access/users?username=${encodeURIComponent(username)}`, "DELETE");
    this._setStatus(`Usuario ${username} excluido.`, false);
    await this._refreshAfterUserMutation();
  }

  async _toggleUser(username, enabledNow) {
    const result = await this._api("/api/ha_radius_access/users/toggle", "POST", {
      username,
    });
    this._setStatus(`Status de ${username} alterado para ${result.enable || "N"}.`, false);
    await this._refreshAfterUserMutation();
  }

  async _showUserDetails(username, resetDateRange = true) {
    const targetUsername = username || (this._state.userDetails && this._state.userDetails.username);
    if (!targetUsername) {
      return;
    }

    if (resetDateRange) {
      const today = new Date();
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(today.getDate() - 2);
      this._state.userDetailsStartDate = this._toIsoDate(twoDaysAgo);
      this._state.userDetailsEndDate = this._toIsoDate(today);
    }

    const params = new URLSearchParams({ username: targetUsername });
    if (this._state.userDetailsStartDate) {
      params.set("start_date", this._state.userDetailsStartDate);
    }
    if (this._state.userDetailsEndDate) {
      params.set("end_date", this._state.userDetailsEndDate);
    }

    const details = await this._api(`/api/ha_radius_access/users/details?${params.toString()}`);
    this._state.userDetails = details;
    this._state.usersView = "details";
    this._renderContent();
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --op-bg-0: #0f1420;
          --op-bg-1: #1a2233;
          --op-bg-2: #222c3e;
          --op-bg-3: #2a3447;
          --op-line: #7d8797;
          --op-text: #e8edf5;
          --op-text-soft: #b7c1cf;
          --op-header: #121928;
          --op-accent: #d36526;
          --op-accent-2: #f07b33;
          --op-danger: #c44545;
          display: block;
          min-height: 100%;
          font-family: "Segoe UI", Tahoma, Arial, sans-serif;
          color: var(--op-text);
          background:
            linear-gradient(180deg, rgba(33, 43, 64, 0.44) 0%, rgba(15, 20, 32, 0) 100%),
            linear-gradient(140deg, #0e1320 0%, #161e30 42%, #1b253a 100%);
          padding: 18px;
          box-sizing: border-box;
        }
        .card {
          background: linear-gradient(180deg, var(--op-bg-1) 0%, #141b2a 100%);
          border: 1px solid #5d6880;
          border-radius: 4px;
          padding: 18px;
          box-shadow: 0 18px 34px rgba(0, 0, 0, 0.28);
          margin: 0 auto;
          max-width: 1180px;
        }
        h2 {
          margin: 0 0 4px;
          font-size: 2rem;
          font-weight: 600;
          letter-spacing: 0.01em;
          color: #eef2f9;
        }
        .subtitle {
          margin: 0 0 16px;
          color: var(--op-text-soft);
          font-size: 0.92rem;
        }
        .tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 14px;
          border-top: 1px solid #6a7384;
          border-bottom: 1px solid #6a7384;
          padding: 10px 0;
        }
        .tab {
          border: 1px solid #707b8d;
          border-radius: 4px;
          background: linear-gradient(180deg, #2a3447 0%, #212a3b 100%);
          padding: 8px 12px;
          cursor: pointer;
          font-weight: 600;
          color: #d9e1ee;
        }
        .tab.active {
          background: linear-gradient(180deg, var(--op-accent-2) 0%, var(--op-accent) 100%);
          color: #fff8f2;
          border-color: #f2a36f;
        }
        .status {
          margin: 8px 0 16px;
          padding: 10px;
          border-radius: 4px;
          font-size: 0.91rem;
          border: 1px solid #6c7688;
          background: #1a2233;
        }
        .status.ok {
          background: #1c2738;
          color: #cde9d8;
          border-color: #4d7b63;
        }
        .status.error {
          background: #382229;
          color: #ffd6d6;
          border-color: #9f5865;
        }
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          border: 0;
        }
        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .panel {
          border: 1px solid #6d788d;
          border-radius: 3px;
          background: linear-gradient(180deg, #111827 0%, #0d1422 100%);
          padding: 14px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
        }
        .panel h3 {
          margin: 0 0 10px;
          color: #f0f4fb;
          font-size: 1.05rem;
          border-bottom: 1px solid #4f5b71;
          padding-bottom: 8px;
        }
        .section {
          margin-top: 6px;
        }
        p {
          color: #d6ddec;
        }
        label {
          font-size: 0.82rem;
          color: #c6cfde;
          display: block;
          margin: 6px 0 4px;
        }
        input, select, textarea {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid #727d90;
          border-radius: 3px;
          padding: 9px;
          font-size: 0.9rem;
          background: #0d1422;
          transition: all 0.2s ease;
          color: #eef3ff;
        }
        input:focus, select:focus, textarea:focus {
          outline: none;
          border-color: #e18b58;
          box-shadow: 0 0 0 2px rgba(211, 101, 38, 0.25);
        }
        input::placeholder {
          color: #8f9db2;
        }
        textarea { min-height: 92px; }
        .row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 10px;
        }
        .row.meta {
          justify-content: space-between;
          align-items: center;
          border: 1px solid #59657c;
          border-radius: 3px;
          background: #1c2639;
          padding: 8px 10px;
        }
        button.action {
          border: 1px solid #808ca1;
          border-radius: 3px;
          background: linear-gradient(180deg, #2a3447 0%, #1f283a 100%);
          padding: 8px 11px;
          cursor: pointer;
          font-weight: 600;
          color: #e8edf5;
        }
        button.action:hover { filter: brightness(1.08); }
        button.action[disabled] {
          opacity: 0.45;
          cursor: not-allowed;
        }
        button.icon-action {
          min-width: 34px;
          padding: 6px 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        button.icon-action ha-icon {
          --mdc-icon-size: 18px;
        }
        button.primary {
          border-color: #f0a069;
          background: linear-gradient(180deg, var(--op-accent-2) 0%, var(--op-accent) 100%);
          color: #ffffff;
        }
        button.danger {
          border-color: #c46d6d;
          background: linear-gradient(180deg, #74313b 0%, #5e2430 100%);
          color: #fff0f0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
          font-size: 0.92rem;
          background: #111a2b;
          border: 1px solid #6a7488;
          border-radius: 3px;
          overflow: hidden;
        }
        th {
          background: #222d42;
          color: #e6edf8;
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          border-bottom: 1px solid #717b91;
        }
        th, td {
          border-bottom: 1px solid #2e394d;
          text-align: left;
          padding: 8px;
        }
        tr:nth-child(even) td {
          background: #151f32;
        }
        tr:hover td {
          background: #1f2a3f;
        }
        td.actions-col { white-space: nowrap; }
        hr { border: none; border-top: 1px solid #475268; margin: 14px 0; }
        code {
          background: #232f45;
          border: 1px solid #6d798f;
          padding: 1px 6px;
          border-radius: 3px;
          color: #f3f6fc;
        }
        .op-operator {
          width: 70px;
          align-self: end;
          text-align: center;
          font-weight: 700;
          color: #f3ad78;
          background: #202b41;
          border: 1px solid #677287;
          border-radius: 3px;
          padding: 8px 0;
          box-sizing: border-box;
        }
        @media (max-width: 900px) {
          .grid { grid-template-columns: 1fr; }
          h2 { font-size: 1.45rem; }
        }
      </style>
      <div class="card">
        <h2>System: HA Radius Access</h2>
        <p class="subtitle">Interface de gerenciamento Freeradius, para contrele de usuário e devices.</p>
        <div class="tabs">
          <button class="tab ${this._state.tab === "users" ? "active" : ""}" data-tab="users">Usuários & MAC</button>
          <button class="tab ${this._state.tab === "groups" ? "active" : ""}" data-tab="groups">Grupos de acesso</button>
          <button class="tab ${this._state.tab === "config" ? "active" : ""}" data-tab="config">Configurações</button>
        </div>
        <div id="status" class="status ok">${this._state.status || "Pronto."}</div>
        <div id="content"></div>
      </div>
    `;
    this._renderContent();
  }

  _renderContent() {
    const content = this.shadowRoot.getElementById("content");
    if (!content) {
      return;
    }

    if (this._state.tab === "config") {
      content.innerHTML = this._renderConfig();
      return;
    }
    if (this._state.tab === "groups") {
      content.innerHTML = this._renderGroups();
      return;
    }
    content.innerHTML = this._renderUsers();
  }

  _renderConfig() {
    return `
      <div class="section">
        <div class="panel">
        <h3>Config e Servicos</h3>
        <p>Backend ativo via endpoints internos em <code>/api/ha_radius_access/*</code>.</p>
        <div class="grid">
          <div>
            <label>Disconnect username/MAC</label>
            <input id="disconnect-username" placeholder="AA:BB:CC:DD:EE:FF" />
          </div>
        </div>
        <div class="row">
          <button class="action primary" data-action="service-sync">Executar sync_users</button>
          <button class="action" data-action="service-disconnect">Executar disconnect_user</button>
        </div>
        </div>
      </div>
    `;
  }

  _renderGroups() {
    if (this._state.groupsView === "edit") {
      return this._renderGroupsEdit();
    }

    const grouped = this._groupMap();
    const allGroups = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
    const filterTerm = (this._state.groupsSearchTerm || "").toLowerCase();
    const filteredGroups = allGroups.filter((groupname) =>
      !filterTerm || groupname.toLowerCase().includes(filterTerm)
    );
    const totalGroups = filteredGroups.length;
    const totalPages = Math.max(1, Math.ceil(totalGroups / this._state.groupsPageSize));
    const currentPage = Math.min(Math.max(1, this._state.groupsPage), totalPages);
    const start = (currentPage - 1) * this._state.groupsPageSize;
    const pageGroups = filteredGroups.slice(start, start + this._state.groupsPageSize);

    const rows = pageGroups
      .map((groupname) => {
        const authType = (this._state.groupStatus && this._state.groupStatus[groupname]) || "Accept";
        const isActive = authType === "Accept";
        return `
        <tr>
          <td>${groupname}</td>
          <td class="actions-col">
            <button class="action icon-action" title="${isActive ? "Desabilitar" : "Habilitar"}" data-action="groups-toggle" data-group="${groupname}" data-auth-type="${authType}"><ha-icon icon="${isActive ? "mdi:toggle-switch-off-outline" : "mdi:toggle-switch"}"></ha-icon><span class="sr-only">${isActive ? "Desabilitar" : "Habilitar"}</span></button>
            <button class="action icon-action" title="Editar" data-action="groups-edit" data-group="${groupname}"><ha-icon icon="mdi:pencil"></ha-icon><span class="sr-only">Editar</span></button>
            <button class="action icon-action danger" title="Excluir" data-action="groups-delete" data-group="${groupname}"><ha-icon icon="mdi:trash-can-outline"></ha-icon><span class="sr-only">Excluir</span></button>
          </td>
        </tr>
      `;
      })
      .join("");

    return `
      <div class="section">
        <div class="panel">
          <h3>Lista de Grupos</h3>
          <div class="row">
            <button class="action primary" data-action="groups-new">Cadastrar Novo Grupo</button>
          </div>

          <div class="row">
            <div style="flex: 1 1 260px;">
              <label>Filtro por nome do grupo</label>
              <input id="groups-search" value="${this._state.groupsSearchDraft || ""}" placeholder="Digite para buscar grupo" />
            </div>
            <div style="align-self: end; display: flex; gap: 8px;">
              <button class="action" data-action="groups-search">Buscar</button>
              <button class="action" data-action="groups-clear-search">Limpar</button>
            </div>
          </div>

          <div class="row meta">
            <p>Total: ${totalGroups}</p>
            <div>
              <label style="margin-right: 8px;">Itens por pagina</label>
              <select id="groups-page-size">
                <option value="10" ${this._state.groupsPageSize === 10 ? "selected" : ""}>10</option>
                <option value="25" ${this._state.groupsPageSize === 25 ? "selected" : ""}>25</option>
                <option value="50" ${this._state.groupsPageSize === 50 ? "selected" : ""}>50</option>
              </select>
            </div>
          </div>
          <table>
            <thead><tr><th>Group</th><th>Acoes</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="2">Sem grupos</td></tr>`}</tbody>
          </table>

          <div class="row" style="justify-content: space-between; margin-top: 12px;">
            <button class="action" data-action="groups-page-prev" ${currentPage <= 1 ? "disabled" : ""}>Anterior</button>
            <span>Pagina ${currentPage} de ${totalPages}</span>
            <button class="action" data-action="groups-page-next" ${currentPage >= totalPages ? "disabled" : ""}>Proxima</button>
          </div>
        </div>
      </div>
    `;
  }

  _renderGroupsEdit() {
    const attributeOptions = [
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
    ];

    const attrRows = (this._state.groupAttributes || [])
      .map(
        (r, idx) => `
          <tr>
            <td>${r.attribute}</td>
            <td>${r.op || ":="}</td>
            <td>${r.value}</td>
            <td>
              <button class="action" data-action="groups-attr-edit" data-index="${idx}">Editar</button>
              <button class="action danger" data-action="groups-attr-delete" data-index="${idx}">Excluir</button>
            </td>
          </tr>
        `
      )
      .join("");

    return `
      <div class="section">
        <div class="panel">
          <h3>${this._state.editingGroupName ? `Editar Grupo: ${this._state.editingGroupName}` : "Cadastro de Grupo"}</h3>
          <div class="row">
            <button class="action" data-action="groups-back">Voltar</button>
          </div>

          <label>Group name</label>
          <input id="groups-name" placeholder="nome do grupo" value="${this._state.editingGroupName || ""}" />

          <label style="margin-top: 8px; display: block;">Atributos</label>
          <div class="row">
            <div style="flex: 1 1 150px;">
              <label>Atributo</label>
              <select id="groups-attr-attribute">
                <option value="">Selecione...</option>
                ${attributeOptions.map((attr) => `<option value="${attr}">${attr}</option>`).join("")}
              </select>
            </div>
            <div class="op-operator">:=</div>
            <div style="flex: 1 1 220px;">
              <label>Valor</label>
              <input id="groups-attr-value" placeholder="10.0.0.0/24 192.168.1.1 1" />
            </div>
          </div>
          <div class="row">
            <button class="action primary" data-action="groups-attr-add">${this._state.editingGroupAttrIndex != null ? "Salvar Atributo" : "Adicionar Atributo"}</button>
          </div>

          <table>
            <thead><tr><th>Atributo</th><th>Op</th><th>Valor</th><th>Acoes</th></tr></thead>
            <tbody>${attrRows || `<tr><td colspan="4">Sem atributos</td></tr>`}</tbody>
          </table>

          <div class="row">
            <button class="action primary" data-action="groups-save">Salvar Grupo</button>
          </div>
        </div>
      </div>
    `;
  }

  _renderUsers() {
    if (this._state.usersView === "edit") {
      return this._renderUsersEdit();
    }
    if (this._state.usersView === "details") {
      return this._renderUsersDetails();
    }
    return this._renderUsersList();
  }

  _renderUsersList() {
    const rows = (this._state.users || [])
      .map(
        (u) => `
          <tr>
            <td><ha-icon icon="${u.entity_type === "user" ? "mdi:account" : "mdi:desktop-tower"}"></ha-icon> ${u.username}</td>
            <td>${u.description || "-"}</td>
            <td>${u.groupnames || "-"}</td>
            <td class="actions-col">
              <button class="action icon-action" title="Editar" data-action="users-edit" data-username="${u.username}"><ha-icon icon="mdi:pencil"></ha-icon><span class="sr-only">Editar</span></button>
              <button class="action icon-action" title="Detalhes" data-action="users-details" data-username="${u.username}"><ha-icon icon="mdi:card-account-details"></ha-icon><span class="sr-only">Detalhes</span></button>
              <button class="action icon-action" title="${u.enable === "Y" ? "Desabilitar" : "Habilitar"}" data-action="users-toggle" data-username="${u.username}" data-enable="${u.enable || "N"}"><ha-icon icon="${u.enable === "Y" ? "mdi:toggle-switch-off-outline" : "mdi:toggle-switch"}"></ha-icon><span class="sr-only">${u.enable === "Y" ? "Desabilitar" : "Habilitar"}</span></button>
              <button class="action icon-action danger" title="Excluir" data-action="users-delete" data-username="${u.username}"><ha-icon icon="mdi:trash-can-outline"></ha-icon><span class="sr-only">Excluir</span></button>
            </td>
          </tr>
        `
      )
      .join("");

    return `
      <div class="section">
        <div class="panel">
          <h3>Busca e Listagem de Usuarios/MAC</h3>
          <div class="row">
            <button class="action primary" data-action="users-new-user">Cadastrar Usuario</button>
            <button class="action primary" data-action="users-new-mac">Cadastrar MAC</button>
          </div>
          <div class="grid">
            <div>
              <label>Busca</label>
              <input id="users-search" value="${this._state.search || ""}" placeholder="username" />
            </div>
            <div>
              <label>Filtro tipo</label>
              <select id="users-filter">
                <option value="" ${!this._state.entityTypeFilter ? "selected" : ""}>Todos</option>
                <option value="user" ${this._state.entityTypeFilter === "user" ? "selected" : ""}>User</option>
                <option value="mac" ${this._state.entityTypeFilter === "mac" ? "selected" : ""}>MAC</option>
              </select>
            </div>
            <div style="display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: end;">
              <div>
                <label>Filtro por grupo</label>
                <select id="users-group-filter" style="margin-bottom: 0;">
                  <option value="" ${!this._state.userGroupFilter ? "selected" : ""}>Todos</option>
                  ${(this._state.groupNames || []).map((g) => `<option value="${g}" ${this._state.userGroupFilter === g ? "selected" : ""}>${g}</option>`).join("")}
                </select>
              </div>
              <button class="action primary" data-action="users-search">Buscar</button>
              <button class="action" data-action="users-clear-filters">Limpar</button>
            </div>
          </div>

          <div class="row meta">
            <p>Total: ${this._state.totalUsers}</p>
            <div>
              <label style="margin-right: 8px;">Itens por pagina</label>
              <select id="users-page-size">
                <option value="10" ${this._state.usersPageSize === 10 ? "selected" : ""}>10</option>
                <option value="25" ${this._state.usersPageSize === 25 ? "selected" : ""}>25</option>
                <option value="50" ${this._state.usersPageSize === 50 ? "selected" : ""}>50</option>
              </select>
            </div>
          </div>
          <table>
            <thead><tr><th>Usuario / MAC</th><th>Descricao</th><th>Grupos</th><th>Acoes</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="4">Sem usuarios</td></tr>`}</tbody>
          </table>

          <div class="row" style="justify-content: space-between; margin-top: 12px;">
            <button class="action" data-action="users-page-prev" ${this._state.usersPage <= 1 ? "disabled" : ""}>Anterior</button>
            <span>Pagina ${this._state.usersPage} de ${Math.max(1, Math.ceil((this._state.totalUsers || 0) / this._state.usersPageSize))}</span>
            <button class="action" data-action="users-page-next" ${this._state.usersPage >= Math.max(1, Math.ceil((this._state.totalUsers || 0) / this._state.usersPageSize)) ? "disabled" : ""}>Proxima</button>
          </div>
        </div>
      </div>
    `;
  }

  _renderUsersEdit() {
    const replyAttributeOptions = [
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
    ];

    const replyRows = (this._state.userReplyAttributes || [])
      .map(
        (r, idx) => `
          <tr>
            <td>${r.attribute}</td>
            <td>${r.op || ":="}</td>
            <td>${r.value}</td>
            <td>
              <button class="action" data-action="users-reply-edit" data-index="${idx}">Editar</button>
              <button class="action danger" data-action="users-reply-delete" data-index="${idx}">Excluir</button>
            </td>
          </tr>
        `
      )
      .join("");

    return `
      <div class="section">
        <div class="panel">
          <h3>${this._state.editingUsername ? `Editar ${this._state.userFormType === "mac" ? "MAC" : "Usuario"}: ${this._state.editingUsername}` : this._state.userFormType === "mac" ? "Cadastro de MAC" : "Cadastro de Usuario"}</h3>
          <div class="row">
            <button class="action" data-action="users-back">Voltar</button>
          </div>

          <label>Username / MAC</label>
          <input id="users-username" placeholder="${this._state.userFormType === "mac" ? "BC:24:11:B5:7B:CD" : "usuario"}" />
          <label>Descricao (${this._state.userFormType === "mac" ? "nome do device" : "nome completo"})</label>
          <input id="users-description" placeholder="${this._state.userFormType === "mac" ? "Ex.: AP Sala" : "Ex.: Fulano da Silva"}" />
          ${this._state.userFormType === "user" ? `
            <label>Password (user)</label>
            <input id="users-password" type="password" />
          ` : ""}
          <label>Groups</label>
          <select id="users-groups" multiple>
            <option value="">-- Nenhum --</option>
            ${(this._state.groupNames || []).map((g) => `<option value="${g}">${g}</option>`).join("")}
          </select>
          <label>Reply Attributes</label>
          <div class="row">
            <div style="flex: 1 1 220px;">
              <label>Atributo</label>
              <select id="users-reply-attribute">
                <option value="">Selecione...</option>
                ${replyAttributeOptions.map((attr) => `<option value="${attr}">${attr}</option>`).join("")}
              </select>
            </div>
            <div class="op-operator">:=</div>
            <div style="flex: 1 1 220px;">
              <label>Valor</label>
              <input id="users-reply-value" placeholder="valor do atributo" />
            </div>
          </div>
          <div class="row">
            <button class="action primary" data-action="users-reply-add">${this._state.editingReplyIndex != null ? "Salvar Reply" : "Adicionar Reply"}</button>
          </div>

          <table>
            <thead><tr><th>Atributo</th><th>Op</th><th>Valor</th><th>Acoes</th></tr></thead>
            <tbody>${replyRows || `<tr><td colspan="4">Sem reply attrs adicionados</td></tr>`}</tbody>
          </table>
          <div class="row">
            <button class="action primary" data-action="users-save">Salvar Usuario/MAC</button>
          </div>
        </div>
      </div>
    `;
  }

  _renderUsersDetails() {
    const details = this._state.userDetails || {};
    const username = details.username || "-";
    const stats = details.stats || {};
    const description = details.description || "-";
    const groups = details.groups || [];
    const replies = details.reply_attributes || [];
    const history = (stats.history || []).slice(0, 20);

    const groupsRows = groups
      .map((g) => `<tr><td>${g.groupname}</td><td>${g.priority}</td></tr>`)
      .join("");
    const repliesRows = replies
      .map((r) => `<tr><td>${r.attribute}</td><td>${r.op}</td><td>${r.value}</td></tr>`)
      .join("");
    const historyRows = history
      .map(
        (h) => `
          <tr>
            <td>${h.acctstarttime || "-"}</td>
            <td>${h.acctstoptime || "ativo"}</td>
            <td>${this._formatMegabytes(h.acctinputoctets || 0)}</td>
            <td>${this._formatMegabytes(h.acctoutputoctets || 0)}</td>
          </tr>
        `
      )
      .join("");

    return `
      <div class="section">
        <div class="panel">
          <h3><ha-icon icon="mdi:card-account-details"></ha-icon> Detalhes do Usuario: ${username}</h3>
          <p><strong>Descricao:</strong> ${description}</p>
          <div class="row">
            <button class="action" data-action="users-back">Voltar</button>
            <button class="action" data-action="users-edit" data-username="${username}">Editar Usuario</button>
          </div>

          <div class="row" style="align-items: end;">
            <div style="flex: 1 1 220px;">
              <label>Data inicio consumo/login</label>
              <input id="users-details-start-date" type="date" value="${this._state.userDetailsStartDate || ""}" />
            </div>
            <div style="flex: 1 1 220px;">
              <label>Data fim consumo/login</label>
              <input id="users-details-end-date" type="date" value="${this._state.userDetailsEndDate || ""}" />
            </div>
            <div>
              <button class="action" data-action="users-details-apply-filter" data-username="${username}">Filtrar</button>
            </div>
            <div>
              <button class="action" data-action="users-details-clear-filter" data-username="${username}">Limpar</button>
            </div>
          </div>

          <hr>
          <h3>Reply Attributes</h3>
          <table>
            <thead><tr><th>Atributo</th><th>Op</th><th>Valor</th></tr></thead>
            <tbody>${repliesRows || `<tr><td colspan="3">Sem reply attrs</td></tr>`}</tbody>
          </table>

          <h3>Groups</h3>
          <table>
            <thead><tr><th>Group</th><th>Priority</th></tr></thead>
            <tbody>${groupsRows || `<tr><td colspan="2">Sem grupos</td></tr>`}</tbody>
          </table>

          <h3>Historico</h3>
          <table>
            <thead><tr><th>Inicio</th><th>Fim</th><th>In</th><th>Out</th></tr></thead>
            <tbody>${historyRows || `<tr><td colspan="4">Sem historico</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    `;
  }
}

if (!customElements.get("ha-radius-access-panel")) {
  customElements.define("ha-radius-access-panel", HaRadiusAccessPanel);
}
