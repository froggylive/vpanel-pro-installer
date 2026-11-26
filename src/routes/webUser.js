const express = require('express');
const qrcode = require('qrcode');
const { collections, getNextId, settings } = require('../lib/db');
const vmService = require('../services/vmService');
const bootLogService = require('../services/bootLogService');
const backupService = require('../services/backupService');
const authService = require('../services/authService');
const activity = require('../services/activityService');
const resourceService = require('../services/resourceService');
const { requireAuth } = require('../middleware/auth');
const { uploadAvatar } = require('../middleware/upload');

const router = express.Router();
function col(name){ return collections[name] || { find:()=>({sort:()=>({limit:()=>({toArray:async()=>[]}),toArray:async()=>[]}),toArray:async()=>[]}), insertOne:async()=>null, updateOne:async()=>null, deleteOne:async()=>null, countDocuments:async()=>0 }; }

router.use(requireAuth);

function render(res, view, vars = {}) {
  res.render(`user/${view}`, { user: res.req.user, settings: settings.all(), ...vars });
}
function renderErr(res, code, title, message) {
  return res.status(code).render('error/404', { code, title, message, settings: settings.all(), user: res.req.user });
}
async function myVms(user) {
  const owned = await col('vms').find({ owner_id: Number(user.id) }).sort({ id: -1 }).toArray();
  const subDocs = await col('subusers').find({ user_id: Number(user.id) }).toArray();
  const subIds = subDocs.map(s => Number(s.vm_id));
  const shared = subIds.length ? await col('vms').find({ id: { $in: subIds } }).toArray() : [];
  const map = new Map();
  [...owned, ...shared].forEach(v => map.set(Number(v.id), vmService.serializeVm(v)));
  return [...map.values()];
}
async function loadVm(req, res, next) {
  try {
    const vm = await vmService.getVm(parseInt(req.params.id, 10));
    if (!vm || !(await vmService.canAccess(req.user, vm))) return renderErr(res, 404, 'Not Found', 'VDS not found or no access.');
    const owner = await col('users').findOne({ id: Number(vm.owner_id) });
    if (owner) { vm.owner_name = owner.username; vm.owner_email = owner.email; }
    req.vm = vm;
    next();
  } catch (e) { next(e); }
}
function vmStats(vm) {
  const s = vmService.liveStats(vm);
  return { ...s, status: vm.status, name: vm.name, id: vm.id };
}

// Dashboard
router.get('/dashboard', async (req, res, next) => {
  try {
    const vms = await myVms(req.user);
    const stats = {
      total: vms.length,
      running: vms.filter(v => v.status === 'running').length,
      stopped: vms.filter(v => !['running','suspended'].includes(v.status)).length,
      suspended: vms.filter(v => v.status === 'suspended').length,
    };
    const resources = await resourceService.userResourceUsage(req.user.id).catch(() => null);
    const recent = vms.slice(0, 8);
    render(res, 'dashboard', { activePage: 'dashboard', vms, stats, resources, recent });
  } catch (e) { next(e); }
});

// VDS list
router.get(['/servers','/vds'], async (req, res, next) => {
  try {
    const vms = await myVms(req.user);
    const filter = String(req.query.filter || 'all');
    const q = String(req.query.q || '').toLowerCase();
    render(res, 'servers', { activePage: 'servers', vms, filter, q });
  } catch (e) { next(e); }
});

router.get(['/create-server','/create-vds'], (req,res)=> res.redirect('/servers?notice=admin-only'));

router.post(['/create-server','/create-vds'], (req,res)=> res.status(403).json({error:'Server creation is managed by administrators.'}));

