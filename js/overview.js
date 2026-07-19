(function () {
  "use strict";

  const subtitle = document.getElementById("overviewSubtitle");
  const notice = document.getElementById("overviewNotice");
  const flowState = document.getElementById("overviewFlowState");
  const flowList = document.getElementById("overviewFlowList");
  let overviewRequestId = 0;

  const summaryMap = {
    total: document.getElementById("overviewTotal"),
    active: document.getElementById("overviewActive"),
    returned: document.getElementById("overviewReturned"),
    cancelled: document.getElementById("overviewCancelled"),
    legacyDone: document.getElementById("overviewLegacyDone")
  };

  const CURRENT_FLOW = [
    { status: "mới nhận", label: "Mới nhận", description: "Phiếu vừa nhập vào hệ thống" },
    { status: "đang kiểm tra", label: "Đang kiểm tra", description: "Kỹ thuật đang kiểm tra lỗi" },
    { status: "báo giá", label: "Báo giá", description: "Đang chờ báo giá hoặc xác nhận" },
    { status: "đang sửa", label: "Đang sửa", description: "Đang xử lý sửa chữa" },
    { status: "chờ bàn giao", label: "Bàn giao tivi", description: "Đã sửa xong, đang chờ giao hoặc khách đến nhận" }
  ];

  function showNotice(type, message) {
    if (!notice) {
      return;
    }

    notice.className = `notice ${type} show`;
    notice.textContent = message;
  }

  function attachLogout() {
    document.querySelectorAll("[data-logout]").forEach((button) => {
      button.addEventListener("click", async function () {
        button.disabled = true;

        try {
          await window.AMApi.signOut();
        } catch (error) {
          showNotice("error", error.message);
          button.disabled = false;
        }
      });
    });
  }

  function setText(element, value) {
    if (element) {
      element.textContent = String(value || 0);
    }
  }

  function setFlowState(type, message) {
    if (!flowState || !flowList) {
      return;
    }

    flowState.textContent = message;
    flowList.replaceChildren();
    window.AMUI.setSectionState({
      section: flowState.closest("section"),
      stateElement: flowState,
      dataElement: flowList
    }, type);
  }

  function showFlowList() {
    if (!flowState || !flowList) {
      return;
    }

    flowState.textContent = "";
    window.AMUI.setSectionState({
      section: flowState.closest("section"),
      stateElement: flowState,
      dataElement: flowList
    }, "data");
  }

  function renderFlow(statuses) {
    const currentTotal = CURRENT_FLOW.reduce((sum, item) => sum + (statuses[item.status] || 0), 0);
    const fragment = document.createDocumentFragment();

    CURRENT_FLOW.forEach((item) => {
      const count = statuses[item.status] || 0;
      const percent = currentTotal > 0 ? Math.round((count / currentTotal) * 100) : 0;
      const row = document.createElement("article");
      const header = document.createElement("div");
      const title = document.createElement("div");
      const label = document.createElement("strong");
      const description = document.createElement("span");
      const value = document.createElement("b");
      const bar = document.createElement("div");
      const fill = document.createElement("span");

      row.className = "overview-flow-row";
      header.className = "overview-flow-row-header";
      title.className = "overview-flow-title";
      value.textContent = String(count);
      label.textContent = item.label;
      description.textContent = item.description;
      bar.className = "overview-flow-bar";
      fill.style.width = `${percent}%`;

      title.append(label, description);
      header.append(title, value);
      bar.appendChild(fill);
      row.append(header, bar);
      fragment.appendChild(row);
    });

    flowList.replaceChildren(fragment);
    showFlowList();
  }

  function renderOverview(stats) {
    const statuses = stats.statuses || {};
    const active = CURRENT_FLOW.reduce((sum, item) => sum + (statuses[item.status] || 0), 0);
    const returned = statuses["đã trả"] || 0;
    const cancelled = statuses["huỷ"] || 0;
    const legacyDone = statuses["đã xong"] || 0;

    setText(summaryMap.total, stats.total);
    setText(summaryMap.active, active);
    setText(summaryMap.returned, returned);
    setText(summaryMap.cancelled, cancelled);
    setText(summaryMap.legacyDone, legacyDone);

    if (subtitle) {
      subtitle.textContent = "Số liệu tổng thể được nhóm theo luồng xử lý, không lẫn với việc cần làm hôm nay.";
    }

    renderFlow(statuses);
  }

  async function initOverview() {
    const requestId = ++overviewRequestId;
    attachLogout();
    setFlowState("loading", "Đang tải tiến trình...");

    try {
      const access = await window.AMApi.requireInternalAccess();

      if (!access) {
        return;
      }

      if (requestId !== overviewRequestId) {
        return;
      }

      const stats = await window.AMApi.getDashboardStats();
      if (requestId !== overviewRequestId) {
        return;
      }
      renderOverview(stats);
    } catch (error) {
      if (requestId !== overviewRequestId) {
        return;
      }
      showNotice("error", error.message || "Không tải được trang tổng quan.");
      setFlowState("error", "Không tải được tiến trình xử lý.");

      if (subtitle) {
        subtitle.textContent = "Chưa tải được số liệu tổng quan.";
      }
    }
  }

  document.addEventListener("DOMContentLoaded", initOverview);
})();
