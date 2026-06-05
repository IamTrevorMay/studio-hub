import React from 'react';
import ToolScaffold from './_ToolScaffold';

export default function SceneComposer({ onBack }) {
  return (
    <ToolScaffold
      onBack={onBack}
      title="Scene Composer"
      description="Drag-and-drop broadcast graphic composer for leaderboards, outing cards, and live overlays."
      tritonPath="/design/scene-composer"
      status="Scaffold"
    />
  );
}
