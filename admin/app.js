// Never inside a frame (clickjacking): GitHub Pages can't send frame-ancestors.
if (window.top !== window.self) { document.documentElement.innerHTML = ''; throw new Error('framed') }

const API = 'https://ykppmjocbrnkokeeiubd.supabase.co/functions/v1/admin'
const TIMEOUT_MS = 20000
const TOKEN_KEY = 'orlyo_admin_token'

// ── helpers ──────────────────────────────────────────────────────────────────
const $ = (s, el = document) => el.querySelector(s)
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmtDate = (s) => s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtDay = (s) => s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const gbp = (p) => p == null ? '—' : '£' + (p / 100).toFixed(2)
const token = () => { try { return sessionStorage.getItem(TOKEN_KEY) || '' } catch { return '' } }
const setToken = (t) => { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY) } catch {} }

function toast(msg) {
  const t = document.createElement('div')
  t.className = 'toast'; t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 2600)
}

// Sign-in steps that use the short-lived token from the password step.
const SIGN_IN_OPS = ['login', 'login_mfa', 'mfa_enrol_start', 'mfa_enrol_finish']
let pendingToken = ''

// Every request: timeout, readable error, never hangs. Throws Error(message).
async function api(op, params = {}) {
  const signingIn = SIGN_IN_OPS.includes(op)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(op === 'login' ? {} : { 'x-admin-token': signingIn ? pendingToken : token() }) },
      body: JSON.stringify(op === 'login' ? { op, password: params.password } : op === 'login_mfa' ? { op, code: params.code } : { op, params }),
      signal: ctrl.signal,
    })
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'The server took too long to respond. Please try again.' : 'Could not reach the server. Check your connection.')
  } finally {
    clearTimeout(timer)
  }
  let body = null
  try { body = await res.json() } catch { /* not JSON */ }
  if (res.status === 401 && op !== 'login') { signOut(signingIn ? body?.message : 'Your session has expired — please sign in again.'); throw new Error('Signed out') }
  if (!res.ok) throw new Error(body?.message || `Request failed (${res.status})`)
  return op === 'login' || op === 'login_mfa' ? body : body?.data
}

// Disables a button while `fn` runs; always re-enables.
async function busy(btn, fn) {
  const label = btn.textContent
  btn.disabled = true; btn.textContent = '…'
  try { return await fn() } finally { btn.disabled = false; btn.textContent = label }
}

// ── sign-in: password, then an authenticator code (or first-time enrolment) ──
function showLoginStep(id) {
  for (const el of ['#login-form', '#code-form', '#enrol']) $(el).classList.toggle('hidden', el !== id)
}
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = $('#login-btn'), err = $('#login-err'), pw = $('#login-password')
  err.textContent = ''
  await busy(btn, async () => {
    try {
      const r = await api('login', { password: pw.value })
      pw.value = ''
      pendingToken = r.token
      if (r.step === 'enrol') return startEnrol()
      showLoginStep('#code-form'); $('#code-err').textContent = ''; $('#code-input').focus()
    } catch (e) { err.textContent = e.message }
  })
})
$('#code-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = $('#code-btn'), err = $('#code-err'), input = $('#code-input')
  err.textContent = ''
  await busy(btn, async () => {
    try {
      const r = await api('login_mfa', { code: input.value.trim() })
      input.value = ''; pendingToken = ''
      setToken(r.token)
      showApp()
      if (r.backupLeft <= 3) toast(`Only ${r.backupLeft} backup code${r.backupLeft === 1 ? '' : 's'} left — make new ones under Security.`)
    } catch (e) { if (e.message !== 'Signed out') err.textContent = e.message }
  })
})
$('#code-back').addEventListener('click', () => signOut())

// First sign-in after 2FA was switched on: add Orlyo to an authenticator app.
async function startEnrol() {
  showLoginStep('#enrol')
  const body = $('#enrol-body'), err = $('#enrol-err')
  body.innerHTML = '<div class="state">Setting up…</div>'; err.textContent = ''
  let d
  try { d = await api('mfa_enrol_start') } catch (e) { if (e.message !== 'Signed out') err.textContent = e.message; return }
  const qr = qrcode(0, 'M'); qr.addData(d.uri); qr.make()
  body.innerHTML = `<h2>Set up two-step sign-in</h2>
    <ol><li>Open your authenticator app (Google Authenticator, 1Password…) and add an account.</li>
        <li>Scan this code, or enter the key below.</li>
        <li>Type the 6-digit code it shows.</li></ol>
    <div class="qr">${qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div>
    <div class="secret">${esc(d.secret.replace(/(.{4})/g, '$1 ').trim())}</div>
    <a class="btn btn-light btn-small" href="${esc(d.uri)}">On this phone? Open in your authenticator app</a>
    <form id="enrol-form" autocomplete="off"><input id="enrol-code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="6" required>
      <button class="btn" id="enrol-btn" type="submit">Turn on two-step sign-in</button></form>`
  $('#enrol-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    await busy($('#enrol-btn'), async () => {
      try {
        const r = await api('mfa_enrol_finish', { code: $('#enrol-code').value.trim() })
        pendingToken = ''
        setToken(r.token)
        showBackupCodes(body, r.backupCodes, () => showApp())
      } catch (e) { if (e.message !== 'Signed out') err.textContent = e.message }
    })
  })
}
// Shown once: each code signs in one time if the phone is lost.
function showBackupCodes(el, codes, onDone) {
  el.innerHTML = `<h2>Save your backup codes</h2>
    <p class="lead">If you lose your phone, each of these signs you in once. Keep them in your password manager or somewhere safe — they won't be shown again.</p>
    <div class="codes">${codes.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
    <button class="btn btn-light btn-small" id="codes-copy" type="button">Copy</button>
    <button class="btn" id="codes-done" type="button">I've saved them</button>`
  $('#codes-copy', el).onclick = async () => { try { await navigator.clipboard.writeText(codes.join('\n')); toast('Copied') } catch { toast('Select and copy them instead') } }
  $('#codes-done', el).onclick = onDone
}

