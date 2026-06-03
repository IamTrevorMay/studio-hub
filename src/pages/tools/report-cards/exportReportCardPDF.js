import { jsPDF } from 'jspdf';

// Wrap a rendered PNG blob in a single-page PDF whose page size matches
// the Scene's pixel dimensions. Simpler than Triton's version because
// we already have a real PNG from the Vercel renderer; we don't have to
// scrape pixels off a DOM canvas.

export async function exportReportCardPDF(pngBlob, scene, filename) {
  const dataUrl = await blobToDataUrl(pngBlob);
  const isLandscape = scene.width > scene.height;
  const pdf = new jsPDF({
    orientation: isLandscape ? 'landscape' : 'portrait',
    unit: 'px',
    format: [scene.width, scene.height],
  });
  pdf.addImage(dataUrl, 'PNG', 0, 0, scene.width, scene.height);
  pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('blob → dataUrl failed'));
    reader.readAsDataURL(blob);
  });
}
