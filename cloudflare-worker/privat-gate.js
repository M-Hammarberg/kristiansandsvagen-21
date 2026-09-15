/*
 * ═══════════════════════════════════════════════════════════════
 *  KV21 — Privat-grind (Cloudflare Worker)
 * ═══════════════════════════════════════════════════════════════
 *
 *  Vad den gör:
 *   1. Ger två API-endpoints (/privat-api/unlock, /privat-api/lock)
 *      som verifierar koden SERVER-SIDE och sätter/rensar en
 *      signerad, httpOnly session-cookie. Koden ligger aldrig i
 *      webbläsaren eller i repot — bara i Cloudflares krypterade
 *      variabler.
 *   2. För alla HTML-sidor under /privat* : om besökaren INTE har
 *      en giltig session, plockas den hemliga datan
 *      (<script id="private-data">) bort innan svaret ens når
 *      webbläsaren. Med giltig session injiceras en liten
 *      <meta name="kv21-authed"> i <head> som sidans egen kod
 *      läser av för att veta att den är upplåst.
 *   3. Allt annat (huvudsidan, /teamaktivitet, bilder, osv) skickas
 *      vidare helt oförändrat.
 *
 *  Krävs (sätts som ENCRYPTED environment variables i Cloudflare-
 *  dashboarden — Workers & Pages → den här workern → Settings →
 *  Variables and Secrets):
 *
 *    PRIVAT_CODE    — den riktiga koden, t.ex. "7391" (byt bort
 *                     från "2121" som legat i klartext i repot!)
 *    COOKIE_SECRET  — en lång slumpad sträng, t.ex. från
 *                     `openssl rand -hex 32` i terminalen.
 *                     Används bara för att signera cookien —
 *                     ändra den när som helst för att logga ut alla.
 *
 *  INGET av det här committas med riktiga värden — de finns bara i
 *  Cloudflares krypterade variabel-lager.
 * ═══════════════════════════════════════════════════════════════
 */

const COOKIE_NAME = 'kv21_session';
const SESSION_HOURS = 24 * 14; // 14 dagar innan man behöver ange koden igen

function b64url(bytes) {
  let bin = '';
  new Uint8Array(bytes).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64url(sig);
}

async function makeSessionCookie(env) {
  const expiry = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = String(expiry);
  const sig = await hmac(env.COOKIE_SECRET, payload);
  const value = `${payload}.${sig}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function isAuthed(request, env) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp(COOKIE_NAME + '=([^;]+)'));
  if (!match) return false;
  const [payload, sig] = match[1].split('.');
  if (!payload || !sig) return false;
  const expected = await hmac(env.COOKIE_SECRET, payload);
  // Konstant-tid-ish jämförelse räcker här — låg hotbild, familjesida
  if (expected !== sig) return false;
  return Number(payload) > Date.now();
}

function json(data, init) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init && init.headers) },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── API: lås upp ──
    if (url.pathname === '/privat-api/unlock' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      if (typeof body.code === 'string' && body.code === env.PRIVAT_CODE) {
        return json({ ok: true }, { headers: { 'Set-Cookie': await makeSessionCookie(env) } });
      }
      return json({ ok: false }, { status: 401 });
    }

    // ── API: lås (logga ut) ──
    if (url.pathname === '/privat-api/lock' && request.method === 'POST') {
      return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } });
    }

    // ── Skyddade sidor under /privat ──
    if (url.pathname === '/privat' || url.pathname.startsWith('/privat/')) {
      const response = await fetch(request);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) return response;

      const authed = await isAuthed(request, env);
      const rewriter = new HTMLRewriter();

      if (!authed) {
        // Ta bort hemlig data innan den ens når webbläsaren
        rewriter.on('script#private-data', { element(el) { el.remove(); } });
      } else {
        // Signalera till sidans egen JS att sessionen är giltig
        rewriter.on('head', {
          element(el) { el.append('<meta name="kv21-authed" content="1">', { html: true }); },
        });
      }

      return rewriter.transform(response);
    }

    // ── Allt annat — helt oförändrat ──
    return fetch(request);
  },
};
