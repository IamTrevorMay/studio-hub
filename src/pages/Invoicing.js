import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import jsPDF from 'jspdf';

// ════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════
const DIRECTIONS = [
  { key: 'inbound',  label: 'Inbound',  color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  { key: 'outbound', label: 'Outbound', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
];
const DIRECTION_MAP = Object.fromEntries(DIRECTIONS.map(d => [d.key, d]));

const STATUSES = [
  { key: 'draft', label: 'Draft', color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  { key: 'sent',  label: 'Sent',  color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
  { key: 'paid',  label: 'Paid',  color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
];
const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.key, s]));

const OVERDUE_STYLE = { color: '#ef4444', bg: 'rgba(239,68,68,0.15)' };

const EMPTY_LINE_ITEM = { description: '', quantity: 1, rate_cents: 0, total_cents: 0 };

const EMPTY_INVOICE = {
  direction: 'inbound',
  status: 'draft',
  contact_id: null,
  issue_date: '',
  due_date: '',
  notes: '',
  line_items: [{ ...EMPTY_LINE_ITEM }],
};

const EMPTY_CONTACT = {
  name: '', company: '', email: '', phone: '',
  address_line1: '', address_line2: '', city: '', state: '', zip: '', country: '', notes: '',
};

// ════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════
function formatInvoiceNumber(num) {
  return `INV-${String(num).padStart(4, '0')}`;
}

function isOverdue(inv) {
  if (inv.status === 'paid' || !inv.due_date) return false;
  return inv.due_date < todayStr();
}

function formatCurrency(cents) {
  const dollars = (cents || 0) / 100;
  return dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function todayStr() { return new Date().toISOString().split('T')[0]; }

function parseDateLocal(dateStr) { return dateStr ? new Date(dateStr + 'T00:00:00') : null; }

function formatDate(dateStr) {
  if (!dateStr) return '';
  return parseDateLocal(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  return parseDateLocal(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ════════════════════════════════════════════════════════════
// PDF Export
// ════════════════════════════════════════════════════════════
function generateInvoicePDF(invoice, lineItems, contact) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 50;

  // Header
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text('INVOICE', 50, y);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  const invNum = formatInvoiceNumber(invoice.invoice_number);
  doc.text(invNum, pageW - 50, y - 10, { align: 'right' });
  y += 20;
  if (invoice.issue_date) {
    doc.text(`Issue Date: ${formatDate(invoice.issue_date)}`, pageW - 50, y, { align: 'right' });
    y += 16;
  }
  if (invoice.due_date) {
    doc.text(`Due Date: ${formatDate(invoice.due_date)}`, pageW - 50, y, { align: 'right' });
    y += 16;
  }
  if (invoice.paid_date) {
    doc.text(`Paid Date: ${formatDate(invoice.paid_date)}`, pageW - 50, y, { align: 'right' });
    y += 16;
  }

  // Direction badge
  const dirLabel = invoice.direction === 'inbound' ? 'INBOUND (Receivable)' : 'OUTBOUND (Payable)';
  doc.setFontSize(9);
  doc.text(dirLabel, 50, y);
  y += 24;

  // Contact info
  if (contact) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(invoice.direction === 'inbound' ? 'Bill To:' : 'Pay To:', 50, y);
    y += 16;
    doc.setFont('helvetica', 'normal');
    if (contact.name) { doc.text(contact.name, 50, y); y += 14; }
    if (contact.company) { doc.text(contact.company, 50, y); y += 14; }
    if (contact.email) { doc.text(contact.email, 50, y); y += 14; }
    if (contact.phone) { doc.text(contact.phone, 50, y); y += 14; }
    const addrParts = [contact.address_line1, contact.address_line2].filter(Boolean);
    if (addrParts.length) { doc.text(addrParts.join(', '), 50, y); y += 14; }
    const cityState = [contact.city, contact.state, contact.zip].filter(Boolean).join(', ');
    if (cityState) { doc.text(cityState, 50, y); y += 14; }
    if (contact.country) { doc.text(contact.country, 50, y); y += 14; }
    y += 10;
  }

  // Line items table header
  y += 10;
  doc.setFillColor(240, 240, 240);
  doc.rect(50, y - 12, pageW - 100, 18, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Description', 56, y);
  doc.text('Qty', 360, y, { align: 'right' });
  doc.text('Rate', 440, y, { align: 'right' });
  doc.text('Total', pageW - 56, y, { align: 'right' });
  y += 18;

  // Line items
  doc.setFont('helvetica', 'normal');
  (lineItems || []).forEach(item => {
    if (y > 700) { doc.addPage(); y = 50; }
    doc.text(String(item.description || ''), 56, y);
    doc.text(String(Number(item.quantity) || 0), 360, y, { align: 'right' });
    doc.text(formatCurrency(item.rate_cents), 440, y, { align: 'right' });
    doc.text(formatCurrency(item.total_cents), pageW - 56, y, { align: 'right' });
    y += 16;
  });

  // Subtotal
  y += 8;
  doc.setDrawColor(200, 200, 200);
  doc.line(300, y - 4, pageW - 50, y - 4);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Subtotal:', 380, y + 6);
  doc.text(formatCurrency(invoice.subtotal_cents), pageW - 56, y + 6, { align: 'right' });
  y += 30;

  // Notes
  if (invoice.notes) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Notes / Memo:', 50, y);
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const noteLines = doc.splitTextToSize(invoice.notes, pageW - 100);
    doc.text(noteLines, 50, y);
    y += noteLines.length * 12;
  }

  // PAID watermark
  if (invoice.status === 'paid') {
    doc.setFontSize(72);
    doc.setTextColor(34, 197, 94);
    doc.setFont('helvetica', 'bold');
    doc.text('PAID', pageW / 2, 400, { align: 'center', angle: 45, renderingMode: 'fill' });
    doc.setTextColor(0, 0, 0);
  }

  doc.save(`${formatInvoiceNumber(invoice.invoice_number)}.pdf`);
}

// ════════════════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════════════════
export default function Invoicing() {
  const { profile } = useAuth();

  // Data
  const [invoices, setInvoices] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  // View
  const [view, setView] = useState('dashboard');

  // Editor
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [creatingNew, setCreatingNew] = useState(false);

  // Filters (list view)
  const [directionFilter, setDirectionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchText, setSearchText] = useState('');

  // Calendar
  const now = new Date();
  const [calendarMonth, setCalendarMonth] = useState(now.getMonth());
  const [calendarYear, setCalendarYear] = useState(now.getFullYear());

  // Contact modal
  const [showContactModal, setShowContactModal] = useState(false);
  const [editingContact, setEditingContact] = useState(null);

  // ── Fetch ──────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [invRes, conRes, tplRes] = await Promise.all([
        supabase.from('invoices').select('*, invoice_line_items(*)').order('created_at', { ascending: false }),
        supabase.from('invoice_contacts').select('*').order('name'),
        supabase.from('invoice_templates').select('*').order('name'),
      ]);
      setInvoices(invRes.data || []);
      setContacts(conRes.data || []);
      setTemplates(tplRes.data || []);
    } catch (err) {
      console.error('Invoicing fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    fetchAll();
  }, [profile?.id, fetchAll]);
  useVisibilityRefresh(fetchAll);

  // ── Computed ───────────────────────────────────────────
  const contactsById = useMemo(() => {
    const map = {};
    contacts.forEach(c => { map[c.id] = c; });
    return map;
  }, [contacts]);

  const dashboardStats = useMemo(() => {
    const today = todayStr();
    const thisMonth = today.slice(0, 7);
    let outstanding = 0;
    let overdueCount = 0;
    let paidThisMonth = 0;
    let paidAllTime = 0;
    invoices.forEach(inv => {
      if (inv.status !== 'paid') {
        outstanding += inv.subtotal_cents || 0;
        if (inv.due_date && inv.due_date < today) overdueCount++;
      } else {
        paidAllTime += inv.subtotal_cents || 0;
        if (inv.paid_date && inv.paid_date.startsWith(thisMonth)) {
          paidThisMonth += inv.subtotal_cents || 0;
        }
      }
    });
    return { outstanding, overdueCount, paidThisMonth, paidAllTime };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      if (directionFilter !== 'all' && inv.direction !== directionFilter) return false;
      if (statusFilter === 'overdue') {
        if (!isOverdue(inv)) return false;
      } else if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        const contact = contactsById[inv.contact_id];
        const contactName = contact ? (contact.name + ' ' + (contact.company || '')).toLowerCase() : '';
        const invNum = formatInvoiceNumber(inv.invoice_number).toLowerCase();
        if (!contactName.includes(q) && !invNum.includes(q) && !(inv.notes || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [invoices, directionFilter, statusFilter, searchText, contactsById]);

  // ── Navigation ─────────────────────────────────────────
  function openEditor(invoiceId) {
    setEditingInvoiceId(invoiceId);
    setCreatingNew(false);
  }

  function openNewInvoice(templateData) {
    setEditingInvoiceId(null);
    setCreatingNew(true);
    if (templateData) {
      setNewFromTemplate(templateData);
    } else {
      setNewFromTemplate(null);
    }
  }

  function closeEditor() {
    setEditingInvoiceId(null);
    setCreatingNew(false);
    setNewFromTemplate(null);
    fetchAll();
  }

  const [newFromTemplate, setNewFromTemplate] = useState(null);

  // ── Render ─────────────────────────────────────────────
  const isEditing = editingInvoiceId !== null || creatingNew;

  if (loading && invoices.length === 0) {
    return (
      <div style={styles.page}>
        <div style={{ color: 'rgba(255,255,255,0.5)', padding: '40px', textAlign: 'center' }}>Loading…</div>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div style={styles.page}>
        <InvoiceEditor
          invoiceId={editingInvoiceId}
          invoices={invoices}
          contacts={contacts}
          contactsById={contactsById}
          templates={templates}
          profile={profile}
          templateData={newFromTemplate}
          onBack={closeEditor}
          onOpenContactModal={() => setShowContactModal(true)}
          fetchAll={fetchAll}
        />
        {showContactModal && (
          <ContactModal
            contacts={contacts}
            editingContact={editingContact}
            onEditContact={setEditingContact}
            profile={profile}
            onClose={() => { setShowContactModal(false); setEditingContact(null); }}
            onSaved={async () => { await fetchAll(); }}
          />
        )}
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Invoicing</h1>
        <button style={styles.primaryBtn} onClick={() => openNewInvoice(null)}>+ New Invoice</button>
      </div>

      {/* View tabs */}
      <div style={styles.tabBar}>
        {['dashboard', 'list', 'calendar'].map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              ...styles.tab,
              ...(view === v ? styles.tabActive : {}),
            }}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {/* Views */}
      {view === 'dashboard' && (
        <DashboardView
          stats={dashboardStats}
          invoices={invoices}
          contactsById={contactsById}
          onOpen={openEditor}
        />
      )}
      {view === 'list' && (
        <ListView
          invoices={filteredInvoices}
          contactsById={contactsById}
          templates={templates}
          directionFilter={directionFilter}
          setDirectionFilter={setDirectionFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          searchText={searchText}
          setSearchText={setSearchText}
          onOpen={openEditor}
          onNewFromTemplate={openNewInvoice}
        />
      )}
      {view === 'calendar' && (
        <CalendarView
          invoices={invoices}
          contactsById={contactsById}
          month={calendarMonth}
          year={calendarYear}
          setMonth={setCalendarMonth}
          setYear={setCalendarYear}
          onOpen={openEditor}
        />
      )}

      {showContactModal && (
        <ContactModal
          contacts={contacts}
          editingContact={editingContact}
          onEditContact={setEditingContact}
          profile={profile}
          onClose={() => { setShowContactModal(false); setEditingContact(null); }}
          onSaved={async () => { await fetchAll(); }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Dashboard View
// ════════════════════════════════════════════════════════════
function DashboardView({ stats, invoices, contactsById, onOpen }) {
  const cards = [
    { label: 'Outstanding', value: formatCurrency(stats.outstanding), color: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
    { label: 'Overdue', value: stats.overdueCount, color: '#ef4444', bg: 'rgba(239,68,68,0.10)' },
    { label: 'Paid This Month', value: formatCurrency(stats.paidThisMonth), color: '#22c55e', bg: 'rgba(34,197,94,0.10)' },
    { label: 'Total Paid', value: formatCurrency(stats.paidAllTime), color: '#6366f1', bg: 'rgba(99,102,241,0.10)' },
  ];
  const recent = invoices.slice(0, 10);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Summary cards */}
      <div style={styles.cardGrid}>
        {cards.map(c => (
          <div key={c.label} style={{ ...styles.summaryCard, background: c.bg, borderColor: c.color + '30' }}>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{c.label}</div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: c.color, marginTop: '4px' }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Recent invoices */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Recent Invoices</div>
        {recent.length === 0 ? (
          <div style={styles.emptyState}>No invoices yet. Create your first invoice to get started.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {recent.map(inv => (
              <InvoiceRow key={inv.id} inv={inv} contactsById={contactsById} onClick={() => onOpen(inv.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// List View
// ════════════════════════════════════════════════════════════
function ListView({ invoices, contactsById, templates, directionFilter, setDirectionFilter, statusFilter, setStatusFilter, searchText, setSearchText, onOpen, onNewFromTemplate }) {
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowTemplateDropdown(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Filters */}
      <div style={styles.filterBar}>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {/* Direction pills */}
          <button
            onClick={() => setDirectionFilter('all')}
            style={{ ...styles.pill, ...(directionFilter === 'all' ? styles.pillActive : {}) }}
          >All</button>
          {DIRECTIONS.map(d => (
            <button
              key={d.key}
              onClick={() => setDirectionFilter(d.key)}
              style={{
                ...styles.pill,
                ...(directionFilter === d.key ? { background: d.bg, color: d.color, borderColor: d.color + '40' } : {}),
              }}
            >{d.label}</button>
          ))}

          <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '0 6px' }} />

          {/* Status pills */}
          <button
            onClick={() => setStatusFilter('all')}
            style={{ ...styles.pill, ...(statusFilter === 'all' ? styles.pillActive : {}) }}
          >All</button>
          {STATUSES.map(s => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(s.key)}
              style={{
                ...styles.pill,
                ...(statusFilter === s.key ? { background: s.bg, color: s.color, borderColor: s.color + '40' } : {}),
              }}
            >{s.label}</button>
          ))}
          <button
            onClick={() => setStatusFilter('overdue')}
            style={{
              ...styles.pill,
              ...(statusFilter === 'overdue' ? { background: OVERDUE_STYLE.bg, color: OVERDUE_STYLE.color, borderColor: OVERDUE_STYLE.color + '40' } : {}),
            }}
          >Overdue</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search invoices…"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            style={styles.searchInput}
          />
          {templates.length > 0 && (
            <div style={{ position: 'relative' }} ref={dropdownRef}>
              <button style={styles.secondaryBtn} onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}>
                From Template ▾
              </button>
              {showTemplateDropdown && (
                <div style={styles.dropdown}>
                  {templates.map(t => (
                    <button
                      key={t.id}
                      style={styles.dropdownItem}
                      onClick={() => {
                        setShowTemplateDropdown(false);
                        onNewFromTemplate({
                          direction: t.direction,
                          notes: t.notes || '',
                          line_items: (t.line_items || []).map(li => ({
                            description: li.description || '',
                            quantity: li.quantity || 1,
                            rate_cents: li.rate_cents || 0,
                            total_cents: Math.round((li.quantity || 1) * (li.rate_cents || 0)),
                          })),
                          template_id: t.id,
                        });
                      }}
                    >
                      <span>{t.name}</span>
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                        {DIRECTION_MAP[t.direction]?.label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      {invoices.length === 0 ? (
        <div style={styles.emptyState}>No invoices match your filters.</div>
      ) : (
        <div style={styles.section}>
          {/* Table header */}
          <div style={styles.tableHeaderRow}>
            <div style={{ flex: '0 0 100px' }}>Invoice #</div>
            <div style={{ flex: 1 }}>Contact</div>
            <div style={{ flex: '0 0 90px' }}>Direction</div>
            <div style={{ flex: '0 0 110px', textAlign: 'right' }}>Amount</div>
            <div style={{ flex: '0 0 90px' }}>Status</div>
            <div style={{ flex: '0 0 100px' }}>Due Date</div>
            <div style={{ flex: '0 0 100px' }}>Created</div>
          </div>
          {invoices.map(inv => (
            <InvoiceRow key={inv.id} inv={inv} contactsById={contactsById} onClick={() => onOpen(inv.id)} full />
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Invoice Row (shared between dashboard + list)
// ════════════════════════════════════════════════════════════
function InvoiceRow({ inv, contactsById, onClick, full }) {
  const contact = contactsById[inv.contact_id];
  const overdue = isOverdue(inv);
  const dir = DIRECTION_MAP[inv.direction] || DIRECTION_MAP.inbound;
  const st = overdue ? { label: 'Overdue', color: OVERDUE_STYLE.color, bg: OVERDUE_STYLE.bg } : (STATUS_MAP[inv.status] || STATUS_MAP.draft);

  return (
    <div style={styles.tableRow} onClick={onClick}>
      <div style={{ flex: '0 0 100px', fontWeight: 600, color: '#e2e8f0', fontFamily: 'monospace', fontSize: '13px' }}>
        {formatInvoiceNumber(inv.invoice_number)}
      </div>
      <div style={{ flex: 1, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {contact ? (contact.company ? `${contact.name} — ${contact.company}` : contact.name) : '—'}
      </div>
      {full && (
        <div style={{ flex: '0 0 90px' }}>
          <span style={{ ...styles.badge, background: dir.bg, color: dir.color }}>{dir.label}</span>
        </div>
      )}
      <div style={{ flex: '0 0 110px', textAlign: 'right', fontWeight: 600, color: '#e2e8f0', fontFamily: 'monospace' }}>
        {formatCurrency(inv.subtotal_cents)}
      </div>
      <div style={{ flex: '0 0 90px' }}>
        <span style={{ ...styles.badge, background: st.bg, color: st.color }}>{st.label}</span>
      </div>
      {full && (
        <>
          <div style={{ flex: '0 0 100px', color: overdue ? '#ef4444' : 'rgba(255,255,255,0.5)', fontSize: '12px' }}>
            {formatDateShort(inv.due_date)}
          </div>
          <div style={{ flex: '0 0 100px', color: 'rgba(255,255,255,0.4)', fontSize: '12px' }}>
            {formatDateShort(inv.created_at?.split('T')[0])}
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Calendar View
// ════════════════════════════════════════════════════════════
function CalendarView({ invoices, contactsById, month, year, setMonth, setYear, onOpen }) {
  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
  }

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = firstDay.getDay();
  const today = todayStr();

  // Map invoices by due date
  const invoicesByDate = {};
  invoices.forEach(inv => {
    if (!inv.due_date) return;
    const d = inv.due_date;
    if (!invoicesByDate[d]) invoicesByDate[d] = [];
    invoicesByDate[d].push(inv);
  });

  const cells = [];
  // Empty leading cells
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const monthLabel = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div style={styles.calendarWrap}>
      <div style={styles.calendarHeader}>
        <button style={styles.navArrow} onClick={prevMonth}>‹</button>
        <div style={styles.calendarMonthLabel}>{monthLabel}</div>
        <button style={styles.navArrow} onClick={nextMonth}>›</button>
      </div>

      <div style={styles.calendarGrid}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} style={styles.calendarDayHeader}>{d}</div>
        ))}
        {cells.map((day, idx) => {
          if (day === null) return <div key={`e${idx}`} style={styles.calendarCellEmpty} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dayInvs = invoicesByDate[dateStr] || [];
          const isToday = dateStr === today;
          return (
            <div key={dateStr} style={{ ...styles.calendarCell, ...(isToday ? styles.calendarCellToday : {}) }}>
              <div style={styles.calendarCellNum}>{day}</div>
              <div style={styles.calendarCellEvents}>
                {dayInvs.slice(0, 3).map(inv => {
                  const overdue = isOverdue(inv);
                  let pillColor, pillBg;
                  if (overdue) { pillColor = '#ef4444'; pillBg = 'rgba(239,68,68,0.20)'; }
                  else if (inv.status === 'paid') { pillColor = '#22c55e'; pillBg = 'rgba(34,197,94,0.20)'; }
                  else if (inv.status === 'sent') { pillColor = '#60a5fa'; pillBg = 'rgba(96,165,250,0.20)'; }
                  else { pillColor = '#94a3b8'; pillBg = 'rgba(148,163,184,0.15)'; }
                  return (
                    <div
                      key={inv.id}
                      onClick={() => onOpen(inv.id)}
                      style={{ ...styles.calendarEvent, color: pillColor, background: pillBg, cursor: 'pointer' }}
                    >
                      {formatInvoiceNumber(inv.invoice_number)} {formatCurrency(inv.subtotal_cents)}
                    </div>
                  );
                })}
                {dayInvs.length > 3 && (
                  <div style={styles.calendarMoreEvents}>+{dayInvs.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Invoice Editor (full-page)
// ════════════════════════════════════════════════════════════
function InvoiceEditor({ invoiceId, invoices, contacts, contactsById, templates, profile, templateData, onBack, onOpenContactModal, fetchAll }) {
  const existing = invoiceId ? invoices.find(i => i.id === invoiceId) : null;
  const [form, setForm] = useState(() => {
    if (existing) {
      return {
        direction: existing.direction,
        status: existing.status,
        contact_id: existing.contact_id || '',
        issue_date: existing.issue_date || '',
        due_date: existing.due_date || '',
        paid_date: existing.paid_date || '',
        notes: existing.notes || '',
        template_id: existing.template_id || '',
      };
    }
    if (templateData) {
      return {
        direction: templateData.direction || 'inbound',
        status: 'draft',
        contact_id: '',
        issue_date: todayStr(),
        due_date: '',
        paid_date: '',
        notes: templateData.notes || '',
        template_id: templateData.template_id || '',
      };
    }
    return {
      direction: 'inbound',
      status: 'draft',
      contact_id: '',
      issue_date: todayStr(),
      due_date: '',
      paid_date: '',
      notes: '',
      template_id: '',
    };
  });

  const [lineItems, setLineItems] = useState(() => {
    if (existing && existing.invoice_line_items) {
      return existing.invoice_line_items
        .sort((a, b) => a.position - b.position)
        .map(li => ({
          description: li.description || '',
          quantity: Number(li.quantity) || 1,
          rate_cents: li.rate_cents || 0,
          total_cents: li.total_cents || 0,
        }));
    }
    if (templateData && templateData.line_items) {
      return templateData.line_items.map(li => ({ ...li }));
    }
    return [{ ...EMPTY_LINE_ITEM }];
  });

  const [saving, setSaving] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  function updateField(key, val) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  function updateLineItem(idx, field, value) {
    setLineItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      // Recompute total
      const qty = field === 'quantity' ? value : next[idx].quantity;
      const rate = field === 'rate_cents' ? value : next[idx].rate_cents;
      next[idx].total_cents = Math.round(Number(qty) * Number(rate));
      return next;
    });
  }

  function addLineItem() {
    setLineItems(prev => [...prev, { ...EMPTY_LINE_ITEM }]);
  }

  function removeLineItem(idx) {
    setLineItems(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx));
  }

  const subtotalCents = lineItems.reduce((sum, li) => sum + (li.total_cents || 0), 0);

  const selectedContact = form.contact_id ? contactsById[form.contact_id] : null;

  // ── Save ─────────────────────────────────────────────
  async function saveInvoice(overrideStatus) {
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
      notes: form.notes || null,
      template_id: form.template_id || null,
    };

    let invoiceRow;
    if (existing) {
      const { data, error } = await supabase.from('invoices').update(payload).eq('id', existing.id).select().single();
      if (error) { alert(error.message); setSaving(false); return; }
      invoiceRow = data;
    } else {
      payload.created_by = profile?.id;
      const { data, error } = await supabase.from('invoices').insert(payload).select().single();
      if (error) { alert(error.message); setSaving(false); return; }
      invoiceRow = data;
    }

    // Delete + reinsert line items
    await supabase.from('invoice_line_items').delete().eq('invoice_id', invoiceRow.id);
    if (lineItems.length > 0) {
      const rows = lineItems.map((li, idx) => ({
        invoice_id: invoiceRow.id,
        description: li.description,
        quantity: li.quantity,
        rate_cents: li.rate_cents,
        total_cents: li.total_cents,
        position: idx,
      }));
      await supabase.from('invoice_line_items').insert(rows);
    }

    setSaving(false);
    onBack();
  }

  async function deleteInvoice() {
    if (!existing) return;
    if (!window.confirm(`Delete ${formatInvoiceNumber(existing.invoice_number)}? This cannot be undone.`)) return;
    await supabase.from('invoices').delete().eq('id', existing.id);
    onBack();
  }

  async function saveAsTemplate() {
    if (!templateName.trim()) return;
    const payload = {
      name: templateName.trim(),
      direction: form.direction,
      line_items: lineItems.map(li => ({
        description: li.description,
        quantity: li.quantity,
        rate_cents: li.rate_cents,
      })),
      notes: form.notes || null,
      created_by: profile?.id,
    };
    await supabase.from('invoice_templates').insert(payload);
    setShowSaveTemplate(false);
    setTemplateName('');
    fetchAll();
  }

  function exportPDF() {
    const invData = existing ? { ...existing, ...form, subtotal_cents: subtotalCents } : { ...form, invoice_number: 0, subtotal_cents: subtotalCents };
    generateInvoicePDF(invData, lineItems, selectedContact);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button style={styles.backBtn} onClick={onBack}>← Back</button>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#e2e8f0' }}>
          {existing ? formatInvoiceNumber(existing.invoice_number) : 'New Invoice'}
        </h2>
        {existing && isOverdue({ ...existing, ...form }) && (
          <span style={{ ...styles.badge, background: OVERDUE_STYLE.bg, color: OVERDUE_STYLE.color }}>Overdue</span>
        )}
      </div>

      {/* Metadata */}
      <div style={styles.editorSection}>
        <div style={styles.editorGrid}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Direction</label>
            <select style={styles.select} value={form.direction} onChange={e => updateField('direction', e.target.value)}>
              {DIRECTIONS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Status</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {(() => {
                const st = STATUS_MAP[form.status] || STATUS_MAP.draft;
                return <span style={{ ...styles.badge, background: st.bg, color: st.color }}>{st.label}</span>;
              })()}
            </div>
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Issue Date</label>
            <input type="date" style={styles.input} value={form.issue_date} onChange={e => updateField('issue_date', e.target.value)} />
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Due Date</label>
            <input type="date" style={styles.input} value={form.due_date} onChange={e => updateField('due_date', e.target.value)} />
          </div>
          {form.status === 'paid' && (
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Paid Date</label>
              <input type="date" style={styles.input} value={form.paid_date} onChange={e => updateField('paid_date', e.target.value)} />
            </div>
          )}
        </div>
      </div>

      {/* Contact */}
      <div style={styles.editorSection}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={styles.sectionTitle}>{form.direction === 'inbound' ? 'Bill To' : 'Pay To'}</div>
          <button style={styles.secondaryBtn} onClick={onOpenContactModal}>Manage Contacts</button>
        </div>
        <select
          style={styles.select}
          value={form.contact_id || ''}
          onChange={e => updateField('contact_id', e.target.value || null)}
        >
          <option value="">— Select Contact —</option>
          {contacts.map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>
          ))}
        </select>
        {selectedContact && (
          <div style={styles.contactCard}>
            <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{selectedContact.name}</div>
            {selectedContact.company && <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>{selectedContact.company}</div>}
            {selectedContact.email && <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>{selectedContact.email}</div>}
            {selectedContact.phone && <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>{selectedContact.phone}</div>}
            {selectedContact.address_line1 && <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', marginTop: '4px' }}>{selectedContact.address_line1}{selectedContact.address_line2 ? `, ${selectedContact.address_line2}` : ''}</div>}
            {(selectedContact.city || selectedContact.state || selectedContact.zip) && (
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px' }}>
                {[selectedContact.city, selectedContact.state, selectedContact.zip].filter(Boolean).join(', ')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Line Items */}
      <div style={styles.editorSection}>
        <div style={styles.sectionTitle}>Line Items</div>
        {/* Header */}
        <div style={styles.lineItemHeader}>
          <div style={{ flex: 1 }}>Description</div>
          <div style={{ flex: '0 0 80px', textAlign: 'right' }}>Qty</div>
          <div style={{ flex: '0 0 110px', textAlign: 'right' }}>Rate ($)</div>
          <div style={{ flex: '0 0 110px', textAlign: 'right' }}>Total</div>
          <div style={{ flex: '0 0 36px' }} />
        </div>
        {lineItems.map((li, idx) => (
          <div key={idx} style={styles.lineItemRow}>
            <div style={{ flex: 1 }}>
              <input
                type="text"
                placeholder="Description"
                value={li.description}
                onChange={e => updateLineItem(idx, 'description', e.target.value)}
                style={{ ...styles.input, width: '100%' }}
              />
            </div>
            <div style={{ flex: '0 0 80px' }}>
              <input
                type="number"
                step="0.01"
                min="0"
                value={li.quantity}
                onChange={e => updateLineItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                style={{ ...styles.input, textAlign: 'right', width: '100%' }}
              />
            </div>
            <div style={{ flex: '0 0 110px' }}>
              <input
                type="number"
                step="0.01"
                min="0"
                value={(li.rate_cents / 100).toFixed(2)}
                onChange={e => updateLineItem(idx, 'rate_cents', Math.round((parseFloat(e.target.value) || 0) * 100))}
                style={{ ...styles.input, textAlign: 'right', width: '100%' }}
              />
            </div>
            <div style={{ flex: '0 0 110px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
              {formatCurrency(li.total_cents)}
            </div>
            <div style={{ flex: '0 0 36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <button
                style={styles.removeBtn}
                onClick={() => removeLineItem(idx)}
                title="Remove"
              >×</button>
            </div>
          </div>
        ))}
        <button style={styles.addLineBtn} onClick={addLineItem}>+ Add Line Item</button>

        {/* Subtotal */}
        <div style={styles.subtotalRow}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#e2e8f0' }}>Subtotal</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>
            {formatCurrency(subtotalCents)}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div style={styles.editorSection}>
        <div style={styles.sectionTitle}>Notes / Memo</div>
        <textarea
          style={styles.textarea}
          rows={3}
          placeholder="Payment terms, thank you notes, etc."
          value={form.notes}
          onChange={e => updateField('notes', e.target.value)}
        />
      </div>

      {/* Actions */}
      <div style={styles.actionBar}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button style={styles.primaryBtn} onClick={() => saveInvoice()} disabled={saving}>
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          {form.status === 'draft' && (
            <button style={{ ...styles.primaryBtn, background: '#3b82f6' }} onClick={() => saveInvoice('sent')} disabled={saving}>
              Mark Sent
            </button>
          )}
          {(form.status === 'draft' || form.status === 'sent') && (
            <button style={{ ...styles.primaryBtn, background: '#22c55e' }} onClick={() => saveInvoice('paid')} disabled={saving}>
              Mark Paid
            </button>
          )}
          <button style={styles.secondaryBtn} onClick={exportPDF}>Export PDF</button>
          <button style={styles.secondaryBtn} onClick={() => setShowSaveTemplate(true)}>Save as Template</button>
        </div>
        {existing && (
          <button style={styles.dangerBtn} onClick={deleteInvoice}>Delete</button>
        )}
      </div>

      {/* Save as Template modal */}
      {showSaveTemplate && (
        <div style={styles.modalOverlay} onClick={() => setShowSaveTemplate(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: '#e2e8f0' }}>Save as Template</h3>
            <input
              type="text"
              placeholder="Template name"
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              style={{ ...styles.input, width: '100%', marginBottom: '12px' }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button style={styles.secondaryBtn} onClick={() => setShowSaveTemplate(false)}>Cancel</button>
              <button style={styles.primaryBtn} onClick={saveAsTemplate} disabled={!templateName.trim()}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Contact Modal
// ════════════════════════════════════════════════════════════
function ContactModal({ contacts, editingContact, onEditContact, profile, onClose, onSaved }) {
  const [form, setForm] = useState(editingContact ? { ...editingContact } : { ...EMPTY_CONTACT });
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState(editingContact ? 'edit' : 'list');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingContact) {
      setForm({ ...editingContact });
      setMode('edit');
    }
  }, [editingContact]);

  function updateField(key, val) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  async function saveContact() {
    if (!form.name.trim()) return;
    setSaving(true);
    if (form.id) {
      const { id, created_at, created_by, updated_at, ...payload } = form;
      const { error } = await supabase.from('invoice_contacts').update(payload).eq('id', id);
      if (error) { alert(error.message); setSaving(false); return; }
    } else {
      const { error } = await supabase.from('invoice_contacts').insert({
        name: form.name,
        company: form.company || null,
        email: form.email || null,
        phone: form.phone || null,
        address_line1: form.address_line1 || null,
        address_line2: form.address_line2 || null,
        city: form.city || null,
        state: form.state || null,
        zip: form.zip || null,
        country: form.country || null,
        notes: form.notes || null,
        created_by: profile?.id,
      });
      if (error) { alert(error.message); setSaving(false); return; }
    }
    await onSaved();
    setSaving(false);
    setMode('list');
    setForm({ ...EMPTY_CONTACT });
    onEditContact(null);
  }

  async function deleteContact() {
    if (!form.id) return;
    if (!window.confirm(`Delete contact "${form.name}"?`)) return;
    const { error } = await supabase.from('invoice_contacts').delete().eq('id', form.id);
    if (error) { alert(error.message); return; }
    await onSaved();
    setMode('list');
    setForm({ ...EMPTY_CONTACT });
    onEditContact(null);
  }

  const filteredContacts = contacts.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (c.name || '').toLowerCase().includes(q) || (c.company || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q);
  });

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{ ...styles.modal, width: '520px', maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#e2e8f0' }}>
            {mode === 'list' ? 'Contacts' : (form.id ? 'Edit Contact' : 'New Contact')}
          </h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        {mode === 'list' ? (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input
                type="text"
                placeholder="Search contacts…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ ...styles.searchInput, flex: 1 }}
              />
              <button style={styles.primaryBtn} onClick={() => { setForm({ ...EMPTY_CONTACT }); setMode('edit'); }}>+ New</button>
            </div>
            {filteredContacts.length === 0 ? (
              <div style={styles.emptyState}>No contacts found.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {filteredContacts.map(c => (
                  <div
                    key={c.id}
                    style={styles.contactListItem}
                    onClick={() => { setForm({ ...c }); setMode('edit'); }}
                  >
                    <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '13px' }}>{c.name}</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                      {[c.company, c.email].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Name *</label>
                <input style={styles.input} value={form.name} onChange={e => updateField('name', e.target.value)} />
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Company</label>
                <input style={styles.input} value={form.company} onChange={e => updateField('company', e.target.value)} />
              </div>
              <div style={styles.editorGrid}>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Email</label>
                  <input style={styles.input} value={form.email} onChange={e => updateField('email', e.target.value)} />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Phone</label>
                  <input style={styles.input} value={form.phone} onChange={e => updateField('phone', e.target.value)} />
                </div>
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Address Line 1</label>
                <input style={styles.input} value={form.address_line1} onChange={e => updateField('address_line1', e.target.value)} />
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Address Line 2</label>
                <input style={styles.input} value={form.address_line2} onChange={e => updateField('address_line2', e.target.value)} />
              </div>
              <div style={styles.editorGrid}>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>City</label>
                  <input style={styles.input} value={form.city} onChange={e => updateField('city', e.target.value)} />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>State</label>
                  <input style={styles.input} value={form.state} onChange={e => updateField('state', e.target.value)} />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>ZIP</label>
                  <input style={styles.input} value={form.zip} onChange={e => updateField('zip', e.target.value)} />
                </div>
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Country</label>
                <input style={styles.input} value={form.country} onChange={e => updateField('country', e.target.value)} />
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Notes</label>
                <textarea style={styles.textarea} rows={2} value={form.notes} onChange={e => updateField('notes', e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', marginTop: '16px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button style={styles.secondaryBtn} onClick={() => { setMode('list'); setForm({ ...EMPTY_CONTACT }); onEditContact(null); }}>
                  {form.id ? 'Back' : 'Cancel'}
                </button>
                <button style={styles.primaryBtn} onClick={saveContact} disabled={saving || !form.name.trim()}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
              {form.id && (
                <button style={styles.dangerBtn} onClick={deleteContact}>Delete</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Styles
// ════════════════════════════════════════════════════════════
const styles = {
  page: {
    maxWidth: '1100px',
    margin: '0 auto',
    padding: '24px 20px',
    fontFamily: "'DM Sans', sans-serif",
    color: 'rgba(255,255,255,0.85)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '18px',
  },
  title: {
    margin: 0,
    fontSize: '24px',
    fontWeight: 700,
    color: '#e2e8f0',
  },

  // Tabs
  tabBar: {
    display: 'flex',
    gap: '4px',
    marginBottom: '18px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    paddingBottom: '8px',
  },
  tab: {
    background: 'none',
    border: '1px solid transparent',
    borderRadius: '6px',
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  tabActive: {
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
    borderColor: 'rgba(99,102,241,0.25)',
  },

  // Summary cards
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '12px',
  },
  summaryCard: {
    padding: '16px',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.06)',
  },

  // Section
  section: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    padding: '14px',
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#e2e8f0',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '10px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '30px 20px',
    color: 'rgba(255,255,255,0.35)',
    fontSize: '13px',
  },

  // Filters
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '10px',
  },
  pill: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '16px',
    padding: '4px 12px',
    fontSize: '12px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  pillActive: {
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
    borderColor: 'rgba(99,102,241,0.25)',
  },
  searchInput: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: '6px',
    padding: '6px 10px',
    fontSize: '13px',
    color: '#e2e8f0',
    outline: 'none',
    fontFamily: "'DM Sans', sans-serif",
    minWidth: '180px',
  },

  // Table
  tableHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 10px',
    fontSize: '11px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  tableRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    transition: 'background 0.15s',
  },

  // Badge
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '11px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },

  // Buttons
  primaryBtn: {
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '7px 16px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    whiteSpace: 'nowrap',
  },
  secondaryBtn: {
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.7)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: '6px',
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    whiteSpace: 'nowrap',
  },
  dangerBtn: {
    background: 'rgba(239,68,68,0.15)',
    color: '#ef4444',
    border: '1px solid rgba(239,68,68,0.25)',
    borderRadius: '6px',
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    whiteSpace: 'nowrap',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '13px',
    cursor: 'pointer',
    padding: '4px 8px',
    fontFamily: "'DM Sans', sans-serif",
  },
  navArrow: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '20px',
    cursor: 'pointer',
    padding: '0 8px',
    fontFamily: "'DM Sans', sans-serif",
  },

  // Dropdown
  dropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: '4px',
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: '8px',
    padding: '4px',
    zIndex: 100,
    minWidth: '200px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  dropdownItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    width: '100%',
    background: 'none',
    border: 'none',
    padding: '8px 10px',
    fontSize: '13px',
    color: '#e2e8f0',
    cursor: 'pointer',
    borderRadius: '4px',
    fontFamily: "'DM Sans', sans-serif",
    textAlign: 'left',
  },

  // Calendar
  calendarWrap: {
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    background: 'rgba(255,255,255,0.02)',
    padding: '14px',
  },
  calendarHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '10px',
  },
  calendarMonthLabel: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#e2e8f0',
  },
  calendarGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '4px',
  },
  calendarDayHeader: {
    fontSize: '10px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    textAlign: 'center',
    padding: '4px 0',
  },
  calendarCell: {
    minHeight: '90px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '6px',
    padding: '4px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  calendarCellEmpty: { minHeight: '90px' },
  calendarCellToday: {
    background: 'rgba(99,102,241,0.06)',
    border: '1px solid rgba(99,102,241,0.25)',
  },
  calendarCellNum: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.5)',
    fontWeight: 600,
  },
  calendarCellEvents: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flex: 1,
    overflow: 'hidden',
  },
  calendarEvent: {
    fontSize: '10px',
    padding: '1px 4px',
    borderRadius: '3px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  calendarMoreEvents: {
    fontSize: '10px',
    color: 'rgba(255,255,255,0.4)',
    padding: '0 4px',
  },

  // Editor
  editorSection: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    padding: '16px',
  },
  editorGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '12px',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  label: {
    fontSize: '11px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  input: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: '6px',
    padding: '7px 10px',
    fontSize: '13px',
    color: '#e2e8f0',
    outline: 'none',
    fontFamily: "'DM Sans', sans-serif",
  },
  select: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: '6px',
    padding: '7px 10px',
    fontSize: '13px',
    color: '#e2e8f0',
    outline: 'none',
    fontFamily: "'DM Sans', sans-serif",
    cursor: 'pointer',
  },
  textarea: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: '6px',
    padding: '8px 10px',
    fontSize: '13px',
    color: '#e2e8f0',
    outline: 'none',
    fontFamily: "'DM Sans', sans-serif",
    resize: 'vertical',
    width: '100%',
    boxSizing: 'border-box',
  },
  contactCard: {
    marginTop: '8px',
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },

  // Line items
  lineItemHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 0',
    fontSize: '11px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    marginBottom: '6px',
  },
  lineItemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 0',
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '0 4px',
    fontFamily: "'DM Sans', sans-serif",
    lineHeight: 1,
  },
  addLineBtn: {
    background: 'none',
    border: '1px dashed rgba(255,255,255,0.10)',
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '12px',
    color: 'rgba(255,255,255,0.4)',
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    marginTop: '6px',
    width: '100%',
  },
  subtotalRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 0 0',
    marginTop: '8px',
    borderTop: '1px solid rgba(255,255,255,0.08)',
  },

  // Action bar
  actionBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 0',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },

  // Modal
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: '12px',
    padding: '20px',
    width: '400px',
    maxWidth: '90vw',
    boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.4)',
    fontSize: '20px',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },

  // Contact list
  contactListItem: {
    padding: '8px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.04)',
  },
};
