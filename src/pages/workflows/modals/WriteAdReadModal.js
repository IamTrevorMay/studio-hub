import React, { useState, useEffect, useRef, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { supabase } from '../../../supabaseClient';
import BeatSheetChooserModal from '../../../components/BeatSheetChooserModal';

const AUTOSAVE_DEBOUNCE_MS = 600;

export default function WriteAdReadModal({ task, onClose, onSubmit }) {
  const deliverableId = task.related_entity_id;
  const ctx = task.workflow_instance?.context || {};

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [deliverable, setDeliverable] = useState(null);
  const [briefs, setBriefs] = useState([]);
  const [beatSheets, setBeatSheets] = useState([]);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushedAt, setPushedAt] = useState(false);
  const [completing, setCompleting] = useState(false);

  const dirtyRef = useRef(false);
  const textRef = useRef('');
  const saveTimerRef = useRef(null);

  // Load deliverable + campaign briefs
  useEffect(() => {
    if (!deliverableId) { setLoading(false); return; }
    (async () => {
      const { data: d } = await supabase
        .from('sponsor_deliverables')
        .select('id, title, ad_copy, notes, beat_sheet_id, campaign_id, sponsor_id, sponsors(name), sponsor_campaigns(name)')
        .eq('id', deliverableId)
        .single();

      if (d) {
        setDeliverable(d);
        const val = d.ad_copy || d.notes || '';
        setText(val);
        textRef.current = val;

        if (d.campaign_id) {
          const { data: b } = await supabase
            .from('campaign_briefs')
            .select('id, label, url, onepager_md')
            .eq('campaign_id', d.campaign_id)
            .order('position', { ascending: true });
          setBriefs(b || []);
        }
      }
      setLoading(false);
    })();
  }, [deliverableId]);

  // Beat sheets for the choose-at-push-time picker
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('beat_sheets')
        .select('id, title, folder, is_archived')
        .order('created_at', { ascending: false });
      setBeatSheets(data || []);
    })();
  }, []);

  // Save to DB
  const saveToDb = useCallback(async () => {
    if (!deliverableId || !dirtyRef.current) return;
    dirtyRef.current = false;
    setSaving(true);
    try {
      await supabase
        .from('sponsor_deliverables')
        .update({ ad_copy: textRef.current || null, updated_at: new Date().toISOString() })
        .eq('id', deliverableId);
      setLastSaved(new Date());
    } catch (err) {
      console.error('Autosave failed:', err);
    } finally {
      setSaving(false);
    }
  }, [deliverableId]);

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    textRef.current = val;
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(saveToDb, AUTOSAVE_DEBOUNCE_MS);
  };

  // Save on unmount / close
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (dirtyRef.current && deliverableId) {
        supabase
          .from('sponsor_deliverables')
          .update({ ad_copy: textRef.current || null, updated_at: new Date().toISOString() })
          .eq('id', deliverableId);
      }
    };
  }, [deliverableId]);

  // Force-flush the debounced autosave regardless of the dirty flag, so a
  // "Save & Complete" / "Save & Close" always persists the latest text.
  const saveNow = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (!deliverableId) return;
    dirtyRef.current = false;
    setSaving(true);
    try {
      await supabase
        .from('sponsor_deliverables')
        .update({ ad_copy: textRef.current || null, updated_at: new Date().toISOString() })
        .eq('id', deliverableId);
      setLastSaved(new Date());
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [deliverableId]);

  // "Close" = save-and-step-away without completing the task.
  const handleClose = async () => {
    await saveNow();
    onClose();
  };

  // "Save & Complete" = persist copy, then run the task-completion path.
  const handleSaveAndComplete = async () => {
    setCompleting(true);
    await saveNow();
    if (onSubmit) {
      // Completes the task via MyTasks.handleModalSubmit → handleComplete.
      onSubmit();
    } else {
      onClose();
    }
  };

  // Push current copy into a chosen beat sheet (choose-at-push-time).
  // Stacks multiple ad reads per sheet, keyed by deliverable id: re-pushing the
  // SAME deliverable updates its own beat in place, a DIFFERENT deliverable
  // appends a new beat. Title starts with "Ad Read" (so existing detection still
  // works) and includes the sponsor/campaign name so stacked reads are distinct.
  const handlePushToBeatSheet = async (sheetId) => {
    if (!sheetId || !textRef.current) return;
    setPushing(true);
    try {
      const { data: sheet } = await supabase
        .from('beat_sheets')
        .select('beats')
        .eq('id', sheetId)
        .single();
      if (!sheet) return;
      const existingBeats = sheet.beats || [];
      const sponsorName = deliverable?.sponsors?.name || ctx.brand_name || '';
      const campaignName = deliverable?.sponsor_campaigns?.name || '';
      let header = 'Ad Read';
      if (sponsorName) header += ' — ' + sponsorName + (campaignName ? ' (' + campaignName + ')' : '');
      const newBeatTitle = header + '\n\n' + textRef.current;
      const idx = deliverableId
        ? existingBeats.findIndex(b => b.deliverable_id === deliverableId)
        : -1;
      const updatedBeats = idx >= 0
        ? existingBeats.map((b, i) => i === idx ? { ...b, title: newBeatTitle, deliverable_id: deliverableId } : b)
        : [...existingBeats, {
            id: crypto.randomUUID(),
            title: newBeatTitle,
            context: '',
            graphics: [],
            videos: [],
            notes: '',
            deliverable_id: deliverableId,
          }];
      await supabase.from('beat_sheets').update({
        beats: updatedBeats,
        updated_at: new Date().toISOString(),
      }).eq('id', sheetId);
      setChooserOpen(false);
      setPushedAt(true);
      setTimeout(() => setPushedAt(false), 2000);
    } catch (err) {
      console.error('Push to beat sheet failed:', err);
    } finally {
      setPushing(false);
    }
  };

  const onepagerBriefs = briefs.filter(b => b.onepager_md);
  const linkBriefs = briefs.filter(b => !b.onepager_md && b.url);
  const onepagerHtml = onepagerBriefs
    .map(b => DOMPurify.sanitize(marked.parse(b.onepager_md)))
    .join('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;" />');

  const brandName = ctx.brand_name || '';
  const deliverableTitle = deliverable?.title || task.title || '';
  const canPush = !!text && !pushing && !completing;
  const pushTitle = !text ? 'Write ad copy first' : 'Push this ad copy into a beat sheet';

  return (
    <div style={s.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div style={s.modal}>
        <div style={s.header}>
          <div>
            <h3 style={s.title}>Ad Copy</h3>
            <p style={s.subtitle}>
              {deliverableTitle}{brandName ? ` · ${brandName}` : ''}
            </p>
          </div>
          <button onClick={handleClose} style={s.closeBtn}>Close</button>
        </div>

        {loading ? (
          <div style={s.loading}>Loading…</div>
        ) : (
          <div style={s.grid}>
            <div style={s.colLeft}>
              <div style={s.colHeader}>
                Editor · {saving ? 'saving…' : lastSaved ? `saved ${lastSaved.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'autosaves'}
              </div>
              <textarea
                value={text}
                onChange={handleChange}
                placeholder="Write your ad copy here…"
                style={s.textarea}
                autoFocus
              />
            </div>
            <div style={s.colRight}>
              <div style={s.colHeader}>Brief · read-only</div>
              <div style={s.briefScroll}>
                {briefs.length === 0 && (
                  <p style={s.emptyBrief}>No brief attached to this campaign yet.</p>
                )}
                {onepagerBriefs.length > 0 && (
                  <div
                    className="brief-md"
                    style={s.briefMd}
                    dangerouslySetInnerHTML={{ __html: onepagerHtml }}
                  />
                )}
                {linkBriefs.length > 0 && (
                  <div style={{ marginTop: onepagerBriefs.length > 0 ? 20 : 0 }}>
                    <p style={s.briefSubhead}>External briefs</p>
                    {linkBriefs.map(b => (
                      <a
                        key={b.id}
                        href={b.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={s.briefLink}
                      >
                        {b.label || b.url}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div style={s.footer}>
          <button
            onClick={() => setChooserOpen(true)}
            disabled={!canPush}
            title={pushTitle}
            style={{
              ...s.pushBtn,
              background: !canPush ? 'rgba(255,255,255,0.05)' : 'rgba(91, 143, 199,0.12)',
              border: '1px solid rgba(91, 143, 199,0.3)',
              color: !canPush ? 'rgba(255,255,255,0.3)' : '#8fb4d8',
              cursor: !canPush ? 'not-allowed' : 'pointer',
            }}
          >
            {pushedAt ? 'Pushed!' : pushing ? 'Pushing…' : 'Push to Beat Sheet'}
          </button>
          <button
            onClick={handleSaveAndComplete}
            disabled={completing}
            style={{
              ...s.pushBtn,
              background: completing ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, #5b8fc7, #8fb4d8)',
              color: completing ? 'rgba(255,255,255,0.3)' : '#fff',
              cursor: completing ? 'not-allowed' : 'pointer',
            }}
          >
            {completing ? 'Completing…' : 'Save & Complete'}
          </button>
        </div>
      </div>

      <BeatSheetChooserModal
        open={chooserOpen}
        beatSheets={beatSheets}
        pushing={pushing}
        onPick={handlePushToBeatSheet}
        onClose={() => setChooserOpen(false)}
      />
    </div>
  );
}

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  },
  modal: {
    background: '#1b2331', borderRadius: 14,
    width: '95vw', maxWidth: 1100, height: '82vh',
    border: '1px solid rgba(255,255,255,0.1)',
    display: 'flex', flexDirection: 'column',
    fontFamily: 'DM Sans, sans-serif',
  },
  header: {
    padding: '18px 22px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  title: { margin: '0 0 2px', fontSize: 16, fontWeight: 600, color: '#fff' },
  subtitle: { margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.4)' },
  closeBtn: {
    background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.6)', borderRadius: 6, padding: '6px 12px',
    fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  },
  loading: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'rgba(255,255,255,0.4)', fontSize: 13,
  },
  grid: {
    flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0,
  },
  colLeft: {
    display: 'flex', flexDirection: 'column',
    borderRight: '1px solid rgba(255,255,255,0.08)',
  },
  colRight: {
    display: 'flex', flexDirection: 'column', minHeight: 0,
  },
  colHeader: {
    padding: '10px 18px', fontSize: 11, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: 'rgba(255,255,255,0.4)', fontWeight: 600,
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  textarea: {
    flex: 1, minHeight: 0,
    background: 'transparent', border: 'none', outline: 'none',
    color: '#fff', fontSize: 14, lineHeight: 1.6,
    padding: '18px 22px', resize: 'none',
    fontFamily: 'DM Sans, sans-serif',
  },
  briefScroll: {
    flex: 1, minHeight: 0, overflow: 'auto', padding: '18px 22px',
  },
  emptyBrief: { margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  briefMd: { fontSize: 13, lineHeight: 1.6, color: 'rgba(255,255,255,0.85)' },
  briefSubhead: {
    margin: '0 0 8px', fontSize: 11, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: 'rgba(255,255,255,0.4)', fontWeight: 600,
  },
  briefLink: {
    display: 'block', padding: '8px 12px',
    background: 'rgba(91, 143, 199,0.08)', border: '1px solid rgba(91, 143, 199,0.2)',
    borderRadius: 8, color: '#8fb4d8', fontSize: 13,
    marginBottom: 6, textDecoration: 'none', wordBreak: 'break-all',
  },
  footer: {
    padding: '14px 22px',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    display: 'flex', justifyContent: 'flex-end', gap: 10,
  },
  pushBtn: {
    border: 'none', borderRadius: 8, padding: '10px 18px',
    fontSize: 13, fontWeight: 600, fontFamily: 'DM Sans, sans-serif',
  },
};
