const BASE = "https://sheets.googleapis.com/v4/spreadsheets";


/**
 * Создаёт корректный диапазон Google Sheets.
 *
 * Пример:
 * ОБЪЕКТЫ + A1:O5000
 * превращается в:
 * ОБЪЕКТЫ!A1:O5000
 */
function makeRange(sheetName, range) {
  return `${sheetName}!${range}`;
}


/**
 * Нормализует диапазоны для batchUpdate.
 *
 * ОБЪЕКТЫ!A2:O2
 * остаётся ОБЪЕКТЫ!A2:O2
 */
function normalizeRange(range) {
  if (!range || typeof range !== "string") {
    return range;
  }

  return range;
}


/**
 * Универсальный запрос к Google Sheets API.
 */
async function googleFetch(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });


  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;

    try {
      const data = await response.json();
      message = data?.error?.message || message;
    } catch (_) {
    }

    throw new Error(message);
  }


  if (response.status === 204) {
    return null;
  }


  return response.json();
}



/**
 * Читает таблицу A:O.
 *
 * Используем фиксированный диапазон,
 * потому что Google Sheets API стабильнее
 * работает с A1:O5000.
 */
export async function readValues({
  spreadsheetId,
  sheetName,
  token
}) {

  const range = makeRange(
    sheetName,
    "A1:O5000"
  );


  console.log(
    "Google Sheets range:",
    range
  );


  const url =
    `${BASE}/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}`;


  const result = await googleFetch(
    url,
    token
  );


  return result.values || [];
}



/**
 * Массовое обновление диапазонов.
 */
export async function batchUpdateRanges({
  spreadsheetId,
  token,
  data
}) {

  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }


  const normalizedData = data.map(item => ({
    ...item,
    range: normalizeRange(item.range)
  }));


  const url =
    `${BASE}/${encodeURIComponent(spreadsheetId)}` +
    `/values:batchUpdate`;


  return googleFetch(url, token, {

    method: "POST",

    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: normalizedData
    })

  });
}



/**
 * Полностью обновляет строку A:O.
 */
export async function updateRow({
  spreadsheetId,
  sheetName,
  token,
  rowNumber,
  values
}) {

  const range = makeRange(
    sheetName,
    `A${rowNumber}:O${rowNumber}`
  );


  const url =
    `${BASE}/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}` +
    `?valueInputOption=USER_ENTERED`;


  return googleFetch(url, token, {

    method: "PUT",

    body: JSON.stringify({

      range,

      majorDimension: "ROWS",

      values: [
        values
      ]

    })

  });
}



/**
 * Добавляет новую строку.
 */
export async function appendRow({
  spreadsheetId,
  sheetName,
  token,
  values
}) {

  const range = makeRange(
    sheetName,
    "A1:O5000"
  );


  const url =
    `${BASE}/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}` +
    `:append` +
    `?valueInputOption=USER_ENTERED` +
    `&insertDataOption=INSERT_ROWS`;


  return googleFetch(url, token, {

    method: "POST",

    body: JSON.stringify({

      range,

      majorDimension: "ROWS",

      values: [
        values
      ]

    })

  });
}
