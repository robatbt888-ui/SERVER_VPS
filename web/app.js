const shadReadyButton = document.querySelector('#shad-ready');
const connectionToggle = document.querySelector('#connection-toggle');
const shadStatus = document.querySelector('#shad-status');
const connectionStatus = document.querySelector('#connection-status');
const connectionSummary = document.querySelector('#connection-summary');
const connectionPill = document.querySelector('#connection-pill');
const globalStatus = document.querySelector('#global-status');
const globalDot = document.querySelector('#global-dot');
const updatedAt = document.querySelector('#updated-at');
const connectionLabel = document.querySelector('#connection-label');
const connectionCard = document.querySelector('#connection-section');
const shadFrame = document.querySelector('#shad-frame');
const shadStat = document.querySelector('#shad-stat');
const serverStat = document.querySelector('#server-stat');
const themeToggle = document.querySelector('#theme-toggle, #auth-theme-toggle');
const themeLabel = document.querySelector('#theme-label, #auth-theme-label');
const root = document.documentElement;
const navLinks = Array.from(document.querySelectorAll('.category-link'));

function updateThemeMeta(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#05070a' : '#f5f8fb';
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem('hooshnet-theme', theme);
  updateThemeMeta(theme);
  if (themeLabel) themeLabel.textContent = theme === 'dark' ? 'حالت روشن' : 'حالت تیره';
  if (themeToggle) themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
}

applyTheme(root.dataset.theme || 'light');
themeToggle?.addEventListener('click', () => applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));

function setActiveSection(id) {
  navLinks.forEach((link) => {
    const isActive = link.getAttribute('href') === '#' + id;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

navLinks.forEach((link) => link.addEventListener('click', () => setActiveSection(link.getAttribute('href').slice(1))));
if ('IntersectionObserver' in window && navLinks.length) {
  const sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    if (visible[0]) setActiveSection(visible[0].target.id);
  }, { rootMargin: '-16% 0px -62% 0px', threshold: [0.1, 0.35, 0.7] });
  navLinks.forEach((link) => {
    const section = document.querySelector(link.getAttribute('href'));
    if (section) sectionObserver.observe(section);
  });
}

function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function setStatusMessage(element, message, kind = '') {
  if (!element) return;
  element.textContent = message;
  element.dataset.kind = kind;
}

function renderStatus(data) {
  const shad = data.shad || {};
  const connection = data.connection || {};
  const online = connection.state === 'online' && connection.enabled;
  const busy = connection.state === 'starting' || connection.state === 'stopping';
  const failed = Boolean(connection.error) || connection.state === 'error';
  const pillText = online ? 'فعال' : busy ? 'در حال اجرا' : failed ? 'خطا' : 'آماده به کار';
  const globalText = online ? 'اتصال برقرار است' : busy ? 'ارتباط در حال آماده‌سازی است' : failed ? 'خطا در ارتباط' : 'آماده برای اتصال';

  if (shadFrame && shad.url && shadFrame.src !== new URL(shad.url, window.location.href).href) shadFrame.src = shad.url;
  if (shadReadyButton) {
    shadReadyButton.textContent = shad.ready ? 'ورود شاد تأیید شد' : 'ورود انجام شد';
    shadReadyButton.disabled = Boolean(shad.ready);
  }
  if (shadStat) shadStat.textContent = shad.ready ? 'آماده' : 'نیازمند ورود';
  setStatusMessage(shadStatus, shad.ready ? 'نشست مرورگر در ' + formatTime(shad.readyAt) + ' آماده اعلام شده است.' : 'وضعیت ورود هنوز تأیید نشده است.', shad.ready ? 'success' : '');

  if (connectionToggle) {
    connectionToggle.classList.toggle('is-on', online);
    connectionToggle.classList.toggle('is-off', !online);
    connectionToggle.classList.toggle('is-busy', busy);
    connectionToggle.disabled = busy;
    connectionToggle.setAttribute('aria-pressed', String(online));
    connectionToggle.setAttribute('aria-busy', String(busy));
    connectionToggle.setAttribute('aria-label', online ? 'قطع اتصال' : 'برقراری اتصال');
  }
  if (connectionLabel) connectionLabel.textContent = online ? 'قطع اتصال' : busy ? 'در حال اجرا' : 'شروع';
  if (connectionPill) {
    connectionPill.className = 'status-pill ' + (online ? 'status-pill-on' : failed ? 'status-pill-error' : busy ? 'status-pill-busy' : 'status-pill-off');
    connectionPill.querySelector('span:last-child').textContent = pillText;
  }
  connectionCard?.classList.toggle('is-on', online);
  connectionCard?.classList.toggle('is-error', failed);
  if (connectionSummary) connectionSummary.textContent = 'وضعیت اتصال : ' + (online ? 'اتصال برقرار است' : busy ? 'در حال آماده‌سازی ارتباط' : 'اتصال برقرار نیست');
  setStatusMessage(connectionStatus, connection.error || (connection.state === 'starting' ? 'در حال فعال‌سازی ارتباط...' : connection.state === 'stopping' ? 'در حال غیرفعال‌سازی ارتباط...' : online ? 'ارتباط فعال و آمادهٔ استفاده است.' : 'برای شروع، دکمهٔ اتصال را بزنید.'), online ? 'success' : connection.error ? 'error' : '');

  if (serverStat) serverStat.textContent = online ? 'آنلاین' : busy ? 'در حال اجرا' : 'آفلاین';
  if (globalDot) globalDot.style.background = online ? 'var(--green)' : failed ? 'var(--red)' : busy ? 'var(--blue)' : 'var(--pink)';
  if (globalStatus) globalStatus.textContent = globalText;
  if (updatedAt) updatedAt.textContent = 'آخرین به‌روزرسانی: ' + formatTime(data.updatedAt);
  document.body.dataset.connection = online ? 'online' : failed ? 'error' : 'offline';
}

async function readJSON(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || 'درخواست انجام نشد.');
    error.code = data.code;
    throw error;
  }
  return data;
}

async function refresh() {
  if (!globalStatus) return;
  try {
    renderStatus(await readJSON(await fetch('/api/status', { credentials: 'same-origin' })));
  } catch (error) {
    if (error.code === 'authentication_required') {
      window.location.href = '/login';
      return;
    }
    setStatusMessage(globalStatus, error.message, 'error');
  }
}

shadReadyButton?.addEventListener('click', async () => {
  shadReadyButton.disabled = true;
  try {
    await readJSON(await fetch('/api/shad/mark-ready', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    await refresh();
  } catch (error) {
    setStatusMessage(shadStatus, error.message, 'error');
    shadReadyButton.disabled = false;
  }
});

connectionToggle?.addEventListener('click', async () => {
  const wantsEnabled = !connectionToggle.classList.contains('is-on');
  connectionToggle.disabled = true;
  try {
    await readJSON(await fetch('/api/connection/toggle', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: wantsEnabled }) }));
    await refresh();
  } catch (error) {
    setStatusMessage(connectionStatus, error.message, 'error');
    connectionToggle.disabled = false;
    await refresh();
  }
});

refresh();
let refreshTimer = window.setInterval(refresh, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    window.clearInterval(refreshTimer);
    refreshTimer = 0;
  } else if (!refreshTimer) {
    refresh();
    refreshTimer = window.setInterval(refresh, 15000);
  }
});