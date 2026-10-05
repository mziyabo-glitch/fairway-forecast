# Owner access to Caddies

Use **Continue with Google** to sign in as **mziyabo@gmail.com**. Google sign-in opens Google's account chooser; it is not an emailed magic link. Only the approved owner gets Caddies access. All weather and round-planning features remain free.

The UI and authentication Worker are implemented. Login stays disabled until the Google client and Worker are configured and deployed.

## Create the Google web client

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) in your Google Cloud project. Configure the application name, contact email, and consent screen. If the app is in testing, add `mziyabo@gmail.com` as a test user.
2. Create an OAuth client with application type **Web application**. Add these **Authorized JavaScript origins**:
   - `https://www.fairwayweather.com`
   - `https://fairwayweather.com`
3. Copy the client ID ending in `.apps.googleusercontent.com`. This implementation uses the Google Identity Services JavaScript callback, so it needs no OAuth redirect URI or Google client secret.

## Deploy the authentication Worker

This is a separate Worker from the weather API. The site itself is static; adding a server file to GitHub Pages does not run it.

From the repository's `workers` directory, use the Cloudflare account that manages `fairwayweather.com`:

```sh
cd workers
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put OWNER_EMAIL
npx wrangler secret put SESSION_SECRET
npx wrangler deploy
```

Enter the Google web client ID for `GOOGLE_CLIENT_ID`, `mziyabo@gmail.com` for `OWNER_EMAIL`, and a cryptographically random secret of at least 32 characters for `SESSION_SECRET`. Keep the session secret out of source control and browser configuration. `wrangler.toml` creates the custom Worker domain `auth.fairwayweather.com`; the zone must be in the deploying Cloudflare account.

Use that custom subdomain. The production website and authentication service must share the same site so the Secure, HttpOnly, SameSite=Strict session cookie works without relying on third-party cookies. A `workers.dev` URL is not a substitute for this configuration.

## Enable the sign-in button

Set these public values in `dev/config.js` (used by both production and preview):

```js
OWNER_AUTH_BASE_URL: "https://auth.fairwayweather.com",
GOOGLE_CLIENT_ID: "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com",
```

Deploy the site changes. Open **Caddies → Owner access → Continue with Google** and choose `mziyabo@gmail.com`. Owner status is restored through the server when the page reloads. Both `/caddie` and `/wind`, including their `/dev` versions, use the same owner session. Choose **Sign out** to clear the server cookie; access also expires after at most one hour.

The Worker verifies Google's RSA signature and key ID, issuer, audience, expiry, verified email and sign-in nonce. It then matches the configured owner email and issues its own signed session. The Google ID token and session token are never stored in localStorage or exposed by the session response. Query parameters and legacy premium tiers cannot unlock Caddies.

Optionally set `OWNER_GOOGLE_SUB` to pin the owner's stable Google account ID. That setting is required for non-Gmail, non-Workspace Google accounts. Rotating `SESSION_SECRET` invalidates all existing owner sessions. Sign-out clears the browser's cookie; there is no server-side session database.

This protects the normal website login flow. The Caddie JavaScript and calculations are still public static assets; this is not a payment backend or a server-enforced paywall for those calculations.

## Validation before activating

- The owner account opens both Caddie views, survives reload, and returns to the premium gate on sign-out.
- A different Google account remains locked; expired or invalid identities do not unlock access.
- Course forecasts, saving rounds, society planning and the other free tools continue to work without login.

Automated checks: `npm test` includes cryptographic Google identity and owner-session regressions. Live Google login requires the deployed service and a real client ID.

References: [Google token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [Google JavaScript API](https://developers.google.com/identity/gsi/web/reference/js-reference).