$('#logout').addEventListener('click', () => signOut())
function signOut(msg) {
  setToken(null); pendingToken = ''
  $('#app').classList.add('hidden'); $('#login').classList.remove('hidden')
  showLoginStep('#login-form')
  $('#login-err').textContent = msg || ''
}
function showApp() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden')
  go(location.hash.slice(1) || 'overview')
}

// ── navigation ───────────────────────────────────────────────────────────────
const pages = {}
document.querySelectorAll('#nav [data-page]').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)))
function go(name) {
  if (!pages[name]) name = 'overview'
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name)
  document.querySelectorAll('#nav [data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === name))
  pages[name]($('#main'))
}
function frame(main, title, lead) {
  main.innerHTML = `<h1>${esc(title)}</h1><p class="lead">${lead}</p><div id="body"><div class="state">Loading…</div></div>`
  return $('#body', main)
}
// Loads one section; shows an error + retry instead of spinning.
async function load(el, op, params, render) {
  el.innerHTML = '<div class="state">Loading…</div>'
  try {
    const data = await api(op, params)
    render(data)
  } catch (e) {
    if (e.message === 'Signed out') return
    el.innerHTML = `<div class="card state error">${esc(e.message)}<br><br><button class="btn btn-light btn-small" id="retry">Try again</button></div>`
    $('#retry', el).onclick = () => load(el, op, params, render)
  }
}
function badge(id, n, alert) {
  const el = $(id); if (!el) return
  el.textContent = n; el.classList.toggle('hidden', !n); el.classList.toggle('alert', !!alert)
}
// Inline "are you sure" with an optional note — no browser dialogs.
function confirmInline(anchor, { text, note, noteRequired, button = 'Confirm', danger }, onOk) {
  const cell = anchor.closest('td') || anchor.parentElement
  cell.querySelector('.confirm')?.remove()
  const box = document.createElement('div')
  box.className = 'confirm'
  box.innerHTML = `<div>${esc(text)}</div>${note ? `<textarea rows="2" placeholder="${esc(note)}"></textarea>` : ''}
    <div class="actions"><button class="btn btn-small ${danger ? 'btn-danger' : ''}">${esc(button)}</button><button class="btn btn-light btn-small">Cancel</button></div>
    <div class="err"></div>`
  cell.appendChild(box)
  const [ok, cancel] = box.querySelectorAll('button')
  cancel.onclick = () => box.remove()
  ok.onclick = () => busy(ok, async () => {
    const value = box.querySelector('textarea')?.value.trim() ?? ''
    if (noteRequired && value.length < 3) { box.querySelector('.err').textContent = 'Please add a short note.'; return }
    try { await onOk(value); box.remove() } catch (e) { if (e.message !== 'Signed out') box.querySelector('.err').textContent = e.message }
  })
}

// ── Overview ─────────────────────────────────────────────────────────────────
pages.overview = (main) => {
  const el = frame(main, 'Overview', 'The state of Orlyo right now.')
  load(el, 'overview', {}, (d) => {
    badge('#n-reports', d.openReports, true); badge('#n-review', d.needsReview, true); badge('#n-waitlist', d.waitlist)
    const t = (label, value, flag) => `<div class="tile ${flag ? 'flag' : ''}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`
    // AI pauses for everyone once today's spend reaches the budget (UTC days).
    const usd = (n) => '$' + Number(n).toFixed(2)
    const aiPct = d.aiDailyBudgetUsd > 0 ? Math.round(100 * d.aiSpendTodayUsd / d.aiDailyBudgetUsd) : 0
    const aiBanner = aiPct >= 100
      ? `<div class="banner red"><b>AI is paused for today.</b> Spend has reached the ${esc(usd(d.aiDailyBudgetUsd))} daily budget; it resumes at midnight UTC.</div>`
      : aiPct >= 80
        ? `<div class="banner"><b>AI budget at ${aiPct}%.</b> ${esc(usd(d.aiSpendTodayUsd))} of ${esc(usd(d.aiDailyBudgetUsd))} spent today; AI features pause at 100% until midnight UTC.</div>`
        : ''
    el.innerHTML = `${aiBanner}<div class="tiles">
      ${t('AI spend today', `${usd(d.aiSpendTodayUsd)} of ${usd(d.aiDailyBudgetUsd)}`, aiPct >= 80)}
      ${t('Open reports', d.openReports, d.openReports > 0)}
      ${t('Paid sessions to review', d.needsReview, d.needsReview > 0)}
      ${t('Mentor waitlist', d.waitlist)}
      ${t('Active invite codes', d.activeInvites)}
      ${t('Users', d.users)}${t('Mentors', d.mentors)}${t('Mentees', d.mentees)}
      ${t('Active mentorships', d.activeMatches)}
      ${t('Upcoming sessions', d.upcomingSessions)}${t('Completed sessions', d.completedSessions)}
      ${t('Paid volume', gbp(d.grossPence))}${t('Platform fees', gbp(d.feePence))}
      ${t('Mentor mode', d.mentorMode)}
    </div>`
  })
}

