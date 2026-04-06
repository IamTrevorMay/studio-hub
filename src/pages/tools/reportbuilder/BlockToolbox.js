import React, { useState, useCallback } from 'react';
import { Droppable, Draggable } from '@hello-pangea/dnd';
import SectionsLibrary from './SectionsLibrary';
import { BLOCK_TYPES, createBlock } from './reportBuilderConstants';

export default function BlockToolbox({
  sections,
  selectedSectionIds,
  onAddSection,
  onSectionCreated,
  onSectionDeleted,
  onAddBlock,
}) {
  const [tab, setTab] = useState('blocks');

  const handleBlockClick = useCallback((type) => {
    onAddBlock(createBlock(type));
  }, [onAddBlock]);

  return (
    <div style={styles.container}>
      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          style={{ ...styles.tab, ...(tab === 'blocks' ? styles.tabActive : {}) }}
          onClick={() => setTab('blocks')}
        >
          Blocks
        </button>
        <button
          style={{ ...styles.tab, ...(tab === 'sections' ? styles.tabActive : {}) }}
          onClick={() => setTab('sections')}
        >
          Sections
        </button>
      </div>

      {/* Blocks tab */}
      {tab === 'blocks' && (
        <div style={styles.scrollArea}>
          <div style={styles.hint}>Drag onto canvas or click to add</div>
          <Droppable droppableId="block-toolbox" isDropDisabled={true}>
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} style={styles.grid}>
                {BLOCK_TYPES.map((bt, index) => (
                  <Draggable key={bt.type} draggableId={`toolbox-${bt.type}`} index={index}>
                    {(dragProvided, dragSnapshot) => (
                      <>
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          {...dragProvided.dragHandleProps}
                          style={{
                            ...styles.blockCard,
                            ...(dragSnapshot.isDragging ? styles.blockCardDragging : {}),
                            ...dragProvided.draggableProps.style,
                          }}
                          onClick={() => handleBlockClick(bt.type)}
                        >
                          <div style={styles.blockIcon}>{bt.icon}</div>
                          <div style={styles.blockLabel}>{bt.label}</div>
                        </div>
                        {dragSnapshot.isDragging && (
                          <div style={styles.blockCard}>
                            <div style={styles.blockIcon}>{bt.icon}</div>
                            <div style={styles.blockLabel}>{bt.label}</div>
                          </div>
                        )}
                      </>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </div>
      )}

      {/* Sections tab */}
      {tab === 'sections' && (
        <SectionsLibrary
          sections={sections}
          selectedIds={selectedSectionIds}
          onAdd={onAddSection}
          onGenerated={onSectionCreated}
          onDelete={onSectionDeleted}
        />
      )}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'rgba(255,255,255,0.01)',
    borderLeft: '1px solid rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  tab: {
    flex: 1,
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: 'rgba(255,255,255,0.4)',
    fontSize: '12px',
    fontWeight: 600,
    fontFamily: 'inherit',
    padding: '10px 12px',
    cursor: 'pointer',
    transition: 'color 0.12s, border-color 0.12s',
  },
  tabActive: {
    color: '#a5b4fc',
    borderBottomColor: '#6366f1',
  },
  scrollArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px',
  },
  hint: {
    fontSize: '10px',
    color: 'rgba(255,255,255,0.3)',
    marginBottom: '10px',
    textAlign: 'center',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
  },
  blockCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    padding: '14px 8px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '6px',
    cursor: 'grab',
    transition: 'background 0.12s, border-color 0.12s',
  },
  blockCardDragging: {
    background: 'rgba(99,102,241,0.1)',
    borderColor: 'rgba(99,102,241,0.3)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
  blockIcon: {
    fontSize: '18px',
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 1,
  },
  blockLabel: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
  },
};
