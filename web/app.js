const shadReadyButton = document.querySelector("#shad-ready");
const connectionToggle = document.querySelector("#connection-toggle");
const shadStatus = document.querySelector("#shad-status");
const connectionStatus = document.querySelector("#connection-status");
const globalStatus = document.querySelector("#global-status");
const globalDot = document.querySelector("#global-dot");
const updatedAt = document.querySelector("#updated-at");
const connectionLabel = document.querySelector("#connection-label");
const connectionIcon = document.querySelector("#connection-icon");

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function setStatusMessage(element, message, kind = "") {
  element.textContent = message;
  element.dataset.kind = kind;
}

function renderStatus(data) {
  const shad = data.shad;
  const connection = data.connection;
  const online = connection.state === "online" && connection.enabled;

  shadReadyButton.textContent = shad.ready ? "ورود شاد تأیید شد" : "ورود انجام شد";
  shadReadyButton.disabled = shad.ready;
  setStatusMessage(
    shadStatus,
    shad.ready
      ? `نشست مرورگر در ${formatTime(shad.readyAt)} آماده اعلام شده است.`
      : "وضعیت ورود هنوز تأیید نشده است.",
    shad.ready ? "success" : "",
  );

  connectionToggle.classList.toggle("is-on", online);
  connectionToggle.classList.toggle("is-off", !online);
  connectionToggle.disabled = connection.state === "starting" || connection.state === "stopping";
  connectionLabel.textContent = online ? "غیرفعال‌سازی ارتباط" : "فعال‌سازی ارتباط";
  connectionIcon.classList.toggle("icon-green", online);
  connectionIcon.classList.toggle("icon-red", !online);
  setStatusMessage(
    connectionStatus,
    connection.error ||
      (connection.state === "starting"
        ? "در حال فعال‌سازی..."
        : connection.state === "stopping"
          ? "در حال غیرفعال‌سازی..."
          : online
            ? "ارتباط فعال و سبز است."
            : "ارتباط خاموش است."),
    online ? "success" : connection.error ? "error" : "",
  );

  globalDot.style.background = online ? "var(--green)" : "var(--red)";
  globalStatus.textContent = online ? "ارتباط فعال است" : "ارتباط فعال نیست";
  updatedAt.textContent = `آخرین به‌روزرسانی: ${formatTime(data.updatedAt)}`;
}

async function readJSON(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "درخواست انجام نشد.");
  }
  return data;
}

async function refresh() {
  try {
    renderStatus(await readJSON(await fetch("/api/status", { credentials: "same-origin" })));
  } catch (error) {
    setStatusMessage(globalStatus, error.message, "error");
  }
}

shadReadyButton.addEventListener("click", async () => {
  shadReadyButton.disabled = true;
  try {
    await readJSON(await fetch("/api/shad/mark-ready", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }));
    await refresh();
  } catch (error) {
    setStatusMessage(shadStatus, error.message, "error");
    shadReadyButton.disabled = false;
  }
});

connectionToggle.addEventListener("click", async () => {
  const wantsEnabled = !connectionToggle.classList.contains("is-on");
  connectionToggle.disabled = true;
  try {
    await readJSON(await fetch("/api/connection/toggle", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: wantsEnabled }),
    }));
    await refresh();
  } catch (error) {
    setStatusMessage(connectionStatus, error.message, "error");
    connectionToggle.disabled = false;
    await refresh();
  }
});

refresh();
setInterval(refresh, 15000);