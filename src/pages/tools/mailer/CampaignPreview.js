import React, { useMemo } from 'react';
import { renderCampaign } from './blockRenderer';

// Iframe-wrapped live preview of the campaign. We render to an `srcdoc`
// blob and sandbox the frame so even a malformed raw-HTML block can't
// reach into the parent document.

export default function CampaignPreview({ subject, preheader, blocks }) {
  const { html } = useMemo(
    () => renderCampaign(blocks || [], { subject, preheader }),
    [blocks, subject, preheader],
  );
  return (
    <div style={styles.wrap}>
      <div style={styles.bar}>Preview</div>
      <iframe
        title="campaign preview"
        srcDoc={html}
        sandbox="allow-same-origin"
        style={styles.frame}
      />
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden', background: '#fff' },
  bar: { padding: '6px 10px', fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#666', background: '#f5f5f7', borderBottom: '1px solid #e5e7eb' },
  frame: { flex: 1, minHeight: 0, border: 'none', width: '100%', background: '#f5f5f7' },
};
