# Parkeringsregistrering

Static site för users: fyll i namn, telefon, regnr, slutdatum, grupp → sparas i Google Sheets via Apps Script.
Sidan är write-only för users, ingen ser listan. Endast admin ser/hanterar data direkt i Google Sheets.

## Setup

1. Skapa nytt Google Sheet.
2. Extensions → Apps Script. Klistra in innehåll från `apps-script/Code.gs`.
3. Deploy → New deployment → Type: **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Kopiera web app-URL (slutar på `/exec`).
5. Klistra in URL i `config.js` (`SCRIPT_URL`).
6. Pusha till GitHub, aktivera GitHub Pages (Settings → Pages → branch `main` / root).

## Filer

- `index.html` — sida (form only, ingen lista)
- `style.css` — styling
- `app.js` — POST ny rad mot Apps Script
- `config.js` — din SCRIPT_URL (enda som behöver ändras)
- `apps-script/Code.gs` — backend-kod, klistras i Google Sheets Apps Script-editor

## Säkerhet

- Server-side validation (regex) på alla fält i `doPost` — junk/skadad data avvisas.
- Formula/CSV-injection-skydd — värden som börjar med `= + - @` sparas som text, inte formel.
- Honeypot-fält (`website`, dolt via CSS) — enkla bottar fyller i det, request ignoreras tyst.
- Rate limit — max 20 requests/minut globalt (CacheService), över det avvisas med felmeddelande.
- `LockService` — förhindrar race condition vid samtidiga skrivningar.
- Detta stoppar naiv bot-spam och enkel injection.

## Notera

- Endast `doPost` finns i backend, ingen `doGet` som läcker data. Vem som helst med URL kan bara *skriva*, inte läsa.
- Admin ser/hanterar alla registreringar direkt i Google Sheets (kräver inloggning på det Google-kontot).
- Uppdaterar du `apps-script/Code.gs` i editorn: kräver ny deployment-version (Deploy → Manage deployments → Edit → New version) för att gå igenom.
