(function (root, factory) {
  "use strict";

  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.AMTicketBulkSelection = Object.freeze(api);
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const MODES = Object.freeze({
    IDLE: "idle",
    SELECTING: "selecting"
  });

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  function normalizeStatus(value) {
    return clean(value).toLocaleLowerCase("vi-VN");
  }

  function normalizeTicket(value) {
    const source = value || {};
    const uuid = clean(source.uuid || source.id);

    if (!uuid) {
      return null;
    }

    return Object.freeze({
      uuid,
      code: clean(source.code || source.ticket_code).toUpperCase(),
      status: normalizeStatus(source.status),
      customerCode: clean(source.customerCode || source.customer_code),
      customerName: clean(source.customerName || source.customer_name || source.customer_master_name),
      model: clean(source.model),
      groupId: clean(source.groupId),
      groupSize: Number(source.groupSize) || 0,
      childIndex: Number(source.childIndex) || 0,
      sourcePage: clean(source.sourcePage),
      selectable: source.selectable !== false,
      disabledReason: clean(source.disabledReason),
      workflowAvailable: source.workflow_available !== false,
      repairStartedAt: clean(source.repair_started_at),
      readyForHandoverAt: clean(source.ready_for_handover_at),
      completedAt: clean(source.completed_at)
    });
  }

  function normalizeGroup(value, visibleTickets) {
    const source = value || {};
    const id = clean(source.id || source.groupId);
    const seen = new Set();
    const ticketIds = (source.ticketIds || source.children || []).reduce((ids, item) => {
      const uuid = clean(item && (item.uuid || item.id) || item);
      if (uuid && visibleTickets.has(uuid) && !seen.has(uuid)) {
        seen.add(uuid);
        ids.push(uuid);
      }
      return ids;
    }, []);

    return id && ticketIds.length ? Object.freeze({ id, ticketIds: Object.freeze(ticketIds) }) : null;
  }

  function createSelectionStore() {
    let mode = MODES.IDLE;
    let visibleTickets = new Map();
    let groups = new Map();
    const selectedTickets = new Map();
    const listeners = new Set();

    function selectedVisibleIds() {
      return Array.from(selectedTickets.keys()).filter((uuid) => visibleTickets.has(uuid));
    }

    function eligibleVisibleIds() {
      return Array.from(visibleTickets.values())
        .filter((ticket) => ticket.selectable)
        .map((ticket) => ticket.uuid);
    }

    function selectionState(ids) {
      const eligible = ids.filter((uuid) => {
        const ticket = visibleTickets.get(uuid);
        return Boolean(ticket && ticket.selectable);
      });
      const selectedCount = eligible.reduce((count, uuid) => count + (selectedTickets.has(uuid) ? 1 : 0), 0);

      return Object.freeze({
        eligibleCount: eligible.length,
        selectedCount,
        checked: eligible.length > 0 && selectedCount === eligible.length,
        indeterminate: selectedCount > 0 && selectedCount < eligible.length,
        disabled: eligible.length === 0
      });
    }

    function getSnapshot() {
      const selected = selectedVisibleIds().map((uuid) => selectedTickets.get(uuid));
      const statusCounts = selected.reduce((counts, ticket) => {
        counts[ticket.status] = (counts[ticket.status] || 0) + 1;
        return counts;
      }, {});

      return Object.freeze({
        mode,
        selected: Object.freeze(selected.slice()),
        selectedCount: selected.length,
        statusCounts: Object.freeze(Object.assign({}, statusCounts)),
        visibleCount: visibleTickets.size,
        selectableCount: eligibleVisibleIds().length,
        globalState: selectionState(eligibleVisibleIds())
      });
    }

    function emit(reason) {
      const snapshot = getSnapshot();
      listeners.forEach((listener) => listener(snapshot, reason));
      return snapshot;
    }

    function setRegistry(registry, options) {
      const source = registry || {};
      const settings = options || {};
      const nextTickets = new Map();

      (source.tickets || []).forEach((value) => {
        const ticket = normalizeTicket(value);
        if (ticket) {
          nextTickets.set(ticket.uuid, ticket);
        }
      });

      const nextGroups = new Map();
      (source.groups || []).forEach((value) => {
        const group = normalizeGroup(value, nextTickets);
        if (group) {
          nextGroups.set(group.id, group);
        }
      });

      visibleTickets = nextTickets;
      groups = nextGroups;

      if (settings.preserveSelection === true) {
        Array.from(selectedTickets.keys()).forEach((uuid) => {
          const ticket = visibleTickets.get(uuid);
          if (!ticket || !ticket.selectable) {
            selectedTickets.delete(uuid);
          } else {
            selectedTickets.set(uuid, ticket);
          }
        });
      } else {
        selectedTickets.clear();
      }

      return emit(settings.reason || "registry");
    }

    function enter() {
      if (mode !== MODES.SELECTING) {
        mode = MODES.SELECTING;
        emit("enter");
      }
      return getSnapshot();
    }

    function exit() {
      selectedTickets.clear();
      mode = MODES.IDLE;
      return emit("exit");
    }

    function clear(reason) {
      if (selectedTickets.size) {
        selectedTickets.clear();
        return emit(reason || "clear");
      }
      return getSnapshot();
    }

    function toggleTicket(uuidValue, forceSelected) {
      const uuid = clean(uuidValue);
      const ticket = visibleTickets.get(uuid);
      if (mode !== MODES.SELECTING || !ticket || !ticket.selectable) {
        return getSnapshot();
      }

      const shouldSelect = typeof forceSelected === "boolean" ? forceSelected : !selectedTickets.has(uuid);
      if (shouldSelect) {
        selectedTickets.set(uuid, ticket);
      } else {
        selectedTickets.delete(uuid);
      }
      return emit("ticket");
    }

    function toggleIds(ids, forceSelected, reason) {
      const eligible = ids.filter((uuid) => {
        const ticket = visibleTickets.get(uuid);
        return Boolean(ticket && ticket.selectable);
      });
      const state = selectionState(eligible);
      const shouldSelect = typeof forceSelected === "boolean" ? forceSelected : !state.checked;

      eligible.forEach((uuid) => {
        if (shouldSelect) {
          selectedTickets.set(uuid, visibleTickets.get(uuid));
        } else {
          selectedTickets.delete(uuid);
        }
      });
      return emit(reason);
    }

    function toggleGroup(groupId, forceSelected) {
      const group = groups.get(clean(groupId));
      return mode === MODES.SELECTING && group
        ? toggleIds(group.ticketIds, forceSelected, "group")
        : getSnapshot();
    }

    function toggleAll(forceSelected) {
      return mode === MODES.SELECTING
        ? toggleIds(eligibleVisibleIds(), forceSelected, "all")
        : getSnapshot();
    }

    function retainStatus(statusValue) {
      const status = normalizeStatus(statusValue);
      Array.from(selectedTickets.entries()).forEach(([uuid, ticket]) => {
        if (ticket.status !== status) {
          selectedTickets.delete(uuid);
        }
      });
      return emit("retain-status");
    }

    function removeMany(ids, reason) {
      (ids || []).forEach((uuid) => selectedTickets.delete(clean(uuid)));
      return emit(reason || "remove-many");
    }

    function replaceSelection(ids, reason) {
      selectedTickets.clear();
      (ids || []).forEach((uuidValue) => {
        const ticket = visibleTickets.get(clean(uuidValue));
        if (ticket && ticket.selectable) {
          selectedTickets.set(ticket.uuid, ticket);
        }
      });
      return emit(reason || "replace");
    }

    function getGroupState(groupId) {
      const group = groups.get(clean(groupId));
      return group ? selectionState(group.ticketIds) : selectionState([]);
    }

    function subscribe(listener) {
      if (typeof listener !== "function") {
        return function () {};
      }
      listeners.add(listener);
      return function () {
        listeners.delete(listener);
      };
    }

    function destroy() {
      listeners.clear();
      selectedTickets.clear();
      visibleTickets.clear();
      groups.clear();
      mode = MODES.IDLE;
    }

    return Object.freeze({
      clear,
      destroy,
      enter,
      exit,
      getGroupState,
      getSnapshot,
      removeMany,
      replaceSelection,
      retainStatus,
      setRegistry,
      subscribe,
      toggleAll,
      toggleGroup,
      toggleTicket
    });
  }

  function createSelectionControl(options) {
    if (typeof document === "undefined") {
      return null;
    }

    const config = options || {};
    const wrapper = document.createElement("label");
    const input = document.createElement("input");
    const label = document.createElement("span");
    const kind = config.kind === "group" ? "group" : "ticket";

    wrapper.className = `ticket-bulk-checkbox ${clean(config.className)}`.trim();
    wrapper.dataset.noRowToggle = "true";
    input.type = "checkbox";
    input.disabled = config.disabled === true;
    input.dataset[kind === "group" ? "bulkGroupSelect" : "bulkTicketSelect"] = clean(config.id);
    input.setAttribute("aria-label", clean(config.ariaLabel) || "Chọn phiếu");
    if (config.disabledReason) {
      input.title = clean(config.disabledReason);
      wrapper.title = clean(config.disabledReason);
    }
    label.className = "sr-only";
    label.textContent = clean(config.ariaLabel) || "Chọn phiếu";
    wrapper.append(input, label);
    return wrapper;
  }

  return Object.freeze({
    MODES,
    createSelectionControl,
    createSelectionStore,
    normalizeStatus,
    normalizeTicket
  });
});
