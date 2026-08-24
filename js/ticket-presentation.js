(function () {
  "use strict";

  const STORAGE_KEY = "anhminh.multiTicketGroups.v1";
  const RECOVERY_STORAGE_KEY = "anhminh.multiPrintRecovery.v1";
  const LEGACY_RECOVERY_STORAGE_KEY = "anhMinhLastBatchPrintRefsV1";
  const STORAGE_VERSION = 1;
  const MAX_GROUPS = 200;

  function cleanText(value) {
    return String(value == null ? "" : value).trim();
  }

  function normalizeTicketRef(value) {
    const ticketId = cleanText(value && (value.ticketId || value.id));
    const ticketCode = cleanText(value && (value.ticketCode || value.ticket_code)).toUpperCase();

    if (!ticketId || !/^AM[A-Z0-9-]{1,63}$/.test(ticketCode)) {
      return null;
    }

    return { ticketId, ticketCode };
  }

  function normalizeTicketRefs(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    const seen = new Set();
    return value.reduce((refs, item) => {
      const ref = normalizeTicketRef(item);
      if (!ref || seen.has(ref.ticketId)) {
        return refs;
      }
      seen.add(ref.ticketId);
      refs.push(ref);
      return refs;
    }, []);
  }

  function createGroupId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeGroup(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const ticketIds = Array.isArray(value.ticketIds) ? value.ticketIds : [];
    const ticketCodes = Array.isArray(value.ticketCodes) ? value.ticketCodes : [];
    if (ticketIds.length < 2 || ticketIds.length !== ticketCodes.length) {
      return null;
    }

    const refs = normalizeTicketRefs(ticketIds.map((ticketId, index) => ({
      ticketId,
      ticketCode: ticketCodes[index]
    })));
    if (refs.length !== ticketIds.length) {
      return null;
    }

    const createdAt = cleanText(value.createdAt);
    return {
      groupId: cleanText(value.groupId) || createGroupId(),
      createdAt: Number.isFinite(Date.parse(createdAt)) ? createdAt : new Date().toISOString(),
      ticketIds: refs.map((ref) => ref.ticketId),
      ticketCodes: refs.map((ref) => ref.ticketCode)
    };
  }

  function readRegistry() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.groups)) {
        return [];
      }
      return parsed.groups.map(normalizeGroup).filter(Boolean);
    } catch (_error) {
      return [];
    }
  }

  function writeRegistry(groups) {
    const normalized = (groups || [])
      .map(normalizeGroup)
      .filter(Boolean)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, MAX_GROUPS);

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: STORAGE_VERSION,
        groups: normalized
      }));
    } catch (_error) {
      return false;
    }
    return true;
  }

  function sameMembers(group, refs) {
    return group.ticketIds.length === refs.length
      && refs.every((ref, index) => (
        group.ticketIds[index] === ref.ticketId
        && group.ticketCodes[index] === ref.ticketCode
      ));
  }

  function registerGroup(ticketRefs, options) {
    const refs = normalizeTicketRefs(ticketRefs);
    if (refs.length < 2) {
      return null;
    }

    const settings = options || {};
    const groups = readRegistry();
    const memberIds = new Set(refs.map((ref) => ref.ticketId));
    const existing = groups.find((group) => sameMembers(group, refs));
    const nextGroup = normalizeGroup({
      groupId: cleanText(settings.groupId) || (existing && existing.groupId) || createGroupId(),
      createdAt: cleanText(settings.createdAt) || (existing && existing.createdAt) || new Date().toISOString(),
      ticketIds: refs.map((ref) => ref.ticketId),
      ticketCodes: refs.map((ref) => ref.ticketCode)
    });
    const remaining = groups.filter((group) => (
      group.groupId !== nextGroup.groupId
      && !group.ticketIds.some((ticketId) => memberIds.has(ticketId))
    ));

    writeRegistry([nextGroup, ...remaining]);
    return nextGroup;
  }

  function reconcileGroupsAfterTicketDeletion(groups, ticketIds) {
    const deletedIds = new Set((Array.isArray(ticketIds) ? ticketIds : []).map(cleanText).filter(Boolean));
    const removedGroupIds = [];
    const updatedGroupIds = [];
    const nextGroups = [];

    (Array.isArray(groups) ? groups : []).forEach((value) => {
      const group = normalizeGroup(value);
      if (!group) {
        return;
      }
      const refs = group.ticketIds.reduce((items, ticketId, index) => {
        if (!deletedIds.has(ticketId)) {
          items.push({ ticketId, ticketCode: group.ticketCodes[index] });
        }
        return items;
      }, []);

      if (refs.length === group.ticketIds.length) {
        nextGroups.push(group);
      } else if (refs.length >= 2) {
        updatedGroupIds.push(group.groupId);
        nextGroups.push(normalizeGroup({
          groupId: group.groupId,
          createdAt: group.createdAt,
          ticketIds: refs.map((ref) => ref.ticketId),
          ticketCodes: refs.map((ref) => ref.ticketCode)
        }));
      } else {
        removedGroupIds.push(group.groupId);
      }
    });

    return Object.freeze({
      groups: Object.freeze(nextGroups),
      removedGroupIds: Object.freeze(removedGroupIds),
      updatedGroupIds: Object.freeze(updatedGroupIds)
    });
  }

  function removeTicketsFromRegistry(ticketIds) {
    const result = reconcileGroupsAfterTicketDeletion(readRegistry(), ticketIds);
    return Object.freeze(Object.assign({}, result, {
      written: writeRegistry(result.groups)
    }));
  }
  function importRecoveryState() {
    try {
      const recovery = JSON.parse(window.sessionStorage.getItem(RECOVERY_STORAGE_KEY) || "null");
      if (
        recovery
        && recovery.version === 1
        && Array.isArray(recovery.ticketIds)
        && Array.isArray(recovery.ticketCodes)
      ) {
        return registerGroup(recovery.ticketIds.map((ticketId, index) => ({
          ticketId,
          ticketCode: recovery.ticketCodes[index]
        })), { createdAt: recovery.createdAt });
      }

      const legacyRefs = JSON.parse(window.sessionStorage.getItem(LEGACY_RECOVERY_STORAGE_KEY) || "[]");
      return registerGroup(legacyRefs);
    } catch (_error) {
      return null;
    }
  }

  function registryIndex() {
    importRecoveryState();
    const groups = readRegistry();
    const byTicketId = new Map();

    groups.forEach((group) => {
      group.ticketIds.forEach((ticketId, index) => {
        byTicketId.set(ticketId, {
          group,
          ticketCode: group.ticketCodes[index],
          itemIndex: index
        });
      });
    });

    return { groups, byTicketId };
  }

  function metadataRegistryIndex(tickets) {
    const candidates = new Map();

    (Array.isArray(tickets) ? tickets : []).forEach((ticket, sourceIndex) => {
      const groupId = cleanText(ticket && ticket.intake_batch_id);
      const ticketId = cleanText(ticket && ticket.id);
      const ticketCode = cleanText(ticket && ticket.ticket_code).toUpperCase();
      const itemNo = Number.parseInt(ticket && ticket.intake_batch_item_no, 10);

      if (!groupId || !ticketId || !ticketCode || !Number.isInteger(itemNo) || itemNo < 1) {
        return;
      }

      if (!candidates.has(groupId)) {
        candidates.set(groupId, []);
      }
      candidates.get(groupId).push({ ticket, ticketId, ticketCode, itemNo, sourceIndex });
    });

    const byTicketId = new Map();
    candidates.forEach((entries, groupId) => {
      const ticketIds = new Set(entries.map((entry) => entry.ticketId));
      const itemNumbers = new Set(entries.map((entry) => entry.itemNo));
      if (entries.length < 2 || ticketIds.size !== entries.length || itemNumbers.size !== entries.length) {
        return;
      }

      entries.sort((left, right) => left.itemNo - right.itemNo || left.sourceIndex - right.sourceIndex);
      const group = {
        groupId,
        createdAt: cleanText(entries[0].ticket && entries[0].ticket.created_at),
        ticketIds: entries.map((entry) => entry.ticketId),
        ticketCodes: entries.map((entry) => entry.ticketCode)
      };

      entries.forEach((entry, itemIndex) => {
        byTicketId.set(entry.ticketId, { group, ticketCode: entry.ticketCode, itemIndex });
      });
    });

    return byTicketId;
  }

  function buildTicketPresentationRows(tickets) {
    const source = Array.isArray(tickets) ? tickets : [];
    const { byTicketId: localRegistryByTicketId } = registryIndex();
    const metadataByTicketId = metadataRegistryIndex(source);
    const rows = [];
    const rowsByGroupId = new Map();

    source.forEach((ticket, sourceIndex) => {
      const ticketId = cleanText(ticket && ticket.id);
      const ticketCode = cleanText(ticket && ticket.ticket_code).toUpperCase();
      const membership = metadataByTicketId.get(ticketId) || localRegistryByTicketId.get(ticketId);

      if (!membership || membership.ticketCode !== ticketCode) {
        rows.push({
          type: "ticket",
          key: `ticket:${ticketId || sourceIndex}`,
          tickets: [ticket],
          sourceIndex
        });
        return;
      }

      let row = rowsByGroupId.get(membership.group.groupId);
      if (!row) {
        row = {
          type: "batch",
          key: `batch:${membership.group.groupId}`,
          batchId: membership.group.groupId,
          tickets: [],
          sourceIndex,
          totalTicketCount: membership.group.ticketIds.length,
          ticketIds: membership.group.ticketIds.slice(),
          ticketCodes: membership.group.ticketCodes.slice(),
          createdAt: membership.group.createdAt
        };
        rowsByGroupId.set(membership.group.groupId, row);
        rows.push(row);
      }

      row.tickets.push({ ticket, itemIndex: membership.itemIndex });
    });

    rows.forEach((row) => {
      if (row.type !== "batch") {
        return;
      }
      row.tickets.sort((left, right) => left.itemIndex - right.itemIndex);
      row.tickets = row.tickets.map((entry) => entry.ticket);
    });

    return rows.sort((left, right) => left.sourceIndex - right.sourceIndex);
  }

  function paginateRows(rows, page, pageSize) {
    const source = Array.isArray(rows) ? rows : [];
    const size = Math.max(Number(pageSize) || 1, 1);
    const totalPages = Math.max(1, Math.ceil(source.length / size));
    const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
    const from = (safePage - 1) * size;

    return {
      rows: source.slice(from, from + size),
      page: safePage,
      pageSize: size,
      totalRows: source.length,
      totalPages
    };
  }

  window.AMMultiTicketPresentation = Object.freeze({
    STORAGE_KEY,
    buildTicketPresentationRows,
    getRegistry: readRegistry,
    importRecoveryState,
    paginateRows,
    reconcileGroupsAfterTicketDeletion,
    removeTicketsFromRegistry,
    registerGroup
  });

  importRecoveryState();
})();
