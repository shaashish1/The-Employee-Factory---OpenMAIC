/**
 * Server-side classroom backup.
 *
 * - syncStageToServer: POST a single stage to /api/classroom
 * - backupAllStagesToServer: iterate IndexedDB and back up every stage
 *
 * Auto-persist on save is wired in stage-storage.ts to call syncStageToServer
 * fire-and-forget after every saveStageData. This guarantees server-side
 * recovery even if browser data is lost.
 */

import { db } from '@/lib/utils/database';
import type { Stage, Scene } from '@/lib/types/stage';
import { createLogger } from '@/lib/logger';

const log = createLogger('ServerBackup');

const pendingSyncs = new Map<string, ReturnType<typeof setTimeout>>();
const SYNC_DEBOUNCE_MS = 3000;

/**
 * Build the persisted-classroom payload for /api/classroom from IndexedDB.
 */
async function buildPayload(stageId: string): Promise<{ stage: Stage; scenes: Scene[] } | null> {
  const stageRow = await db.stages.get(stageId);
  if (!stageRow) return null;
  const scenesWithStageId = await db.scenes.where('stageId').equals(stageId).sortBy('order');
  // Strip Dexie-internal stageId from scenes; the persisted shape doesn't carry it
  const scenes = scenesWithStageId.map((scene) => {
    // Strip the Dexie stageId field; the API expects clean Scene shape
    const { stageId: _omit, ...clean } = scene as unknown as Scene & {
      stageId?: string;
    };
    void _omit;
    return clean as Scene;
  });
  // Pass-through the stage row (it already matches Stage shape)
  return {
    stage: stageRow as unknown as Stage,
    scenes,
  };
}

async function postToServer(payload: { stage: Stage; scenes: Scene[] }): Promise<boolean> {
  try {
    const res = await fetch('/api/classroom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      log.warn(`Server backup failed [${res.status}] for stage ${payload.stage.id}`);
      return false;
    }
    return true;
  } catch (err) {
    log.warn(`Server backup network error for stage ${payload.stage.id}:`, err);
    return false;
  }
}

/**
 * Debounced sync of a single stage from IndexedDB to /api/classroom.
 * Called fire-and-forget from saveStageData.
 */
export function syncStageToServer(stageId: string): void {
  if (!stageId) return;
  const existing = pendingSyncs.get(stageId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(async () => {
    pendingSyncs.delete(stageId);
    const payload = await buildPayload(stageId);
    if (!payload || payload.scenes.length === 0) return;
    const ok = await postToServer(payload);
    if (ok) log.info(`Auto-saved stage to server: ${stageId} (${payload.scenes.length} scenes)`);
  }, SYNC_DEBOUNCE_MS);
  pendingSyncs.set(stageId, t);
}

/** Force-sync a single stage immediately (no debounce). For manual save button. */
export async function syncStageNow(stageId: string): Promise<boolean> {
  if (!stageId) return false;
  const existing = pendingSyncs.get(stageId);
  if (existing) {
    clearTimeout(existing);
    pendingSyncs.delete(stageId);
  }
  const payload = await buildPayload(stageId);
  if (!payload) return false;
  return await postToServer(payload);
}

/**
 * One-click backup of EVERY classroom in IndexedDB to the server.
 * Returns counts: total / ok / failed / urls of saved classrooms.
 */
export async function backupAllStagesToServer(): Promise<{
  total: number;
  ok: number;
  failed: number;
  saved: Array<{ id: string; name: string; scenes: number }>;
}> {
  const all = await db.stages.toArray();
  const saved: Array<{ id: string; name: string; scenes: number }> = [];
  let ok = 0;
  let failed = 0;
  for (const row of all) {
    const payload = await buildPayload(row.id);
    if (!payload || payload.scenes.length === 0) {
      failed++;
      continue;
    }
    const success = await postToServer(payload);
    if (success) {
      ok++;
      saved.push({ id: row.id, name: row.name, scenes: payload.scenes.length });
    } else {
      failed++;
    }
  }
  log.info(`Backup complete: ok=${ok} failed=${failed} total=${all.length}`);
  return { total: all.length, ok, failed, saved };
}

/**
 * Expose on window so it's callable from devtools / the admin button.
 */
if (typeof window !== 'undefined') {
  (window as unknown as { __maicBackup: typeof backupAllStagesToServer }).__maicBackup =
    backupAllStagesToServer;
  (window as unknown as { __maicSyncNow: typeof syncStageNow }).__maicSyncNow = syncStageNow;
}

// ---------------------------------------------------------------------------
// Restore: pull a server-side classroom back into the user's IndexedDB
// ---------------------------------------------------------------------------

export interface ServerClassroomSummary {
  id: string;
  name: string;
  sceneCount: number;
  createdAt: string;
  sizeBytes: number;
}

/** Fetch the list of server-side classrooms. */
export async function listServerClassrooms(): Promise<ServerClassroomSummary[]> {
  const res = await fetch('/api/classroom');
  if (!res.ok) {
    log.warn(`listServerClassrooms: HTTP ${res.status}`);
    return [];
  }
  const json = (await res.json()) as { success: boolean; classrooms?: ServerClassroomSummary[] };
  return json?.classrooms ?? [];
}

/** Restore a single classroom from server JSON into the browser's IndexedDB. */
export async function restoreClassroomFromServer(id: string): Promise<{
  ok: boolean;
  name?: string;
  scenes?: number;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/classroom?id=${encodeURIComponent(id)}`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = (await res.json()) as {
      success: boolean;
      classroom?: { stage: Stage; scenes: Scene[] };
    };
    const data = json?.classroom;
    if (!data?.stage || !Array.isArray(data.scenes)) return { ok: false, error: 'Bad payload' };

    const now = Date.now();
    const stage = data.stage;
    const scenes = data.scenes;

    // Write stage row
    await db.stages.put({
      id: stage.id,
      name: stage.name || 'Restored classroom',
      description: stage.description,
      createdAt: stage.createdAt || now,
      updatedAt: now,
      languageDirective: stage.languageDirective,
      style: stage.style,
      currentSceneId: scenes[0]?.id,
      agentIds: stage.agentIds,
      videoManifest: stage.videoManifest,
      interactiveMode: stage.interactiveMode,
    });

    // Replace scenes
    await db.scenes.where('stageId').equals(stage.id).delete();
    if (scenes.length > 0) {
      await db.scenes.bulkPut(
        scenes.map((scene, index) => ({
          ...scene,
          stageId: stage.id,
          order: scene.order ?? index,
          createdAt: scene.createdAt || now,
          updatedAt: scene.updatedAt || now,
        })),
      );
    }

    log.info(`Restored stage from server: ${stage.id} (${scenes.length} scenes)`);
    return { ok: true, name: stage.name, scenes: scenes.length };
  } catch (err) {
    log.warn(`restoreClassroomFromServer failed for ${id}:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Delete a server-side classroom. */
export async function deleteServerClassroom(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/classroom?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok;
  } catch (err) {
    log.warn(`deleteServerClassroom failed for ${id}:`, err);
    return false;
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as { __maicListServer: typeof listServerClassrooms }).__maicListServer =
    listServerClassrooms;
  (window as unknown as { __maicRestore: typeof restoreClassroomFromServer }).__maicRestore =
    restoreClassroomFromServer;
}
