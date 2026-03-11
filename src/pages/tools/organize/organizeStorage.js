const META_FILE = '_organize.json';
const BACKUP_FILE = '_organize_backup.json';

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateXmp({ title, description, type, subtype }) {
  const keywords = [type, subtype].filter(Boolean);
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${escapeXml(title || '')}</rdf:li>
        </rdf:Alt>
      </dc:title>
      <dc:description>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${escapeXml(description || '')}</rdf:li>
        </rdf:Alt>
      </dc:description>
      <dc:subject>
        <rdf:Bag>
${keywords.map(k => `          <rdf:li>${escapeXml(k)}</rdf:li>`).join('\n')}
        </rdf:Bag>
      </dc:subject>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export async function writeXmpSidecar(dirHandle, fileName, meta) {
  const xmpName = fileName.replace(/\.[^.]+$/, '') + '.xmp';
  const xmpContent = generateXmp(meta);
  const fileHandle = await dirHandle.getFileHandle(xmpName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(xmpContent);
  await writable.close();
}

export async function removeXmpSidecar(dirHandle, fileName) {
  const xmpName = fileName.replace(/\.[^.]+$/, '') + '.xmp';
  try {
    await dirHandle.removeEntry(xmpName);
  } catch {
    // already gone
  }
}

export async function readMetadata(dirHandle) {
  try {
    const fileHandle = await dirHandle.getFileHandle(META_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function writeMetadata(dirHandle, metadata) {
  const fileHandle = await dirHandle.getFileHandle(META_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(metadata, null, 2));
  await writable.close();
}

export async function readBackup(dirHandle) {
  try {
    const fileHandle = await dirHandle.getFileHandle(BACKUP_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function writeBackup(dirHandle, backup) {
  const fileHandle = await dirHandle.getFileHandle(BACKUP_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(backup, null, 2));
  await writable.close();
}

export async function deleteBackup(dirHandle) {
  try {
    await dirHandle.removeEntry(BACKUP_FILE);
  } catch {
    // already gone
  }
}
