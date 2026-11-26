const { collections, getNextId } = require('../lib/db');

async function listTickets(filter = {}) {
  const q = {};
  if (filter.user_id) q.user_id = Number(filter.user_id);
  if (filter.status) q.status = String(filter.status);
  return collections.support_tickets.find(q).sort({ updated_at: -1, id: -1 }).limit(filter.limit || 200).toArray();
}
async function getTicket(id, user) {
  const ticket = await collections.support_tickets.findOne({ id: Number(id) });
  if (!ticket) return null;
  if (user && user.role !== 'admin' && !user.root_admin && Number(ticket.user_id) !== Number(user.id)) return null;
  const messages = await collections.support_messages.find({ ticket_id: Number(ticket.id) }).sort({ id: 1 }).toArray();
  return { ...ticket, messages };
}
async function createTicket({ user, subject, department, priority, message }) {
  const id = await getNextId('support_tickets');
  const now = new Date().toISOString();
  const ticket = {
    id, user_id: Number(user.id), username: user.username, email: user.email || '',
    subject: String(subject || 'Support Request').slice(0, 140),
    department: String(department || 'General').slice(0, 60),
    priority: ['low','medium','high','urgent'].includes(priority) ? priority : 'medium',
    status: 'open', created_at: now, updated_at: now, last_reply_at: now, last_reply_by: user.username,
  };
  await collections.support_tickets.insertOne(ticket);
  const mid = await getNextId('support_messages');
  await collections.support_messages.insertOne({ id: mid, ticket_id: id, user_id: Number(user.id), username: user.username, role: user.role, message: String(message || '').slice(0, 10000), attachments: [], created_at: now });
  return ticket;
}
async function replyTicket({ ticket, user, message }) {
  const now = new Date().toISOString();
  const mid = await getNextId('support_messages');
  await collections.support_messages.insertOne({ id: mid, ticket_id: Number(ticket.id), user_id: Number(user.id), username: user.username, role: user.role, message: String(message || '').slice(0, 10000), attachments: [], created_at: now });
  const status = (user.role === 'admin' || user.root_admin) ? (ticket.status === 'closed' ? 'closed' : 'answered') : 'open';
  await collections.support_tickets.updateOne({ id: Number(ticket.id) }, { $set: { updated_at: now, last_reply_at: now, last_reply_by: user.username, status } });
  return { id: mid };
}
async function updateTicketStatus(id, status) {
  const s = ['open','answered','pending','closed'].includes(status) ? status : 'open';
  await collections.support_tickets.updateOne({ id: Number(id) }, { $set: { status: s, updated_at: new Date().toISOString() } });
  return collections.support_tickets.findOne({ id: Number(id) });
}
module.exports = { listTickets, getTicket, createTicket, replyTicket, updateTicketStatus };
