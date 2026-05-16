/**
 * Pollinations.ai image generation adapter.
 *
 * Free, no-API-key image generation via FLUX-family models.
 * Endpoint: https://image.pollinations.ai/prompt/{prompt}?width=W&height=H&model=M
 *
 * Models:
 *   - flux           (FLUX.1 — fast, high quality, default)
 *   - flux-realism   (photorealistic)
 *   - flux-anime     (anime/manga style)
 *   - flux-3d        (3D render style)
 *   - turbo          (fastest, lower quality)
 *
 * Returns raw image bytes (PNG/JPEG). We convert to base64 to match the
 * ImageGenerationResult interface used by OpenMAIC.
 */

import type {
  ImageGenerationConfig,
  ImageGenerationOptions,
  ImageGenerationResult,
} from '../types';

const DEFAULT_MODEL = 'flux';
const DEFAULT_BASE_URL = 'https://image.pollinations.ai';

export async function testPollinationsConnectivity(
  config: ImageGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;
  // Simple HEAD on a tiny image to validate reachability
  const probeUrl = `${baseUrl}/prompt/test?width=64&height=64&model=${encodeURIComponent(model)}&nologo=true`;
  try {
    const res = await fetch(probeUrl, { method: 'GET' });
    if (res.ok) {
      return { success: true, message: `Connected to Pollinations.ai (${model})` };
    }
    return {
      success: false,
      message: `Pollinations.ai responded ${res.status}: ${res.statusText}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Network error reaching ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function generateWithPollinations(
  config: ImageGenerationConfig,
  options: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;
  const width = options.width || 1024;
  const height = options.height || 1024;

  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    model,
    nologo: 'true',
    enhance: 'true',
    seed: String(Math.floor(Math.random() * 1_000_000)),
  });

  const url = `${baseUrl}/prompt/${encodeURIComponent(options.prompt)}?${params}`;

  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Pollinations image generation failed (${response.status}): ${response.statusText}`);
  }

  const buf = await response.arrayBuffer();
  if (buf.byteLength === 0) {
    throw new Error('Pollinations returned empty image');
  }

  const base64 = Buffer.from(buf).toString('base64');
  return { base64, width, height };
}
