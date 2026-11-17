/** Fake generator only. A fixed PNG, never an outbound image/model request. */
import type { ImageArguments, ImageGenerationAvailability, ImageGenerationInfo } from '@/api/schema';
import { uid } from '@/lib/uid';
import { fixtures, PREVIEW_USER_ID, startJob, jobResult } from './fixtures';
import { MOCK_DEPLOYMENT } from './assistantCatalog';
import { mockSha256 } from './assetBytes';
import { storeAsset } from './assets';

export function enableImageFixture() {
  fixtures.imageGenerationEnabled = true;
  fixtures.assistant.switches.images = true;
  MOCK_DEPLOYMENT.capabilities.add('image_generation');
}

export function generationQuota(workspaceId: string): ImageGenerationAvailability {
  const now = new Date();
  const confirmed = [...fixtures.imageGenerations.values()].filter((row) => row.confirmed_at !== null);
  const day = now.toISOString().slice(0, 10), month = day.slice(0, 7);
  if (confirmed.filter((row) => row.created_by === PREVIEW_USER_ID && row.confirmed_at!.slice(0, 10) === day).length >= 20) {
    return { available: false, scope: 'person', reason: 'Daily image confirmation quota reached.',
      resets_at: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString() };
  }
  if (confirmed.filter((row) => row.workspace_id === workspaceId && row.confirmed_at!.slice(0, 7) === month).length >= 200) {
    return { available: false, scope: 'workspace', reason: 'Monthly workspace image confirmation quota reached.',
      resets_at: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString() };
  }
  return { available: true, reason: null, scope: null, resets_at: null };
}

export function generationQuote(info: Pick<ImageGenerationInfo, 'generation_id' | 'prompt' | 'aspect_ratio' | 'provider' | 'model' | 'quality' | 'output_format'>) {
  const estimated_cost = info.provider === 'codex' ? null : info.aspect_ratio === '1:1' ? 0.013 : info.aspect_ratio === '3:2' ? 0.01 : info.aspect_ratio === '16:9' ? 0.008 : 0.013;
  return { estimated_cost, confirmation_token: mockSha256(new TextEncoder().encode(JSON.stringify([info.generation_id, info.prompt, info.aspect_ratio, info.provider, info.model, info.quality, info.output_format, estimated_cost]))) };
}

export function proposeGeneration(workspaceId: string, documentId: string, args: ImageArguments, engine: 'gateway' | 'codex', runId = uid()): ImageGenerationInfo {
  const info: ImageGenerationInfo = {
    generation_id: `gen-${uid()}`, workspace_id: workspaceId, document_id: documentId, chat_id: null,
    run_id: runId, tool_call_id: 'author-request', created_by: PREVIEW_USER_ID, can_decide: true, status: 'proposed',
    engine, provider: engine === 'gateway' ? 'openrouter' : 'codex',
    model: engine === 'gateway' ? 'openai/gpt-image-2.5-sunburst' : null,
    model_slug: engine === 'gateway' ? 'openai/gpt-image-2.5-sunburst-20260908' : null,
    quality: engine === 'gateway' ? 'medium' : null, aspect_ratio: args.aspect_ratio ?? '3:2',
    output_format: engine === 'gateway' ? 'png' : null,
    arguments: { ...args, style: args.style ?? '', exact_text: args.exact_text ?? '', aspect_ratio: args.aspect_ratio ?? '3:2' },
    prompt: `Create one conceptual ${args.purpose.replaceAll('_', ' ')}.\nThis is an illustration, not primary research evidence or a plot of measured data.\nSubject: ${args.description}\nVisual style: ${args.style || 'clean, clear illustration'}\n${args.exact_text ? `Only this exact text may appear: ${args.exact_text}` : 'No text in the image.'}`,
    estimated_cost: null, confirmation_token: '', usage: null, cost_usd: null, asset_id: null,
    error_code: null, codex_version: null, thread_id: null, job_id: null,
    created_at: new Date().toISOString(), confirmed_at: null, completed_at: null,
  };
  Object.assign(info, generationQuote(info));
  fixtures.imageGenerations.set(info.generation_id, info);
  return info;
}

export function confirmGeneration(info: ImageGenerationInfo) {
  const job = startJob(info.workspace_id, 'image_generation', 1, jobResult({ generation_id: info.generation_id, generation_status: 'succeeded' }));
  info.status = 'confirmed';
  info.confirmed_at = new Date().toISOString();
  info.job_id = job.id;
  return job;
}

export async function generationState(info: ImageGenerationInfo): Promise<ImageGenerationInfo> {
  if (info.job_id === null || !['confirmed', 'running'].includes(info.status)) return info;
  const job = fixtures.jobs.get(info.job_id);
  if (!job) return info;
  if (Date.now() - job.started < job.duration) { info.status = 'running'; return info; }
  // One tiny, fixed preview raster. Not evidence of a live generator.
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII='), (char) => char.charCodeAt(0));
  const stored = await storeAsset(info.workspace_id, info.generation_id, new Blob([bytes], { type: 'image/png' }), 'generated-preview.png');
  Object.assign(stored.asset, { kind: 'generated', generation_id: info.generation_id, generation: {
    generation_id: info.generation_id, provider: info.provider, model: info.model, model_slug: info.model_slug,
    quality: info.quality, aspect_ratio: info.engine === 'codex' ? null : info.aspect_ratio, output_format: info.output_format,
    prompt: info.prompt, arguments: info.arguments, created_at: info.created_at, completed_at: new Date().toISOString(),
    usage: info.engine === 'gateway' ? { cost: 0.01 } : null, cost_usd: info.engine === 'gateway' ? 0.01 : null,
    codex_version: null, thread_id: null,
  } });
  info.asset_id = stored.asset.asset_id;
  info.status = 'succeeded';
  info.completed_at = new Date().toISOString();
  info.usage = info.engine === 'gateway' ? { cost: 0.01 } : null;
  info.cost_usd = info.engine === 'gateway' ? 0.01 : null;
  return info;
}