// VDS details + tabs
async function serverPage(req, res, next, tab) {
  try {
    const backups = await backupService.listForVm(req.vm.id).catch(() => []);
    const logs = await activity.listActivity({ vm_id: req.vm.id, limit: 100 }).catch(() => []);
    const recent = logs.slice(0, 15);
    const sshKeys = await (col('ssh_keys')?col('ssh_keys').find({ user_id: Number(req.user.id) }):{sort:()=>({toArray:async()=>[]})}).sort({ id: -1 }).toArray().catch(() => []);
    const vars = { activePage: `server.${tab}`, currentVm: req.vm, vm: req.vm, tab, backups, logs, recent, sshKeys, stats: vmStats(req.vm), osList: vmService.getOsList(), network: { ip: req.vm.ssh_port ? `127.0.0.1:${req.vm.ssh_port}` : '—' } };
    const fs = require('fs');
    const path = require('path');
    const standalone = path.join(__dirname, '..', '..', 'views', 'user', 'server', `${tab}.ejs`);
    const tabbed = path.join(__dirname, '..', '..', 'views', 'user', 'server', 'tabs', `${tab}.ejs`);
    if (tab === 'overview' && fs.existsSync(standalone)) return res.render('user/server/overview', { user: req.user, settings: settings.all(), ...vars });
    if (fs.existsSync(tabbed)) return res.render('user/server/detail', { user: req.user, settings: settings.all(), ...vars });
    if (fs.existsSync(standalone)) return res.render(`user/server/${tab}`, { user: req.user, settings: settings.all(), ...vars });
    return res.render('user/server/detail', { user: req.user, settings: settings.all(), ...vars });
  } catch (e) { next(e); }
}
['overview','console','resources','networking','storage','backups','snapshots','firewall','settings','activity'].forEach(tab => {
  router.get(`/server/:id/${tab}`, loadVm, (req,res,next)=>serverPage(req,res,next,tab));
  router.get(`/vds/:id/${tab}`, loadVm, (req,res,next)=>res.redirect(`/server/${req.params.id}/${tab}`));
});
router.get(['/server/:id','/servers/:id','/vds/:id'], loadVm, (req,res,next)=>serverPage(req,res,next,'overview'));
router.get(['/server/:id/status','/vds/:id/status'], loadVm, (req, res) => { const s = vmStats(req.vm); res.json({ ok: true, stats: s, ...s }); });


