// ToolZutter License Guard — trang quản trị
const API_BASE = window.location.origin;
const ROLE_RANK = { VIEWER: 1, STAFF: 2, OWNER: 3 };
const ROLE_LABEL = { OWNER: 'Chủ', STAFF: 'Nhân viên', VIEWER: 'Chỉ xem' };
const DAY_MS = 86400000;
const AUTH_KEY = 'zutter_admin_auth';

// Phiên đăng nhập chỉ giữ trong tab (đóng trình duyệt là đăng xuất)
let auth = JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null'); // { type: 'bearer' | 'secret', value, admin }
let licenses = [];
let customers = [];
let licenseFilter = 'ALL';
let activeTab = 'licenses';
localStorage.removeItem('zutter_admin_secret'); // bản cũ lưu secret vĩnh viễn

const $ = (id) => document.getElementById(id);

// Dữ liệu từ server có thể chứa chuỗi do người ngoài gửi lên (key nhập sai, thông tin máy) → luôn escape
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const money = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const dateVi = (iso) => (iso ? new Date(iso).toLocaleDateString('vi-VN') : '');
const osLabel = (os) => ({ macos: 'macOS', windows: 'Windows', linux: 'Linux' }[os] || os || '');
const can = (role) => auth && ROLE_RANK[auth.admin.role] >= ROLE_RANK[role];

function ago(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  if (mins < 1440) return `${Math.floor(mins / 60)} giờ trước`;
  return `${Math.floor(mins / 1440)} ngày trước`;
}
const isOnline = (iso) => iso && Date.now() - new Date(iso).getTime() < 5 * 60000;

function showToast(message, duration = 3500) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.classList.add('hidden'), duration);
}

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth?.type === 'bearer') headers.Authorization = `Bearer ${auth.value}`;
  if (auth?.type === 'secret') headers['x-admin-secret'] = auth.value;
  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/admin/login') {
    logout(false);
    throw new Error(data.message || 'Phiên đăng nhập đã hết hạn');
  }
  if (!res.ok || data.success === false) throw new Error(data.message || `Lỗi ${res.status}`);
  return data;
}

// Gọi API rồi báo kết quả + tải lại dữ liệu
async function act(method, path, body) {
  try {
    const data = await api(method, path, body);
    if (data.message) showToast(data.message);
    await reloadAll();
    return data;
  } catch (err) {
    showToast(err.message, 5000);
    throw err;
  }
}

// ===== Đăng nhập =====
let secretMode = false;
$('login-toggle-mode').addEventListener('click', () => {
  secretMode = !secretMode;
  $('login-account-fields').classList.toggle('hidden', secretMode);
  $('login-secret-fields').classList.toggle('hidden', !secretMode);
  $('login-toggle-mode').textContent = secretMode ? 'Đăng nhập bằng tài khoản' : 'Đăng nhập bằng Admin Secret';
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (secretMode) {
      auth = { type: 'secret', value: $('login-secret').value.trim() };
      const { admin } = await api('GET', '/api/admin/me');
      auth.admin = admin;
    } else {
      const data = await api('POST', '/api/admin/login', { username: $('login-username').value, password: $('login-password').value });
      auth = { type: 'bearer', value: data.token, admin: data.admin };
    }
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    $('login-password').value = '';
    $('login-secret').value = '';
    enterDashboard();
  } catch (err) {
    auth = null;
    showToast(err.message || 'Đăng nhập thất bại');
  }
});

function logout(callServer = true) {
  if (callServer && auth?.type === 'bearer') fetch(`${API_BASE}/api/admin/logout`, { method: 'POST', headers: { Authorization: `Bearer ${auth.value}` } });
  auth = null;
  sessionStorage.removeItem(AUTH_KEY);
  $('dashboard').classList.add('hidden');
  $('login-modal').classList.remove('hidden');
}
$('btn-logout').addEventListener('click', () => logout());

