const META_FILE = '_organize.json';
const BACKUP_FILE = '_organize_backup.json';

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
