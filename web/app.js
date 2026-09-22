const root = document.documentElement;
const themeToggle = document.querySelector('#theme-toggle, #auth-theme-toggle');
const themeLabel = document.querySelector('#theme-label, #auth-theme-label');
const shadReadyButton = document.querySelector('#shad-ready');
const shadReloadButton = document.querySelector('#shad-reload');
const shadFrame = document.querySelector('#shad-frame');
const shadStatus = document.querySelector('#shad-status');
const connectionToggle = document.querySelector('#connection-toggle');
const connectionStatus = document.querySelector('#connection-status');
const connectionSummary = document.querySelector('#connection-summary');
const connectionPill = document.querySelector('#connection-pill');
const connectionCard = document.querySelector('#connection-section');
const globalStatus = document.querySelector('#global-status');
const globalDot = document.querySelector('#global-dot');
const updatedAt = document.querySelector('#updated-at');
const uploadStat = document.querySelector('#upload-stat');
const downloadStat = document.querySelector('#download-stat');
const tabButtons = Array.from(document.querySelectorAll('[data-screen-target]'));
const screens = Array.from(document.querySelectorAll('[data-screen]'));

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
applyTheme(root.dataset.theme || 'dark');
themeToggle?.addEventListener('click', () => applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));

function showScreen(name, updateUrl = true) {
  const valid = screens.some((screen) => screen.dataset.screen === name) ? name : 'connect';
  screens.forEach((screen) => screen.classList.toggle('is-active', screen.dataset.screen === valid));
  tabButtons.forEach((button) => {
    const active = button.dataset.screenTarget === valid;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (updateUrl) history.replaceState(null, '', '#' + valid);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
tabButtons.forEach((button) => button.addEventListener('click', () => showScreen(button.dataset.screenTarget)));
showScreen(window.location.hash.slice(1) || 'connect', false);

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
  const globalText = online ? 'ارتباط برقرار است' : busy ? 'ارتباط در حال آماده‌سازی است' : failed ? 'خطا در ارتباط' : 'ارتباط برقرار نیست';
  if (shadFrame && shad.url && shadFrame.src !== new URL(shad.url, window.location.href).href) shadFrame.src = shad.url;
  if (shadReadyButton) {
    shadReadyButton.textContent = shad.ready ? 'ورود شاد تأیید شد' : 'ورود شاد انجام شد';
    shadReadyButton.disabled = Boolean(shad.ready);
  }
  setStatusMessage(shadStatus, shad.ready ? 'نشست شاد در ' + formatTime(shad.readyAt) + ' آماده اعلام شده است.' : 'ابتدا در شاد وارد شوید و سپس این وضعیت را تأیید کنید.', shad.ready ? 'success' : '');
  if (connectionToggle) {
    connectionToggle.classList.toggle('is-on', online);
    connectionToggle.classList.toggle('is-off', !online);
    connectionToggle.classList.toggle('is-busy', busy);
    connectionToggle.disabled = busy;
    connectionToggle.setAttribute('aria-pressed', String(online));
    connectionToggle.setAttribute('aria-busy', String(busy));
    connectionToggle.setAttribute('aria-label', online ? 'قطع ارتباط' : 'برقراری ارتباط');
  }
  const label = document.querySelector('#connection-label');
  if (label) label.textContent = online ? 'قطع ارتباط' : busy ? 'در حال اجرا' : 'برقراری ارتباط';
  if (connectionPill) {
    connectionPill.className = 'status-pill ' + (online ? 'status-pill-on' : failed ? 'status-pill-error' : busy ? 'status-pill-busy' : 'status-pill-off');
    const text = connectionPill.querySelector('span:last-child');
    if (text) text.textContent = pillText;
  }
  connectionCard?.classList.toggle('is-on', online);
  connectionCard?.classList.toggle('is-error', failed);
  if (connectionSummary) connectionSummary.textContent = 'وضعیت ارتباط : ' + (online ? 'ارتباط برقرار است' : busy ? 'در حال آماده‌سازی ارتباط' : 'ارتباط برقرار نیست');
  setStatusMessage(connectionStatus, connection.error || (connection.state === 'starting' ? 'در حال برقراری ارتباط...' : connection.state === 'stopping' ? 'در حال قطع ارتباط...' : online ? 'ارتباط سرور فعال و آماده است.' : 'برای شروع، دکمه‌ی برقراری ارتباط را بزنید.'), online ? 'success' : connection.error ? 'error' : '');
  if (globalDot) globalDot.style.background = online ? 'var(--green)' : failed ? 'var(--red)' : busy ? 'var(--blue)' : 'var(--pink)';
  if (globalStatus) globalStatus.textContent = globalText;
  if (updatedAt) updatedAt.textContent = 'آخرین به‌روزرسانی: ' + formatTime(data.updatedAt);
  if (uploadStat) uploadStat.textContent = '۰ B';
  if (downloadStat) downloadStat.textContent = '۰ B';
  document.body.dataset.connection = online ? 'online' : failed ? 'error' : 'offline';
}
async function readJSON(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.message || 'درخواست انجام نشد.'); error.code = data.code; throw error; }
  return data;
}
async function refresh() {
  if (!globalStatus) return;
  try { renderStatus(await readJSON(await fetch('/api/status', { credentials: 'same-origin' }))); }
  catch (error) { if (error.code === 'authentication_required') { window.location.href = '/login'; return; } setStatusMessage(globalStatus, error.message, 'error'); }
}
shadReloadButton?.addEventListener('click', () => { if (shadFrame) shadFrame.src = shadFrame.src; });
shadReadyButton?.addEventListener('click', async () => {
  shadReadyButton.disabled = true;
  try { await readJSON(await fetch('/api/shad/mark-ready', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })); await refresh(); }
  catch (error) { setStatusMessage(shadStatus, error.message, 'error'); shadReadyButton.disabled = false; }
});
connectionToggle?.addEventListener('click', async () => {
  const wantsEnabled = !connectionToggle.classList.contains('is-on');
  connectionToggle.disabled = true;
  try { await readJSON(await fetch('/api/connection/toggle', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: wantsEnabled }) })); await refresh(); }
  catch (error) { setStatusMessage(connectionStatus, error.message, 'error'); connectionToggle.disabled = false; await refresh(); }
});
refresh();
let refreshTimer = window.setInterval(refresh, 15000);
document.addEventListener('visibilitychange', () => { if (document.hidden) { window.clearInterval(refreshTimer); refreshTimer = 0; } else if (!refreshTimer) { refresh(); refreshTimer = window.setInterval(refresh, 15000); } });