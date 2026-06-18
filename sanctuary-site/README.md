# Sanctuary Barber Co — website

A standalone marketing site for Sanctuary Barber Co, built in the **Studio** theme
(editorial black & white) so it matches the Vero app. No build step — plain HTML, CSS,
and vanilla JS. Open it anywhere.

## Files

| File | What it is |
|------|------------|
| `index.html` | The website (hero, services, announcements, gallery, about, reviews, visit). |
| `styles.css` | Studio theme — palette + Fraunces/Jost type mirrored from the app. |
| `data.js` | The announcements **store** — the single source of truth for posts + banner. |
| `main.js` | Site behavior: renders announcements, banner, nav, scroll reveals. |
| `admin.html` / `admin.js` | The "post an announcement" editor (linked from the footer). |

## Run it locally

```bash
cd sanctuary-site
python3 -m http.server 4321
# open http://localhost:4321
```

- The site is at `/` (`index.html`).
- The editor is at `/admin.html` (also linked in the footer as "Manage announcements").
- Post something in the editor, then refresh the site — it shows up in **What's new**
  and (optionally) in the top banner.

## Posting announcements

Open `admin.html`. You can:
- Toggle and write the **top banner** message.
- **Publish** a new announcement (title, message, tag, date, pin-to-top).
- **Edit / pin / delete** existing ones.

## Adding real photos

The grey hatched blocks (`.ph`) are placeholders. To use real images, replace each
placeholder `<div class="ph">…</div>` with `<img src="images/your-photo.jpg" alt="…">`
(create an `images/` folder). The hero, gallery, and about photos are all marked.

## Going live (shared announcements for every visitor)

Today, posts are saved to the **browser's localStorage** so the full post→appear loop
works with zero backend. That means a post is only visible in the browser it was made in.

To make posts visible to **everyone**, point the store at Supabase (already used by Vero).
Only two functions in `data.js` change — `read()` and `write()` — to call a tiny
`announcements` table. The website and editor code stay identical. Ask Claude to "wire
the announcements store to Supabase" and it'll do the table + the swap.

## Hosting

Static files — deploy the `sanctuary-site/` folder to Vercel, Netlify, or Cloudflare
Pages. The **Book** buttons currently point at a placeholder; swap their `href` for your
MangoMint booking link now, and your Vero booking link later.
