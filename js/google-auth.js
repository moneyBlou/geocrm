const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

let tokenClient = null;
let accessToken = "";
let tokenExpiresAt = 0;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForGIS(timeout = 12000) {
  const started = Date.now();
  while (!window.google?.accounts?.oauth2) {
    if (Date.now() - started > timeout) {
      throw new Error("Google Identity Services не загрузился. Проверь интернет или блокировщик рекламы.");
    }
    await wait(100);
  }
}

export async function initGoogleAuth(clientId) {
  await waitForGIS();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SHEETS_SCOPE,
    callback: () => {}
  });
}

export async function requestAccessToken() {
  if (!tokenClient) throw new Error("Google OAuth ещё не инициализирован.");

  return new Promise((resolve, reject) => {
    tokenClient.callback = response => {
      if (response?.error) {
        reject(new Error(response.error_description || response.error));
        return;
      }

      accessToken = response.access_token;
      const expiresIn = Number(response.expires_in || 3600);
      tokenExpiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
      resolve(accessToken);
    };

    tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
  });
}

export function getAccessToken() {
  if (!accessToken || Date.now() >= tokenExpiresAt) return "";
  return accessToken;
}

export function hasAccessToken() {
  return Boolean(getAccessToken());
}

export function clearAccessToken() {
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    try { window.google.accounts.oauth2.revoke(accessToken, () => {}); } catch (_) {}
  }
  accessToken = "";
  tokenExpiresAt = 0;
}