// ── Reports ──────────────────────────────────────────────────────────────────
let reportFilter = 'open'
pages.reports = (main) => {
  const el = frame(main, 'Reports', 'Users reported in the app — Apple expects these handled promptly. Close a report, or suspend the reported account: that hides their profile and blocks sign-in until you lift it.')
  const render = () => load(el, 'reports_list', { status: reportFilter === 'all' ? null : reportFilter }, (rows) => {
    const filters = ['open', 'actioned', 'dismissed', 'all'].map((f) => `<button class="btn btn-light btn-small ${f === reportFilter ? 'on' : ''}" data-f="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')
    if (reportFilter === 'open') badge('#n-reports', rows.length, true)
    el.innerHTML = `<div class="filters">${filters}</div>` + (rows.length === 0
      ? `<div class="card state">No ${reportFilter === 'all' ? '' : reportFilter} reports.</div>`
      : `<div class="card table-wrap"><table><thead><tr><th>Reported</th><th>Reason</th><th>Details</th><th>By</th><th>When</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map((r) => `<tr data-id="${esc(r.id)}" data-user="${esc(r.reported_id)}" data-name="${esc(r.reported?.name ?? 'this account')}">
          <td><b>${esc(r.reported?.name ?? '(deleted account)')}</b><div class="muted">${esc(r.reported?.role ?? '')}${r.reports_against_user > 1 ? ` · ${r.reports_against_user} reports` : ''}</div>
              ${r.reported_suspended ? '<span class="pill red">Suspended</span>' : ''}</td>
          <td><span class="pill amber">${esc(String(r.reason).replace('_', ' '))}</span>${r.post_id ? '<div class="muted">about a post</div>' : ''}</td>
          <td class="detail">${esc(r.details || '—')}${r.admin_notes ? `<div class="muted">Note: ${esc(r.admin_notes)}</div>` : ''}</td>
          <td>${esc(r.reporter?.name ?? '(deleted)')}</td>
          <td class="muted">${fmtDate(r.created_at)}</td>
          <td><span class="pill ${r.status === 'open' ? 'red' : r.status === 'actioned' ? 'green' : ''}">${esc(r.status)}</span></td>
          <td><div class="actions">
            ${r.status === 'open' ? `<button class="btn btn-small" data-act="actioned">Mark actioned</button><button class="btn btn-light btn-small" data-act="dismissed">Dismiss</button>`
                                  : `<button class="btn btn-light btn-small" data-act="open">Reopen</button>`}
            ${r.reported ? (r.reported_suspended ? `<button class="btn btn-light btn-small" data-act="unsuspend">Unsuspend</button>` : `<button class="btn btn-danger btn-small" data-act="suspend">Suspend account</button>`) : ''}
          </div></td></tr>`).join('')}
      </tbody></table></div>`)
    el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { reportFilter = b.dataset.f; render() })
    el.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => {
      const tr = b.closest('tr'), act = b.dataset.act, name = tr.dataset.name
      if (act === 'suspend') return confirmInline(b, { text: `Suspend ${name}? Their profile is hidden and they can't sign in until you lift it.`, note: 'Reason (kept in the activity log)', button: 'Suspend', danger: true },
        async (reason) => { await api('user_suspend', { user_id: tr.dataset.user, reason }); toast('Account suspended'); render() })
      if (act === 'unsuspend') return confirmInline(b, { text: `Lift the suspension on ${name}?`, button: 'Unsuspend' },
        async () => { await api('user_unsuspend', { user_id: tr.dataset.user }); toast('Suspension lifted'); render() })
      const label = { actioned: 'Mark this report actioned', dismissed: 'Dismiss this report', open: 'Reopen this report' }[act]
      confirmInline(b, { text: `${label}?`, note: act === 'open' ? null : 'Note — what you did and why', button: 'Save' },
        async (notes) => { await api('reports_set_status', { id: tr.dataset.id, status: act, notes }); toast('Report updated'); render() })
    })
  })
  render()
}

