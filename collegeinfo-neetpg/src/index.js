// collegeinfo.neetpg — Cloudflare Worker: private data delivery, username, Razorpay payments.
// Premium is decided ONLY here, from the Supabase `entitlements` table, after verifying the
// caller's Supabase access token. Nothing the browser sends can grant access.

import CSV_TEXT from '../data/all.csv';

const PRICE_PAISE = 100;            // ₹1 — the ONE place the price lives. The frontend never supplies an amount.
const CURRENCY = 'INR';
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const COLS = ['Course', 'State', 'Institute', 'Stipend Year 1', 'Stipend Year 2', 'Stipend Year 3', 'Bond Years', 'Bond Penalty', 'BED'];
const FREE_RE = /^[abc]/i;          // first character of the ORIGINAL institute name, case-insensitive

/* ---------------- dataset (parsed once per isolate) ---------------- */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

let DATA = null;
function dataset() {
  if (DATA) return DATA;
  const raw = parseCsv(CSV_TEXT);
  const header = raw[0].map(h => h.trim().toLowerCase());
  const idx = COLS.map(c => header.indexOf(c.toLowerCase()));
  if (idx.some(i => i < 0)) throw new Error('CSV is missing a required column');
  const seen = new Set(), all = [];
  for (let r = 1; r < raw.length; r++) {
    const line = raw[r];
    if (line.every(x => x.trim() === '')) continue;
    const v = idx.map(i => (line[i] == null ? '' : String(line[i])));
    const key = v.join('\u0001');                    // exact duplicate on every column only
    if (seen.has(key)) continue;
    seen.add(key); all.push(v);
  }
  // Free users: eligible rows in full, every other row becomes `null` (position kept, content NOT sent).
  const free = all.map(v => (FREE_RE.test(v[2]) ? v : null));
  DATA = { premiumJson: JSON.stringify({ premium: true, rows: all }), freeJson: JSON.stringify({ premium: false, rows: free }) };
  return DATA;
}

/* ---------------- helpers ---------------- */
const SEC = { 'X-Content-Type-Options': 'nosniff' };
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC, ...extra } });
const err = (msg, status = 400) => json({ error: msg }, status);

