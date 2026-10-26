// Generates the public founding-mentor pages: m/<slug>/index.html for every
// active mentor who has turned sharing on, plus m/config.mjs and 404.html.
// Runs in the "Mentor pages" GitHub Action (hourly, on demand, and on a
// repository_dispatch). Node 20+, no dependencies.
//
//   SUPABASE_URL       secret   e.g. https://<ref>.supabase.co
//   SUPABASE_ANON_KEY  secret   the public anon key (the same one the app ships)
//   APP_STORE_ID       variable numeric App Store id (optional until known)
//
// Data comes only from get_public_mentors() — the agreed public fields for
// mentors who opted in. Static HTML matters because link previews (iMessage,
// WhatsApp, LinkedIn) read og: tags without running JavaScript.
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { esc, renderMentor } from '../m/render.mjs'

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || ''
const APP_STORE_ID = (process.env.APP_STORE_ID || '').trim()
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('SUPABASE_URL and SUPABASE_ANON_KEY are required')
  process.exit(1)
}
const SITE = 'https://www.orlyo.app'
const APP_STORE_URL = /^\d+$/.test(APP_STORE_ID) ? `https://apps.apple.com/app/id${APP_STORE_ID}` : ''

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">'
const HEADER = '<header class="top"><a class="wordmark" href="/">orlyo</a></header>'
const FOOTER = '<footer><a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a><a href="/support.html">Support</a></footer>'

function mentorPage(m) {
  const url = `${SITE}/m/${m.slug}`
  const title = `${m.name} — mentor on Orlyo`
  const description = m.headline ? `${m.headline}. Connect with ${m.name} on Orlyo.` : `Connect with ${m.name} on Orlyo.`
  const banner = APP_STORE_ID ? `<meta name="apple-itunes-app" content="app-id=${esc(APP_STORE_ID)}, app-argument=${esc(url)}">` : ''
  const image = m.photo_url ? `<meta property="og:image" content="${esc(m.photo_url)}"><meta name="twitter:image" content="${esc(m.photo_url)}">` : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="Orlyo">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
${image}
<meta name="twitter:card" content="${m.photo_url ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${banner}
${FONTS}
<link rel="stylesheet" href="/m/mentor.css">
</head>
<body>
${HEADER}
<main id="mentor">${renderMentor(m, { appStoreUrl: APP_STORE_URL, appUrl: `orlyo://m/${m.slug}` })}</main>
${FOOTER}
<script type="module">
  import { hydrate } from '/m/page.mjs'
  hydrate(${JSON.stringify(m.slug)}, document.getElementById('mentor'))
</script>
</body>
</html>
`
}

// GitHub Pages serves this for any missing path. /m/<slug> that hasn't been
// generated yet (sharing turned on since the last run) is rendered client-side;
// anything else gets a plain not-found page.
function notFoundPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orlyo</title>
${FONTS}
<link rel="stylesheet" href="/m/mentor.css">
</head>
<body>
${HEADER}
<main id="mentor">
  <article class="card card-empty">
    <h1>Page not found</h1>
    <p class="bio">We couldn't find that page.</p>
    <a class="btn btn-secondary" href="/">Go to orlyo.app</a>
  </article>
</main>
${FOOTER}
<script type="module">
  import { hydrate, slugFromPath } from '/m/page.mjs'
  const slug = slugFromPath()
  if (slug) hydrate(slug, document.getElementById('mentor'))
</script>
</body>
</html>
`
}

const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_mentors`, {
  method: 'POST',
  headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
  body: '{}',
})
if (!res.ok) {
  console.error(`get_public_mentors failed: HTTP ${res.status} ${await res.text()}`)
  process.exit(1)
}
const mentors = (await res.json()).filter((m) => /^[a-z0-9-]+$/.test(m.slug || ''))

const live = new Set(mentors.map((m) => m.slug))
for (const entry of await readdir('m', { withFileTypes: true })) {
  if (entry.isDirectory() && !live.has(entry.name)) await rm(join('m', entry.name), { recursive: true, force: true })
}
for (const m of mentors) {
  await mkdir(join('m', m.slug), { recursive: true })
  await writeFile(join('m', m.slug, 'index.html'), mentorPage(m))
}
await writeFile('m/config.mjs', `// Generated by scripts/build-mentor-pages.mjs. The anon key is public by design
// (it ships inside the app); it can only call the public mentor functions here.
export const SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)}
export const SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)}
export const APP_STORE_URL = ${JSON.stringify(APP_STORE_URL)}
`)
await writeFile('404.html', notFoundPage())
console.log(`Generated ${mentors.length} mentor page(s): ${[...live].join(', ') || '(none)'}`)