// ── Sessions to review ───────────────────────────────────────────────────────
let reviewResolved = false
pages.review = (main) => {
  const el = frame(main, 'Sessions to review', 'Paid sessions the attendance check couldn\'t settle on its own (unclear call record, Daily outage, failed refund) or cancelled after payment. Check the attendance, issue any refund in the Stripe dashboard, then record the decision. Repeat mentor no-shows and late cancellations are flagged.')
  const render = () => load(el, 'review_list', { resolved: reviewResolved }, (rows) => {
    if (!reviewResolved) badge('#n-review', rows.length, true)
    const filters = `<div class="filters"><button class="btn btn-light btn-small ${!reviewResolved ? 'on' : ''}" data-r="0">To review</button><button class="btn btn-light btn-small ${reviewResolved ? 'on' : ''}" data-r="1">Resolved</button></div>`
    el.innerHTML = filters + (rows.length === 0 ? `<div class="card state">${reviewResolved ? 'Nothing resolved yet.' : 'Nothing to review.'}</div>`
      : `<div class="card table-wrap"><table><thead><tr><th>Session</th><th>Mentor</th><th>Mentee</th><th>Status</th><th>Attendance (Daily)</th><th>Paid</th><th>Stripe</th><th>${reviewResolved ? 'Decision' : ''}</th></tr></thead><tbody>
        ${rows.map((s) => `<tr data-id="${esc(s.id)}">
          <td><b>${fmtDate(s.scheduled_at)}</b><div class="muted">${esc(s.duration_minutes)} min</div></td>
          <td>${esc(s.mentor?.name ?? '—')}<div>${noShowFlag(s.mentor_no_shows_90d || 0, s.mentor_late_cancels_90d || 0)}</div></td><td>${esc(s.mentee?.name ?? '—')}</td>
          <td><span class="pill ${s.status === 'missed' ? 'red' : 'amber'}">${esc(s.status)}</span>${s.cancelled_at ? `<div class="muted">cancelled ${fmtDay(s.cancelled_at)}</div>` : ''}</td>
          <td>${attendanceCell(s)}</td>
          <td>${gbp(s.amount_pence)}<div class="muted">${esc(s.payment_status)}${s.refund_issued ? ` · refunded ${gbp(s.refund_amount_pence)}` : ''}</div></td>
          <td>${s.payment_intent_id ? `<a href="https://dashboard.stripe.com/payments/${encodeURIComponent(s.payment_intent_id)}" target="_blank" rel="noopener">Open in Stripe</a>` : '<span class="muted">no payment id</span>'}</td>
          <td>${reviewResolved ? `<div class="detail">${esc(s.review_note)}</div><div class="muted">${fmtDate(s.reviewed_at)}</div>` : '<button class="btn btn-small" data-act="resolve">Record decision</button>'}</td>
        </tr>`).join('')}
      </tbody></table></div>`)
    el.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { reviewResolved = b.dataset.r === '1'; render() })
    el.querySelectorAll('[data-act="resolve"]').forEach((b) => b.onclick = () => {
      const id = b.closest('tr').dataset.id
      confirmInline(b, { text: 'Record the outcome — e.g. "Refunded in full in Stripe: mentor no-show" or "No refund: mentee no-show".', note: 'Decision', noteRequired: true, button: 'Save decision' },
        async (note) => { await api('review_resolve', { id, note }); toast('Decision recorded'); render() })
    })
  })
  render()
}

// ── Completed sessions ───────────────────────────────────────────────────────
function transferCell(s) {
  if (s.payment_status === 'free' || !s.amount_pence) return '<span class="muted">Free session</span>'
  if (s.stripe_flow !== 'platform') return '<span class="muted">Paid at booking (older flow)</span>'
  if (s.transferred_at) return `<span class="pill green">Paid to mentor</span><div class="muted">${gbp(s.mentor_payout_pence)} · ${fmtDay(s.transferred_at)}${s.transfer_id ? ` · <a href="https://dashboard.stripe.com/connect/transfers/${encodeURIComponent(s.transfer_id)}" target="_blank" rel="noopener">transfer</a>` : ''}</div>`
  if (s.transfer_error) return `<span class="pill red">Transfer failed</span><div class="muted">${esc(s.transfer_error)}${s.transfer_attempts ? ` · ${esc(s.transfer_attempts)} attempt${s.transfer_attempts === 1 ? '' : 's'}` : ''}</div>`
  return `<span class="pill amber">Transfer pending</span><div class="muted">${gbp(s.mentor_payout_pence)} due</div>`
}
pages.completed = (main) => {
  const el = frame(main, 'Completed sessions', 'The latest 100 sessions that settled as completed, with the attendance record and whether the mentor has been paid.')
  load(el, 'completed_list', {}, (rows) => {
    el.innerHTML = rows.length === 0 ? '<div class="card state">No completed sessions yet.</div>'
      : `<div class="card table-wrap"><table><thead><tr><th>Session</th><th>Mentor</th><th>Mentee</th><th>Amount</th><th>Attendance (Daily)</th><th>Mentor payout</th></tr></thead><tbody>
        ${rows.map((s) => `<tr>
          <td><b>${fmtDate(s.scheduled_at)}</b><div class="muted">${esc(s.duration_minutes)} min</div></td>
          <td>${esc(s.mentor?.name ?? '—')}</td><td>${esc(s.mentee?.name ?? '—')}</td>
          <td>${s.amount_pence ? gbp(s.amount_pence) : 'Free'}${s.platform_fee_pence ? `<div class="muted">fee ${gbp(s.platform_fee_pence)}</div>` : ''}</td>
          <td>${attendanceCell(s)}</td>
          <td>${transferCell(s)}</td>
        </tr>`).join('')}
      </tbody></table></div>`
  })
}

