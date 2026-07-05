// CSV parser for manual transaction imports (Amex statement downloads and
// similar). Finds date/description/amount columns by header name and returns
// normalized rows for the import-transactions edge function.

// Minimal RFC-4180 parser: quoted fields, escaped quotes, CRLF.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

const DATE_HEADERS = ['date', 'transaction date', 'posted date', 'post date'];
const DESC_HEADERS = ['description', 'merchant', 'payee', 'name', 'details'];
const AMOUNT_HEADERS = ['amount', 'transaction amount'];

function findColumn(headers, candidates) {
  const lower = headers.map(h => h.trim().toLowerCase());
  for (const c of candidates) {
    const i = lower.indexOf(c);
    if (i !== -1) return i;
  }
  return -1;
}

// Returns { rows: [{date, description, amount}], errors: [string] }.
// `date` stays as-found (the edge fn normalizes M/D/YYYY and YYYY-MM-DD).
export function parseTransactionsCsv(text) {
  const errors = [];
  const raw = parseCsv(text);
  if (raw.length < 2) return { rows: [], errors: ['File has no data rows.'] };

  const headers = raw[0];
  const dateCol = findColumn(headers, DATE_HEADERS);
  const descCol = findColumn(headers, DESC_HEADERS);
  const amountCol = findColumn(headers, AMOUNT_HEADERS);
  if (dateCol === -1 || descCol === -1 || amountCol === -1) {
    return {
      rows: [],
      errors: [`Couldn't find required columns. Need Date, Description, and Amount headers — got: ${headers.join(', ')}`],
    };
  }

  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const date = (r[dateCol] || '').trim();
    const description = (r[descCol] || '').trim();
    const amount = parseFloat((r[amountCol] || '').replace(/[$,]/g, ''));
    if (!date || !description || !Number.isFinite(amount)) {
      errors.push(`Row ${i + 1} skipped (missing/invalid field).`);
      continue;
    }
    rows.push({ date, description, amount });
  }
  return { rows, errors };
}
