import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

async function loadLocalEnvironment() {
  if (process.env.OPENAI_API_KEY) return;
  try {
    const lines = (await readFile(path.join(ROOT, '.env'), 'utf8')).split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z\d_]*)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^(?:"(.*)"|'(.*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
    }
  } catch {}
}
await loadLocalEnvironment();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const LESSON_MODEL = process.env.OPENAI_LESSON_MODEL || 'gpt-6-luna';
const FEEDBACK_MODEL = process.env.OPENAI_FEEDBACK_MODEL || 'gpt-6.1-sol';
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1-mini';
const dailyCache = new Map();
const rateBuckets = new Map();

const string = { type: 'string' };
const stringList = { type: 'array', items: string };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const DAILY_SCHEMA = object({
  theme: string,
  vocabulary: { type: 'array', items: object({
    word: string,
    phonetic: string,
    meaningId: string,
    category: { type: 'string', enum: ['Sehari-hari', 'Perasaan', 'Aktivitas'] },
    exampleEn: string,
    exampleId: string
  }) },
  grammar: object({
    title: string,
    summaryId: string,
    explanationId: string,
    examples: { type: 'array', items: object({ label: string, english: string, indonesian: string }) },
    quiz: object({ question: string, sentence: string, options: stringList, answer: string, explanationId: string })
  }),
  reading: object({
    title: string,
    introId: string,
    paragraphs: stringList,
    question: string,
    options: stringList,
    answer: string,
    explanationId: string
  }),
  listening: object({
    title: string,
    introId: string,
    dialogue: { type: 'array', items: object({ speaker: string, line: string }) },
    question: string,
    options: stringList,
    answer: string,
    explanationId: string
  }),
  speaking: object({ topic: string, question: string, questions: stringList, phrases: stringList }),
  writing: object({ topic: string, promptId: string, phraseHints: stringList })
});
const FEEDBACK_SCHEMA = object({
  overall: string,
  strengths: stringList,
  corrections: { type: 'array', items: object({ original: string, naturalVersion: string, explanationId: string }) },
  pronunciationNote: string,
  nextPractice: string
});
const WRITING_SCHEMA = object({
  overall: string,
  correctedVersion: string,
  corrections: { type: 'array', items: object({ original: string, suggested: string, explanationId: string }) },
  nextTip: string
});

const DAILY_THEMES = [
  'meeting someone new', 'a morning at the market', 'making weekend plans', 'food and family',
  'finding your way around town', 'a small act of kindness', 'a busy day at work or school',
  'hobbies and free time', 'ordering at a café', 'a memorable trip', 'healthy daily habits',
  'shopping for something useful', 'weather and what to wear', 'meeting a new neighbor'
];

function respond(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function checkOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    if (new URL(origin).host === req.headers.host) return true;
  } catch {}
  respond(res, 403, { error: 'Permintaan harus berasal dari situs ini.' });
  return false;
}

function enforceRateLimit(req, res, bucket, limit = 40, windowMs = 60 * 60 * 1000) {
  const address = req.socket.remoteAddress || 'unknown';
  const key = `${bucket}:${address}`;
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.until <= now) {
    rateBuckets.set(key, { count: 1, until: now + windowMs });
    return true;
  }
  if (current.count >= limit) {
    respond(res, 429, { error: 'Terlalu banyak permintaan. Coba lagi sebentar.' }, { 'Retry-After': String(Math.ceil((current.until - now) / 1000)) });
    return false;
  }
  current.count += 1;
  return true;
}

async function readBody(req, maxBytes = 1_500_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Ukuran permintaan terlalu besar.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req, maxBytes) {
  const body = await readBody(req, maxBytes);
  try { return JSON.parse(body || '{}'); }
  catch { throw Object.assign(new Error('Format JSON tidak valid.'), { status: 400 }); }
}

function apiKeyOrRespond(res) {
  const key = process.env.OPENAI_API_KEY;
  if (key) return key;
  respond(res, 503, { error: 'API belum dikonfigurasi. Isi OPENAI_API_KEY di file .env lalu mulai ulang server.' });
  return null;
}

async function callResponsesApi({ model, instructions, input, name, schema, maxOutputTokens = 3500 }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      instructions,
      input,
      store: false,
      max_output_tokens: maxOutputTokens,
      text: { format: { type: 'json_schema', name, strict: true, schema } }
    }),
    signal: AbortSignal.timeout(90_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.error?.message || `OpenAI API merespons dengan status ${response.status}.`;
    throw Object.assign(new Error(detail), { status: 502 });
  }
  const outputText = data.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
  if (!outputText) throw Object.assign(new Error('Model tidak mengirim materi yang bisa dibaca.'), { status: 502 });
  try { return JSON.parse(outputText); }
  catch { throw Object.assign(new Error('Format materi dari model tidak valid.'), { status: 502 }); }
}

