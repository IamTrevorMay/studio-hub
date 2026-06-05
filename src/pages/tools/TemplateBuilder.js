import React from 'react';
import ToolScaffold from './_ToolScaffold';

export default function TemplateBuilder({ onBack }) {
  return (
    <ToolScaffold
      onBack={onBack}
      title="Template Builder"
      description="WYSIWYG data-binding template designer for reusable broadcast graphics."
      tritonPath="/design/template-builder"
      status="Scaffold"
    />
  );
}
