// Renders a public mentor profile. Shared by the page generator (Node) and the
// browser (fresh data on load, and the /m/ fallback in 404.html), so every
// path shows exactly the same thing.
//
// Input is exactly what get_public_mentor() returns (Orlyo migrations 063/064).
// Only real, mentor-provided facts — no counts, ratings, views or activity.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const firstName = (name) => String(name || 'this mentor').trim().split(/\s+/)[0]

const RIBBON = '<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a6 6 0 0 0-3.2 11.07L7 22l5-3 5 3-1.8-8.93A6 6 0 0 0 12 2Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/></svg>'

export function initials(name) {
  return String(name || '?').split(/\s+/).map((p) => p[0] || '').join('').slice(0, 2).toUpperCase()
}

// opts: { appStoreUrl, appUrl }  — appUrl is the custom-scheme deep link.
export function renderMentor(m, opts = {}) {
  const first = esc(firstName(m.name))
  const photo = m.photo_url
    ? `<img class="photo" src="${esc(m.photo_url)}" alt="${esc(m.name)}" width="104" height="104">`
    : `<div class="photo photo-fallback" aria-hidden="true">${esc(initials(m.name))}</div>`
  const pills = [
    m.industry ? `<span class="pill">${esc(m.industry)}</span>` : '',
    m.session_rate ? `<span class="pill">£${esc(m.session_rate)}/hr</span>` : '',
    m.offers_free_session ? '<span class="pill pill-green">First session free</span>' : '',
  ].join('')
  const skills = (m.skills || []).map((s) => `<span class="chip">${esc(s)}</span>`).join('')
  const status = m.accepting_mentees
    ? '<p class="status">Currently accepting mentees</p>'
    : '<p class="status status-off">Not taking new mentees right now</p>'

  const storeBtn = opts.appStoreUrl
    ? `<a class="btn btn-primary" href="${esc(opts.appStoreUrl)}">Get Orlyo on the App Store</a>`
    : ''
  const codeBox = m.code
    ? `<div class="code-box">
         <p class="code-label">New to Orlyo? After installing, enter ${first}'s mentor code when you sign up:</p>
         <div class="code-row"><span class="code" id="mentor-code">${esc(m.code)}</span>
         <button class="btn-copy" type="button" data-copy="${esc(m.code)}">Copy</button></div>
       </div>`
    : ''

  return `
  <article class="card">
    <div class="hero">
      ${photo}
      <h1>${esc(m.name)}</h1>
      ${m.headline ? `<p class="headline">${esc(m.headline)}</p>` : ''}
      ${m.is_founding_mentor ? `<span class="badge">${RIBBON} Founding mentor</span>` : ''}
    </div>
    ${pills ? `<div class="pills">${pills}</div>` : ''}
    ${status}
    ${m.bio ? `<h2>About</h2><p class="bio">${esc(m.bio)}</p>` : ''}
    ${skills ? `<h2>Areas of expertise</h2><div class="chips">${skills}</div>` : ''}
  </article>
  <section class="cta">
    <h2 class="cta-title">Connect with ${first} on Orlyo</h2>
    ${storeBtn}
    ${opts.appUrl ? `<a class="btn btn-secondary" href="${esc(opts.appUrl)}">Already have the app? Open ${first}'s profile</a>` : ''}
    ${codeBox}
  </section>`
}

export function renderUnavailable() {
  return `
  <article class="card card-empty">
    <h1>This profile isn't available</h1>
    <p class="bio">The mentor may have turned off sharing, or the link may be mistyped.</p>
    <a class="btn btn-secondary" href="/">Go to orlyo.app</a>
  </article>`
}

// Browser only: wire the "Copy" button.
export function wireCopy(root = document) {
  root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied' } catch { /* ignore */ }
  }))
}