function isValidLesson(lesson) {
  const checks = [lesson?.vocabulary?.length >= 4, lesson?.grammar?.examples?.length >= 2,
    lesson?.grammar?.quiz?.options?.includes(lesson?.grammar?.quiz?.answer),
    lesson?.reading?.paragraphs?.length >= 1, lesson?.reading?.options?.includes(lesson?.reading?.answer),
    lesson?.listening?.dialogue?.length >= 2, lesson?.listening?.options?.includes(lesson?.listening?.answer)];
  return checks.every(Boolean);
}

function lessonDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = Date.parse(`${value}T00:00:00Z`);
    if (Number.isFinite(parsed) && new Date(parsed).toISOString().startsWith(value)) return value;
  }
  return new Date().toISOString().slice(0, 10);
}

async function getDailyLesson(date, level) {
  const cacheKey = `${date}:${level}`;
  if (dailyCache.has(cacheKey)) return dailyCache.get(cacheKey);
  const dayNumber = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const theme = DAILY_THEMES[((dayNumber % DAILY_THEMES.length) + DAILY_THEMES.length) % DAILY_THEMES.length];
  const cefrLevel = { beginner: 'A1', elementary: 'A2', intermediate: 'B1', 'upper-intermediate': 'B2' }[level] || 'A1';
  const lesson = await callResponsesApi({
    model: LESSON_MODEL,
    name: 'english_daily_lesson',
    schema: DAILY_SCHEMA,
    maxOutputTokens: 4200,
    instructions: `You are an expert English curriculum writer for Indonesian learners. Create accurate, natural English learning material at CEFR ${cefrLevel} (${level}). Keep explanations and translations in clear Indonesian, while target-language material is in everyday English. Avoid errors, ambiguous quiz keys, repeated items, and culturally narrow assumptions. Return only data that matches the requested schema.`,
    input: `Create today's complete six-skill English lesson. Local study date: ${date}. Daily theme: ${theme}. Make it coherent: vocabulary, grammar examples, reading, listening, speaking, and writing all relate to the theme but use distinct realistic examples. Include 6 useful vocabulary words with IPA pronunciation and Indonesian translations. Grammar should teach one practical pattern with 3 examples and a 3-choice quiz whose answer exactly matches one option. Reading should be a short original passage (2 short paragraphs) and one comprehension question with 3 options. Listening should be a natural 5-7 line dialogue and one question with 3 options. Speaking should give one conversational topic and questions. Writing should give a brief Indonesian prompt and useful English phrase starters. Do not include markdown.`
  });
  if (!isValidLesson(lesson)) throw Object.assign(new Error('Materi harian belum lengkap. Coba muat ulang sebentar lagi.'), { status: 502 });
  const result = { date, level, theme, lesson };
  dailyCache.set(cacheKey, result);
  return result;
}

