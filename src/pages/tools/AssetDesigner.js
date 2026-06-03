import React from 'react';
import ToolScaffold from './_ToolScaffold';

export default function AssetDesigner({ onBack }) {
  return (
    <ToolScaffold
      onBack={onBack}
      title="Asset Designer"
      description="Canvas designer for logos, badges, and lower-thirds. Push outputs into Scene Composer / Template Builder."
      tritonPath="/design/asset-designer"
      status="Scaffold"
    />
  );
}
