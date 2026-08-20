const BASE = "https://sheets.googleapis.com/v4/spreadsheets";


/**
 * Универсальный запрос к Google Sheets API
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
    } catch (_) {}

    throw new Error(message);
  }


  if (response.status === 204) {
    return null;
  }


  return response.json();
}



/**
 * Читаем таблицу
 */
export async function readValues({
  spreadsheetId,
  sheetName,
  token
}) {


  // ЖЁСТКО задаём лист для проверки
  const range = "ОБЪЕКТЫ!A1:O1000";


  console.log("READ RANGE:", range);


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
 * Массовое обновление
 */
export async function batchUpdateRanges({
  spreadsheetId,
  token,
  data
}) {


  if (!data || !data.length) {
    return null;
  }


  const url =
    `${BASE}/${encodeURIComponent(spreadsheetId)}` +
    `/values:batchUpdate`;


  const fixedData = data.map(item => ({
    ...item,
    range: item.range.replace(
      /^'?ОБЪЕКТЫ'?/,
      "ОБЪЕКТЫ"
    )
  }));


  return googleFetch(
    url,
    token,
    {
      method: "POST",

      body: JSON.stringify({

        valueInputOption: "USER_ENTERED",

        data: fixedData

      })
    }
  );
}



/**
 * Обновление строки
 */
export async function updateRow({
  spreadsheetId,
  token,
  rowNumber,
  values
}) {


  const range =
    `ОБЪЕКТЫ!A${rowNumber}:O${rowNumber}`;


  const url =
    `${BASE}/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}` +
    `?valueInputOption=USER_ENTERED`;


  return googleFetch(
    url,
    token,
    {

      method: "PUT",

      body: JSON.stringify({

        range,

        majorDimension: "ROWS",

        values: [
          values
        ]

      })

    }
  );
}



/**
 * Добавление строки
 */
export async function appendRow({
  spreadsheetId,
  token,
  values
}) {


  const range =
    "ОБЪЕКТЫ!A1:O1000";


  const url =
    `${BASE}/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}` +
    `:append?valueInputOption=USER_ENTERED` +
    `&insertDataOption=INSERT_ROWS`;


  return googleFetch(
    url,
    token,
    {

      method: "POST",

      body: JSON.stringify({

        range,

        majorDimension: "ROWS",

        values: [
          values
        ]

      })

    }
  );
}
