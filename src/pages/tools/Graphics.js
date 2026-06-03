import React from 'react';
import ToolScaffold from './_ToolScaffold';

export default function Graphics({ onBack }) {
  return (
    <ToolScaffold
      onBack={onBack}
      title="Graphics"
      description="Pick a widget, tweak filters, hit Export — produces broadcast graphics like player cards and heat maps. Server renderer being ported from Triton."
      tritonPath="/design/imagine"
      status="Phase 2"
    />
  );
}
