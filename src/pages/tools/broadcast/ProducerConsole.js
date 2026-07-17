import React, { useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily } from '../../../lib/styleTokens';
import { useBroadcastState } from './useBroadcastState';
import { useObs } from './useObs';
import { useStreamDeck } from './useStreamDeck';
import BroadcastCanvas from './BroadcastCanvas';
import TriggerBar from './TriggerBar';
import LiveControlGrid from './LiveControlGrid';
import OBSSettings from './OBSSettings';
import StreamDeckSetup from './StreamDeckSetup';
import StreamDeckGrid from './StreamDeckGrid';
import LivePreview from './LivePreview';
import ClipMarkerPanel from './ClipMarkerPanel';
import TemplateDataPanel from './TemplateDataPanel';
import ChatReplay from './ChatReplay';
import { updateSession } from './api';
import { clickableKeyProps } from '../../../lib/styleRecipes';

// Full producer surface. Live state via useBroadcastState (subscribes to
// session row updates over Realtime). Hardware integrations: OBS WS +
// StreamDeck WebHID. Triggers post through /api/broadcast/trigger.

export default function ProducerConsole({ project, session: initialSession, onClose }) {
  const state = useBroadcastState({ project, session: initialSession });
  const obs = useObs();
  const deck = useStreamDeck();
  const [selectedScene, setSelectedScene] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [showObs, setShowObs] = useState(false);
  const [showDeck, setShowDeck] = useState(false);
  const [rightTab, setRightTab] = useState('triggers'); // triggers | data | markers | chat

  const session = state.session;
  const overlayUrl = `${window.location.origin}/broadcast-overlay/${encodeURIComponent(session.channel_name)}`;

  async function endLive() {
    if (!window.confirm('End this live session?')) return;
    try { await updateSession(session.id, { is_live: false }); }
    finally { onClose(); }
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <button onClick={onClose} style={styles.backBtn} title="Back to project">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span style={styles.title}>{project.name}</span>
        <span style={styles.slug}>· {session.channel_name}</span>
        {session.is_live && <span style={styles.livePill}>LIVE</span>}

        <div style={styles.headerActions}>
          <button onClick={() => setShowObs(true)} style={iconBtnStyle(obs.status)}>OBS · {obs.status}</button>
          <button onClick={() => setShowDeck(true)} style={iconBtnStyle(deck.status)}>StreamDeck · {deck.status}</button>
          <button onClick={() => navigator.clipboard.writeText(overlayUrl)} style={styles.copyBtn}>Copy overlay URL</button>
          <button onClick={endLive} style={styles.endBtn}>End live</button>
        </div>
      </header>

      {state.error && <div style={styles.errorBar}>{state.error}</div>}

      <div style={styles.body}>
        <aside style={styles.left}>
          <div style={styles.sectionLbl}>Scenes</div>
          {state.scenes.length === 0
            ? <div style={styles.empty}>No scenes.</div>
            : state.scenes.map((s) => (
              <button
                key={s.id} onClick={() => setSelectedScene(s.id === selectedScene ? null : s.id)}
                style={{ ...styles.sceneBtn, ...(s.id === selectedScene ? styles.sceneBtnActive : {}) }}
              >
                {s.name}
              </button>
            ))}
          <div style={{ ...styles.sectionLbl, marginTop: spacing.lg }}>Hotkey grid</div>
          <LiveControlGrid session={session} assets={state.assets} visibleAssetIds={state.visibleAssetIds} />
          <div style={{ ...styles.sectionLbl, marginTop: spacing.lg }}>StreamDeck mirror</div>
          <StreamDeckGrid deck={deck} session={session} assets={state.assets} visibleAssetIds={state.visibleAssetIds} />
        </aside>

        <main style={styles.center}>
          <BroadcastCanvas
            assets={state.assets}
            sceneAssets={state.sceneAssets}
            sceneId={selectedScene}
            visibleAssetIds={state.visibleAssetIds}
            onSelect={setSelectedAsset}
            selectedId={selectedAsset && selectedAsset.id}
          />
          <TriggerBar
            session={session} assets={state.assets}
            visibleAssetIds={state.visibleAssetIds}
            onTriggered={() => null}
          />
          <LivePreview session={session} />
        </main>

        <aside style={styles.right}>
          <div style={styles.rightTabs}>
            {['triggers', 'data', 'markers', 'chat'].map((t) => (
              <button key={t} onClick={() => setRightTab(t)}
                style={{ ...styles.rightTab, ...(rightTab === t ? styles.rightTabActive : {}) }}>
                {t}
              </button>
            ))}
          </div>
          {rightTab === 'triggers' && (
            <div style={styles.assetsList}>
              {state.assets.length === 0
                ? <div style={styles.empty}>No assets.</div>
                : state.assets.map((a) => (
                  <div key={a.id} {...clickableKeyProps(() => setSelectedAsset(a))} onClick={() => setSelectedAsset(a)}
                    style={{ ...styles.assetRow, ...(selectedAsset && selectedAsset.id === a.id ? styles.assetRowSel : {}) }}>
                    <span style={styles.dot(state.visibleAssetIds.has(a.id))} />
                    <span style={styles.assetName}>{a.name}</span>
                    <span style={styles.assetType}>{a.asset_type}</span>
                  </div>
                ))}
            </div>
          )}
          {rightTab === 'data' && (
            <TemplateDataPanel asset={selectedAsset} onChanged={state.refresh} />
          )}
          {rightTab === 'markers' && <ClipMarkerPanel session={session} />}
          {rightTab === 'chat'    && <ChatReplay session={session} />}
        </aside>
      </div>

      {showObs && <OBSSettings obs={obs} onClose={() => setShowObs(false)} />}
      {showDeck && <StreamDeckSetup deck={deck} onClose={() => setShowDeck(false)} />}
    </div>
  );
}

