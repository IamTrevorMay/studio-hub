import React from 'react';
import ToolScaffold from './_ToolScaffold';

export default function ReportCards({ onBack }) {
  return (
    <ToolScaffold
      onBack={onBack}
      title="Report Cards"
      description="Drag-and-drop builder for data-driven player report cards. Build templates, then auto-populate from player data and export PNG/PDF."
      tritonPath="/design/report-cards"
      status="Phase 3"
    />
  );
}
