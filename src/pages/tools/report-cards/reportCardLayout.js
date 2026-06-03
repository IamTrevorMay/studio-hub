// suggestLayout — auto-arrange elements into a sensible default layout.
// Ported from Triton lib/reportCardLayout.ts. Pure function; no side
// effects. Categorizes elements (shapes → bg, titles → top, player image
// → top-left, everything else → row-flow on the right) and returns a
// new Scene with rewritten x/y/zIndex.

const PAD = 40;
const GAP = 20;

export function suggestLayout(scene) {
  const { width: canvasW } = scene;
  const elements = [...(scene.elements || [])];
  if (elements.length === 0) return scene;

  const titles = [];
  const playerImages = [];
  const dataObjects = [];
  const shapes = [];

  for (const el of elements) {
    if (el.type === 'text') titles.push(el);
    else if (el.type === 'player-image') playerImages.push(el);
    else if (el.type === 'shape' || el.type === 'image') shapes.push(el);
    else dataObjects.push(el);
  }

  // Larger data objects first.
  dataObjects.sort((a, b) => (b.width * b.height) - (a.width * a.height));

  const result = [];
  let cursorY = PAD;
  let nextZ = 1;

  for (const el of shapes) {
    result.push({ ...el, zIndex: nextZ++ });
  }

  for (const el of titles) {
    result.push({ ...el, x: PAD, y: cursorY, width: canvasW - PAD * 2, zIndex: nextZ++ });
    cursorY += el.height + GAP;
  }

  let imageEndX = PAD;
  for (const el of playerImages) {
    result.push({ ...el, x: PAD, y: cursorY, zIndex: nextZ++ });
    imageEndX = PAD + el.width + GAP;
  }

  const flowStartX = playerImages.length > 0 ? imageEndX : PAD;
  const flowEndX = canvasW - PAD;
  let rowX = flowStartX;
  let rowY = cursorY;
  let rowMaxH = 0;

  for (const el of dataObjects) {
    const playerImgH = playerImages[0] ? playerImages[0].height : 0;
    const effectiveStartX = (rowY >= cursorY + playerImgH + GAP) ? PAD : flowStartX;
    const effectiveEndX = (rowY >= cursorY + playerImgH + GAP) ? canvasW - PAD : flowEndX;

    if (rowX < effectiveStartX) rowX = effectiveStartX;
    if (rowX + el.width > effectiveEndX && rowX > effectiveStartX) {
      rowX = effectiveStartX;
      rowY += rowMaxH + GAP;
      rowMaxH = 0;
    }

    result.push({ ...el, x: Math.round(rowX), y: Math.round(rowY), zIndex: nextZ++ });
    rowX += el.width + GAP;
    rowMaxH = Math.max(rowMaxH, el.height);
  }

  return { ...scene, elements: result };
}
