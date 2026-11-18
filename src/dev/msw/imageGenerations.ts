/** Fake generator only. A fixed PNG, never an outbound image/model request. */
import type { ImageArguments, ImageGenerationAvailability, ImageGenerationInfo } from '@/api/schema';
import { uid } from '@/lib/uid';
import { fixtures, PREVIEW_USER_ID, startJob, jobResult } from './fixtures';
import { MOCK_DEPLOYMENT } from './assistantCatalog';
import { mockSha256 } from './assetBytes';
import { linkChatAssets, storeAsset } from './assets';
import previewIllustration from './preview-illustration.png?inline';

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

export function proposeGeneration(workspaceId: string, documentId: string, args: ImageArguments, prompt: string,
  engine: 'gateway' | 'codex', runId = uid()): ImageGenerationInfo {
  const info: ImageGenerationInfo = {
    generation_id: `gen-${uid()}`, workspace_id: workspaceId, document_id: documentId, chat_id: null,
    run_id: runId, tool_call_id: 'author-request', created_by: PREVIEW_USER_ID, can_decide: true, status: 'proposed',
    engine, provider: engine === 'gateway' ? 'openrouter' : 'codex',
    model: engine === 'gateway' ? 'openai/gpt-image-2.5-sunburst' : null,
    model_slug: engine === 'gateway' ? 'openai/gpt-image-2.5-sunburst-20260908' : null,
    quality: engine === 'gateway' ? 'medium' : null, aspect_ratio: args.aspect_ratio ?? '3:2',
    output_format: engine === 'gateway' ? 'png' : null,
    arguments: { ...args, style: args.style ?? '', exact_text: args.exact_text ?? '', aspect_ratio: args.aspect_ratio ?? '3:2' },
    prompt,
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

export function discardGeneration(info: ImageGenerationInfo) {
  if (info.status === 'running') {
    info.status = 'unknown';
    info.error_code = 'image_generation_unknown';
  } else {
    info.status = 'discarded';
  }
  info.completed_at = new Date().toISOString();
}

export async function generationState(info: ImageGenerationInfo): Promise<ImageGenerationInfo> {
  if (info.job_id === null || !['confirmed', 'running'].includes(info.status)) return info;
  const job = fixtures.jobs.get(info.job_id);
  if (!job) return info;
  if (Date.now() - job.started < job.duration) { info.status = 'running'; return info; }
  const bytes = Uint8Array.from(atob(previewIllustration.slice(previewIllustration.indexOf(',') + 1)), (char) => char.charCodeAt(0));
  const stored = await storeAsset(info.workspace_id, info.generation_id, new Blob([bytes], { type: 'image/png' }), 'generated-preview.png');
  const usage = info.engine === 'gateway' ? { prompt_tokens: 40, completion_tokens: 280, total_tokens: 320, cost: 0.01 } : null;
  Object.assign(stored.asset, { kind: 'generated', generation_id: info.generation_id, generation: {
    generation_id: info.generation_id, provider: info.provider, model: info.model, model_slug: info.model_slug,
    quality: info.quality, aspect_ratio: info.engine === 'codex' ? null : info.aspect_ratio, output_format: info.output_format,
    prompt: info.prompt, arguments: info.arguments, created_at: info.created_at, completed_at: new Date().toISOString(),
    usage, cost_usd: usage?.cost ?? null,
    codex_version: null, thread_id: null,
  } });
  info.asset_id = stored.asset.asset_id;
  info.status = 'succeeded';
  info.completed_at = new Date().toISOString();
  info.usage = usage;
  info.cost_usd = usage?.cost ?? null;
  if (info.chat_id) linkChatAssets(info.workspace_id, info.document_id, info.chat_id, [info.asset_id]);
  return info;
}