// ── Mentor waitlist ──────────────────────────────────────────────────────────
pages.waitlist = (main) => {
  const el = frame(main, 'Mentor waitlist', 'People who registered interest in mentoring. Send the ones you want an invite code.')
  load(el, 'waitlist', {}, (rows) => {
    badge('#n-waitlist', rows.length)
    el.innerHTML = rows.length === 0 ? '<div class="card state">No one on the waitlist yet.</div>'
      : `<div class="card table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Source</th><th>Registered</th><th></th></tr></thead><tbody>
        ${rows.map((w) => `<tr><td>${esc(w.name || '—')}</td><td>${esc(w.email)}</td><td class="muted">${esc(w.source || '—')}</td><td class="muted">${fmtDate(w.created_at)}</td>
          <td><button class="btn btn-light btn-small" data-name="${esc(w.name || w.email)}">Create invite</button></td></tr>`).join('')}
      </tbody></table></div>`
    el.querySelectorAll('[data-name]').forEach((b) => b.onclick = () => { pendingInviteNote = `${b.dataset.name} — from waitlist`; go('invites') })
  })
}

// ── Invite codes ─────────────────────────────────────────────────────────────
let pendingInviteNote = ''
pages.invites = (main) => {
  main.innerHTML = `<h1>Invite codes</h1><p class="lead">Mentor signup is invite-only. A code unlocks mentor onboarding for whoever enters it at Welcome → Become a Mentor.</p>
    <div class="card"><form class="row" id="new-invite">
      <label style="flex:2;min-width:200px">Note (who it's for)<input name="note" maxlength="200" placeholder="e.g. Hayley Walker — founding"></label>
      <label style="width:110px">Max uses<input name="max_uses" type="number" min="1" max="100" value="1"></label>
      <label style="width:130px">Valid for (days)<input name="valid_days" type="number" min="1" max="365" value="30"></label>
      <button class="btn" type="submit">Create code</button>
    </form><div class="err" id="invite-err"></div><div id="invite-new"></div></div>
    <div id="body"></div>`
  const form = $('#new-invite'), body = $('#body')
  form.note.value = pendingInviteNote; pendingInviteNote = ''
  form.onsubmit = (e) => {
    e.preventDefault()
    $('#invite-err').textContent = ''
    busy(form.querySelector('button'), async () => {
      try {
        const r = await api('invites_create', { note: form.note.value.trim(), max_uses: Number(form.max_uses.value), valid_days: Number(form.valid_days.value) })
        $('#invite-new').innerHTML = `<p style="margin-top:12px">New code: <span class="code" style="font-size:20px">${esc(r.code)}</span> <button class="btn btn-light btn-small" id="copy" type="button">Copy</button></p>`
        $('#copy').onclick = () => navigator.clipboard?.writeText(r.code).then(() => toast('Copied'), () => toast('Copy it by hand'))
        form.note.value = ''
        list()
      } catch (err) { if (err.message !== 'Signed out') $('#invite-err').textContent = err.message }
    })
  }
  const list = () => load(body, 'invites_list', {}, (rows) => {
    body.innerHTML = rows.length === 0 ? '<div class="card state">No invite codes yet.</div>'
      : `<div class="card table-wrap"><table><thead><tr><th>Code</th><th>Note</th><th>Used</th><th>Expires</th><th>Redeemed by</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map((i) => {
          const expired = i.expires_at && new Date(i.expires_at) < new Date()
          const used = i.uses >= i.max_uses
          const status = i.disabled ? ['Disabled', ''] : expired ? ['Expired', 'amber'] : used ? ['Used up', ''] : ['Active', 'green']
          return `<tr data-code="${esc(i.code)}"><td class="code">${esc(i.code)}</td><td>${esc(i.note || '—')}</td><td>${i.uses} / ${i.max_uses}</td>
            <td class="muted">${i.expires_at ? fmtDay(i.expires_at) : 'never'}</td>
            <td>${i.redeemed_by.length ? i.redeemed_by.map((r) => `${esc(r.name)} <span class="muted">${fmtDay(r.at)}</span>`).join('<br>') : '<span class="muted">—</span>'}</td>
            <td><span class="pill ${status[1]}">${status[0]}</span></td>
            <td><button class="btn btn-light btn-small" data-dis="${i.disabled ? '0' : '1'}">${i.disabled ? 'Enable' : 'Disable'}</button></td></tr>`
        }).join('')}
      </tbody></table></div>`
    body.querySelectorAll('[data-dis]').forEach((b) => b.onclick = () => busy(b, async () => {
      try { await api('invites_set_disabled', { code: b.closest('tr').dataset.code, disabled: b.dataset.dis === '1' }); toast('Saved'); list() }
      catch (e) { if (e.message !== 'Signed out') toast(e.message) }
    }))
  })
  list()
}

