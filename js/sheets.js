const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

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

  if (response.status === 204) return null;
  return response.json();
}

export async function readValues({ spreadsheetId, sheetName, token }) {
  const range = `${sheetName}!A1:O`;
  const url = `${BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  const result = await googleFetch(url, token);
  return result.values || [];
}

export async function batchUpdateRanges({ spreadsheetId, token, data }) {
  if (!data.length) return null;
  const url = `${BASE}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`;
  return googleFetch(url, token, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data })
  });
}

export async function updateRow({ spreadsheetId, sheetName, token, rowNumber, values }) {
  const range = `${sheetName}!A${rowNumber}:O${rowNumber}`;
  const url = `${BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  return googleFetch(url, token, {
    method: "PUT",
    body: JSON.stringify({ range, majorDimension: "ROWS", values: [values] })
  });
}

export async function appendRow({ spreadsheetId, sheetName, token, values }) {
  const range = `${sheetName}!A:O`;
  const url = `${BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  return googleFetch(url, token, {
    method: "POST",
    body: JSON.stringify({ values: [values] })
  });
}
