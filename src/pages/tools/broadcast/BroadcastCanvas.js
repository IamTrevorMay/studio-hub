import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import WidgetCanvasPreview from './WidgetCanvasPreview';

// Renders a 1920x1080 stage scaled to fit. Stacks each visible asset
// according to layer + canvas_x/y/width/height (or per-scene overrides
// if a scene is selected). Click a tile to select it for editing.

const STAGE_W = 1920;
const STAGE_H = 1080;

export default function BroadcastCanvas({ assets, visibleAssetIds, sceneAssets, sceneId, onSelect, selectedId }) {
  const visible = assets
    .filter((a) => visibleAssetIds.has(a.id))
    .map((a) => withOverrides(a, sceneAssets, sceneId))
    .sort((a, b) => (a.layer || 0) - (b.layer || 0));

  return (
    <div style={styles.outer}>
      <div style={styles.stageWrap}>
        <div style={styles.stage}>
          {visible.length === 0 && (
            <div style={styles.empty}>Nothing visible. Trigger an asset from the right panel.</div>
          )}
          {visible.map((a) => (
            <div
              key={a.id}
              onClick={() => onSelect && onSelect(a)}
              style={{
                position: 'absolute',
                left:   `${pct(a.canvas_x ?? 0, STAGE_W)}%`,
                top:    `${pct(a.canvas_y ?? 0, STAGE_H)}%`,
                width:  a.canvas_width  != null ? `${pct(a.canvas_width, STAGE_W)}%` : 'auto',
                height: a.canvas_height != null ? `${pct(a.canvas_height, STAGE_H)}%` : 'auto',
                opacity: a.opacity ?? 1,
                outline: selectedId === a.id ? `2px solid ${colors.accent}` : '1px dashed rgba(255,255,255,0.15)',
                outlineOffset: 0,
                cursor: 'pointer',
                background: 'rgba(0,0,0,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 12,
                overflow: 'hidden',
              }}
              title={a.name}
            >
              <WidgetCanvasPreview asset={a} />
            </div>
          ))}
        </div>
      </div>
      <div style={styles.legend}>
        Stage 1920×1080 · {visible.length} visible
      </div>
    </div>
  );
}

function withOverrides(asset, sceneAssets, sceneId) {
  if (!sceneId) return asset;
  const link = (sceneAssets || []).find((sa) => sa.scene_id === sceneId && sa.asset_id === asset.id);
  if (!link) return asset;
  return {
    ...asset,
    canvas_x:      link.override_x      ?? asset.canvas_x,
    canvas_y:      link.override_y      ?? asset.canvas_y,
    canvas_width:  link.override_width  ?? asset.canvas_width,
    canvas_height: link.override_height ?? asset.canvas_height,
    layer:         link.override_layer  ?? asset.layer,
    opacity:       link.override_opacity ?? asset.opacity,
  };
}
function pct(n, total) { return (Number(n) / total) * 100; }

const styles = {
  outer: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: spacing.md, gap: spacing.xs },
  stageWrap: {
    flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#0a0a14', border: `1px solid ${colors.border}`, borderRadius: radii.md,
    overflow: 'hidden',
  },
  stage: {
    position: 'relative',
    width: '100%', aspectRatio: '16 / 9',
    maxHeight: '100%',
    background: '#000000',
  },
  empty: {
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: colors.textSubtle, fontSize: fontSizes.sm, padding: spacing.lg, textAlign: 'center',
  },
  legend: { fontSize: fontSizes.xxs, color: colors.textSubtle, fontFamily: 'monospace', textAlign: 'right' },
};