// ── Founding badges ──────────────────────────────────────────────────────────
pages.founding = (main) => {
  const el = frame(main, 'Founding badges', 'The founding-mentor badge shows on cards, profiles and share links. Only the server can set it.')
  const render = () => load(el, 'founding_list', {}, (rows) => {
    el.innerHTML = rows.length === 0 ? '<div class="card state">No mentors yet.</div>'
      : `<div class="card"><input id="f-search" placeholder="Search mentors…" style="margin-bottom:12px"><div class="table-wrap"><table><thead><tr><th>Mentor</th><th>Joined</th><th>Sharing</th><th>Badge</th><th></th></tr></thead><tbody>
        ${rows.map((m) => `<tr data-id="${esc(m.id)}" data-name="${esc(m.name || 'this mentor')}" data-search="${esc((m.name || '').toLowerCase())}"><td><b>${esc(m.name || '—')}</b><div class="muted">${esc(m.headline || '')}</div>
            ${m.suspended_at ? '<span class="pill red">Suspended</span>' : !m.is_active ? '<span class="pill">Inactive</span>' : ''}</td>
          <td class="muted">${fmtDay(m.created_at)}</td>
          <td>${m.share_enabled ? '<span class="pill green">On</span>' : '<span class="muted">Off</span>'}</td>
          <td>${m.is_founding_mentor ? '<span class="pill violet">Founding mentor</span>' : '<span class="muted">—</span>'}</td>
          <td><button class="btn ${m.is_founding_mentor ? 'btn-light' : ''} btn-small" data-v="${m.is_founding_mentor ? '0' : '1'}">${m.is_founding_mentor ? 'Remove badge' : 'Grant badge'}</button></td></tr>`).join('')}
      </tbody></table></div></div>`
    const search = $('#f-search', el)
    if (search) search.oninput = () => el.querySelectorAll('tbody tr').forEach((tr) => tr.classList.toggle('hidden', !tr.dataset.search.includes(search.value.toLowerCase())))
    el.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => {
      const tr = b.closest('tr'), grant = b.dataset.v === '1', name = tr.dataset.name
      confirmInline(b, { text: grant ? `Give ${name} the founding-mentor badge?` : `Remove ${name}'s founding-mentor badge?`, button: grant ? 'Grant' : 'Remove' },
        async () => { await api('founding_set', { user_id: tr.dataset.id, value: grant }); toast('Saved'); render() })
    })
  })
  render()
}