const enc = new TextEncoder();
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  return [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEq(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const missing = (env, names) => names.filter(n => !env[n]);
const sbBase = env => String(env.SUPABASE_URL).trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const q = encodeURIComponent;

/* ---------------- Supabase ---------------- */
// Verifies the token with Supabase Auth itself (never trusts a decoded-but-unchecked JWT).
async function getUser(req, env) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') || '');
  if (!m || missing(env, ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']).length) return null;
  const r = await fetch(sbBase(env) + '/auth/v1/user', { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + m[1] } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && /^[0-9a-f-]{36}$/i.test(u.id || '') ? { id: u.id } : null;
}
// Server-only database access with the secret key (bypasses RLS; the browser never sees this key).
async function db(env, path, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(sbBase(env) + '/rest/v1/' + path, {
    method,
    headers: { apikey: env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { ok: r.ok, status: r.status, data };
}
async function isPremium(env, userId) {
  const r = await db(env, `entitlements?user_id=eq.${q(userId)}&select=premium`);
  if (!r.ok) throw new Error('entitlement lookup failed');
  return Array.isArray(r.data) && r.data.length > 0 && r.data[0].premium === true;
}
async function getUsername(env, userId) {
  const r = await db(env, `profiles?id=eq.${q(userId)}&select=username`);
  if (!r.ok) throw new Error('profile lookup failed');
  return (Array.isArray(r.data) && r.data[0] && r.data[0].username) || null;
}

/* ---------------- Razorpay ---------------- */
const rzAuth = env => 'Basic ' + btoa(env.RAZORPAY_KEY_ID + ':' + env.RAZORPAY_KEY_SECRET);
async function rz(env, path, method = 'GET', body) {
  const r = await fetch('https://api.razorpay.com/v1' + path, {
    method, headers: { Authorization: rzAuth(env), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
}

// Confirms with Razorpay that this payment is real, captured, ₹1, INR and belongs to this order —
// then (idempotently) records it and grants lifetime premium. Used by /api/verify and the webhook.
async function confirmAndGrant(env, { orderId, paymentId, userId }) {
  if (!/^order_[A-Za-z0-9]+$/.test(orderId || '') || !/^pay_[A-Za-z0-9]+$/.test(paymentId || '')) return { ok: false, code: 400, msg: 'Invalid payment reference' };

  const filter = `razorpay_order_id=eq.${q(orderId)}` + (userId ? `&user_id=eq.${q(userId)}` : '');
  const found = await db(env, `payments?${filter}&select=id,user_id,status,amount`);
  if (!found.ok) return { ok: false, code: 500, msg: 'Database error' };
  const row = found.data && found.data[0];
  if (!row) return { ok: false, code: 404, msg: 'Unknown order' };
  if (row.amount !== PRICE_PAISE) return { ok: false, code: 400, msg: 'Order amount mismatch' };

  if (row.status === 'paid') {                       // already processed — never process twice, just make sure access exists
    await db(env, 'entitlements', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: { user_id: row.user_id, premium: true, payment_id: paymentId } });
    return { ok: true, code: 200, already: true };
  }

  let p = await rz(env, '/payments/' + paymentId);
  if (!p.ok || !p.data) return { ok: false, code: 502, msg: 'Could not verify payment with Razorpay' };
  if (p.data.order_id !== orderId || p.data.amount !== PRICE_PAISE || p.data.currency !== CURRENCY) return { ok: false, code: 400, msg: 'Payment does not match the order' };
  if (p.data.status === 'authorized') {              // capture with the enforced amount if the account is on manual capture
    const c = await rz(env, `/payments/${paymentId}/capture`, 'POST', { amount: PRICE_PAISE, currency: CURRENCY });
    if (c.ok && c.data) p = c;
  }
  if (p.data.status === 'failed') { await db(env, `payments?id=eq.${q(row.id)}&status=eq.created`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'failed' } }); return { ok: false, code: 402, msg: 'Payment failed' }; }
  if (p.data.status !== 'captured') return { ok: false, code: 402, msg: 'Payment is not completed yet' };

  const upd = await db(env, `payments?id=eq.${q(row.id)}&status=neq.paid`, { method: 'PATCH', prefer: 'return=representation', body: { status: 'paid', razorpay_payment_id: paymentId, paid_at: new Date().toISOString() } });
  if (!upd.ok) return { ok: false, code: upd.status === 409 ? 409 : 500, msg: upd.status === 409 ? 'This payment was already used' : 'Database error' };
  const ent = await db(env, 'entitlements', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: { user_id: row.user_id, premium: true, payment_id: paymentId } });
  if (!ent.ok) return { ok: false, code: 500, msg: 'Could not record access' };
  return { ok: true, code: 200 };
}

/* ---------------- routes ---------------- */
async function readJson(req) { try { return await req.json(); } catch { return null; } }

async function route(req, env, url) {
  const path = url.pathname, method = req.method;

  if (path === '/api/config' && method === 'GET') {            // only public values
    const miss = missing(env, ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']);
    if (miss.length) return err('Sign-in is not configured yet', 503);
    return json({ supabaseUrl: sbBase(env), supabaseKey: env.SUPABASE_PUBLISHABLE_KEY });
  }

  if (path === '/api/data' && method === 'GET') {
    const d = dataset();
    let premium = false;
    const user = await getUser(req, env);
    if (user && !missing(env, ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']).length) {
      try { premium = await isPremium(env, user.id); } catch (e) { console.error(e); premium = false; }   // fail closed
    }
    return new Response(premium ? d.premiumJson : d.freeJson, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', Vary: 'Authorization', ...SEC } });
  }

  if (missing(env, ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']).length && path !== '/api/webhook') return err('Server is not configured', 503);

  if (path === '/api/me' && method === 'GET') {
    const user = await getUser(req, env); if (!user) return err('Not signed in', 401);
    const [username, premium] = await Promise.all([getUsername(env, user.id), isPremium(env, user.id)]);
    return json({ username, premium });
  }

  if (path === '/api/username' && method === 'POST') {
    const user = await getUser(req, env); if (!user) return err('Not signed in', 401);
    const b = await readJson(req); const name = b && typeof b.username === 'string' ? b.username.trim() : '';
    if (!USERNAME_RE.test(name)) return err('Username must be 3–20 characters: letters, numbers or underscore.');
    if (await getUsername(env, user.id)) return err('Username is already set.', 409);
    const r = await db(env, 'profiles', { method: 'POST', prefer: 'return=minimal', body: { id: user.id, username: name } });
    if (r.status === 409) return err('That username is taken. Please choose another.', 409);
    if (!r.ok) return err('Could not save username', 500);
    return json({ username: name });
  }

  if (path === '/api/order' && method === 'POST') {
    if (missing(env, ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']).length) return err('Payments are not configured', 503);
    const user = await getUser(req, env); if (!user) return err('Not signed in', 401);
    if (!(await getUsername(env, user.id))) return err('Choose a username first.', 400);
    if (await isPremium(env, user.id)) return err('Premium is already active.', 409);
    const receipt = 'rcpt_' + crypto.randomUUID().replace(/-/g, '');
    const o = await rz(env, '/orders', 'POST', { amount: PRICE_PAISE, currency: CURRENCY, receipt, notes: { user_id: user.id } });   // amount is ALWAYS the server constant
    if (!o.ok || !o.data || o.data.amount !== PRICE_PAISE) return err('Could not start payment', 502);
    const ins = await db(env, 'payments', { method: 'POST', prefer: 'return=minimal', body: { user_id: user.id, razorpay_order_id: o.data.id, amount: PRICE_PAISE, currency: CURRENCY, status: 'created' } });
    if (!ins.ok) return err('Could not start payment', 500);
    return json({ orderId: o.data.id, amount: PRICE_PAISE, currency: CURRENCY, keyId: env.RAZORPAY_KEY_ID });
  }

  if (path === '/api/verify' && method === 'POST') {
    if (missing(env, ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']).length) return err('Payments are not configured', 503);
    const user = await getUser(req, env); if (!user) return err('Not signed in', 401);
    const b = await readJson(req) || {};
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = b;
    if (typeof oid !== 'string' || typeof pid !== 'string' || typeof sig !== 'string') return err('Invalid request');
    const expected = await hmacHex(env.RAZORPAY_KEY_SECRET, oid + '|' + pid);
    if (!safeEq(expected, sig)) return err('Payment signature is invalid', 400);
    const res = await confirmAndGrant(env, { orderId: oid, paymentId: pid, userId: user.id });
    if (!res.ok) return err(res.msg, res.code);
    return json({ premium: true });
  }

  if (path === '/api/webhook' && method === 'POST') {          // backup path: works even if the user closes the tab
    if (missing(env, ['RAZORPAY_WEBHOOK_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY']).length) return err('Not configured', 503);
    const raw = await req.text();
    const expected = await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, raw);
    if (!safeEq(expected, req.headers.get('X-Razorpay-Signature') || '')) return err('Bad signature', 400);
    let ev; try { ev = JSON.parse(raw); } catch { return err('Bad body', 400); }
    const pay = ev && ev.payload && ev.payload.payment && ev.payload.payment.entity;
    if (!pay) return json({ ok: true });
    if (ev.event === 'payment.captured' || ev.event === 'order.paid') {
      const res = await confirmAndGrant(env, { orderId: pay.order_id, paymentId: pay.id, userId: null });
      if (!res.ok && res.code >= 500) return err('Retry', 500);       // transient: let Razorpay retry
    } else if (ev.event === 'payment.failed' && /^order_/.test(pay.order_id || '')) {
      await db(env, `payments?razorpay_order_id=eq.${q(pay.order_id)}&status=eq.created`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'failed' } });
    }
    return json({ ok: true });
  }

  return err('Not found', 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try { return await route(req, env, url); }
    catch (e) { console.error(e); return err('Server error', 500); }
  },
};
