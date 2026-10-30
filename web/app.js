'use strict';
const $ = id => document.getElementById(id);
let accounts;
try { accounts = JSON.parse(localStorage.getItem('ghostai-accounts') || '[]'); } catch { accounts = []; }
if (!Array.isArray(accounts)) accounts = [];
let token = sessionStorage.getItem('ghostai-session') || '', state, editing = null;
const conversation = crypto.randomUUID();
function message(text = '') { $('message').textContent = text; }
function el(tag, text, cls) { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; }
function option(value, text) { const node = el('option', text); node.value = value; return node; }
async function api(path, body) {
  const response = await fetch(path, {method: body === undefined ? 'GET' : 'POST',
    headers: {'Content-Type':'application/json', 'Authorization': `Bearer ${token}`},
    body: body === undefined ? undefined : JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function remember(code, label) {
  if (!accounts.some(a => a.code === code)) accounts.push({code, label});
  localStorage.setItem('ghostai-accounts', JSON.stringify(accounts));
  renderAccounts();
}
function renderAccounts() {
  $('identity').replaceChildren(option('', 'Choose an identity'));
  accounts.forEach(a => $('identity').append(option(a.code, a.label)));
  $('identity').value = token;
}
async function login(code) {
  const previous = token;
  token = code;
  try {
    const next = await api('/api/state');
    state = next;
    sessionStorage.setItem('ghostai-session', token);
    remember(token, `${state.company} / ${state.actor.name} (${state.actor.role})`);
    editing = null;
    $('staff-form').reset();
    $('access-code').hidden = true;
    $('issued-code').textContent = '';
    $('result').textContent = 'Your receipt will appear here.';
    $('operation-form').elements.text.value = '';
    $('request-key').value = crypto.randomUUID();
    render(); message();
  } catch (error) { token = previous; throw error; }
}
async function refresh() { state = await api('/api/state'); render(); }
function render() {
  $('workspace').hidden = false;
  $('company-name').textContent = state.company;
  $('role').textContent = `${state.actor.name} / ${state.actor.role}`;
  const owner = state.actor.role === 'owner';
  for (const id of ['enrollment','approval-card','audit-card']) $(id).hidden = !owner;
  const previousOperation = $('operation').value, previousJob = $('job').value;
  $('operation').replaceChildren();
  state.operations.filter(op => state.permissions[op.id]).forEach(op =>
    $('operation').append(option(op.id, `${op.id} · ${op.risk}${op.provider === 'fake_crm' ? ' · FAKE CRM' : ''}`)));
  if ([...$('operation').options].some(o => o.value === previousOperation)) $('operation').value = previousOperation;
  $('job').replaceChildren(...state.jobs.map(j => option(j.id, j.title)));
  if (state.jobs.some(j => j.id === previousJob)) $('job').value = previousJob;
  $('run').disabled = !state.jobs.length || !$('operation').value;
  updateText();
  $('permissions').replaceChildren();
  state.operations.forEach(op => {
    const label = el('label', op.id);
    const select = el('select'); select.dataset.permission = op.id;
    select.append(option('', 'Off'), ...op.scopes.map(s => option(s, s[0].toUpperCase()+s.slice(1))));
    select.value = state.default_permissions[op.id] || '';
    label.append(select); $('permissions').append(label);
  });
  $('assignments').replaceChildren();
  state.jobs.forEach(job => {
    const label = el('label', null, 'check'), input = el('input');
    input.type = 'checkbox'; input.value = job.id; input.dataset.assignment = '';
    label.append(input, document.createTextNode(job.title)); $('assignments').append(label);
  });
  if (editing) fillStaff(state.staff.find(s => s.id === editing));
  else { $('staff-heading').textContent = 'Enroll a technician'; $('save-staff').textContent = 'Enroll technician'; $('cancel-edit').hidden = true; }
  $('staff-list').replaceChildren();
  state.staff.forEach(staff => {
    const row = el('div', null, 'row'); row.append(el('strong', staff.name), el('span', `${staff.role} · ${staff.active ? 'active' : 'revoked'}`, 'muted'));
    if (staff.role === 'technician') {
      const button = el('button', 'Edit access', 'secondary'); button.type = 'button';
      button.onclick = () => { editing = staff.id; fillStaff(staff); $('staff-heading').scrollIntoView({behavior:'smooth',block:'center'}); };
      row.append(el('div', Object.entries(staff.permissions).map(([k,v]) => `${k}: ${v}`).join(' · ') || 'No permissions', 'muted'), button);
    }
    $('staff-list').append(row);
  });
  $('approvals').replaceChildren();
  if (!state.approvals.length) $('approvals').append(el('p', 'No pending approvals.', 'muted'));
  state.approvals.forEach(request => {
    const row = el('div', null, 'row');
    row.append(el('strong', `${request.name} · ${request.operation_id}`), el('pre', request.arguments),
      el('p', `Expires ${new Date(request.expires_at*1000).toLocaleTimeString()}`, 'muted'));
    const approve = el('button', request.decision === 'approved' ? 'Execute approved request' : 'Approve & execute');
    approve.onclick = () => action(async () => {
      if (request.decision !== 'approved') await api(`/api/requests/${request.id}/approve`, {approve:true});
      $('result').textContent = JSON.stringify(await api(`/api/requests/${request.id}/execute`, {}), null, 2);
      await refresh();
    });
    row.append(approve);
    if (request.decision === 'pending') {
      const deny = el('button', 'Deny', 'secondary');
      deny.onclick = () => action(async () => { await api(`/api/requests/${request.id}/approve`, {approve:false}); await refresh(); });
      row.append(deny);
    }
    $('approvals').append(row);
  });
  $('receipts').replaceChildren();
  state.receipts.forEach(receipt => {
    const row = el('div', null, 'row');
    row.append(el('strong', receipt.operation_id), el('div', receipt.status, 'status'), el('small', receipt.request_id, 'muted'));
    if (receipt.error) row.append(el('p', receipt.error));
    $('receipts').append(row);
  });
  if (!state.receipts.length) $('receipts').append(el('p', 'No operations yet.', 'muted'));
  $('audit').replaceChildren(...state.audit.map(event => el('div', `${new Date(event.created_at*1000).toLocaleTimeString()} · ${event.event} · ${event.subject_id}`, 'row muted')));
}
function fillStaff(staff) {
  if (!staff) { editing = null; return; }
  $('staff-heading').textContent = `Edit ${staff.name}’s access`;
  $('staff-form').elements.name.value = staff.name;
  $('staff-form').elements.active.checked = Boolean(staff.active);
  document.querySelectorAll('[data-permission]').forEach(s => s.value = staff.permissions[s.dataset.permission] || '');
  document.querySelectorAll('[data-assignment]').forEach(s => s.checked = staff.job_ids.includes(s.value));
  $('save-staff').textContent = 'Save permissions'; $('cancel-edit').hidden = false;
}
function updateText() {
  const writing = ['business_note.create','service_request.create'].includes($('operation').value);
  $('text-label').hidden = !writing;
  $('operation-form').elements.text.required = writing;
}
async function action(fn) { message(); try { await fn(); } catch (error) { message(error.message); } }
$('company-form').onsubmit = event => { event.preventDefault(); action(async () => {
  const data = await api('/api/companies', {name: event.target.elements.name.value});
  await login(data.access_code); event.target.reset();
}); };
$('login-form').onsubmit = event => { event.preventDefault(); action(async () => { await login(event.target.elements.code.value.trim()); event.target.reset(); }); };
$('identity').onchange = event => { if (event.target.value) action(() => login(event.target.value)); };
$('refresh').onclick = () => action(refresh);
$('operation').onchange = updateText;
$('new-key').onclick = () => { $('request-key').value = crypto.randomUUID(); };
$('request-key').value = crypto.randomUUID();
$('operation-form').onsubmit = event => { event.preventDefault(); action(async () => {
  const form = event.target.elements;
  const args = {job_id:form.job_id.value};
  if (!$('text-label').hidden) args.text = form.text.value;
  const data = await api('/api/operations', {operation_id:form.operation_id.value, arguments:args,
    idempotency_key:form.idempotency_key.value, conversation_id:`${conversation}-${state.actor.id}`});
  $('result').textContent = JSON.stringify(data, null, 2); await refresh();
}); };
$('staff-form').onsubmit = event => { event.preventDefault(); action(async () => {
  const permissions = {};
  document.querySelectorAll('[data-permission]').forEach(s => { if (s.value) permissions[s.dataset.permission] = s.value; });
  const payload = {name:event.target.elements.name.value, active:event.target.elements.active.checked, permissions,
    job_ids:[...document.querySelectorAll('[data-assignment]:checked')].map(c => c.value)};
  const data = await api(editing ? `/api/staff/${editing}` : '/api/staff', payload);
  if (data.access_code) {
    $('issued-code').textContent = data.access_code; $('access-code').hidden = false;
    remember(data.access_code, `${state.company} / ${payload.name} (technician)`);
  }
  editing = null; event.target.reset(); await refresh(); message('Technician access saved. New permissions take effect immediately.');
}); };
$('cancel-edit').onclick = () => { editing = null; $('staff-form').reset(); render(); };
renderAccounts();
if (token) action(() => login(token));