// Repeat mentor reliability issues in 90 days — no-shows (from the call
// record) plus cancellations within 48 h — flagged at 2+.
const NO_SHOW_FLAG = 2
const noShowFlag = (noShows = 0, late = 0) => {
  const n = noShows + late
  if (!n) return ''
  const parts = [noShows ? `${noShows} no-show${noShows === 1 ? '' : 's'}` : '', late ? `${late} late cancel${late === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')
  return n >= NO_SHOW_FLAG ? `<span class="pill red" title="Mentor reliability issues in the last 90 days">⚠ ${parts} (90d)</span>` : `<span class="muted">${parts} (90d)</span>`
}
const OUTCOME = { both: ['Both joined', 'green'], mentee_no_show: ['Mentee no-show', 'amber'], mentor_no_show: ['Mentor no-show', 'red'], neither: ['Neither joined', ''], unknown: ['Unclear — check', 'amber'], legacy: ['Before attendance checks', ''] }
const mins = (sec) => sec == null ? '—' : `${Math.round(sec / 60)} min`
function attendanceCell(s) {
  if (!s.attendance_outcome) return '<span class="muted">Not checked yet</span>'
  const [label, cls] = OUTCOME[s.attendance_outcome] || [s.attendance_outcome, '']
  const a = s.attendance || {}
  const detail = a.reason ? esc(a.reason) : `mentor ${mins(a.mentor_seconds)} · mentee ${mins(a.mentee_seconds)} · together ${mins(a.together_seconds)}${a.mentor_late ? ' · mentor joined 15+ min late' : ''}`
  return `<span class="pill ${cls}">${esc(label)}</span><div class="muted">${detail}${a.refund_error ? ` · refund failed: ${esc(a.refund_error)}` : ''}</div>`
}

// ── Users ────────────────────────────────────────────────────────────────────
let userQuery = ''
const ago = (s) => {
  if (!s) return '—'
  const d = (Date.now() - new Date(s).getTime()) / 86400000
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 30 ? `${Math.floor(d)} days ago` : fmtDay(s)
}
const lastActive = (u) => {
  const t = [u.last_seen_at, u.last_sign_in_at].filter(Boolean).sort().pop()
  return t ? ago(t) : '—'
}
pages.users = (main) => {
  main.innerHTML = `<h1>Users</h1><p class="lead">Search by name or email. Open a user to see their details, suspend them, or change their founding badge.</p>
    <div class="card"><input id="u-search" placeholder="Search by name or email…" value="${esc(userQuery)}" autocomplete="off"></div>
    <div id="body"></div>`
  const body = $('#body'), input = $('#u-search')
  let timer = null
  const run = () => load(body, 'users_search', { q: userQuery }, (rows) => {
    body.innerHTML = rows.length === 0 ? `<div class="card state">No users match “${esc(userQuery)}”.</div>`
      : `<div class="card table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Signed up</th><th>Pro</th><th>Founding</th><th>Status</th><th>Last active</th><th>App build</th></tr></thead><tbody>
        ${rows.map((u) => `<tr class="clickable" data-id="${esc(u.id)}">
          <td><b>${esc(u.name || '—')}</b><div class="muted">${esc(u.email || '')}</div></td>
          <td>${esc(u.role || '—')}</td>
          <td class="muted">${fmtDay(u.created_at)}</td>
          <td>${u.is_pro ? '<span class="pill green">Pro</span>' : '<span class="muted">—</span>'}</td>
          <td>${u.is_founding_mentor ? '<span class="pill violet">Founding</span>' : '<span class="muted">—</span>'}</td>
          <td>${u.suspended_at ? '<span class="pill red">Suspended</span>' : u.is_active ? '<span class="muted">Active</span>' : '<span class="pill">Inactive</span>'}${u.role === 'mentor' && (u.mentor_no_shows_90d || u.mentor_late_cancels_90d) ? `<div>${noShowFlag(u.mentor_no_shows_90d || 0, u.mentor_late_cancels_90d || 0)}</div>` : ''}</td>
          <td class="muted">${lastActive(u)}</td>
          <td>${u.last_app_build ? `${esc(u.last_app_version || '')} <span class="muted">(${esc(u.last_app_build)})</span>` : '<span class="muted">—</span>'}</td>
        </tr>`).join('')}
      </tbody></table></div><p class="muted" style="margin-top:8px">${rows.length === 100 ? 'Showing the first 100 — refine your search to narrow it down.' : `${rows.length} user${rows.length === 1 ? '' : 's'}`}</p>`
    body.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => userDetail(main, tr.dataset.id))
  })
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { userQuery = input.value.trim(); run() }, 300) }
  input.focus()
  run()
}
function userDetail(main, id) {
  main.innerHTML = `<button class="back" id="u-back">← All users</button><div id="body"><div class="state">Loading…</div></div>`
  $('#u-back').onclick = () => pages.users(main)
  const body = $('#body')
  const render = () => load(body, 'user_detail', { user_id: id }, (u) => {
    const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`
    const suspended = !!u.suspended_at
    body.innerHTML = `<h1>${esc(u.name || '(no name)')}</h1>
      <p class="lead">${esc(u.email || '')}${u.headline ? ` · ${esc(u.headline)}` : ''}</p>
      <div class="card"><dl class="dl">
        ${row('Role', esc(u.role || '—') + (u.is_onboarded ? '' : ' <span class="pill amber">not onboarded</span>'))}
        ${row('Signed up', fmtDate(u.created_at))}
        ${row('Pro', u.is_pro ? '<span class="pill green">Pro</span>' : 'No')}
        ${u.role === 'mentor' ? row('Founding badge', u.is_founding_mentor ? '<span class="pill violet">Founding mentor</span>' : 'No') : ''}
        ${row('Status', suspended ? `<span class="pill red">Suspended</span> <span class="muted">${fmtDate(u.suspended_at)}${u.suspended_reason ? ' — ' + esc(u.suspended_reason) : ''}</span>` : u.is_active ? 'Active' : 'Inactive')}
        ${row('Last active in the app', u.last_seen_at ? fmtDate(u.last_seen_at) : '—')}
        ${row('Last sign-in', u.last_sign_in_at ? fmtDate(u.last_sign_in_at) : '—')}
        ${row('App build', u.last_app_build ? `${esc(u.last_app_version || '')} (build ${esc(u.last_app_build)}) · ${esc(u.last_app_platform || '')}` : '— <span class="muted">(no stamp yet — builds before 1.1.8’s Oct 29 update don’t report it)</span>')}
        ${u.industry ? row('Industry', esc(u.industry)) : ''}
        ${u.role === 'mentor' ? row('Share link', u.share_enabled && u.share_slug ? `<a href="https://www.orlyo.app/m/${encodeURIComponent(u.share_slug)}/" target="_blank" rel="noopener">orlyo.app/m/${esc(u.share_slug)}</a>` : 'Off') : ''}
        ${u.role === 'mentor' && u.session_rate ? row('Rate', '£' + esc(u.session_rate) + '/hr') : ''}
        ${row('Mentorships', `${u.active_matches} active`)}
        ${row('Sessions', `${u.sessions_completed} completed · ${u.sessions_upcoming} upcoming`)}
        ${row('Reports', `${u.reports_against} against them${u.reports_open_against ? ` (<b>${u.reports_open_against} open</b>)` : ''} · ${u.reports_made} made`)}
        ${u.role === 'mentor' ? row('Reliability', `No-shows: ${u.mentor_no_shows_total} total · ${u.mentor_no_shows_90d} in 90 days<br>Cancelled within 48 h: ${u.mentor_late_cancels_total} total · ${u.mentor_late_cancels_90d} in 90 days<br>${noShowFlag(u.mentor_no_shows_90d, u.mentor_late_cancels_90d)}`) : row('Missed sessions (no-show)', `${u.mentee_no_shows_total}`)}
        ${u.invite_code ? row('Joined with invite', `<span class="code">${esc(u.invite_code)}</span>`) : ''}
        ${row('User ID', `<span class="code" style="font-weight:400">${esc(u.id)}</span>`)}
      </dl></div>
      <div class="card"><div class="actions" id="u-actions">
        ${suspended ? '<button class="btn btn-light" data-act="unsuspend">Unsuspend account</button>' : '<button class="btn btn-danger" data-act="suspend">Suspend account</button>'}
        ${u.role === 'mentor' ? (u.is_founding_mentor ? '<button class="btn btn-light" data-act="revoke">Remove founding badge</button>' : '<button class="btn" data-act="grant">Grant founding badge</button>') : ''}
      </div></div>`
    const name = u.name || 'this account'
    body.querySelectorAll('#u-actions [data-act]').forEach((b) => b.onclick = () => {
      const act = b.dataset.act
      if (act === 'suspend') return confirmInline(b, { text: `Suspend ${name}? Their profile is hidden and they can't sign in until you lift it.`, note: 'Reason (kept in the activity log)', button: 'Suspend', danger: true },
        async (reason) => { await api('user_suspend', { user_id: id, reason }); toast('Account suspended'); render() })
      if (act === 'unsuspend') return confirmInline(b, { text: `Lift the suspension on ${name}?`, button: 'Unsuspend' },
        async () => { await api('user_unsuspend', { user_id: id }); toast('Suspension lifted'); render() })
      const grant = act === 'grant'
      confirmInline(b, { text: grant ? `Give ${name} the founding-mentor badge?` : `Remove ${name}'s founding-mentor badge?`, button: grant ? 'Grant' : 'Remove' },
        async () => { await api('founding_set', { user_id: id, value: grant }); toast('Saved'); render() })
    })
  })
  render()
}

