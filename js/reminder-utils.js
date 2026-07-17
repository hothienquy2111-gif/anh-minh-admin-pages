(function () {
  "use strict";

  const TIME_ZONE = "Asia/Ho_Chi_Minh";
  const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2 };
  const TYPE_LABELS = {
    CALLBACK: "Gọi lại khách",
    CALL_CUSTOMER: "Gọi lại khách",
    QUOTE: "Báo giá",
    CUSTOMER_PICKUP: "Khách đến lấy máy",
    DELIVERY: "Giao máy tận nơi",
    RECHECK: "Kiểm tra lại",
    INTERNAL: "Xử lý nội bộ",
    OTHER: "Khác"
  };

  function parseTimestamp(value) {
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : null;
  }

  function vietnamDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function classifyReminderTiming(reminder, nowValue) {
    const scheduledTime = parseTimestamp(reminder && reminder.scheduled_at);
    const now = nowValue instanceof Date ? nowValue : new Date(nowValue || Date.now());

    if (scheduledTime === null) {
      return "unknown";
    }

    if (scheduledTime < now.getTime()) {
      return "overdue";
    }

    if (vietnamDateKey(scheduledTime) === vietnamDateKey(now)) {
      return "today";
    }

    return "upcoming";
  }

  function durationParts(milliseconds) {
    const totalMinutes = Math.max(0, Math.floor(Math.abs(milliseconds) / 60000));
    return {
      days: Math.floor(totalMinutes / 1440),
      hours: Math.floor((totalMinutes % 1440) / 60),
      minutes: totalMinutes % 60
    };
  }

  function formatDuration(milliseconds) {
    const parts = durationParts(milliseconds);

    if (parts.days > 0) {
      return `${parts.days} ngày ${parts.hours} giờ`;
    }

    if (parts.hours > 0) {
      return `${parts.hours} giờ ${parts.minutes} phút`;
    }

    return `${Math.max(parts.minutes, 1)} phút`;
  }

  function formatReminderRelativeTime(reminder, nowValue) {
    const scheduledTime = parseTimestamp(reminder && reminder.scheduled_at);
    const now = nowValue instanceof Date ? nowValue : new Date(nowValue || Date.now());
    const timing = classifyReminderTiming(reminder, now);

    if (scheduledTime === null) {
      return "Chưa có thời gian hẹn";
    }

    if (timing === "overdue") {
      return `Quá hạn ${formatDuration(now.getTime() - scheduledTime)}`;
    }

    if (timing === "today") {
      const time = new Intl.DateTimeFormat("vi-VN", {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(new Date(scheduledTime));
      return `Đến hạn lúc ${time} hôm nay`;
    }

    if (scheduledTime - now.getTime() < 48 * 60 * 60 * 1000) {
      return `Còn ${formatDuration(scheduledTime - now.getTime())}`;
    }

    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: TIME_ZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(scheduledTime)).replace(",", " lúc");
  }

  function formatReminderDateTime(value) {
    const time = parseTimestamp(value);

    if (time === null) {
      return "—";
    }

    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: TIME_ZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(time));
  }

  function sortPendingReminders(reminders) {
    return (reminders || []).slice().sort((a, b) => {
      const scheduledA = parseTimestamp(a && a.scheduled_at) ?? Number.MAX_SAFE_INTEGER;
      const scheduledB = parseTimestamp(b && b.scheduled_at) ?? Number.MAX_SAFE_INTEGER;

      if (scheduledA !== scheduledB) {
        return scheduledA - scheduledB;
      }

      const priorityA = PRIORITY_RANK[String(a && a.priority || "normal")] ?? PRIORITY_RANK.normal;
      const priorityB = PRIORITY_RANK[String(b && b.priority || "normal")] ?? PRIORITY_RANK.normal;

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      const createdComparison = String(a && a.created_at || "").localeCompare(String(b && b.created_at || ""));
      if (createdComparison !== 0) {
        return createdComparison;
      }

      const ticketComparison = String(a && a.ticket_code || "").localeCompare(String(b && b.ticket_code || ""));
      if (ticketComparison !== 0) {
        return ticketComparison;
      }

      return String(a && a.id || "").localeCompare(String(b && b.id || ""));
    });
  }

  function typeLabel(type) {
    return TYPE_LABELS[type] || TYPE_LABELS.OTHER;
  }

  window.AMReminderUtils = {
    TIME_ZONE,
    TYPE_LABELS: Object.assign({}, TYPE_LABELS),
    classifyReminderTiming,
    sortPendingReminders,
    formatReminderRelativeTime,
    formatReminderDateTime,
    typeLabel,
    vietnamDateKey
  };
})();