function enterDashboard() {
  $('login-modal').classList.add('hidden');
  $('dashboard').classList.remove('hidden');
  $('current-admin').innerHTML = `${esc(auth.admin.displayName)} <span class="role-badge role-${esc(auth.admin.role)}">${esc(ROLE_LABEL[auth.admin.role])}</span>`;
  document.querySelectorAll('[data-min-role]').forEach((el) => el.classList.toggle('hidden', !can(el.dataset.minRole)));
  switchTab('licenses');
  reloadAll();
}

// ===== Tab =====
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.main-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${tab}`));
  reloadAll();
}
document.querySelectorAll('.main-tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
$('btn-refresh').addEventListener('click', () => reloadAll());

async function reloadAll() {
  if (!auth) return;
  try {
    const [lic, cus] = await Promise.all([api('GET', '/api/admin/licenses'), api('GET', '/api/admin/customers')]);
    licenses = lic.licenses;
    customers = cus.customers;
    const s = lic.stats;
    $('stat-total').textContent = s.total;
    $('stat-active').textContent = s.active;
    $('stat-online').textContent = s.onlineNow;
    $('stat-expiring').textContent = s.expiringSoon;
    $('stat-locked').textContent = s.locked;
    renderLicenses();
    renderCustomers();
    if (activeTab === 'logs') renderLogs((await api('GET', '/api/admin/logs')).logs);
    if (activeTab === 'admins' && can('OWNER')) renderAdmins((await api('GET', '/api/admin/admins')).admins);
  } catch (err) {
    showToast(err.message);
  }
}

// ===== Key =====
function statusBadge(l) {
  if (l.status === 'LOCKED') return '<span class="badge badge-locked">Đã khóa</span>';
  if (l.status === 'EXPIRED' || (l.expires_at && new Date(l.expires_at) < Date.now())) return '<span class="badge badge-expired">Hết hạn</span>';
  return '<span class="badge badge-active">Hoạt động</span>';
}

function expiryCell(l) {
  if (!l.expires_at) return '<span class="muted">Vĩnh viễn</span>';
  const days = Math.ceil((new Date(l.expires_at) - Date.now()) / DAY_MS);
  const cls = days <= 0 ? 'text-danger' : days <= 7 ? 'text-warning' : 'muted';
  return `${dateVi(l.expires_at)}<div class="small ${cls}">${days > 0 ? `còn ${days} ngày` : 'đã hết hạn'}</div>`;
}

function licenseMatches(l, q) {
  if (q && ![l.license_key, l.customer_name, l.customer_phone, l.customer_zalo, l.hwid, l.last_ip, l.notes]
    .some((v) => String(v || '').toLowerCase().includes(q))) return false;
  const exp = l.expires_at ? new Date(l.expires_at).getTime() : null;
  if (licenseFilter === 'ACTIVE') return l.status === 'ACTIVE';
  if (licenseFilter === 'ONLINE') return isOnline(l.last_ping_at);
  if (licenseFilter === 'EXPIRING') return l.status === 'ACTIVE' && exp && exp > Date.now() && exp < Date.now() + 7 * DAY_MS;
  if (licenseFilter === 'LOCKED') return l.status !== 'ACTIVE';
  return true;
}

function renderLicenses() {
  const q = $('license-search').value.trim().toLowerCase();
  const rows = licenses.filter((l) => licenseMatches(l, q));
  if (!rows.length) {
    $('licenses-tbody').innerHTML = '<tr><td colspan="8" class="loading-state">Không có key nào phù hợp</td></tr>';
    return;
  }
  $('licenses-tbody').innerHTML = rows.map((l) => `
    <tr>
      <td><div class="license-key-cell" data-action="copy" data-value="${esc(l.license_key)}">${esc(l.license_key)}</div>
        ${l.notes ? `<div class="small muted">${esc(l.notes)}</div>` : ''}</td>
      <td><a class="link" data-action="customer" data-id="${l.customer_id}">${esc(l.customer_name || l.client_name)}</a>
        ${l.customer_phone ? `<div class="small muted">${esc(l.customer_phone)}</div>` : ''}</td>
      <td>${l.hwid ? `<span class="hwid-tag" title="${esc(l.hwid)}">${esc(l.hwid)}</span>` : '<span class="muted">Chưa gắn máy</span>'}
        ${l.client_os || l.app_version ? `<div class="small muted">${esc(osLabel(l.client_os))}${l.app_version ? ` · app v${esc(l.app_version)}` : ''}</div>` : ''}</td>
      <td class="small">${esc(l.max_accounts)} tài khoản<br>${esc(l.max_users || 1)} người dùng</td>
      <td>${statusBadge(l)}</td>
      <td>${expiryCell(l)}</td>
      <td>${l.last_ping_at ? (isOnline(l.last_ping_at) ? '<span class="text-success">● Online</span>' : esc(ago(l.last_ping_at))) : '<span class="muted">Chưa kết nối</span>'}
        ${l.last_ip ? `<div class="small muted">IP: ${esc(l.last_ip)}</div>` : ''}</td>
      <td style="text-align:right"><div class="row-actions">
        ${can('STAFF') ? `
          <button class="btn btn-sm btn-unlock" data-action="extend" data-id="${l.id}">Gia hạn</button>
          <button class="btn btn-sm btn-secondary" data-action="plan" data-id="${l.id}">Gói</button>
          <button class="btn btn-sm ${l.status === 'ACTIVE' ? 'btn-kill' : 'btn-unlock'}" data-action="toggle" data-id="${l.id}">${l.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'}</button>
          ${l.hwid ? `<button class="btn btn-sm btn-reset-hwid" data-action="reset" data-id="${l.id}">Đổi máy</button>` : ''}` : ''}
        ${can('OWNER') ? `<button class="btn btn-sm btn-delete" data-action="delete-license" data-id="${l.id}" title="Xóa key">Xóa</button>` : ''}
      </div></td>
    </tr>`).join('');
}

$('license-search').addEventListener('input', renderLicenses);
document.querySelectorAll('#license-filters .filter-btn').forEach((b) => b.addEventListener('click', () => {
  licenseFilter = b.dataset.filter;
  document.querySelectorAll('#license-filters .filter-btn').forEach((x) => x.classList.toggle('active', x === b));
  renderLicenses();
}));

// ===== Khách hàng =====
function renderCustomers() {
  const q = $('customer-search').value.trim().toLowerCase();
  const rows = customers.filter((c) => !q || [c.name, c.phone, c.zalo, c.email, c.notes].some((v) => String(v || '').toLowerCase().includes(q)));
  if (!rows.length) {
    $('customers-tbody').innerHTML = '<tr><td colspan="7" class="loading-state">Chưa có khách hàng</td></tr>';
    return;
  }
  $('customers-tbody').innerHTML = rows.map((c) => `
    <tr>
      <td><a class="link" data-action="customer" data-id="${c.id}">${esc(c.name)}</a>
        ${c.notes ? `<div class="small muted">${esc(c.notes)}</div>` : ''}</td>
      <td class="small">${[c.phone && `SĐT: ${esc(c.phone)}`, c.zalo && `Zalo: ${esc(c.zalo)}`, c.email && esc(c.email)].filter(Boolean).join('<br>') || '<span class="muted">—</span>'}</td>
      <td>${esc(c.active_count)} / ${esc(c.license_count)}</td>
      <td>${c.next_expiry ? expiryCell({ expires_at: c.next_expiry }) : '<span class="muted">—</span>'}</td>
      <td>${c.last_seen ? (isOnline(c.last_seen) ? '<span class="text-success">● Online</span>' : esc(ago(c.last_seen))) : '<span class="muted">—</span>'}</td>
      <td>${money(c.total_paid)}</td>
      <td style="text-align:right"><div class="row-actions">
        <button class="btn btn-sm btn-secondary" data-action="customer" data-id="${c.id}">Xem</button>
        ${can('STAFF') ? `<button class="btn btn-sm btn-secondary" data-action="edit-customer" data-id="${c.id}">Sửa</button>` : ''}
        ${can('OWNER') ? `<button class="btn btn-sm btn-delete" data-action="delete-customer" data-id="${c.id}">Xóa</button>` : ''}
      </div></td>
    </tr>`).join('');
}
$('customer-search').addEventListener('input', renderCustomers);

// ===== Admin =====
function renderAdmins(admins) {
  $('admins-tbody').innerHTML = admins.length ? admins.map((a) => `
    <tr>
      <td class="mono">${esc(a.username)}</td>
      <td>${esc(a.display_name)}</td>
      <td><span class="role-badge role-${esc(a.role)}">${esc(ROLE_LABEL[a.role])}</span></td>
      <td>${a.active ? '<span class="badge badge-active">Hoạt động</span>' : '<span class="badge badge-locked">Đã khóa</span>'}</td>
      <td>${a.last_login_at ? esc(ago(a.last_login_at)) : '<span class="muted">Chưa đăng nhập</span>'}</td>
      <td style="text-align:right"><div class="row-actions">
        <button class="btn btn-sm btn-secondary" data-action="edit-admin" data-id="${a.id}">Sửa</button>
        <button class="btn btn-sm ${a.active ? 'btn-kill' : 'btn-unlock'}" data-action="toggle-admin" data-id="${a.id}" data-active="${a.active ? 1 : 0}">${a.active ? 'Khóa' : 'Mở khóa'}</button>
        <button class="btn btn-sm btn-delete" data-action="delete-admin" data-id="${a.id}" data-name="${esc(a.username)}">Xóa</button>
      </div></td>
    </tr>`).join('')
    : '<tr><td colspan="6" class="loading-state">Chưa có tài khoản nào. Đang đăng nhập bằng Admin Secret — hãy tạo tài khoản cho bạn và nhân viên.</td></tr>';
}

// ===== Nhật ký =====
const LOG_LABEL = {
  ACTIVATE_BIND_HWID: 'Kích hoạt máy mới', ACTIVATE_REBIND_OK: 'Kích hoạt lại', ACTIVATE_HWID_MISMATCH: 'Thử dùng trên máy khác',
  ACTIVATE_FAIL_NOT_FOUND: 'Nhập key không tồn tại', ACTIVATE_BLOCKED_LOCKED: 'Key bị khóa cố kích hoạt', ACTIVATE_EXPIRED: 'Key hết hạn cố kích hoạt',
  HEARTBEAT_KILL_SWITCH_HIT: 'App bị đóng do khóa', ADMIN_CREATE_KEY: 'Tạo key', KILL_SWITCH_ACTIVATED: 'Khóa key', UNLOCKED: 'Mở khóa key',
  EXTEND: 'Gia hạn', UPDATE_PLAN: 'Đổi gói', RESET_HWID: 'Đổi máy', DELETE_KEY: 'Xóa key',
  CUSTOMER_CREATE: 'Thêm khách', CUSTOMER_UPDATE: 'Sửa khách', CUSTOMER_DELETE: 'Xóa khách',
  ADMIN_LOGIN: 'Đăng nhập', ADMIN_LOGIN_FAIL: 'Đăng nhập sai', ADMIN_CREATE: 'Tạo admin', ADMIN_UPDATE: 'Sửa admin', ADMIN_DELETE: 'Xóa admin',
};

function logLines(logs) {
  if (!logs.length) return '<div class="log-item muted">Chưa có hoạt động nào</div>';
  return logs.map((l) => {
    const cls = /KILL|LOCKED|MISMATCH|FAIL|DELETE/.test(l.action) ? 'kill' : /EXTEND|BIND|REBIND|CREATE/.test(l.action) ? 'active' : '';
    return `
      <div class="log-item ${cls}">
        <div>
          <strong>${esc(LOG_LABEL[l.action] || l.action)}</strong>
          ${l.license_key ? `<span class="mono" style="color:#60a5fa; margin-left:8px;">${esc(l.license_key)}</span>` : ''}
          ${l.details ? `<span class="muted" style="margin-left:6px;">${esc(l.details)}</span>` : ''}
        </div>
        <div class="small muted">${l.actor ? `${esc(l.actor)} • ` : ''}${l.ip ? `${esc(l.ip)} • ` : ''}${new Date(l.timestamp).toLocaleString('vi-VN')}</div>
      </div>`;
  }).join('');
}
const renderLogs = (logs) => { $('logs-container').innerHTML = logLines(logs); };

// ===== Hộp thoại dùng chung =====
let dialogSubmit = null;

function field(f) {
  const id = `f-${f.name}`;
  const common = `id="${id}" name="${esc(f.name)}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
  let input;
  if (f.type === 'select') {
    input = `<select ${common}>${f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea ${common} rows="2">${esc(f.value ?? '')}</textarea>`;
  } else if (f.type === 'presets') {
    input = `<div class="preset-pills" data-target="${esc(f.target)}">${f.options.map((o) => `<button type="button" class="preset-pill ${String(o.value) === String(f.value) ? 'active' : ''}" data-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}</div>`;
  } else {
    input = `<input type="${f.type || 'text'}" ${common} value="${esc(f.value ?? '')}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} autocomplete="off">`;
  }
  return `<div class="form-group ${f.hidden ? 'hidden' : ''}" data-field="${esc(f.name)}"><label>${esc(f.label)}</label>${input}${f.hint ? `<div class="small muted" style="margin-top:4px">${esc(f.hint)}</div>` : ''}</div>`;
}

