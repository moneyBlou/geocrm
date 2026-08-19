const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/**
 * Безопасно оборачивает имя листа в одинарные кавычки.
 *
 * Например:
 * ОБЪЕКТЫ -> 'ОБЪЕКТЫ'
 */
function quoteSheetName(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

/**
 * Создаёт корректный A1-диапазон.
 *
 * Например:
 * makeRange("ОБЪЕКТЫ", "A1:O")
 * -> 'ОБЪЕКТЫ'!A1:O
 */
function makeRange(sheetName, range) {
  return `${quoteSheetName(sheetName)}!${range}`;
}

/**
 * На случай batchUpdate:
 * автоматически исправляет диапазон вида:
 *
 * ОБЪЕКТЫ!A2:O2
 *
 * на:
 *
 * 'ОБЪЕКТЫ'!A2:O2
 */
function normalizeRange(range) {
  if (!range || typeof range !== "string") {
    return range;
  }

  const separatorIndex = range.indexOf("!");

  if (separatorIndex === -1) {
    return range;
  }

  const rawSheetName = range.slice(0, separatorIndex);
  const cellRange = range.slice(separatorIndex + 1);

  // Если имя листа уже заключено в кавычки,
  // ничего повторно не делаем.
  if (
    rawSheetName.startsWith("'") &&
    rawSheetName.endsWith("'")
  ) {
    return range;
  }

  return makeRange(rawSheetName, cellRange);
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
      // Если Google вернул не JSON,
      // оставляем HTTP-ошибку как есть.
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

/**
 * Читает все данные A:O с первой строки.
 */
export async function readValues({
  spreadsheetId,
  sheetName,
  token
}) {
  const range = makeRange(sheetName, "A1:O");

  const url =
    `${BASE}/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}`;

  const result = await googleFetch(url, token);

  return result.values || [];
}

/**
 * Массово обновляет несколько диапазонов.
 */
export async function batchUpdateRanges({
  spreadsheetId,
  token,
  data
}) {
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  // Нормализуем диапазоны, чтобы кириллическое
  // имя листа тоже всегда было в кавычках.
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
 * Полностью обновляет одну строку A:O.
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
      values: [values]
    })
  });
}

/**
 * Добавляет новую строку в конец таблицы.
 */
export async function appendRow({
  spreadsheetId,
  sheetName,
  token,
  values
}) {
  const range = makeRange(sheetName, "A:O");

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
      values: [values]
    })
  });
}
