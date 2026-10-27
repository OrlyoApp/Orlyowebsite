// Branded link-preview image for a mentor page: 1200×630 JPEG (what iMessage,
// WhatsApp, LinkedIn and X expect), well under WhatsApp's ~300 KB limit.
// Photo, name, headline, founding badge, Orlyo branding. Rendered from SVG
// with resvg (bundled fonts, no system fonts, so CI and a laptop match), then
// encoded with sharp.
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'

const W = 1200
const H = 630
const FONT_DIR = fileURLToPath(new URL('./fonts/', import.meta.url))
// Note: the bundled DM Sans static files name their family 'DM Sans 9pt'.
const FONT_FILES = ['CormorantGaramond-Bold.ttf', 'DMSans-400.ttf', 'DMSans-500.ttf', 'DMSans-700.ttf'].map((f) => FONT_DIR + f)

// Bump when the design changes so every image (and its cache-busting ?v=) is redone.
const DESIGN_VERSION = 2

const C = { bg: '#E9F4EC', navy: '#1B2833', grey: '#5F6B63', mint: '#5BC87A', violet: '#4C03FF', violetLight: '#EDE0FF', white: '#FFFFFF' }

const xml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Fingerprint of everything the image shows — unchanged inputs skip the render.
export function ogHash(m) {
  return createHash('sha256')
    .update(JSON.stringify([DESIGN_VERSION, m.name, m.headline, m.photo_url, !!m.is_founding_mentor]))
    .digest('hex')
    .slice(0, 12)
}

// resvg has no text layout, so wrap by an average glyph width (DM Sans ≈ 0.5em,
// Cormorant ≈ 0.45em) and ellipsise past maxLines.
function wrap(text, fontSize, maxWidth, maxLines, em) {
  const perLine = Math.max(8, Math.floor(maxWidth / (fontSize * em)))
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (next.length <= perLine) { line = next; continue }
    if (line) lines.push(line)
    line = w.length > perLine ? w.slice(0, perLine - 1) + '…' : w
    if (lines.length === maxLines) break
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1]
    lines[maxLines - 1] = (last.length >= perLine ? last.slice(0, perLine - 1) : last).replace(/[\s,.;:–-]+$/, '') + '…'
  }
  return lines
}

const initials = (name) => String(name || '?').split(/\s+/).map((p) => p[0] || '').join('').slice(0, 2).toUpperCase()

async function photoDataUri(url) {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const jpg = await sharp(buf).rotate().resize(640, 640, { fit: 'cover', position: 'attention' }).jpeg({ quality: 86 }).toBuffer()
    return `data:image/jpeg;base64,${jpg.toString('base64')}`
  } catch {
    return null
  }
}

const RIBBON = 'M12 2a6 6 0 0 0-3.2 11.07L7 22l5-3 5 3-1.8-8.93A6 6 0 0 0 12 2Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z'

export async function renderOgImage(m) {
  const photo = await photoDataUri(m.photo_url)
  const founding = !!m.is_founding_mentor

  // Photo: 320px circle, left column.
  const cx = 250
  const cy = 300
  const r = 160
  const ring = founding ? C.violet : C.white
  const photoSvg = photo
    ? `<clipPath id="circle"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
       <image href="${photo}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#circle)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.mint}"/>
       <text x="${cx}" y="${cy + 36}" text-anchor="middle" font-family="DM Sans 9pt" font-weight="700" font-size="104" fill="${C.white}">${xml(initials(m.name))}</text>`

  // Text column.
  const tx = 480
  const textWidth = W - tx - 70
  const nameSize = m.name.length > 22 ? 64 : 78
  const nameLines = wrap(m.name, nameSize, textWidth, 2, 0.45)
  const headSize = 32
  const headLines = wrap(m.headline, headSize, textWidth, 2, 0.5)

  const blockH = nameLines.length * nameSize * 1.02 + (headLines.length ? 18 + headLines.length * headSize * 1.3 : 0) + (founding ? 76 : 0)
  let y = Math.round(cy - blockH / 2) + 6

  const parts = []
  if (founding) {
    const bw = 262
    parts.push(`<rect x="${tx}" y="${y}" width="${bw}" height="50" rx="25" fill="${C.violetLight}"/>
      <path d="${RIBBON}" fill="${C.violet}" transform="translate(${tx + 20} ${y + 12}) scale(1.08)"/>
      <text x="${tx + 54}" y="${y + 33}" font-family="DM Sans 9pt" font-weight="700" font-size="22" fill="${C.violet}" letter-spacing="0.4">Founding mentor</text>`)
    y += 76
  }
  for (const line of nameLines) {
    y += nameSize * 0.82
    parts.push(`<text x="${tx}" y="${y}" font-family="Cormorant Garamond" font-weight="700" font-size="${nameSize}" fill="${C.navy}">${xml(line)}</text>`)
    y += nameSize * 0.2
  }
  if (headLines.length) {
    y += 18
    for (const line of headLines) {
      y += headSize
      parts.push(`<text x="${tx}" y="${y}" font-family="DM Sans 9pt" font-weight="400" font-size="${headSize}" fill="${C.grey}">${xml(line)}</text>`)
      y += headSize * 0.3
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <circle cx="${W - 40}" cy="40" r="210" fill="${C.mint}" opacity="0.16"/>
  <circle cx="${cx}" cy="${cy}" r="${r + 12}" fill="${ring}"/>
  ${photoSvg}
  ${parts.join('\n  ')}
  <rect x="0" y="${H - 84}" width="${W}" height="84" fill="${C.navy}"/>
  <text x="70" y="${H - 28}" font-family="Cormorant Garamond" font-weight="700" font-size="50" fill="${C.white}">orlyo</text>
  <text x="${W - 70}" y="${H - 34}" text-anchor="end" font-family="DM Sans 9pt" font-weight="500" font-size="26" fill="${C.white}">Connect with ${xml(m.name.split(' ')[0])} on Orlyo</text>
</svg>`

  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'DM Sans 9pt' },
  }).render().asPng()
  return sharp(png).jpeg({ quality: 84, mozjpeg: true }).toBuffer()
}

// Local preview: node scripts/og-image.mjs '<json of a get_public_mentors row>' out.jpg
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2]) {
  const { writeFile } = await import('node:fs/promises')
  const out = await renderOgImage(JSON.parse(process.argv[2]))
  await writeFile(process.argv[3] || 'og-preview.jpg', out)
  console.log(`${out.length} bytes`)
}
