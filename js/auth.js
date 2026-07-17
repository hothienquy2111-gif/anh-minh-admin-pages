(function () {
  "use strict";

  const form = document.getElementById("loginForm");
  const loginButton = document.getElementById("loginButton");
  const loginButtonLabel = loginButton.querySelector(".auth-submit-label");
  const passwordInput = document.getElementById("password");
  const passwordToggle = document.getElementById("passwordToggle");
  const notice = document.getElementById("loginNotice");

  function showNotice(type, message) {
    notice.className = `notice ${type} show`;
    notice.textContent = message;
    notice.hidden = false;
  }

  function clearNotice() {
    notice.className = "notice";
    notice.textContent = "";
    notice.hidden = true;
  }

  function setLoading(isLoading) {
    loginButton.disabled = isLoading;
    loginButton.setAttribute("aria-busy", String(isLoading));
    form.setAttribute("aria-busy", String(isLoading));
    loginButtonLabel.textContent = isLoading ? "Đang đăng nhập..." : "Đăng nhập";
  }

  function togglePasswordVisibility() {
    const shouldShow = passwordInput.type === "password";
    passwordInput.type = shouldShow ? "text" : "password";
    passwordToggle.setAttribute("aria-pressed", String(shouldShow));
    passwordToggle.setAttribute("aria-label", shouldShow ? "Ẩn mật khẩu" : "Hiện mật khẩu");
    passwordToggle.classList.toggle("is-visible", shouldShow);
    passwordInput.focus({ preventScroll: true });
  }

  function getLoginErrorMessage(error) {
    const rawMessage = String(error && error.message || "").toLowerCase();

    if (rawMessage.includes("invalid login credentials")) {
      return "Email hoặc mật khẩu không đúng.";
    }

    if (rawMessage.includes("failed to fetch") || rawMessage.includes("network")) {
      return "Không thể kết nối hệ thống. Vui lòng kiểm tra mạng và thử lại.";
    }

    return "Không thể đăng nhập lúc này. Vui lòng thử lại.";
  }

  async function redirectIfAlreadyAllowed() {
    try {
      const access = await window.AMApi.checkInternalAccess();

      if (access.allowed) {
        window.location.replace("dashboard.html");
      }
    } catch (error) {
      showNotice("error", getLoginErrorMessage(error));
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    clearNotice();
    setLoading(true);

    const email = form.email.value.trim();
    const password = form.password.value;

    try {
      const client = window.AMApi.getClient();
      const { error } = await client.auth.signInWithPassword({ email, password });

      if (error) {
        throw error;
      }

      const access = await window.AMApi.checkInternalAccess();

      if (!access.allowed) {
        await window.AMApi.signOut(false);
        showNotice("error", access.message);
        return;
      }

      window.location.replace("dashboard.html");
    } catch (error) {
      showNotice("error", getLoginErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    const queuedMessage = sessionStorage.getItem("am_admin_login_message");

    if (queuedMessage) {
      sessionStorage.removeItem("am_admin_login_message");
      showNotice("error", queuedMessage);
    }

    form.addEventListener("submit", handleLogin);
    passwordToggle.addEventListener("click", togglePasswordVisibility);
    redirectIfAlreadyAllowed();
  });
})();