function sessionInstructions(topic) {
  const safeTopic = String(topic || '').replace(/[\r\n]/g, ' ').slice(0, 160);
  return `You are Lingua, a friendly AI English conversation partner with fluent, natural everyday English. Never claim to be a human or a human native speaker. Help an Indonesian learner practice speaking freely. ${safeTopic ? `Begin with this practice topic: ${safeTopic}.` : 'Let the learner choose the topic and begin with a simple, warm question.'} Speak in short, natural turns and ask only one follow-up question at a time. Give the learner time to think. Keep the conversation in English unless they ask for help in Indonesian. Respond to the meaning first, then gently model at most one important correction using a natural alternative, without interrupting or turning every exchange into a lesson. Be encouraging and conversational, like a patient fluent speaking partner. The voice is AI-generated.`;
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

async function serveStatic(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { res.writeHead(400).end('Bad request'); return; }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  if (relative.split('/').some(part => part.startsWith('.'))) { res.writeHead(404).end('Not found'); return; }
  const filePath = path.resolve(ROOT, relative);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) { res.writeHead(403).end('Forbidden'); return; }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    if (req.method === 'HEAD') res.end(); else res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/status' && req.method === 'GET') {
      respond(res, 200, { configured: Boolean(process.env.OPENAI_API_KEY), lessonModel: LESSON_MODEL, realtimeModel: REALTIME_MODEL });
      return;
    }

    if (url.pathname === '/api/daily' && req.method === 'GET') {
      if (!checkOrigin(req, res) || !enforceRateLimit(req, res, 'daily', 15)) return;
      if (!apiKeyOrRespond(res)) return;
      const date = lessonDate(url.searchParams.get('date'));
      const level = ['beginner', 'elementary', 'intermediate', 'upper-intermediate'].includes(url.searchParams.get('level')) ? url.searchParams.get('level') : 'beginner';
      const result = await getDailyLesson(date, level);
      respond(res, 200, result);
      return;
    }

    if (url.pathname === '/api/feedback' && req.method === 'POST') {
      if (!checkOrigin(req, res) || !enforceRateLimit(req, res, 'feedback', 30)) return;
      if (!apiKeyOrRespond(res)) return;
      const body = await readJson(req, 80_000);
      const turns = Array.isArray(body.turns) ? body.turns.slice(-40).map(turn => ({
        role: turn.role === 'assistant' ? 'partner' : 'learner',
        text: typeof turn.text === 'string' ? turn.text.slice(0, 800) : ''
      })).filter(turn => turn.text) : [];
      if (!turns.some(turn => turn.role === 'learner')) { respond(res, 400, { error: 'Belum ada ucapan yang bisa dievaluasi.' }); return; }
      const feedback = await callResponsesApi({
        model: FEEDBACK_MODEL,
        name: 'speaking_feedback',
        schema: FEEDBACK_SCHEMA,
        maxOutputTokens: 1200,
        instructions: 'You are a supportive English speaking coach for an Indonesian learner. Assess the learner turns in this transcript, not the partner turns. Give specific, kind feedback in Indonesian. Correct only meaningful mistakes and show a natural English alternative. Never infer pronunciation, accent, confidence, or fluency from text alone; explain that pronunciation cannot be reliably judged from this transcript. No grades that could discourage the learner.',
        input: `Give concise feedback on this speaking conversation. Topic: ${String(body.topic || 'free conversation').slice(0, 160)}. Transcript JSON: ${JSON.stringify(turns)}`
      });
      respond(res, 200, feedback);
      return;
    }

    if (url.pathname === '/api/writing-feedback' && req.method === 'POST') {
      if (!checkOrigin(req, res) || !enforceRateLimit(req, res, 'writing', 30)) return;
      if (!apiKeyOrRespond(res)) return;
      const body = await readJson(req, 30_000);
      const writing = typeof body.text === 'string' ? body.text.trim().slice(0, 6000) : '';
      if (writing.split(/\s+/).filter(Boolean).length < 5) { respond(res, 400, { error: 'Tulis setidaknya lima kata sebelum meminta feedback.' }); return; }
      const feedback = await callResponsesApi({
        model: FEEDBACK_MODEL,
        name: 'writing_feedback',
        schema: WRITING_SCHEMA,
        maxOutputTokens: 1400,
        instructions: 'You are a kind English writing tutor for Indonesian learners. Give useful, accurate corrections in Indonesian while preserving the learner’s intended meaning and voice. Correct only meaningful grammar, spelling, punctuation, or word-choice issues. Do not invent facts or rewrite beyond the learner’s level.',
        input: `Review this learner writing about the daily topic “${String(body.topic || '').slice(0, 120)}”. Return an improved full version, a short overall response, a few specific corrections, and one next tip. Learner text: ${writing}`
      });
      respond(res, 200, feedback);
      return;
    }

    if (url.pathname === '/api/realtime' && req.method === 'POST') {
      if (!checkOrigin(req, res) || !enforceRateLimit(req, res, 'realtime', 20)) return;
      const apiKey = apiKeyOrRespond(res);
      if (!apiKey) return;
      const body = await readJson(req, 150_000);
      if (typeof body.sdp !== 'string' || body.sdp.length > 100_000) { respond(res, 400, { error: 'Data koneksi audio tidak valid.' }); return; }
      const form = new FormData();
      form.set('sdp', body.sdp);
      form.set('session', JSON.stringify({
        type: 'realtime',
        model: REALTIME_MODEL,
        instructions: sessionInstructions(body.topic),
        audio: {
          input: {
            transcription: { model: 'gpt-live-transcribe', languages: ['en', 'id'], delay: 'low' },
            turn_detection: { type: 'semantic_vad' }
          },
          output: { voice: 'marin' }
        }
      }));
      const userId = typeof body.userId === 'string' ? body.userId.slice(0, 100) : 'lingua-anonymous';
      const safetyId = createHash('sha256').update(userId).digest('hex');
      const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'OpenAI-Safety-Identifier': safetyId },
        body: form,
        signal: AbortSignal.timeout(40_000)
      });
      const answerSdp = await upstream.text();
      if (!upstream.ok) {
        let detail = 'Tidak dapat membuka sesi percakapan suara.';
        try { detail = JSON.parse(answerSdp).error?.message || detail; } catch {}
        respond(res, 502, { error: detail });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/sdp', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(answerSdp);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end('Method not allowed'); return; }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    respond(res, error.status || 500, { error: error.message || 'Terjadi kesalahan pada server.' });
  }
});

server.listen(PORT, HOST, () => console.log(`Lingua tersedia di http://localhost:${PORT}`));
