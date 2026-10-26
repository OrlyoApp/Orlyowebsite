// Browser: refresh a mentor page with live data (sharing may have been turned
// off, or details edited, since the static page was generated), and render
// /m/<slug> from scratch for the 404.html fallback (a mentor who turned
// sharing on after the last generator run).
import { renderMentor, renderUnavailable, wireCopy } from '/m/render.mjs'
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_STORE_URL } from '/m/config.mjs'

export function slugFromPath(pathname = location.pathname) {
  const m = pathname.match(/^\/m\/([a-z0-9-]+)\/?$/i)
  return m ? m[1].toLowerCase() : null
}

export async function fetchMentor(slug) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_mentor`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_slug: slug }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const rows = await res.json()
  return rows[0] ?? null
}

export async function hydrate(slug, container) {
  wireCopy(container)
  try {
    const mentor = await fetchMentor(slug)
    container.innerHTML = mentor
      ? renderMentor(mentor, { appStoreUrl: APP_STORE_URL, appUrl: `orlyo://m/${slug}` })
      : renderUnavailable()
    if (mentor) document.title = `${mentor.name} — mentor on Orlyo`
    wireCopy(container)
  } catch {
    // Network trouble: keep the static content (if any) as it is.
  }
}
