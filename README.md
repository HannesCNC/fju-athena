# FJU Athena V1 — RichLab

This package gives you:

- `/athena/index.html` — public **Ask Athena** page for `richlab.online/athena/`
- `/athena/admin.html` — private update page for `richlab.online/athena/admin.html`
- `server.js` — small Node/Express API for Railway
- `athena-knowledge.json` — starter knowledge base, using curated FJU/course/student information (no phone numbers)
- `richlab-door-snippet.html` — one-button link to add to the RichLab home page

## 1. Railway backend

Create a new Railway service from these backend files (or merge the routes into the existing RichLab backend later). Set:

- `OPENAI_API_KEY` = your server-side OpenAI API key
- `OPENAI_MODEL` = `gpt-5-mini` (or another model you choose)
- `ATHENA_ADMIN_KEY` = a long private password
- `ALLOWED_ORIGINS` = `https://richlab.online,https://www.richlab.online`
- `ATHENA_DATA_PATH` = `/data/athena-knowledge.json`

Attach a Railway persistent volume mounted at `/data`. Copy the starter `athena-knowledge.json` there on first deployment, or temporarily omit `ATHENA_DATA_PATH` for a code-bundled read-only test.

## 2. Point the webpages at Railway

In both `athena/index.html` and `athena/admin.html`, replace:

`https://YOUR-ATHENA-BACKEND.up.railway.app`

with the live Railway service URL.

## 3. Upload to RichLab

In cPanel File Manager, create `public_html/athena/` and upload:

- `athena/index.html`
- `athena/admin.html`

Then `https://richlab.online/athena/` is the public page.

## 4. Add the RichLab door

Use the snippet in `richlab-door-snippet.html`, or add a normal button linking to `/athena/`.

## 5. Updating information

Open `https://richlab.online/athena/admin.html`, enter the admin key, and add a quick update. Mark the source accurately: Official FJU, Course material, Lecture notes, or Student WhatsApp report.

Athena ranks official information above student reports and exposes the source type/date in the answer.

## Safety / privacy rule for the prototype

Do not upload the raw student WhatsApp export to the public website. Curate useful facts into Athena and avoid names/phone numbers unless there is a legitimate need and permission.

## What this proves

V1 answers one question: can a student ask a practical FJU question in plain language and get a short, sourced answer without searching the whole platform?
