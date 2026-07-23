const SHEET_NAME = "Data";
const RATE_LIMIT_MAX = 20; // per minut
const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿÅÄÖåäö '-]{1,50}$/;
const GROUP_RE = /^[A-Za-zÀ-ÖØ-öø-ÿÅÄÖåäö0-9 '-]{1,50}$/;
const PHONE_RE = /^'?[0-9+\-\s()]{6,20}$/;
const REGNR_RE = /^[A-ZÅÄÖ0-9]{2,8}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function doPost(e) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    lock.waitLock(5000);
    lockAcquired = true;
    checkRateLimit_();

    const data = JSON.parse(e.postData.contents);

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
