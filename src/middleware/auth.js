const authService = require('../services/authService');
const { settings } = require('../lib/db');

const crypto = require('crypto');
const { collections } = require('../lib/db');

async function getUserFromApiKey(req) {
  try {
    let raw = '';
    const auth = req.headers && req.headers.authorization ? String(req.headers.authorization) : '';
    if (auth.toLowerCase().startsWith('bearer ')) raw = auth.slice(7).trim();
    if (!raw && req.headers && req.headers['x-api-key']) raw = String(req.headers['x-api-key']).trim();
    if (!raw || (!raw.startsWith('vp_') && !raw.startsWith('vpk_'))) return null;
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    let doc = await collections.api_keys.findOne({ key_hash: hash }).catch(()=>null);
    if (!doc) doc = await collections.api_keys.findOne({ key: raw }).catch(()=>null);
    if (!doc) return null;
    if (doc.revoked_at || doc.revoked) return null;
    if (doc.expires_at && new Date(doc.expires_at) < new Date()) return null;
    const user = await authService.findById(Number(doc.user_id || doc.owner_id));
    if (!user || user.is_banned || user.suspended) return null;
    collections.api_keys.updateOne({ id: doc.id }, { $set: { last_used_at: new Date().toISOString() } }).catch(()=>{});
    user.api_key = { id: doc.id, scopes: doc.scopes || [], name: doc.name };
    return user;
  } catch (_) { return null; }
}

async function getUserFromReq(req) {
  const apiUser = await getUserFromApiKey(req);
  if (apiUser) return apiUser;
  const candidates = [];
  if (req.headers && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    const t = req.headers.authorization.slice(7).trim();
    if (t && t !== 'undefined' && t !== 'null' && t !== '[object Object]') candidates.push(t);
  }
  if (req.cookies && req.cookies.token) {
    const raw = String(req.cookies.token).trim();
    let t = raw;
    try { t = decodeURIComponent(raw); } catch (_) {}
    if (t && t !== 'undefined' && t !== 'null' && t !== '[object Object]') candidates.push(t);
  }
  if (req.query && req.query.token) {
    const raw = String(req.query.token).trim();
    let t = raw;
    try { t = decodeURIComponent(raw); } catch (_) {}
    if (t && t !== 'undefined' && t !== 'null' && t !== '[object Object]') candidates.push(t);
  }

  let user = null;
  for (const token of candidates) {
    try {
      const payload = authService.verifyToken(token);
      if (!payload || !payload.sub) continue;
      const found = await authService.findById(Number(payload.sub));
      if (found) {
        if (found.is_banned) continue;
        if (found.suspended) {
          if (found.suspended_until && new Date(found.suspended_until) <= new Date()) {
            await authService.updateUser(found.id, { suspended: false, suspended_until: null, suspension_reason: null }).catch(() => {});
            found.suspended = 0;
          } else {
            continue;
          }
        }
        user = found;
        break;
      }
    } catch (_) {}
  }

  if (user && req.cookies && req.cookies.vpanel_impersonate_admin) {
    try {
      const adminToken = String(req.cookies.vpanel_impersonate_admin).trim();
      const adminPayload = authService.verifyToken(adminToken);
      if (adminPayload && adminPayload.sub) {
        const adminUser = await authService.findById(Number(adminPayload.sub));
        if (adminUser && (adminUser.role === 'admin' || adminUser.root_admin)) {
          user.is_impersonating = true;
          user.impersonated_by = adminUser.username;
          user.impersonator_id = adminUser.id;
        }
      }
    } catch (_) {}
  }
  return user;
}

async function requireAuth(req, res, next) {
  try {
    const user = await getUserFromReq(req);
    if (!user) {
      if (req.xhr || req.path.startsWith('/api') || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      return res.redirect('/login');
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

async function optionalAuth(req, res, next) {
  try {
    req.user = await getUserFromReq(req);
    next();
  } catch (err) {
    next(err);
  }
}

async function requireAdmin(req, res, next) {
  try {
    const user = req.user || (await getUserFromReq(req));
    if (!user) {
      if (req.xhr || req.path.startsWith('/api') || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      return res.redirect('/login');
    }
    if (user.role !== 'admin' && !user.root_admin) {
      if (req.xhr || req.path.startsWith('/api') || req.headers.accept?.includes('application/json')) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      return res.status(403).render('error/403', { code: 403, title: 'Forbidden', message: 'You do not have permission to access this page.', settings: settings.all(), user });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

async function apiAuth(req, res, next) {
  try {
    const user = await getUserFromReq(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

async function apiAdmin(req, res, next) {
  try {
    const user = await getUserFromReq(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (user.role !== 'admin' && !user.root_admin) return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, optionalAuth, requireAdmin, apiAuth, apiAdmin, getUserFromReq };
