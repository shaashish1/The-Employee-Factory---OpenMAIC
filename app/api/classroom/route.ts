import { type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  buildRequestOrigin,
  isValidClassroomId,
  persistClassroom,
  readClassroom,
  listClassrooms,
  deleteClassroom,
} from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom API');


/**
 * Preserve server-side media URLs (audioUrl, imageUrl, videoUrl) when the
 * client sends a save that has the same actions but no media URLs.
 *
 * This prevents the browser's stale IndexedDB from wiping out server-generated
 * audio when the auto-persist hook fires on classroom open.
 */
async function preserveServerMedia(
  id: string,
  incoming: { stage: unknown; scenes: Array<{ actions?: Array<Record<string, unknown>> }> },
): Promise<void> {
  try {
    const existing = await readClassroom(id);
    if (!existing) return;

    const audioByActionId = new Map<string, string>();
    const imageByActionId = new Map<string, string>();
    const videoByActionId = new Map<string, string>();
    for (const scene of (existing.scenes as Array<{ actions?: Array<Record<string, unknown>> }> ) || []) {
      for (const action of scene.actions || []) {
        const aid = action.id as string | undefined;
        if (!aid) continue;
        if (typeof action.audioUrl === 'string' && action.audioUrl) audioByActionId.set(aid, action.audioUrl);
        if (typeof action.imageUrl === 'string' && action.imageUrl) imageByActionId.set(aid, action.imageUrl);
        if (typeof action.videoUrl === 'string' && action.videoUrl) videoByActionId.set(aid, action.videoUrl);
      }
    }

    for (const scene of incoming.scenes || []) {
      for (const action of scene.actions || []) {
        const aid = action.id as string | undefined;
        if (!aid) continue;
        if (!action.audioUrl && audioByActionId.has(aid)) action.audioUrl = audioByActionId.get(aid);
        if (!action.imageUrl && imageByActionId.has(aid)) action.imageUrl = imageByActionId.get(aid);
        if (!action.videoUrl && videoByActionId.has(aid)) action.videoUrl = videoByActionId.get(aid);
      }
    }
  } catch (err) {
    log.warn(`preserveServerMedia failed [id=${id}]:`, err);
  }
}

export async function POST(request: NextRequest) {
  let stageId: string | undefined;
  let sceneCount: number | undefined;
  try {
    const body = await request.json();
    const { stage, scenes } = body;
    stageId = stage?.id;
    sceneCount = scenes?.length;

    if (!stage || !scenes) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: stage, scenes',
      );
    }

    const id = stage.id || randomUUID();
    const baseUrl = buildRequestOrigin(request);
    // Preserve server-generated audioUrl/imageUrl/videoUrl across stale client saves
    await preserveServerMedia(id, { stage, scenes });
    const persisted = await persistClassroom({ id, stage: { ...stage, id }, scenes }, baseUrl);
    return apiSuccess({ id: persisted.id, url: persisted.url }, 201);
  } catch (error) {
    log.error(
      `Classroom storage failed [stageId=${stageId ?? 'unknown'}, scenes=${sceneCount ?? 0}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to store classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');

    // List mode: GET /api/classroom (no id) → list summaries
    if (!id) {
      const classrooms = await listClassrooms();
      return apiSuccess({ classrooms });
    }

    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }
    const classroom = await readClassroom(id);
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }
    return apiSuccess({ classroom });
  } catch (error) {
    log.error(
      `Classroom retrieval failed [id=${request.nextUrl.searchParams.get('id') ?? 'list'}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  try {
    if (!id) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required parameter: id',
      );
    }
    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }
    const removed = await deleteClassroom(id);
    if (!removed) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }
    log.info(`Classroom deleted [id=${id}]`);
    return apiSuccess({ id, deleted: true });
  } catch (error) {
    log.error(`Classroom deletion failed [id=${id ?? 'unknown'}]:`, error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to delete classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}
