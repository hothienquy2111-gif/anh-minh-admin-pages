(function () {
  "use strict";

  const MACHINE_POPULAR = [
    "Không lên nguồn",
    "Có tiếng, không có hình",
    "Có hình, không có tiếng",
    "Màn hình tối",
    "Sọc dọc màn hình",
    "Sọc ngang màn hình",
    "Nhảy hình",
    "Chớp hình",
    "Tự tắt",
    "Treo logo",
    "Không mở được YouTube",
    "Không kết nối Wi-Fi",
    "Không nhận remote"
  ];

  const MACHINE_GROUPS = [
    {
      title: "Nguồn và khởi động",
      options: [
        "Không lên nguồn",
        "Có đèn nguồn nhưng không khởi động",
        "Bấm nguồn không phản hồi",
        "Khó lên nguồn",
        "Lên nguồn chậm",
        "Tự tắt",
        "Tự bật",
        "Tự tắt rồi khởi động lại",
        "Khởi động lại liên tục",
        "Treo logo",
        "Đứng máy",
        "Dùng một lúc mới bị lỗi"
      ]
    },
    {
      title: "Hình ảnh",
      options: [
        "Có tiếng, không có hình",
        "Có hình, không có tiếng",
        "Có nguồn, màn hình đen",
        "Màn hình tối",
        "Mất đèn nền",
        "Hình lúc có lúc không",
        "Chớp hình",
        "Nhảy hình",
        "Rung hình",
        "Sọc dọc màn hình",
        "Sọc ngang màn hình",
        "Sọc màu",
        "Nửa màn hình",
        "Một phần màn hình bị tối",
        "Sai màu",
        "Ám màu",
        "Mất màu",
        "Hình âm bản",
        "Hình bị mờ",
        "Hình bị nhòe",
        "Hình bị giật",
        "Hình bị lưu ảnh",
        "Bóng mờ",
        "Có đốm sáng",
        "Có đốm đen",
        "Có điểm chết",
        "Màn hình trắng",
        "Màn hình xanh",
        "Màn hình đỏ",
        "Màn hình bị co",
        "Hình bị lệch",
        "Không hiển thị toàn màn hình"
      ]
    },
    {
      title: "Âm thanh",
      options: [
        "Không có tiếng",
        "Tiếng nhỏ",
        "Tiếng rè",
        "Tiếng lúc có lúc không",
        "Mất một bên loa",
        "Âm thanh bị méo",
        "Hình có trước, tiếng có sau",
        "Tiếng có trước, hình có sau"
      ]
    },
    {
      title: "Smart TV, mạng và ứng dụng",
      options: [
        "Không kết nối Wi-Fi",
        "Wi-Fi yếu hoặc hay mất kết nối",
        "Không vào được mạng",
        "Không mở được YouTube",
        "YouTube bị lỗi",
        "Ứng dụng bị lỗi",
        "Không tải được ứng dụng",
        "Smart TV chạy chậm",
        "Máy bị đơ",
        "Không cập nhật được phần mềm",
        "Lỗi hệ điều hành",
        "Mất tài khoản hoặc không đăng nhập được",
        "Không xem được truyền hình"
      ]
    },
    {
      title: "Cổng kết nối và điều khiển",
      options: [
        "Không nhận HDMI",
        "HDMI lúc nhận lúc không",
        "Không nhận USB",
        "Không nhận anten",
        "Không dò được kênh",
        "Mất kênh",
        "Không nhận remote",
        "Remote bấm không ăn",
        "Không nhận Bluetooth",
        "Không xuất được âm thanh ngoài",
        "Không kết nối được loa"
      ]
    },
    {
      title: "Lỗi khác",
      options: [
        "Bị sét đánh",
        "Bị vào nước",
        "Bị ẩm",
        "Có mùi khét",
        "Có tiếng nổ",
        "Máy nóng bất thường",
        "Bị côn trùng vào",
        "Khách chưa xác định rõ lỗi",
        "Cần kiểm tra thêm",
        "Khách báo lỗi không ổn định",
        "Lỗi xuất hiện ngẫu nhiên"
      ]
    }
  ];

  const APPEARANCE_POPULAR = [
    "Ngoại quan bình thường",
    "Màn hình nguyên vẹn",
    "Màn hình bị trầy",
    "Màn hình bị vỡ",
    "Có đầy đủ chân đế",
    "Mất chân đế",
    "Mất chân",
    "Không có chân",
    "Có remote",
    "Không có remote",
    "Có dây nguồn",
    "Không có dây nguồn",
    "Đủ ốc",
    "Thiếu ốc"
  ];

  const APPEARANCE_GROUPS = [
    {
      title: "Màn hình và khung vỏ",
      options: [
        "Ngoại quan bình thường",
        "Màn hình nguyên vẹn",
        "Màn hình bị trầy",
        "Màn hình bị vỡ",
        "Màn hình bị nứt",
        "Màn hình bị cấn",
        "Có vết va đập",
        "Viền bị trầy",
        "Viền bị móp",
        "Vỏ bị trầy",
        "Vỏ bị nứt",
        "Mặt lưng bị móp",
        "Máy bị cong",
        "Máy bám bụi",
        "Máy bám bẩn",
        "Có dấu hiệu vào nước",
        "Có dấu hiệu ẩm mốc",
        "Có dấu hiệu côn trùng"
      ]
    },
    {
      title: "Chân đế và giá treo",
      options: [
        "Có đầy đủ chân đế",
        "Mất chân đế",
        "Mất chân",
        "Không có chân",
        "Thiếu một chân đế",
        "Chân đế bị gãy",
        "Chân đế bị trầy",
        "Có giá treo",
        "Không có giá treo",
        "Thiếu ốc chân đế",
        "Thiếu ốc giá treo"
      ]
    },
    {
      title: "Phụ kiện",
      options: [
        "Có remote",
        "Không có remote",
        "Remote bị hỏng",
        "Có dây nguồn",
        "Không có dây nguồn",
        "Có dây HDMI",
        "Có dây anten",
        "Có hộp máy",
        "Không có hộp máy",
        "Có phụ kiện kèm theo",
        "Không có phụ kiện kèm theo"
      ]
    },
    {
      title: "Tem, ốc và dấu hiệu sửa chữa",
      options: [
        "Tem máy còn nguyên",
        "Tem máy bị rách",
        "Mất tem máy",
        "Đủ ốc",
        "Thiếu ốc",
        "Có dấu hiệu đã tháo máy",
        "Có dấu hiệu đã sửa chữa",
        "Máy chưa có dấu hiệu tháo sửa"
      ]
    }
  ];

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLocaleLowerCase("vi-VN")
      .trim();
  }

  function uniqueOptions(options) {
    const seen = new Set();
    return (options || []).filter((option) => {
      const key = normalizeSearchText(option);
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  function getConfig(type) {
    if (type === "appearance") {
      return {
        popular: APPEARANCE_POPULAR,
        groups: APPEARANCE_GROUPS
      };
    }

    return {
      popular: MACHINE_POPULAR,
      groups: MACHINE_GROUPS
    };
  }

  function allOptions(groups) {
    return uniqueOptions((groups || []).flatMap((group) => group.options || []));
  }

  function parseSelections(text) {
    return String(text || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function hasCondition(text, condition) {
    return parseSelections(text).includes(condition);
  }

  function writeSelections(textarea, selections) {
    textarea.value = selections.join("; ");

    if (typeof Event === "function") {
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function appendCondition(textarea, condition) {
    const selections = parseSelections(textarea.value);

    if (!selections.includes(condition)) {
      selections.push(condition);
      writeSelections(textarea, selections);
    }
  }

  function removeCondition(textarea, condition) {
    const selections = parseSelections(textarea.value).filter((item) => item !== condition);
    writeSelections(textarea, selections);
  }

  function toggleCondition(textarea, condition) {
    if (hasCondition(textarea.value, condition)) {
      removeCondition(textarea, condition);
      return false;
    }

    appendCondition(textarea, condition);
    return true;
  }

  function syncConditionChips(container, textarea) {
    if (!container || !textarea) {
      return;
    }

    container.querySelectorAll("[data-condition-option]").forEach((button) => {
      const option = button.dataset.conditionOption || "";
      const active = hasCondition(textarea.value, option);
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);

    if (className) {
      element.className = className;
    }

    if (text) {
      element.textContent = text;
    }

    return element;
  }

  function filterGroups(groups, keyword) {
    const query = normalizeSearchText(keyword);

    if (!query) {
      return groups;
    }

    return groups
      .map((group) => ({
        title: group.title,
        options: (group.options || []).filter((option) => normalizeSearchText(option).includes(query))
      }))
      .filter((group) => group.options.length > 0);
  }

  function attachConditionPicker(options) {
    const config = options || {};
    const textarea = config.textarea;
    const container = config.container;

    if (!textarea || !container) {
      return null;
    }

    const data = getConfig(config.type);
    const labelText = config.label || "Chọn nhanh";
    let expanded = false;
    let keyword = "";
    const buttons = new Map();

    container.textContent = "";
    container.classList.add("condition-picker");

    const header = createElement("div", "condition-picker-header");
    const title = createElement("strong", "condition-picker-title", labelText);
    const controls = createElement("div", "condition-picker-controls");
    const searchInput = createElement("input", "condition-search-input");
    const toggleButton = createElement("button", "condition-toggle-button", "Xem thêm");
    const groupsContainer = createElement("div", "condition-groups");

    searchInput.type = "search";
    searchInput.placeholder = "Tìm tình trạng...";
    searchInput.autocomplete = "off";
    searchInput.setAttribute("aria-label", `Tìm ${labelText.toLocaleLowerCase("vi-VN")}`);
    toggleButton.type = "button";

    controls.append(searchInput, toggleButton);
    header.append(title, controls);
    container.append(header, groupsContainer);

    function setButtonState(button, option) {
      const active = hasCondition(textarea.value, option);
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }

    function syncConditionChips() {
      buttons.forEach(setButtonState);
    }

    function renderChip(option) {
      const button = createElement("button", "condition-chip", option);
      button.type = "button";
      button.dataset.conditionOption = option;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        toggleCondition(textarea, option);
        syncConditionChips();
      });
      buttons.set(button, option);
      setButtonState(button, option);
      return button;
    }

    function renderGroup(titleText, options) {
      const groupElement = createElement("section", "condition-group");
      const groupTitle = createElement("h4", "condition-group-title", titleText);
      const chipList = createElement("div", "condition-chip-list");

      options.forEach((option) => {
        chipList.appendChild(renderChip(option));
      });

      groupElement.append(groupTitle, chipList);
      groupsContainer.appendChild(groupElement);
    }

    function render() {
      buttons.clear();
      groupsContainer.textContent = "";

      const hasKeyword = Boolean(keyword.trim());
      const sourceGroups = hasKeyword || expanded
        ? filterGroups(data.groups, keyword)
        : [{ title: "Phổ biến", options: data.popular }];

      if (sourceGroups.length === 0) {
        groupsContainer.appendChild(createElement("p", "condition-empty", "Không có gợi ý phù hợp."));
      } else {
        sourceGroups.forEach((group) => renderGroup(group.title, group.options));
      }

      toggleButton.textContent = expanded ? "Thu gọn" : "Xem thêm";
      toggleButton.hidden = hasKeyword;
    }

    searchInput.addEventListener("input", () => {
      keyword = searchInput.value;
      render();
    });

    toggleButton.addEventListener("click", () => {
      expanded = !expanded;
      render();
    });

    textarea.addEventListener("input", syncConditionChips);
    render();

    return {
      refresh: syncConditionChips,
      reset() {
        searchInput.value = "";
        keyword = "";
        expanded = false;
        render();
      }
    };
  }

  window.AMTvConditionUtils = {
    machineConditions: allOptions(MACHINE_GROUPS),
    appearanceConditions: allOptions(APPEARANCE_GROUPS),
    machineGroups: MACHINE_GROUPS,
    appearanceGroups: APPEARANCE_GROUPS,
    parseSelections,
    appendCondition,
    removeCondition,
    toggleCondition,
    syncConditionChips,
    attachConditionPicker
  };
})();
