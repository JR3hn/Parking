const SHEET_NAME = "Data";
const SCANS_SHEET_NAME = "Scans";
const RATE_LIMIT_MAX = 20; // per minut
const SCAN_BATCH_MAX = 200; // max regnr per scan-sändning
const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿÅÄÖåäö '-]{1,50}$/;
const GROUP_RE = /^[A-Za-zÀ-ÖØ-öø-ÿÅÄÖåäö0-9 '-]{1,50}$/;
const PHONE_RE = /^'?[0-9+\-\s()]{6,20}$/;
const REGNR_RE = /^[A-ZÅÄÖ0-9]{2,8}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

// ingen doGet, sidan ska bara kunna skriva, inte läsa listan

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["Timestamp", "Förnamn", "Efternamn", "Telefon", "Regnr", "Slutdatum", "Grupp"]);
  }
  return sheet;
}

function getScansSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SCANS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SCANS_SHEET_NAME);
    sheet.appendRow(["Timestamp", "Regnr", "Skannad (klient)"]);
  }
  return sheet;
}

// tvingar text istället för formel om värdet börjar med = + - @
function sanitizeText_(str) {
  if (/^[=+\-@]/.test(str)) return "'" + str;
  return str;
}

function checkRateLimit_() {
  const cache = CacheService.getScriptCache();
  const key = "rl_" + Math.floor(Date.now() / 60000);
  const count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), 120);
  if (count > RATE_LIMIT_MAX) {
    throw new Error("För många förfrågningar, försök igen om en liten stund");
  }
}

// loggar skannade regnr i egen flik, läser inte/matchar inte mot Data-fliken
function handleScanBatch_(data) {
  const plates = Array.isArray(data.plates) ? data.plates : [];
  if (plates.length === 0) throw new Error("Tom lista");
  if (plates.length > SCAN_BATCH_MAX) throw new Error("För många regnr i en sändning");

  const rows = [];
  let skipped = 0;
  plates.forEach((p) => {
    const regnr = String((p && p.regnr) || "").trim().toUpperCase();
    const ts = String((p && p.ts) || "");
    if (!REGNR_RE.test(regnr) || !ISO_DATE_RE.test(ts)) {
      skipped++;
      return;
    }
    rows.push([new Date(), sanitizeText_(regnr), ts]);
  });

  if (rows.length === 0) throw new Error("Inga giltiga regnr i listan");

  const sheet = getScansSheet_();
  sheet
    .getRange(sheet.getLastRow() + 1, 1, rows.length, 3)
    .setValues(rows);

  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, saved: rows.length, skipped: skipped })
  ).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    lock.waitLock(5000);
    lockAcquired = true;
    checkRateLimit_();

    const data = JSON.parse(e.postData.contents);

    if (data.action === "scan_batch") {
      return handleScanBatch_(data);
    }

    // bot brukar fylla i honeypot-fältet, riktiga users ser det aldrig
    if (String(data.website || "").trim() !== "") {
      return ContentService.createTextOutput(JSON.stringify({ ok: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const fornamn = String(data.fornamn || "").trim();
    const efternamn = String(data.efternamn || "").trim();
    const telefon = String(data.telefon || "").trim();
    const regnr = String(data.regnr || "").trim().toUpperCase();
    const slutdatum = String(data.slutdatum || "").trim();
    const grupp = String(data.grupp || "").trim();

    if (!NAME_RE.test(fornamn)) throw new Error("Ogiltigt förnamn");
    if (!NAME_RE.test(efternamn)) throw new Error("Ogiltigt efternamn");
    if (!PHONE_RE.test(telefon)) throw new Error("Ogiltigt telefonnummer");
    if (!REGNR_RE.test(regnr)) throw new Error("Ogiltigt regnummer");
    if (!DATE_RE.test(slutdatum) || isNaN(new Date(slutdatum).getTime())) throw new Error("Ogiltigt slutdatum");
    if (!GROUP_RE.test(grupp)) throw new Error("Ogiltig grupp");

    const sheet = getSheet_();
    sheet.appendRow([
      new Date(),
      sanitizeText_(fornamn),
      sanitizeText_(efternamn),
      telefon,
      sanitizeText_(regnr),
      slutdatum,
      sanitizeText_(grupp),
    ]);

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}