function iconBtnStyle(status) {
  return {
    padding: `${spacing.xs}px ${spacing.sm}px`,
    background: 'transparent',
    border: `1px solid ${
      status === 'connected' ? colors.success.border
        : status === 'error' || status === 'unsupported' ? colors.danger.border
        : colors.border
    }`,
    borderRadius: radii.sm,
    color: status === 'connected' ? colors.success.fg
      : status === 'error' || status === 'unsupported' ? colors.danger.fg
      : colors.textMuted,
    fontSize: fontSizes.xxs,
    fontFamily: 'inherit',
    cursor: 'pointer',
    textTransform: 'uppercase', letterSpacing: '0.06em',
  };
}

const styles = {
  container: { height: '100vh', display: 'flex', flexDirection: 'column', background: colors.bg, color: colors.text, fontFamily },
  header: {
    height: 52, flexShrink: 0, display: 'flex', alignItems: 'center',
    gap: spacing.sm, padding: `0 ${spacing.lg}px`,
    borderBottom: `1px solid ${colors.border}`, background: colors.bgRaised,
  },
  backBtn: {
    width: 32, height: 32, border: 'none', background: 'transparent',
    color: colors.textMuted, cursor: 'pointer', borderRadius: radii.sm,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.text },
  slug: { fontSize: fontSizes.xs, color: colors.textSubtle, fontFamily: 'monospace' },
  livePill: {
    padding: `${spacing.xs}px ${spacing.sm}px`, fontSize: fontSizes.xxs,
    color: '#fff', background: colors.danger.fg, borderRadius: radii.pill,
    fontWeight: fontWeights.bold, letterSpacing: '0.06em',
  },
  headerActions: { marginLeft: 'auto', display: 'flex', gap: spacing.xs },
  copyBtn: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: 'transparent',
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.textMuted, fontSize: fontSizes.xxs, cursor: 'pointer', fontFamily: 'inherit',
  },
  endBtn: {
    padding: `${spacing.xs}px ${spacing.md}px`, background: colors.danger.fg,
    color: '#fff', border: 'none', borderRadius: radii.sm, cursor: 'pointer',
    fontSize: fontSizes.xs, fontWeight: fontWeights.semibold, fontFamily: 'inherit',
  },
  errorBar: { padding: spacing.sm, background: colors.danger.bg, color: colors.danger.fg, fontSize: fontSizes.xs, textAlign: 'center' },
  body: { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '260px 1fr 320px' },
  left: {
    overflow: 'auto', padding: spacing.md, gap: spacing.xs,
    borderRight: `1px solid ${colors.border}`, background: colors.bgRaised,
    display: 'flex', flexDirection: 'column',
  },
  center: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  right: {
    overflow: 'hidden', display: 'flex', flexDirection: 'column',
    borderLeft: `1px solid ${colors.border}`, background: colors.bgRaised,
  },
  sectionLbl: { fontSize: fontSizes.xxs, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: fontWeights.bold, padding: `${spacing.xs}px 0` },
  empty: { padding: spacing.md, fontSize: fontSizes.xs, color: colors.textSubtle, textAlign: 'center' },
  sceneBtn: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.xs, cursor: 'pointer', fontFamily: 'inherit',
    textAlign: 'left',
  },
  sceneBtnActive: { background: colors.accentSoft, borderColor: colors.accentBorder, color: colors.accentFg },
  rightTabs: { display: 'flex', borderBottom: `1px solid ${colors.border}` },
  rightTab: {
    flex: 1, padding: `${spacing.sm}px 0`, background: 'transparent',
    border: 'none', borderBottom: `2px solid transparent`,
    color: colors.textMuted, fontSize: fontSizes.xxs, cursor: 'pointer',
    fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  rightTabActive: { color: colors.accentFg, borderBottomColor: colors.accent },
  assetsList: { overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4, padding: spacing.md },
  assetRow: { display: 'flex', alignItems: 'center', gap: spacing.sm, padding: spacing.xs, background: colors.bgInput, border: `1px solid ${colors.border}`, borderRadius: radii.sm, cursor: 'pointer' },
  assetRowSel: { borderColor: colors.accentBorder, background: colors.accentSoft },
  dot: (on) => ({ width: 8, height: 8, borderRadius: '50%', background: on ? colors.success.fg : colors.border }),
  assetName: { flex: 1, fontSize: fontSizes.xs, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  assetType: { fontSize: fontSizes.xxs, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: '0.06em' },
};
