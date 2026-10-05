/** Owner status comes only from the auth server; no local tier or URL bypass. */
const listeners = new Set();
let owner = null;
let expiryTimer;
let googleScript;
let sessionRequest = 0;

function config() {
  return globalThis.window?.APP_CONFIG || {};
}

export function ownerSignInConfigured() {
  const { OWNER_AUTH_BASE_URL, GOOGLE_CLIENT_ID } = config();
  try {
    return Boolean(GOOGLE_CLIENT_ID && new URL(OWNER_AUTH_BASE_URL).protocol === "https:");
  } catch { return false; }
}

function updateOwner(value) {
  const previous = owner;
  owner = value;
  clearTimeout(expiryTimer);
  if (owner) {
    expiryTimer = setTimeout(() => updateOwner(null), Math.max(0, owner.expiresAt - Date.now()));
    expiryTimer.unref?.();
  }
  if (previous?.expiresAt !== owner?.expiresAt || previous?.email !== owner?.email) {
    listeners.forEach(listener => listener(owner));
  }
}

export function hasOwnerAccess() {
  return Boolean(owner && owner.expiresAt > Date.now());
}

export function onOwnerSessionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function authRequest(path, { method = "GET", body } = {}) {
  if (!ownerSignInConfigured()) throw new Error("Owner sign-in is being set up.");
  const response = await fetch(new URL(path, config().OWNER_AUTH_BASE_URL), {
    method, credentials: "include", cache: "no-store",
    signal: AbortSignal.timeout(10000),
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Owner sign-in failed. Please try again.");
  return data;
}

export async function restoreOwnerSession() {
  if (!ownerSignInConfigured()) return false;
  const request = ++sessionRequest;
  try {
    const data = await authRequest("/owner/session");
    if (data.owner !== true || typeof data.email !== "string" || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) throw new Error("Session expired");
    if (request !== sessionRequest) return hasOwnerAccess();
    updateOwner({ email: data.email, expiresAt: data.expiresAt });
    return true;
  } catch {
    if (request === sessionRequest) updateOwner(null);
    return false;
  }
}

export async function signOutOwner() {
  // Do not claim to sign out while the server cookie is still usable.
  await authRequest("/owner/logout", { method: "POST" });
  sessionRequest++;
  globalThis.google?.accounts?.id?.disableAutoSelect();
  updateOwner(null);
}

function loadGoogleSignIn() {
  if (globalThis.google?.accounts?.id) return Promise.resolve();
  if (googleScript) return googleScript;
  googleScript = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    const timeout = setTimeout(() => { script.remove(); reject(new Error("Google sign-in could not load. Please try again.")); }, 10000);
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error("Google sign-in could not load. Please try again.")); };
    document.head.append(script);
  }).catch(error => { googleScript = null; throw error; });
  return googleScript;
}

/** Google loads only when someone opens Owner access. */
export function wireOwnerLogin(container) {
  const details = container?.querySelector("[data-owner-login]");
  if (!details) return;
  const status = details.querySelector("[data-owner-status]");
  const mount = details.querySelector("[data-owner-google]");
  const retry = details.querySelector("[data-owner-retry]");
  let loading = false;
  let ready = false;
  async function start() {
    if (!details.open || loading || ready || !ownerSignInConfigured()) return;
    loading = true;
    retry.hidden = true;
    status.textContent = "Loading Google sign-in…";
    try {
      const challenge = await authRequest("/owner/challenge", { method: "POST" });
      await loadGoogleSignIn();
      if (!details.isConnected) return;
      google.accounts.id.initialize({
        client_id: config().GOOGLE_CLIENT_ID,
        nonce: challenge.nonce,
        auto_select: false,
        callback: async result => {
          status.textContent = "Verifying owner access…";
          try {
            await authRequest("/owner/session", { method: "POST", body: { credential: result.credential } });
            if (!await restoreOwnerSession()) throw new Error("Could not confirm owner access. Check that cookies are enabled.");
          } catch (error) {
            status.textContent = error.message;
            ready = false;
            mount.replaceChildren();
            retry.hidden = false;
          }
        },
      });
      google.accounts.id.renderButton(mount, { theme: "outline", size: "large", text: "continue_with", width: 240 });
      ready = true;
      status.textContent = "Use the approved owner Google account to unlock Caddies.";
    } catch (error) {
      status.textContent = error.message;
      retry.hidden = false;
    } finally { loading = false; }
  }
  details.addEventListener("toggle", start);
  retry.addEventListener("click", start);
}

export function renderOwnerLogin() {
  return `<details class="fw-owner-login" data-owner-login>
    <summary>Owner access</summary>
    <p data-owner-status role="status">${ownerSignInConfigured() ? "Sign in with your approved Google account to use Caddies." : "Owner sign-in is being set up."}</p>
    <div data-owner-google></div>
    <button type="button" class="fw-btn fw-btn-secondary" data-owner-retry hidden>Retry Google sign-in</button>
  </details>`;
}

export function renderOwnerControls() {
  return hasOwnerAccess() ? `<div class="fw-owner-controls"><span>Owner access</span><button type="button" class="fw-btn-text" data-owner-signout>Sign out</button><p data-owner-signout-status role="status"></p></div>` : "";
}

export function wireOwnerControls(container) {
  const button = container?.querySelector("[data-owner-signout]");
  button?.addEventListener("click", async () => {
    button.disabled = true;
    try { await signOutOwner(); }
    catch { container.querySelector("[data-owner-signout-status]").textContent = "Could not sign out. Check your connection and try again."; button.disabled = false; }
  });
}
