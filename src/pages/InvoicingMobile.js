import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import FullScreenSheet from '../components/mobile/FullScreenSheet';
import BottomSheet from '../components/mobile/BottomSheet';
import { mobileTokens, mobileTapButton } from '../utils/mobileTokens';

// Statuses match desktop (draft / sent / paid). Overdue is derived from due_date.
const STATUSES = [
  { key: 'draft', label: 'Draft', color: '#94a3b8' },
  { key: 'sent', label: 'Sent', color: '#60a5fa' },
  { key: 'paid', label: 'Paid', color: '#22c55e' },
];
const STATUS_MAP = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
const DIRECTIONS = [
  { key: 'inbound', label: 'Inbound', help: 'Money owed to you' },
  { key: 'outbound', label: 'Outbound', help: 'Money you owe' },
];

const EMPTY_LINE = { description: '', quantity: 1, rate_cents: 0, total_cents: 0 };

const EMPTY_FORM = {
  direction: 'inbound',
  status: 'draft',
  contact_id: null,
  issue_date: '',
  due_date: '',
  paid_date: '',
  notes: '',
};

function todayStr() { return new Date().toISOString().split('T')[0]; }
function fmtCents(cents) {
  return ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtInvoiceNumber(n) {
  return n ? `INV-${String(n).padStart(4, '0')}` : 'INV';
}
function isOverdue(inv) {
  if (inv.status === 'paid' || !inv.due_date) return false;
  return inv.due_date < todayStr();
}

export default function InvoicingMobile() {
  const { profile } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('outstanding');
  const [editing, setEditing] = useState(null); // null | 'new' | invoice row

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [invRes, conRes] = await Promise.all([
        supabase.from('invoices').select('*, invoice_line_items(*)').order('created_at', { ascending: false }),
        supabase.from('invoice_contacts').select('*').order('name'),
      ]);
      setInvoices(invRes.data || []);
      setContacts(conRes.data || []);
    } catch (err) {
      console.error('Invoicing fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (profile?.id) fetchAll(); }, [profile?.id, fetchAll]);

  const contactsById = useMemo(() => {
    const m = {};
    contacts.forEach((c) => { m[c.id] = c; });
    return m;
  }, [contacts]);

  const stats = useMemo(() => {
    const today = todayStr();
    const thisMonth = today.slice(0, 7);
    let outstanding = 0, overdueCount = 0, paidMonth = 0;
    invoices.forEach((inv) => {
      const amt = inv.total_cents || inv.subtotal_cents || 0;
      if (inv.status === 'paid') {
        if (inv.paid_date && inv.paid_date.startsWith(thisMonth)) paidMonth += amt;
      } else {
        outstanding += amt;
        if (inv.due_date && inv.due_date < today) overdueCount++;
      }
    });
    return { outstanding, overdueCount, paidMonth };
  }, [invoices]);

  const visible = useMemo(() => {
    return invoices.filter((inv) => {
      if (filter === 'paid') return inv.status === 'paid';
      if (filter === 'outstanding') return inv.status !== 'paid';
      return true;
    });
  }, [invoices, filter]);

  if (loading) return <p style={styles.empty}>Loading…</p>;

  return (
    <div style={styles.root}>
      <div style={styles.statRow}>
        <Stat label="Outstanding" value={fmtCents(stats.outstanding)} accent="#a5b4fc" />
        <Stat label="Overdue" value={String(stats.overdueCount)} accent={stats.overdueCount > 0 ? '#fca5a5' : 'rgba(255,255,255,0.6)'} />
        <Stat label="Paid this month" value={fmtCents(stats.paidMonth)} accent="#86efac" />
      </div>

      <div style={styles.filterBar}>
        <FilterChip label="Outstanding" active={filter === 'outstanding'} onClick={() => setFilter('outstanding')} />
        <FilterChip label="Paid" active={filter === 'paid'} onClick={() => setFilter('paid')} />
        <FilterChip label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
      </div>

      {visible.length === 0 ? (
        <p style={styles.empty}>No invoices in this view.</p>
      ) : (
        <ul style={styles.list}>
          {visible.map((inv) => {
            const overdue = isOverdue(inv);
            const accent = overdue ? '#ef4444' : (STATUS_MAP[inv.status]?.color || '#94a3b8');
            const contact = contactsById[inv.contact_id];
            return (
              <li key={inv.id}>
                <button onClick={() => setEditing(inv)} style={styles.row}>
                  <div style={{ ...styles.rowAccent, background: accent }} />
                  <div style={styles.rowBody}>
                    <div style={styles.rowHeader}>
                      <span style={styles.rowNumber}>{fmtInvoiceNumber(inv.invoice_number)}</span>
                      <span style={styles.rowAmount}>{fmtCents(inv.total_cents || inv.subtotal_cents || 0)}</span>
                    </div>
                    <div style={styles.rowMeta}>
                      <span style={styles.rowContact}>{contact?.name || contact?.company || 'No contact'}</span>
                      <span style={{ ...styles.statusPill, background: `${accent}22`, color: accent, borderColor: `${accent}55` }}>
                        {overdue ? 'Overdue' : (STATUS_MAP[inv.status]?.label || inv.status)}
                      </span>
                    </div>
                    {inv.due_date && (
                      <div style={styles.rowFoot}>Due {fmtDate(inv.due_date)}</div>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div style={{ ...styles.bottomBar, paddingBottom: `calc(${mobileTokens.space.md}px + ${mobileTokens.safeBottom})` }}>
        <button onClick={() => setEditing('new')} style={styles.createBtn}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
          <span>New invoice</span>
        </button>
      </div>

      <FullScreenSheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New invoice' : editing ? fmtInvoiceNumber(editing.invoice_number) : ''}
      >
        {editing && (
          <InvoiceEditor
            existing={editing === 'new' ? null : editing}
            contacts={contacts}
            onSaved={() => { setEditing(null); fetchAll(); }}
            onContactsChanged={fetchAll}
            onCancel={() => setEditing(null)}
            profileId={profile?.id}
          />
        )}
      </FullScreenSheet>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={{ ...styles.statValue, color: accent }}>{value}</div>
    </div>
  );
}

function FilterChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.chip,
        background: active ? 'rgba(99,102,241,0.16)' : 'rgba(255,255,255,0.05)',
        color: active ? '#a5b4fc' : 'rgba(255,255,255,0.7)',
        borderColor: active ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)',
        fontWeight: active ? 600 : 500,
      }}
    >
      {label}
    </button>
  );
}

function InvoiceEditor({ existing, contacts, onSaved, onContactsChanged, onCancel, profileId }) {
  const [form, setForm] = useState(() => existing ? {
    direction: existing.direction || 'inbound',
    status: existing.status || 'draft',
    contact_id: existing.contact_id || null,
    issue_date: existing.issue_date || todayStr(),
    due_date: existing.due_date || '',
    paid_date: existing.paid_date || '',
    notes: existing.notes || '',
  } : { ...EMPTY_FORM, issue_date: todayStr() });

  const [lineItems, setLineItems] = useState(() => {
    if (existing?.invoice_line_items?.length) {
      return existing.invoice_line_items
        .slice()
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .map((li) => ({
          description: li.description || '',
          quantity: li.quantity || 1,
          rate_cents: li.rate_cents || 0,
          total_cents: li.total_cents || 0,
        }));
    }
    return [{ ...EMPTY_LINE }];
  });

  const [showContacts, setShowContacts] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const subtotalCents = lineItems.reduce((sum, li) => sum + (li.total_cents || 0), 0);
  const totalCents = subtotalCents; // mobile keeps tax/discount/shipping at 0 — desktop handles those.

  const selectedContact = form.contact_id ? contacts.find((c) => c.id === form.contact_id) : null;

  function update(patch) { setForm((prev) => ({ ...prev, ...patch })); }

  function updateLine(idx, patch) {
    setLineItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      next[idx].total_cents = Math.round(Number(next[idx].quantity || 0) * Number(next[idx].rate_cents || 0));
      return next;
    });
  }

  function addLine() { setLineItems((prev) => [...prev, { ...EMPTY_LINE }]); }
  function removeLine(idx) { setLineItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx))); }

  async function save(overrideStatus) {
    if (saving) return;
    setSaving(true);
    const status = overrideStatus || form.status;
    const payload = {
      direction: form.direction,
      status,
      contact_id: form.contact_id || null,
      issue_date: form.issue_date || null,
      due_date: form.due_date || null,
      paid_date: status === 'paid' ? (form.paid_date || todayStr()) : (form.paid_date || null),
      subtotal_cents: subtotalCents,
      tax_rate: existing?.tax_rate || 0,
      tax_cents: existing?.tax_cents || 0,
      discount_cents: existing?.discount_cents || 0,
      shipping_cents: existing?.shipping_cents || 0,
      amount_paid_cents: status === 'paid' ? totalCents : (existing?.amount_paid_cents || 0),
      total_cents: totalCents + (existing?.tax_cents || 0) - (existing?.discount_cents || 0) + (existing?.shipping_cents || 0),
      notes: form.notes || null,
    };

    let row;
    try {
      if (existing) {
        const { data, error } = await supabase.from('invoices').update(payload).eq('id', existing.id).select().single();
        if (error) throw error;
        row = data;
      } else {
        payload.created_by = profileId;
        const { data, error } = await supabase.from('invoices').insert(payload).select().single();
        if (error) throw error;
        row = data;
      }

      await supabase.from('invoice_line_items').delete().eq('invoice_id', row.id);
      const validLines = lineItems.filter((li) => (li.description || '').trim() || li.total_cents > 0);
      if (validLines.length > 0) {
        await supabase.from('invoice_line_items').insert(validLines.map((li, idx) => ({
          invoice_id: row.id,
          description: li.description,
          quantity: li.quantity,
          rate_cents: li.rate_cents,
          total_cents: li.total_cents,
          position: idx,
        })));
      }
      onSaved();
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!existing) return;
    try {
      await supabase.from('invoice_line_items').delete().eq('invoice_id', existing.id);
      await supabase.from('invoices').delete().eq('id', existing.id);
      onSaved();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  }

  return (
    <div style={editStyles.root}>
      <FieldGroup>
        <SegmentedField
          label="Type"
          value={form.direction}
          onChange={(v) => update({ direction: v })}
          options={DIRECTIONS}
        />
        <SegmentedField
          label="Status"
          value={form.status}
          onChange={(v) => update({ status: v, ...(v === 'paid' && !form.paid_date ? { paid_date: todayStr() } : {}) })}
          options={STATUSES.map((s) => ({ key: s.key, label: s.label }))}
        />
      </FieldGroup>

      <FieldGroup>
        <Field label="Contact">
          <button type="button" onClick={() => setShowContacts(true)} style={editStyles.pickerBtn}>
            {selectedContact ? (
              <span style={editStyles.pickerName}>{selectedContact.name || selectedContact.company || 'Unnamed'}</span>
            ) : (
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>Pick a contact…</span>
            )}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <path d="M5 3l4 4-4 4" />
            </svg>
          </button>
        </Field>
      </FieldGroup>

      <FieldGroup>
        <div style={editStyles.row}>
          <Field label="Issue date" style={{ flex: 1 }}>
            <input type="date" value={form.issue_date} onChange={(e) => update({ issue_date: e.target.value })} style={editStyles.input} />
          </Field>
          <Field label="Due date" style={{ flex: 1 }}>
            <input type="date" value={form.due_date} onChange={(e) => update({ due_date: e.target.value })} style={editStyles.input} />
          </Field>
        </div>
        {form.status === 'paid' && (
          <Field label="Paid date">
            <input type="date" value={form.paid_date} onChange={(e) => update({ paid_date: e.target.value })} style={editStyles.input} />
          </Field>
        )}
      </FieldGroup>

      <FieldGroup>
        <div style={editStyles.sectionHeader}>
          <span style={editStyles.sectionLabel}>Line items</span>
          <button type="button" onClick={addLine} style={editStyles.addLineBtn}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M8 3v10M3 8h10" strokeLinecap="round" />
            </svg>
            <span>Add</span>
          </button>
        </div>
        <div style={editStyles.lineList}>
          {lineItems.map((li, idx) => (
            <LineItemRow
              key={idx}
              item={li}
              onChange={(patch) => updateLine(idx, patch)}
              onRemove={lineItems.length > 1 ? () => removeLine(idx) : null}
            />
          ))}
        </div>
        <div style={editStyles.totalRow}>
          <span style={editStyles.totalLabel}>Total</span>
          <span style={editStyles.totalValue}>{fmtCents(totalCents)}</span>
        </div>
      </FieldGroup>

      <FieldGroup>
        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => update({ notes: e.target.value })}
            rows={3}
            placeholder="Internal notes (not shown on PDF)"
            style={editStyles.textarea}
          />
        </Field>
      </FieldGroup>

      <div style={editStyles.actions}>
        {existing && form.status !== 'paid' && (
          <button type="button" onClick={() => save('paid')} disabled={saving} style={editStyles.markPaidBtn}>
            Mark paid
          </button>
        )}
        <button type="button" onClick={() => save()} disabled={saving} style={editStyles.saveBtn}>
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Create invoice'}
        </button>
        {existing && (
          <button type="button" onClick={() => setShowDeleteConfirm(true)} disabled={saving} style={editStyles.deleteBtn}>
            Delete invoice
          </button>
        )}
        <button type="button" onClick={onCancel} style={editStyles.cancelBtn}>Cancel</button>
      </div>

      <BottomSheet open={showContacts} onClose={() => setShowContacts(false)} title="Pick contact" maxHeight="85vh">
        <div style={editStyles.contactPicker}>
          <button type="button" onClick={() => { setShowContacts(false); setShowAddContact(true); }} style={editStyles.addContactBtn}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M8 3v10M3 8h10" strokeLinecap="round" />
            </svg>
            <span>New contact</span>
          </button>
          {contacts.length === 0 ? (
            <p style={editStyles.contactEmpty}>No contacts yet.</p>
          ) : (
            <ul style={editStyles.contactList}>
              {contacts.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => { update({ contact_id: c.id }); setShowContacts(false); }} style={editStyles.contactRow}>
                    <div style={editStyles.contactAvatar}>{(c.name || c.company || '?').charAt(0).toUpperCase()}</div>
                    <div style={editStyles.contactBody}>
                      <div style={editStyles.contactName}>{c.name || c.company || 'Unnamed'}</div>
                      {c.email && <div style={editStyles.contactSub}>{c.email}</div>}
                    </div>
                    {form.contact_id === c.id && (
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#a5b4fc" strokeWidth="2.5">
                        <path d="M4 9l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </BottomSheet>

      <BottomSheet open={showAddContact} onClose={() => setShowAddContact(false)} title="New contact">
        <ContactForm
          onCreated={(c) => { update({ contact_id: c.id }); setShowAddContact(false); onContactsChanged(); }}
          onCancel={() => setShowAddContact(false)}
        />
      </BottomSheet>

      <BottomSheet open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="Delete invoice?">
        <div style={editStyles.confirmBody}>
          <p style={editStyles.confirmText}>This permanently removes the invoice and its line items.</p>
          <button type="button" onClick={handleDelete} style={editStyles.confirmDangerBtn}>Yes, delete</button>
          <button type="button" onClick={() => setShowDeleteConfirm(false)} style={editStyles.cancelBtn}>Keep it</button>
        </div>
      </BottomSheet>
    </div>
  );
}

function FieldGroup({ children }) {
  return <div style={editStyles.group}>{children}</div>;
}

function Field({ label, style, children }) {
  return (
    <label style={{ ...editStyles.field, ...(style || {}) }}>
      <span style={editStyles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function SegmentedField({ label, value, onChange, options }) {
  return (
    <div style={editStyles.field}>
      <span style={editStyles.fieldLabel}>{label}</span>
      <div style={editStyles.segmented}>
        {options.map((o) => {
          const active = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => onChange(o.key)}
              style={{
                ...editStyles.segmentBtn,
                background: active ? 'rgba(99,102,241,0.16)' : 'transparent',
                color: active ? '#a5b4fc' : 'rgba(255,255,255,0.65)',
                fontWeight: active ? 600 : 500,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LineItemRow({ item, onChange, onRemove }) {
  // rate stored as cents, but we let users type dollars for sanity.
  const [rateText, setRateText] = useState((item.rate_cents / 100).toString().replace(/^0$/, ''));

  function commitRate(text) {
    const dollars = parseFloat(text);
    const cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
    onChange({ rate_cents: cents });
  }

  return (
    <div style={editStyles.lineCard}>
      <input
        value={item.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder="Description"
        style={editStyles.lineDesc}
      />
      <div style={editStyles.lineRow}>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={item.quantity}
          onChange={(e) => onChange({ quantity: parseFloat(e.target.value) || 0 })}
          placeholder="Qty"
          style={{ ...editStyles.lineSmallInput, flex: '0 0 70px' }}
        />
        <span style={editStyles.lineX}>×</span>
        <div style={{ flex: 1, position: 'relative' }}>
          <span style={editStyles.dollarPrefix}>$</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={rateText}
            onChange={(e) => { setRateText(e.target.value); commitRate(e.target.value); }}
            placeholder="0.00"
            style={{ ...editStyles.lineSmallInput, paddingLeft: 22, width: '100%' }}
          />
        </div>
        <span style={editStyles.lineEquals}>=</span>
        <span style={editStyles.lineTotal}>{fmtCents(item.total_cents)}</span>
        {onRemove && (
          <button type="button" onClick={onRemove} style={editStyles.lineRemoveBtn} aria-label="Remove line item">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3l8 8M11 3l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function ContactForm({ onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (!name.trim() && !company.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('invoice_contacts')
        .insert({ name: name.trim() || null, company: company.trim() || null, email: email.trim() || null })
        .select()
        .single();
      if (error) throw error;
      onCreated(data);
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  const valid = !!(name.trim() || company.trim());

  return (
    <form onSubmit={save} style={editStyles.contactForm}>
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" autoFocus style={editStyles.input} />
      </Field>
      <Field label="Company">
        <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme, Inc." style={editStyles.input} />
      </Field>
      <Field label="Email">
        <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@acme.com" style={editStyles.input} />
      </Field>
      <div style={{ display: 'flex', gap: mobileTokens.space.sm, marginTop: mobileTokens.space.sm }}>
        <button type="button" onClick={onCancel} style={editStyles.cancelBtn}>Cancel</button>
        <button type="submit" disabled={!valid || saving} style={{ ...editStyles.saveBtn, opacity: !valid || saving ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Save contact'}
        </button>
      </div>
    </form>
  );
}

const styles = {
  root: {
    minHeight: '100%',
    background: '#0f0f1a',
    color: '#e2e8f0',
    paddingTop: mobileTokens.space.md,
    display: 'flex',
    flexDirection: 'column',
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontSize: mobileTokens.font.md,
    padding: mobileTokens.space.xxl,
    margin: 0,
  },
  statRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: mobileTokens.space.sm,
    padding: `0 ${mobileTokens.space.lg}px ${mobileTokens.space.md}px`,
  },
  statCard: {
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.md,
    padding: mobileTokens.space.md,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  statLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    fontWeight: 600,
  },
  statValue: {
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    letterSpacing: '-0.3px',
  },
  filterBar: {
    display: 'flex',
    gap: mobileTokens.space.sm,
    padding: `0 ${mobileTokens.space.lg}px ${mobileTokens.space.md}px`,
  },
  chip: {
    minHeight: 36,
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    border: '1px solid',
    borderRadius: mobileTokens.radius.pill,
    fontSize: mobileTokens.font.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: `0 ${mobileTokens.space.lg}px ${mobileTokens.space.lg}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
  },
  row: {
    width: '100%',
    display: 'flex',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.md,
    border: 'none',
    overflow: 'hidden',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    color: '#e2e8f0',
    minHeight: mobileTokens.tap + 16,
  },
  rowAccent: { width: 4, flexShrink: 0 },
  rowBody: { flex: 1, padding: mobileTokens.space.md, minWidth: 0 },
  rowHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
  },
  rowNumber: { fontSize: mobileTokens.font.md, fontWeight: 700, color: '#fff' },
  rowAmount: { fontSize: mobileTokens.font.md, fontWeight: 700, color: '#fff' },
  rowMeta: {
    marginTop: 4,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
  },
  rowContact: {
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.65)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  statusPill: {
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: mobileTokens.radius.pill,
    border: '1px solid',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    flexShrink: 0,
  },
  rowFoot: {
    marginTop: 4,
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.45)',
  },
  bottomBar: {
    position: 'sticky',
    bottom: 0,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    background: 'rgba(15,15,30,0.96)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  createBtn: {
    ...mobileTapButton,
    width: '100%',
    minHeight: mobileTokens.tap + 6,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: '#fff',
    borderRadius: mobileTokens.radius.md,
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    flexDirection: 'row',
    gap: mobileTokens.space.sm,
  },
};

const editStyles = {
  root: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.lg, paddingBottom: mobileTokens.space.xxl },
  group: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.md },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: {
    fontSize: mobileTokens.font.xs,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  input: {
    height: mobileTokens.tap,
    padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    outline: 'none',
    fontFamily: 'inherit',
  },
  textarea: {
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    outline: 'none',
    fontFamily: 'inherit',
    resize: 'vertical',
    minHeight: 80,
  },
  row: { display: 'flex', gap: mobileTokens.space.md },
  segmented: {
    display: 'flex',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: mobileTokens.radius.md,
    padding: 3,
    gap: 2,
  },
  segmentBtn: {
    flex: 1,
    minHeight: mobileTokens.tap - 6,
    border: 'none',
    borderRadius: mobileTokens.radius.sm,
    cursor: 'pointer',
    fontSize: mobileTokens.font.sm,
    fontFamily: 'inherit',
  },
  pickerBtn: {
    width: '100%',
    minHeight: mobileTokens.tap,
    padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    fontFamily: 'inherit',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    textAlign: 'left',
  },
  pickerName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionLabel: {
    fontSize: mobileTokens.font.xs,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  addLineBtn: {
    ...mobileTapButton,
    minHeight: 32,
    padding: '0 10px',
    background: 'rgba(99,102,241,0.14)',
    color: '#a5b4fc',
    borderRadius: mobileTokens.radius.sm,
    fontSize: mobileTokens.font.xs,
    fontWeight: 600,
    flexDirection: 'row',
    gap: 4,
  },
  lineList: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm },
  lineCard: {
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.md,
    padding: mobileTokens.space.sm,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
  },
  lineDesc: {
    height: mobileTokens.tap,
    padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: mobileTokens.radius.sm,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    outline: 'none',
    fontFamily: 'inherit',
  },
  lineRow: { display: 'flex', alignItems: 'center', gap: 6 },
  lineSmallInput: {
    height: 36,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: mobileTokens.radius.sm,
    color: '#fff',
    fontSize: mobileTokens.font.sm,
    outline: 'none',
    fontFamily: 'inherit',
    padding: '0 8px',
  },
  dollarPrefix: {
    position: 'absolute',
    left: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'rgba(255,255,255,0.4)',
    fontSize: mobileTokens.font.sm,
    pointerEvents: 'none',
  },
  lineX: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: mobileTokens.font.sm,
    flexShrink: 0,
  },
  lineEquals: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: mobileTokens.font.sm,
    flexShrink: 0,
  },
  lineTotal: {
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    color: '#fff',
    minWidth: 64,
    textAlign: 'right',
  },
  lineRemoveBtn: {
    width: 32,
    height: 32,
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.45)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontFamily: 'inherit',
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: mobileTokens.space.sm,
    borderTop: '1px solid rgba(255,255,255,0.08)',
  },
  totalLabel: {
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.65)',
  },
  totalValue: {
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    color: '#fff',
  },
  actions: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm },
  saveBtn: {
    flex: 1,
    minHeight: mobileTokens.tap + 4,
    padding: mobileTokens.space.md,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  markPaidBtn: {
    minHeight: mobileTokens.tap + 4,
    padding: mobileTokens.space.md,
    background: 'linear-gradient(135deg, #22c55e, #4ade80)',
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  cancelBtn: {
    flex: 1,
    minHeight: mobileTokens.tap + 4,
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md,
    color: '#e2e8f0',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  deleteBtn: {
    minHeight: mobileTokens.tap + 4,
    padding: mobileTokens.space.md,
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.25)',
    borderRadius: mobileTokens.radius.md,
    color: '#fca5a5',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  contactPicker: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm },
  contactList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '60vh', overflowY: 'auto' },
  contactRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.md,
    padding: mobileTokens.space.md,
    background: 'transparent',
    border: 'none',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    borderRadius: mobileTokens.radius.md,
  },
  contactAvatar: {
    width: 36,
    height: 36,
    borderRadius: mobileTokens.radius.sm,
    background: 'rgba(99,102,241,0.2)',
    color: '#a5b4fc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: mobileTokens.font.md,
    flexShrink: 0,
  },
  contactBody: { flex: 1, minWidth: 0 },
  contactName: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#fff',
  },
  contactSub: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.5)',
  },
  contactEmpty: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontSize: mobileTokens.font.sm,
    padding: mobileTokens.space.lg,
    margin: 0,
  },
  addContactBtn: {
    ...mobileTapButton,
    minHeight: mobileTokens.tap,
    padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(99,102,241,0.14)',
    color: '#a5b4fc',
    borderRadius: mobileTokens.radius.md,
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    flexDirection: 'row',
    gap: mobileTokens.space.sm,
  },
  contactForm: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.md },
  confirmBody: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.md },
  confirmText: {
    margin: 0,
    color: 'rgba(255,255,255,0.7)',
    fontSize: mobileTokens.font.md,
    lineHeight: 1.4,
  },
  confirmDangerBtn: {
    minHeight: mobileTokens.tap + 4,
    padding: mobileTokens.space.md,
    background: '#ef4444',
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