function openDialog({ title, subtitle = '', fields = [], html = '', submitLabel = 'Lưu', wide = false, onSubmit = null, onChange = null }) {
  $('dialog-title').textContent = title;
  $('dialog-subtitle').textContent = subtitle;
  $('dialog-body').innerHTML = fields.map(field).join('') + html;
  $('dialog-box').classList.toggle('modal-wide', wide);
  $('dialog-submit').textContent = submitLabel;
  $('dialog-submit').classList.toggle('hidden', !onSubmit);
  dialogSubmit = onSubmit;
  $('dialog').classList.remove('hidden');

  // Nút chọn nhanh ghi giá trị vào ô đích
  $('dialog-body').querySelectorAll('.preset-pills[data-target]').forEach((group) => {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.preset-pill');
      if (!btn) return;
      group.querySelectorAll('.preset-pill').forEach((p) => p.classList.toggle('active', p === btn));
      $(`f-${group.dataset.target}`).value = btn.dataset.value;
      onChange?.();
    });
  });
  if (onChange) {
    $('dialog-body').addEventListener('input', onChange);
    $('dialog-body').addEventListener('change', onChange);
    onChange();
  }
  $('dialog-body').querySelector('input:not([type=hidden]), select')?.focus();
}

function closeDialog() {
  $('dialog').classList.add('hidden');
  const fresh = $('dialog-body').cloneNode(false); // bỏ listener cũ
  $('dialog-body').replaceWith(fresh);
  dialogSubmit = null;
}