async function powerAction(req, res) {
  const action = req.body.action;
  try {
    if (action === 'start') await vmService.start(req.vm, { user: req.user });
    else if (action === 'stop' || action === 'shutdown') await vmService.stop(req.vm, { user: req.user });
    else if (action === 'kill') await vmService.stop(req.vm, { user: req.user, force: true });
    else if (action === 'restart') await vmService.restart(req.vm, req.user);
    else return res.status(400).json({ error: 'Unknown action' });
    res.json({ ok: true, status: (await vmService.getVm(req.vm.id)).status });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
router.post(['/server/:id/power','/servers/:id/power','/vds/:id/power'], loadVm, express.json(), powerAction);

router.post(['/server/:id/reinstall','/vds/:id/reinstall'], loadVm, express.json(), async (req,res)=>{
  try { await vmService.reinstall(req.vm, { os: req.body.os, user: req.user }); res.json({ ok: true }); }
  catch(e){ res.status(500).json({ error: e.message }); }
});

router.post(['/server/:id/settings','/vds/:id/settings'], loadVm, express.json(), async (req,res)=>{
  try {
    const allowed = ['cpu_model','hostname','start_on_boot','notes','startup_command'];
    const data = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    const vm = await vmService.update(req.vm, data, req.user);
    res.json({ ok: true, vm: vmService.serializeVm(vm) });
  } catch(e){ res.status(500).json({ error: e.message }); }
});


// Backups
router.post(['/server/:id/backups/create','/servers/:id/backups'], loadVm, express.json(), async (req,res)=>{
  try { const backup = await backupService.createBackup(req.vm, { user: req.user, name: req.body.name }); res.json({ ok: true, backup }); }
  catch(e){ res.status(500).json({ error: e.message }); }
});
router.post(['/server/:id/backups/:bid/restore','/server/:id/backups/:bid/restore','/servers/:id/backups/:bid/restore'], loadVm, async (req,res)=>{
  try { const backup = await col('backups').findOne({ id: Number(req.params.bid), vm_id: Number(req.vm.id) }); if(!backup) return res.status(404).json({error:'Backup not found'});
    await backupService.restoreBackup(backup, { user: req.user }); res.json({ ok: true }); } catch(e){ res.status(500).json({ error: e.message }); }
});
router.post(['/server/:id/backups/:bid/delete','/server/:id/backups/:bid/delete','/servers/:id/backups/:bid/delete'], loadVm, async (req,res)=>{
  try { const backup = await col('backups').findOne({ id: Number(req.params.bid), vm_id: Number(req.vm.id) }); if(!backup) return res.status(404).json({error:'Backup not found'});
    await backupService.deleteBackup(backup, { user: req.user }); res.json({ ok: true }); } catch(e){ res.status(500).json({ error: e.message }); }
});
router.get(['/server/:id/backups/:bid/download','/server/:id/backups/:bid/download','/servers/:id/backups/:bid/download'], loadVm, async (req,res)=>{
  const backup = await col('backups').findOne({ id: Number(req.params.bid), vm_id: Number(req.vm.id) });
  if(!backup) return res.status(404).send('Backup not found');
  res.download(backup.file, `${req.vm.name}-${backup.name||backup.id}.qcow2`);
});

// VDS management pages (aggregated real data)
router.get('/snapshots', async (req,res,next)=>{ try{ const vms=await myVms(req.user); render(res,'snapshots',{activePage:'snapshots',vms}); }catch(e){next(e);} });
router.get('/backups', async (req,res,next)=>{ try{ const vms=await myVms(req.user); const vmIds=vms.map(v=>v.id); const backups=vmIds.length?await col('backups').find({vm_id:{$in:vmIds}}).sort({id:-1}).limit(200).toArray():[]; render(res,'backups',{activePage:'backups',vms,backups}); }catch(e){next(e);} });
router.get('/network', async (req,res,next)=>{ try{ const vms=await myVms(req.user); render(res,'network',{activePage:'network',vms}); }catch(e){next(e);} });
router.get('/firewall', async (req,res,next)=>{ try{ const vms=await myVms(req.user); render(res,'firewall',{activePage:'firewall',vms}); }catch(e){next(e);} });
router.get('/ip-addresses', async (req,res,next)=>{ try{ const vms=await myVms(req.user); render(res,'ip-addresses',{activePage:'ip-addresses',vms}); }catch(e){next(e);} });

// API keys
router.get('/account/api-keys', async (req,res,next)=>{
  try {
    const keys = await col('api_keys').find({ user_id: Number(req.user.id) }).sort({ id: -1 }).toArray().catch(()=>[]);
    render(res,'account/api-keys',{activePage:'account-api-keys',keys: keys.map(k=>({...k,key:undefined,secret:undefined,token_hash:undefined}))});
  } catch(e){ next(e); }
});
router.post('/account/api-keys', express.json(), async (req,res)=>{
  try {
    const name = String(req.body.name||'API Key').slice(0,80);
    const raw = 'vp_' + require('crypto').randomBytes(24).toString('hex');
    const hash = require('crypto').createHash('sha256').update(raw).digest('hex');
    const id = await getNextId('api_keys');
    const doc = { id, user_id: Number(req.user.id), name, key_hash: hash, key_preview: raw.slice(0,6)+'...'+raw.slice(-4), scopes: Array.isArray(req.body.scopes)?req.body.scopes.slice(0,20):[], created_at: new Date().toISOString(), last_used_at: null, expires_at: req.body.expires_at || null };
    await col('api_keys').insertOne(doc);
    await activity.logActivity({ user_id:req.user.id, event:'api_key.create', details:{name,key_id:id} });
    res.json({ ok:true, key: raw, id });
  } catch(e){ res.status(500).json({ error:e.message }); }
});
router.post('/account/api-keys/:id/delete', async (req,res)=>{
  try {
    await col('api_keys').deleteOne({ id:Number(req.params.id), user_id:Number(req.user.id) });
    await activity.logActivity({ user_id:req.user.id, event:'api_key.revoke', details:{key_id:Number(req.params.id)} });
    res.json({ ok:true });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// SSH keys
router.get(['/account/ssh-keys','/ssh-keys'], async (req,res,next)=>{ try{ const keys=await (col('ssh_keys')?col('ssh_keys').find({user_id:Number(req.user.id)}).sort({id:-1}).toArray():Promise.resolve([])); render(res,'account/ssh-keys',{activePage:'account-ssh-keys',keys}); }catch(e){next(e);} });
router.post(['/account/ssh-keys','/ssh-keys'], express.json(), async (req,res)=>{ try{ const name=String(req.body.name||'Key').slice(0,80); const key=String(req.body.public_key||'').trim(); if(!key.startsWith('ssh-')) return res.status(400).json({error:'Invalid public key'}); const id=await getNextId('ssh_keys'); await col('ssh_keys').insertOne({id,user_id:Number(req.user.id),name,public_key:key,created_at:new Date().toISOString()}); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});} });
router.post(['/account/ssh-keys/:id/delete','/ssh-keys/:id/delete'], async (req,res)=>{ await col('ssh_keys').deleteOne({id:Number(req.params.id), user_id:Number(req.user.id)}); res.json({ok:true}); });

// Account
router.get('/account/profile', async (req,res,next)=>{ try{ const loginHistory=await activity.listLoginHistory({user_id:req.user.id,limit:20}); render(res,'account/profile',{activePage:'account-profile',loginHistory}); }catch(e){next(e);} });
router.post('/account/profile', uploadAvatar.single('avatar'), async (req,res)=>{
  try {
    const updates = { username: String(req.body.username||req.user.username).trim() };
    if (req.file) updates.avatar = '/uploads/avatars/' + req.file.filename;
    await col('users').updateOne({ id: Number(req.user.id) }, { $set: updates });
    await authService.findById(req.user.id).then(u=>{ if(u) authService.generateToken(u); });
    res.redirect('/account/profile?ok=1');
  } catch(e){ next(e); }
});
router.get('/account/security', async (req,res,next)=>{ try{ const sessions=[]; const loginHistory=await activity.listLoginHistory({user_id:req.user.id,limit:20}); render(res,'account/security',{activePage:'account-security',sessions,loginHistory}); }catch(e){next(e);} });
router.post('/account/security/password', express.json(), async (req,res)=>{
  try {
    const r = await authService.changePassword(req.user, req.body.current_password, req.body.new_password);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  } catch(e){ res.status(500).json({ error: e.message }); }
});
router.get('/account/settings', (req,res)=>render(res,'account/settings',{activePage:'account-settings'}));

// Notifications
router.get('/notifications', async (req,res,next)=>{ try{ const notifs=await col('notifications').find({user_id:Number(req.user.id)}).sort({id:-1}).limit(50).toArray(); render(res,'notifications',{activePage:'notifications',notifs}); }catch(e){next(e);} });
router.post('/notifications/:id/read', async (req,res)=>{ await col('notifications').updateOne({id:Number(req.params.id),user_id:Number(req.user.id)},{$set:{read:1}}); res.json({ok:true}); });

// Legacy redirects
router.get('/profile', (req,res)=>res.redirect('/account/profile'));
router.get('/settings', (req,res)=>res.redirect('/account/settings'));
router.get('/activity', async (req,res,next)=>{ try{ const logs=await activity.listActivity({user_id:req.user.id,limit:200}); render(res,'activity',{activePage:'account-activity',logs}); }catch(e){next(e);} });

module.exports = router;
