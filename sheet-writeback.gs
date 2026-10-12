/**
 * Zamówienia PRO -> Google Sheets
 * Docelowy arkusz: zakładka gid 912478609 w arkuszu przekazanym przez Marcina.
 * Wymaga wdrożenia jako aplikacja internetowa uruchamiana jako właściciel.
 */
const SPREADSHEET_ID = "1wZwM-4EELaQclFgPc0QO6WXj6N1Ixt28ikCKOqzZdLA";
const TARGET_SHEET_GID = 912478609;

// Uruchom ręcznie jeden raz z edytora Apps Script. Token nie jest zapisany
// w pliku ani w publicznym repozytorium; pojawi się w dzienniku wykonania.
function initializeWriteToken() {
  const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  PropertiesService.getScriptProperties().setProperty("WRITE_TOKEN", token);
  console.log("Token aplikacji Zamówienia PRO: " + token);
  return token;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const expectedToken = PropertiesService.getScriptProperties().getProperty("WRITE_TOKEN");
    if (!expectedToken || body.token !== expectedToken) return output_({ ok: false, error: "unauthorized" });
    if (Number(body.gid) !== TARGET_SHEET_GID) return output_({ ok: false, error: "wrong_sheet" });

    const p = body.product || {};
    const name = clean_(p.name);
    const category = clean_(p.category);
    if (!name || !category) return output_({ ok: false, error: "missing_name_or_category" });

    lock.waitLock(10000);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheets().find(s => s.getSheetId() === TARGET_SHEET_GID);
    if (!sheet) throw new Error("Target tab not found");

    const columns = ensureColumns_(sheet, ["name", "category", "sections", "barcode"]);
    const lastRow = sheet.getLastRow();
    let targetRow = 0;
    if (lastRow >= 2) {
      const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        if (key_(row[columns.name - 1]) === key_(name) && key_(row[columns.category - 1]) === key_(category)) {
          targetRow = i + 2;
          break;
        }
      }
    }
    if (!targetRow) targetRow = Math.max(2, lastRow + 1);

    const old = targetRow <= lastRow ? sheet.getRange(targetRow, 1, 1, sheet.getLastColumn()).getValues()[0] : new Array(sheet.getLastColumn()).fill("");
    const sections = Array.isArray(p.sections) ? p.sections.join(";") : clean_(p.sections);
    const barcode = clean_(p.barcode);
    const row = old.slice();
    row[columns.name - 1] = name;
    row[columns.category - 1] = category;
    row[columns.sections - 1] = sections || old[columns.sections - 1] || "";
    row[columns.barcode - 1] = barcode || old[columns.barcode - 1] || "";
    sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
    return output_({ ok: true, action: targetRow <= lastRow ? "updated" : "added" });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return output_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function ensureColumns_(sheet, required) {
  let lastColumn = Math.max(1, sheet.getLastColumn());
  let headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  if (headers.every(value => !clean_(value))) {
    sheet.getRange(1, 1, 1, required.length).setValues([required]);
    return Object.fromEntries(required.map((name, index) => [name, index + 1]));
  }
  const positions = {};
  for (let i = 0; i < headers.length; i++) {
    const h = clean_(headers[i]).toLowerCase();
    if (required.includes(h) && !positions[h]) positions[h] = i + 1;
  }
  for (const name of required) {
    if (!positions[name]) {
      lastColumn++;
      sheet.getRange(1, lastColumn).setValue(name);
      positions[name] = lastColumn;
    }
  }
  return positions;
}

function clean_(value) { return String(value == null ? "" : value).replace(/\s+/g, " ").trim(); }
function key_(value) { return clean_(value).toLocaleLowerCase("pl-PL"); }
function output_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
