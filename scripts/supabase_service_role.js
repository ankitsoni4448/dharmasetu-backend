function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function describeSupabaseKey(key = '') {
  if (!key) return { valid: false, kind: 'missing', reason: 'missing' };
  if (key.startsWith('sb_secret_')) return { valid: true, kind: 'service_role_secret' };
  if (key.startsWith('sb_publishable_')) {
    return { valid: false, kind: 'publishable', reason: 'publishable keys cannot bypass RLS' };
  }

  const payload = decodeJwtPayload(key);
  if (payload?.role === 'service_role') return { valid: true, kind: 'service_role_jwt' };
  if (payload?.role === 'anon') return { valid: false, kind: 'anon_jwt', reason: 'anon keys cannot write RLS-protected tables' };
  return { valid: false, kind: 'unknown', reason: 'not recognized as a Supabase service role key' };
}

function getSupabaseServiceRoleKey({ required = true, allowLegacyServiceKey = true } = {}) {
  const explicit = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const legacy = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  const key = explicit || (allowLegacyServiceKey ? legacy : '');
  const source = explicit ? 'SUPABASE_SERVICE_ROLE_KEY' : (legacy ? 'SUPABASE_SERVICE_KEY' : '');
  const info = describeSupabaseKey(key);

  if (!info.valid) {
    if (!required && !key) return { key: '', source: '', info };
    const hint = source
      ? `${source} is ${info.kind}: ${info.reason}. Set SUPABASE_SERVICE_ROLE_KEY to the backend-only service_role key.`
      : 'SUPABASE_SERVICE_ROLE_KEY is required for backend ingestion.';
    throw new Error(hint);
  }

  return { key, source, info };
}

module.exports = {
  describeSupabaseKey,
  getSupabaseServiceRoleKey,
};
