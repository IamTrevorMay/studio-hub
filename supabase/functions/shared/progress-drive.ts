// Shared Drive + filename helpers for the Progress pipeline.
// Used by both sync-progress-cards (cron reconcile + self-heal) and
// progress-reorder (admin drag). Keeping cleanName/numbering here guarantees
// the two functions strip and apply the "N. " priority prefix identically —
// any drift would break cross-folder matching and the unique-title index.

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  trashed?: boolean;
  createdTime?: string;
};

export async function getDriveAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  const tokens = await res.json();
  if (!res.ok) throw new Error(tokens.error_description || "Token refresh failed");
  return tokens.access_token;
}

export async function listDriveFolder(token: string, folderId: string): Promise<DriveFile[]> {
  const all: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: "nextPageToken, files(id, name, mimeType, trashed, createdTime)",
      pageSize: "1000",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Drive list failed (${folderId}): ${err}`);
    }
    const json = await res.json();
    all.push(...(json.files || []).filter((f: DriveFile) => !f.trashed));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return all;
}

export async function renameDriveFile(token: string, fileId: string, newName: string): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive rename failed (${fileId}): ${err}`);
  }
}

/**
 * Return the file extension including the dot (e.g. ".mp4"), or "" if none.
 * Only a short alphanumeric run counts — many of these Drive files have NO
 * extension but DO contain dots (e.g. "1. Title"), so a naive "everything
 * after the last dot" would wrongly treat ". Title" as the extension.
 */
export function getExt(filename: string): string {
  const m = filename.match(/\.[A-Za-z0-9]{1,5}$/);
  return m ? m[0] : "";
}

/** Strip a leading priority number prefix like "12. " (with trailing space). */
export function stripNumberPrefix(name: string): string {
  return name.replace(/^\s*\d+\.\s+/, "");
}

/** Strip a leading "(S)" or "(E)" status prefix. */
function stripStatusPrefix(name: string): string {
  return name.replace(/^\([SE]\)\s*/i, "");
}

/**
 * Does the filename carry the edited/final "(E)" tag? "(E)" may sit before or
 * after a number prefix (e.g. "3. (E) Title" or "(E) 3. Title"), so peel the
 * number first — mirrors hasScheduledPrefix. This tag is the payroll signal:
 * an "(E)" video in the Ready folder (Watch 1) marks Alana's work complete, so
 * numbering must PRESERVE it, never strip it.
 */
export function hasEditedPrefix(filename: string): boolean {
  return /^\(E\)\s*/i.test(stripNumberPrefix(filename.replace(/\.[A-Za-z0-9]{1,5}$/, "")));
}

/**
 * Canonical title for matching: drop the extension, then peel any leading
 * number / (S) / (E) prefixes in any order until stable, and trim.
 */
export function cleanName(filename: string): string {
  let name = filename.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  let prev: string;
  do {
    prev = name;
    name = stripStatusPrefix(name);
    name = stripNumberPrefix(name);
  } while (name !== prev);
  return name.trim();
}

export function hasScheduledPrefix(filename: string): boolean {
  // "(S)" may sit before or after a number prefix; peel the number first.
  return /^\(S\)\s*/i.test(stripNumberPrefix(filename.replace(/\.[A-Za-z0-9]{1,5}$/, "")));
}

/**
 * Build the desired Drive filename for a card at 1-based position `n` in a
 * numbered column. Preserves the original extension; strips any pre-existing
 * number/status prefix from the current name first.
 *
 * `edited` re-stamps the "(E)" tag AFTER the number ("3. (E) Title"). Ready
 * cards live in Watch 1 and must keep "(E)" so the payroll trigger fires; the
 * number goes in FRONT of the tag, it does not replace it.
 */
export function numberedName(currentName: string, title: string, n: number, edited = false): string {
  const ext = getExt(currentName);
  return `${n}. ${edited ? "(E) " : ""}${title}${ext}`;
}

/**
 * Desired filename for a card that should NOT be numbered (e.g. scheduled).
 * Keeps a leading "(S)" if present, drops any number prefix.
 */
export function unnumberedName(currentName: string, title: string, scheduled: boolean): string {
  const ext = getExt(currentName);
  return `${scheduled ? "(S) " : ""}${title}${ext}`;
}

/** Does the current filename already match the desired numbered name? */
export function nameHasNumber(currentName: string, n: number): boolean {
  return new RegExp(`^\\s*${n}\\.\\s+`).test(currentName);
}