const formValues = () => Object.fromEntries(new FormData($('dialog-form')).entries());

$('dialog-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!dialogSubmit) return;
  $('dialog-submit').disabled = true;
  try {
    await dialogSubmit(formValues());
    closeDialog();
  } catch {
    // act() đã báo lỗi
  } finally {
    $('dialog-submit').disabled = false;
  }
});
document.addEventListener('click', (e) => { if (e.target.closest('[data-dialog-close]')) closeDialog(); });

const num = (v) => (v === '' || v === undefined ? undefined : Number(v));

// ===== Các thao tác =====
const DURATION_PRESETS = [
  { value: 30, label: '1 tháng' }, { value: 90, label: '3 tháng' }, { value: 180, label: '6 tháng' },
  { value: 365, label: '1 năm' }, { value: 9999, label: 'Vĩnh viễn' },
];

function openCreateLicense(customerId = '') {
  openDialog({
    title: 'Tạo License Key Mới',
    subtitle: 'Chọn khách có sẵn hoặc nhập khách mới',
    fields: [
      { name: 'customerId', label: 'Khách hàng', type: 'select', value: customerId,
        options: [{ value: '', label: '+ Khách mới' }, ...customers.map((c) => ({ value: c.id, label: `${c.name}${c.phone ? ` · ${c.phone}` : ''}` }))] },
      { name: 'clientName', label: 'Tên khách mới', placeholder: 'VD: Anh Minh - Agency Media' },
      { name: 'phone', label: 'SĐT', placeholder: 'Không bắt buộc' },
      { name: 'zalo', label: 'Zalo', placeholder: 'Không bắt buộc' },
      { name: 'durationPreset', label: 'Thời hạn', type: 'presets', target: 'durationDays', value: 90, options: DURATION_PRESETS },
      { name: 'durationDays', label: 'Số ngày (9999 = vĩnh viễn)', type: 'number', value: 90, min: 1, max: 9999, required: true },
      { name: 'maxAccounts', label: 'Số tài khoản tối đa (Via + Fanpage + TikTok + Threads)', type: 'number', value: 20, min: 1, max: 1000, required: true },
      { name: 'maxUsers', label: 'Số người dùng trong app', type: 'number', value: 1, min: 1, max: 100, required: true },
      { name: 'amount', label: 'Số tiền đã thu (đ)', type: 'number', value: 0, min: 0 },
      { name: 'notes', label: 'Ghi chú', placeholder: 'VD: CK Vietcombank' },
    ],
    submitLabel: 'Tạo Key',
    onChange: () => {
      const isNew = !$('f-customerId').value;
      ['clientName', 'phone', 'zalo'].forEach((n) => document.querySelector(`[data-field="${n}"]`).classList.toggle('hidden', !isNew));
    },
    onSubmit: async (v) => {
      const data = await act('POST', '/api/admin/licenses/create', {
        customerId: v.customerId ? Number(v.customerId) : undefined,
        clientName: v.clientName, phone: v.phone, zalo: v.zalo,
        durationDays: num(v.durationDays), maxAccounts: num(v.maxAccounts), maxUsers: num(v.maxUsers),
        amount: num(v.amount) || 0, notes: v.notes,
      });
      navigator.clipboard?.writeText(data.licenseKey).catch(() => {});
      showToast(`Đã tạo key ${data.licenseKey} (đã copy)`, 6000);
    },
  });
}
$('btn-open-create').addEventListener('click', () => openCreateLicense());

