import React from 'react';
import ToolScaffold from './_ToolScaffold';

export default function Broadcast({ onBack }) {
  return (
    <ToolScaffold
      onBack={onBack}
      title="Broadcast"
      description="Live show producer: OBS control, Stream Deck triggers, scene assets, and clip markers. Being ported from Triton."
      tritonPath="/broadcast"
      status="Phase 5"
    />
  );
}
