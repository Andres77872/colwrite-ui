import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import {
  DOCUMENT_RENDERER_VERSION,
  ExportValidationError,
  renderStandaloneHtml,
} from '../dist-renderer/document-renderer.js';

const host = process.env.DOCUMENT_RENDERER_HOST || '127.0.0.1';
const port = Number(process.env.DOCUMENT_RENDERER_PORT || 5010);
const token = process.env.DOCUMENT_RENDERER_TOKEN || '';
const maxBodyBytes = Number(process.env.DOCUMENT_RENDERER_MAX_BODY_BYTES || 10 * 1024 * 1024);

if (token.length < 24) {
  throw new Error('DOCUMENT_RENDERER_TOKEN must contain at least 24 characters');
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('DOCUMENT_RENDERER_PORT is invalid');
}
if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1024) {
  throw new Error('DOCUMENT_RENDERER_MAX_BODY_BYTES is invalid');
}

function authorized(header) {
  const supplied = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : '';
  const expectedBuffer = Buffer.from(token);
  const suppliedBuffer = Buffer.from(supplied);
  return suppliedBuffer.length === expectedBuffer.length
    && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function reply(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error('request too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

function validatePayload(payload) {
  const invalid = () => {
    throw Object.assign(new Error('invalid export payload'), { status: 422 });
  };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) invalid();
  const { document, snapshot, options } = payload;
  if (!document || typeof document !== 'object' || Array.isArray(document)) invalid();
  if (!Number.isInteger(document.version) || document.version < 1) invalid();
  if (!Array.isArray(document.blocks) || document.blocks.length > 2000) invalid();
  if (document.name !== undefined && typeof document.name !== 'string') invalid();
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) invalid();
  if (
    !Number.isInteger(snapshot.base_version)
    || snapshot.base_version !== document.version
    || !Number.isInteger(snapshot.local_revision)
    || snapshot.local_revision < 0
    || typeof snapshot.dirty !== 'boolean'
  ) invalid();
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalid();
  if (!['paper', 'editor-faithful'].includes(options.profile)) invalid();
  if (!['A4', 'Letter'].includes(options.page_size)) invalid();
  if (!['portrait', 'landscape'].includes(options.orientation)) invalid();
  if (!['omit', 'draft-card'].includes(options.ai_beat)) invalid();
  if (typeof options.include_title !== 'boolean') invalid();
  return { document, snapshot, options };
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    return reply(
      response,
      200,
      JSON.stringify({ status: 'healthy', renderer_version: DOCUMENT_RENDERER_VERSION }),
      { 'Content-Type': 'application/json; charset=utf-8' },
    );
  }
  if (request.method !== 'POST' || request.url !== '/render') {
    return reply(response, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  if (!authorized(request.headers.authorization)) {
    return reply(response, 401, 'Unauthorized', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  if (request.headers['content-type']?.split(';', 1)[0].trim() !== 'application/json') {
    return reply(response, 415, 'JSON content type required', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  try {
    const payload = validatePayload(await readJson(request));
    const html = renderStandaloneHtml(payload.document, payload.options, payload.snapshot);
    return reply(response, 200, html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(html)),
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'",
      'X-Document-Renderer-Version': DOCUMENT_RENDERER_VERSION,
    });
  } catch (error) {
    const status = error instanceof ExportValidationError
      ? 422
      : Number.isInteger(error?.status)
        ? error.status
        : 500;
    if (status === 500) console.error('Document renderer failed without logging authored content');
    return reply(
      response,
      status,
      status === 500 ? 'Render failed' : error.message,
      { 'Content-Type': 'text/plain; charset=utf-8' },
    );
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(port, host, () => {
  console.log(`ColWrite document renderer ${DOCUMENT_RENDERER_VERSION} listening on ${host}:${port}`);
});