function openExtend(l) {
  const preview = () => {
    const days = Number($('f-days').value);
    const target = $('extend-preview');
    if ($('f-days').value === 'lifetime') { target.textContent = `${dateVi(l.expires_at) || 'Vĩnh viễn'} → Vĩnh viễn`; return; }
    if (!Number.isInteger(days) || days < 1) { target.textContent = ''; return; }
    const base = Math.max(Date.now(), l.expires_at ? new Date(l.expires_at).getTime() : Date.now());
    target.textContent = `Hạn hiện tại: ${dateVi(l.expires_at) || '—'}  →  Hạn mới: ${new Date(base + days * DAY_MS).toLocaleDateString('vi-VN')}`;
  };
  openDialog({
    title: `Gia hạn: ${l.customer_name || l.client_name}`,
    subtitle: 'Cộng từ hạn hiện tại (đã hết hạn thì tính từ hôm nay). App khách đang mở tự nhận hạn mới trong 3 phút.',
    fields: [
      { name: 'preset', label: 'Thêm thời hạn', type: 'presets', target: 'days', value: 30,
        options: [{ value: 30, label: '+1 tháng' }, { value: 90, label: '+3 tháng' }, { value: 365, label: '+1 năm' }, { value: 'lifetime', label: 'Vĩnh viễn' }] },
      { name: 'days', label: 'Hoặc nhập số ngày', type: 'text', value: 30, required: true },
      { name: 'amount', label: 'Số tiền đã thu (đ)', type: 'number', value: 0, min: 0 },
      { name: 'note', label: 'Ghi chú thanh toán', placeholder: 'VD: CK Vietcombank 25/10' },
    ],
    html: '<p id="extend-preview" class="extend-preview"></p>',
    submitLabel: 'Xác Nhận Gia Hạn',
    onChange: preview,
    onSubmit: (v) => act('POST', `/api/admin/licenses/${l.id}/extend`,
      v.days === 'lifetime' ? { lifetime: true, amount: num(v.amount) || 0, note: v.note } : { days: Number(v.days), amount: num(v.amount) || 0, note: v.note }),
  });
}

