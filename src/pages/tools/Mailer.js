import React from 'react';
import ToolScaffold from './_ToolScaffold';

export default function Mailer({ onBack }) {
  return (
    <ToolScaffold
      onBack={onBack}
      title="Mailer"
      description="Block-based newsletter editor with audiences, scheduled sends, open/click tracking, and Resend webhooks. Being ported from Triton."
      tritonPath="/design/emails"
      status="Phase 4"
    />
  );
}
