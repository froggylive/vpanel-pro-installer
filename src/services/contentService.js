const { collections, getNextId } = require('../lib/db');

async function listAnnouncements(limit=50) {
  return collections.announcements.find({ published: { $ne: false } }).sort({ id: -1 }).limit(limit).toArray();
}
async function listAllAnnouncements(limit=100) {
  return collections.announcements.find({}).sort({ id: -1 }).limit(limit).toArray();
}
async function createAnnouncement(data) {
  const id = await getNextId('announcements');
  const doc = { id, title: String(data.title||'Announcement').slice(0,200), body: String(data.body||'').slice(0,20000), type: String(data.type||'info'), published: data.published !== false, created_at: new Date().toISOString() };
  await collections.announcements.insertOne(doc); return doc;
}
async function deleteAnnouncement(id) { await collections.announcements.deleteOne({ id: Number(id) }); }

async function listDocs() { return collections.docs_pages.find({ published: { $ne: false } }).sort({ order: 1, id: 1 }).toArray(); }
async function listAllDocs() { return collections.docs_pages.find({}).sort({ order: 1, id: 1 }).toArray(); }
async function createDoc(data) {
  const id = await getNextId('docs_pages');
  const doc = { id, slug: String(data.slug||`doc-${id}`).toLowerCase().replace(/[^a-z0-9-]/g,'-'), title: String(data.title||'Untitled').slice(0,200), body: String(data.body||'').slice(0,50000), category: String(data.category||'General').slice(0,60), order: Number(data.order||0), published: data.published !== false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  await collections.docs_pages.insertOne(doc); return doc;
}
async function updateDoc(id, data) {
  const update = { updated_at: new Date().toISOString() };
  ['slug','title','body','category','published'].forEach(k=>{ if(data[k]!==undefined) update[k]=k==='published'?!!data[k]:String(data[k]); });
  if (data.order!==undefined) update.order=Number(data.order||0);
  await collections.docs_pages.updateOne({ id: Number(id) }, { $set: update });
  return collections.docs_pages.findOne({ id: Number(id) });
}
async function deleteDoc(id) { await collections.docs_pages.deleteOne({ id: Number(id) }); }
module.exports = { listAnnouncements, listAllAnnouncements, createAnnouncement, deleteAnnouncement, listDocs, listAllDocs, createDoc, updateDoc, deleteDoc };