function openPlan(l) {
  openDialog({
    title: `Gói của ${l.customer_name || l.client_name}`,
    subtitle: `Key ${l.license_key}. App khách nhận giới hạn mới trong 3 phút.`,
    fields: [
      { name: 'maxAccounts', label: 'Số tài khoản tối đa', type: 'number', value: l.max_accounts, min: 1, max: 1000, required: true },
      { name: 'maxUsers', label: 'Số người dùng trong app', type: 'number', value: l.max_users || 1, min: 1, max: 100, required: true },
      { name: 'customerId', label: 'Thuộc khách hàng', type: 'select', value: l.customer_id, options: customers.map((c) => ({ value: c.id, label: c.name })) },
      { name: 'notes', label: 'Ghi chú', value: l.notes || '' },
    ],
    onSubmit: (v) => act('PATCH', `/api/admin/licenses/${l.id}`, {
      maxAccounts: num(v.maxAccounts), maxUsers: num(v.maxUsers), customerId: Number(v.customerId), notes: v.notes,
    }),
  });
}

function openCustomerForm(c = null) {
  openDialog({
    title: c ? `Sửa: ${c.name}` : 'Thêm Khách Hàng',
    fields: [
      { name: 'name', label: 'Tên khách / đơn vị', value: c?.name, required: true },
      { name: 'phone', label: 'SĐT', value: c?.phone },
      { name: 'zalo', label: 'Zalo', value: c?.zalo },
      { name: 'email', label: 'Email', type: 'email', value: c?.email },
      { name: 'notes', label: 'Ghi chú', type: 'textarea', value: c?.notes },
    ],
    onSubmit: (v) => (c ? act('PATCH', `/api/admin/customers/${c.id}`, v) : act('POST', '/api/admin/customers', v)),
  });
}
$('btn-add-customer').addEventListener('click', () => openCustomerForm());