// ── Activity log ─────────────────────────────────────────────────────────────
pages.audit = (main) => {
  const el = frame(main, 'Activity log', 'Every admin action and sign-in attempt (latest 200).')
  load(el, 'audit_list', {}, (rows) => {
    el.innerHTML = rows.length === 0 ? '<div class="card state">Nothing yet.</div>'
      : `<div class="card table-wrap"><table><thead><tr><th>When</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>
        ${rows.map((a) => `<tr><td class="muted">${fmtDate(a.created_at)}</td><td><span class="pill ${a.action === 'login_failed' ? 'red' : ''}">${esc(a.action)}</span></td>
          <td class="code" style="font-weight:400">${esc(a.target || '')}</td><td class="detail muted">${esc(Object.keys(a.details || {}).length ? JSON.stringify(a.details) : '')}</td></tr>`).join('')}
      </tbody></table></div>`
  })
}

// ── Security ─────────────────────────────────────────────────────────────────
pages.security = (main) => {
  const el = frame(main, 'Security', 'Two-step sign-in and admin sessions.')
  load(el, 'security_status', {}, (d) => {
    el.innerHTML = `<div class="card"><h2>Two-step sign-in</h2>
        <p class="lead">${d.enrolledAt ? `On since ${esc(fmtDay(d.enrolledAt))}. ${d.backupLeft} backup code${d.backupLeft === 1 ? '' : 's'} left.` : 'Not set up.'}</p>
        <form id="regen" class="filters" autocomplete="off"><input id="regen-code" inputmode="numeric" placeholder="Current 6-digit code" maxlength="6" required>
          <button class="btn btn-small" type="submit">Make new backup codes</button></form>
        <div id="regen-out"></div><div class="err" id="regen-err"></div></div>
      <div class="card"><h2>Sign out everywhere</h2>
        <p class="lead">Ends every admin session, on every device, including this one.</p>
        <div><button class="btn btn-danger btn-small" id="signout-all">Sign out everywhere</button></div></div>`
    $('#regen', el).addEventListener('submit', async (e) => {
      e.preventDefault()
      $('#regen-err', el).textContent = ''
      try {
        const r = await api('mfa_backup_regenerate', { code: $('#regen-code', el).value.trim() })
        showBackupCodes($('#regen-out', el), r.backupCodes, () => pages.security(main))
      } catch (e) { if (e.message !== 'Signed out') $('#regen-err', el).textContent = e.message }
    })
    $('#signout-all', el).onclick = (e) => confirmInline(e.currentTarget, { text: 'Sign out of every admin session now?', button: 'Sign out everywhere', danger: true },
      async () => { await api('sign_out_all'); signOut('Signed out everywhere.') })
  })
}

// Resume an existing session (the token is checked by the first request).
if (token()) showApp()