async function openCustomerDetail(id) {
  try {
    const { customer: c, licenses: keys, payments, logs } = await api('GET', `/api/admin/customers/${id}`);
    const total = payments.reduce((s, p) => s + (p.amount || 0), 0);
    openDialog({
      title: c.name,
      subtitle: [c.phone && `SĐT ${c.phone}`, c.zalo && `Zalo ${c.zalo}`, c.email].filter(Boolean).join(' · ') || 'Chưa có thông tin liên hệ',
      wide: true,
      html: `
        ${c.notes ? `<p class="muted">${esc(c.notes)}</p>` : ''}
        <div class="section-header"><h3>Key (${keys.length})</h3>
          ${can('STAFF') ? `<button type="button" class="btn btn-sm btn-primary" data-action="create-for" data-id="${c.id}">+ Tạo key cho khách</button>` : ''}</div>
        <table class="licenses-table compact"><thead><tr><th>Key</th><th>Gói</th><th>Trạng thái</th><th>Hạn</th><th>Online</th><th>Máy</th></tr></thead><tbody>
          ${keys.map((l) => `<tr><td class="mono">${esc(l.license_key)}</td><td class="small">${esc(l.max_accounts)} TK · ${esc(l.max_users || 1)} người</td>
            <td>${statusBadge(l)}</td><td>${expiryCell(l)}</td>
            <td class="small">${l.last_ping_at ? (isOnline(l.last_ping_at) ? '<span class="text-success">● Online</span>' : esc(ago(l.last_ping_at))) : '—'}${l.last_ip ? `<br><span class="muted">${esc(l.last_ip)}</span>` : ''}</td>
            <td class="small">${esc(osLabel(l.client_os))}${l.app_version ? ` v${esc(l.app_version)}` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Chưa có key</td></tr>'}
        </tbody></table>
        <div class="section-header"><h3>Thanh toán · tổng ${money(total)}</h3></div>
        <table class="licenses-table compact"><thead><tr><th>Ngày</th><th>Key</th><th>Số tiền</th><th>Thời hạn</th><th>Ghi chú</th><th>Người thu</th></tr></thead><tbody>
          ${payments.map((p) => `<tr><td class="small">${esc(new Date(p.created_at).toLocaleString('vi-VN'))}</td><td class="mono small">${esc(p.license_key || '')}</td>
            <td>${money(p.amount)}</td><td class="small">${p.days ? `+${esc(p.days)} ngày` : 'Vĩnh viễn'}</td><td class="small">${esc(p.note || '')}</td><td class="small">${esc(p.actor || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Chưa có thanh toán</td></tr>'}
        </tbody></table>
        <div class="section-header"><h3>Hoạt động</h3></div>
        <div class="logs-container short">${logLines(logs)}</div>`,
    });
  } catch (err) {
    showToast(err.message);
  }
}

function openAdminForm(a = null) {
  openDialog({
    title: a ? `Sửa: ${a.username}` : 'Thêm Tài Khoản Admin',
    subtitle: a ? 'Để trống mật khẩu nếu không đổi. Đổi mật khẩu / quyền sẽ đăng xuất các phiên đang mở của tài khoản này.' : '',
    fields: [
      ...(a ? [] : [{ name: 'username', label: 'Tên đăng nhập', placeholder: 'chữ thường, số, . _ -', required: true }]),
      { name: 'displayName', label: 'Tên hiển thị', value: a?.display_name },
      { name: 'role', label: 'Quyền', type: 'select', value: a?.role || 'STAFF',
        options: [{ value: 'STAFF', label: 'Nhân viên' }, { value: 'VIEWER', label: 'Chỉ xem' }, { value: 'OWNER', label: 'Chủ (toàn quyền)' }] },
      { name: 'password', label: a ? 'Mật khẩu mới' : 'Mật khẩu (tối thiểu 8 ký tự)', type: 'password', required: !a },
    ],
    onSubmit: (v) => {
      const body = { displayName: v.displayName, role: v.role };
      if (v.password) body.password = v.password;
      if (!a) body.username = v.username;
      return a ? act('PATCH', `/api/admin/admins/${a.id}`, body) : act('POST', '/api/admin/admins', body);
    },
  });
}
$('btn-add-admin').addEventListener('click', () => openAdminForm());

// Mọi nút trong bảng / hộp thoại dùng data-action (không nhét dữ liệu vào onclick)
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const id = Number(el.dataset.id);
  const l = licenses.find((x) => x.id === id);
  const c = customers.find((x) => x.id === id);
  switch (el.dataset.action) {
    case 'copy':
      navigator.clipboard?.writeText(el.dataset.value).then(() => showToast(`Đã copy ${el.dataset.value}`));
      break;
    case 'extend': openExtend(l); break;
    case 'plan': openPlan(l); break;
    case 'toggle':
      if (l.status === 'ACTIVE' && !confirm(`Khóa key của "${l.customer_name || l.client_name}"? App của khách sẽ tự đóng trong vòng 3 phút.`)) return;
      act('POST', `/api/admin/licenses/${id}/toggle`).catch(() => {});
      break;
    case 'reset':
      if (confirm(`Xóa mã máy của "${l.customer_name || l.client_name}"? Khách kích hoạt lại được trên máy mới, máy cũ mất quyền.`)) {
        act('POST', `/api/admin/licenses/${id}/reset-hwid`).catch(() => {});
      }
      break;
    case 'delete-license':
      if (confirm(`Xóa vĩnh viễn key ${l.license_key}?`)) act('DELETE', `/api/admin/licenses/${id}`).catch(() => {});
      break;
    case 'customer': openCustomerDetail(id); break;
    case 'edit-customer': openCustomerForm(c); break;
    case 'delete-customer':
      if (confirm(`Xóa khách "${c.name}"?`)) act('DELETE', `/api/admin/customers/${id}`).catch(() => {});
      break;
    case 'create-for': closeDialog(); openCreateLicense(id); break;
    case 'edit-admin': {
      const { admins } = await api('GET', '/api/admin/admins');
      openAdminForm(admins.find((a) => a.id === id));
      break;
    }
    case 'toggle-admin':
      act('PATCH', `/api/admin/admins/${id}`, { active: el.dataset.active !== '1' }).catch(() => {});
      break;
    case 'delete-admin':
      if (confirm(`Xóa tài khoản ${el.dataset.name}?`)) act('DELETE', `/api/admin/admins/${id}`).catch(() => {});
      break;
    default:
  }
});

// Tự làm mới để thấy khách online
setInterval(() => { if (auth && $('dialog').classList.contains('hidden')) reloadAll(); }, 30000);

if (auth) enterDashboard();
