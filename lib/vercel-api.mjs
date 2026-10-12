import { createHash } from 'node:crypto';

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
    word: string, phonetic: string, meaningId: string,
    category: { type: 'string', enum: ['Sehari-hari', 'Perasaan', 'Aktivitas'] },
    exampleEn: string, exampleId: string
  }) },
  grammar: object({
    title: string, summaryId: string, explanationId: string,
    examples: { type: 'array', items: object({ label: string, english: string, indonesian: string }) },
    quiz: object({ question: string, sentence: string, options: stringList, answer: string, explanationId: string })
  }),
  reading: object({
    title: string, introId: string, paragraphs: stringList,
    question: string, options: stringList, answer: string, explanationId: string
  }),
  listening: object({
    title: string, introId: string,
    dialogue: { type: 'array', items: object({ speaker: string, line: string }) },
    question: string, options: stringList, answer: string, explanationId: string
  }),
  speaking: object({ topic: string, question: string, questions: stringList, phrases: stringList }),
  writing: object({ topic: string, promptId: string, phraseHints: stringList })
});
const FEEDBACK_SCHEMA = object({
  overall: string, strengths: stringList,
  corrections: { type: 'array', items: object({ original: string, naturalVersion: string, explanationId: string }) },
  pronunciationNote: string, nextPractice: string
});
const WRITING_SCHEMA = object({
  overall: string, correctedVersion: string,
  corrections: { type: 'array', items: object({ original: string, suggested: string, explanationId: string }) },
  nextTip: string
});
const DAILY_THEMES = [
  'meeting someone new', 'a morning at the market', 'making weekend plans', 'food and family',
  'finding your way around town', 'a small act of kindness', 'a busy day at work or school',
  'hobbies and free time', 'ordering at a café', 'a memorable trip', 'healthy daily habits',
  'shopping for something useful', 'weather and what to wear', 'meeting a new neighbor'
];

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function checkOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  try {
    if (new URL(origin).host === new URL(request.url).host) return;
  } catch {}
  throw fail('Permintaan harus berasal dari situs ini.', 403);
}

function enforceRateLimit(request, bucket, limit = 40, windowMs = 60 * 60 * 1000) {
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || 'unknown';
  const key = `${bucket}:${address}`;
  const now = Date.now();
  let current = rateBuckets.get(key);
  if (!current || current.until <= now) {
    current = { count: 0, until: now + windowMs };
    rateBuckets.set(key, current);
  }
  if (rateBuckets.size > 5000) {
    for (const [entry, value] of rateBuckets) if (value.until <= now) rateBuckets.delete(entry);
  }
  if (current.count >= limit) {
    throw Object.assign(fail('Terlalu banyak permintaan. Coba lagi sebentar.', 429), {
      retryAfter: String(Math.max(1, Math.ceil((current.until - now) / 1000)))
    });
  }
  current.count += 1;
}

async function readJson(request, maxBytes = 1_500_000) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw fail('Ukuran permintaan terlalu besar.', 413);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) throw fail('Ukuran permintaan terlalu besar.', 413);
  try { return JSON.parse(body || '{}'); }
  catch { throw fail('Format JSON tidak valid.'); }
}

function requireApiKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw fail('API belum dikonfigurasi. Tambahkan OPENAI_API_KEY di Environment Variables Vercel lalu deploy ulang.', 503);
  }
  return process.env.OPENAI_API_KEY;
}

async function callResponsesApi({ model, instructions, input, name, schema, maxOutputTokens = 3500 }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, instructions, input, store: false, max_output_tokens: maxOutputTokens,
      text: { format: { type: 'json_schema', name, strict: true, schema } }
    }),
    signal: AbortSignal.timeout(90_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw fail(data.error?.message || `OpenAI API merespons dengan status ${response.status}.`, 502);
  const outputText = data.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
  if (!outputText) throw fail('Model tidak mengirim materi yang bisa dibaca.', 502);
  try { return JSON.parse(outputText); }
  catch { throw fail('Format materi dari model tidak valid.', 502); }
}

function lessonDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = Date.parse(`${value}T00:00:00Z`);
    if (Number.isFinite(parsed) && new Date(parsed).toISOString().startsWith(value)) return value;
  }
  return new Date().toISOString().slice(0, 10);
}

function isValidLesson(lesson) {
  return [
    lesson?.vocabulary?.length >= 4,
    lesson?.grammar?.examples?.length >= 2,
    lesson?.grammar?.quiz?.options?.includes(lesson?.grammar?.quiz?.answer),
    lesson?.reading?.paragraphs?.length >= 1,
    lesson?.reading?.options?.includes(lesson?.reading?.answer),
    lesson?.listening?.dialogue?.length >= 2,
    lesson?.listening?.options?.includes(lesson?.listening?.answer)
  ].every(Boolean);
}

async function getDailyLesson(date, level) {
  const cacheKey = `${date}:${level}`;
  if (dailyCache.has(cacheKey)) return dailyCache.get(cacheKey);
  const dayNumber = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const theme = DAILY_THEMES[((dayNumber % DAILY_THEMES.length) + DAILY_THEMES.length) % DAILY_THEMES.length];
  const cefrLevel = { beginner: 'A1', elementary: 'A2', intermediate: 'B1', 'upper-intermediate': 'B2' }[level] || 'A1';
  const lesson = await callResponsesApi({
    model: LESSON_MODEL, name: 'english_daily_lesson', schema: DAILY_SCHEMA, maxOutputTokens: 4200,
    instructions: `You are an expert English curriculum writer for Indonesian learners. Create accurate, natural English learning material at CEFR ${cefrLevel} (${level}). Keep explanations and translations in clear Indonesian, while target-language material is in everyday English. Avoid errors, ambiguous quiz keys, repeated items, and culturally narrow assumptions. Return only data that matches the requested schema.`,
    input: `Create today's complete six-skill English lesson. Local study date: ${date}. Daily theme: ${theme}. Make it coherent: vocabulary, grammar examples, reading, listening, speaking, and writing all relate to the theme but use distinct realistic examples. Include 6 useful vocabulary words with IPA pronunciation and Indonesian translations. Grammar should teach one practical pattern with 3 examples and a 3-choice quiz whose answer exactly matches one option. Reading should be a short original passage (2 short paragraphs) and one comprehension question with 3 options. Listening should be a natural 5-7 line dialogue and one question with 3 options. Speaking should give one conversational topic and questions. Writing should give a brief Indonesian prompt and useful English phrase starters. Do not include markdown.`
  });
  if (!isValidLesson(lesson)) throw fail('Materi harian belum lengkap. Coba muat ulang sebentar lagi.', 502);
  const result = { date, level, theme, lesson };
  dailyCache.set(cacheKey, result);
  return result;
}

function sessionInstructions(topic) {
  const safeTopic = String(topic || '').replace(/[\r\n]/g, ' ').slice(0, 160);
  return `You are Lingua, a friendly AI English conversation partner with fluent, natural everyday English. Never claim to be a human or a human native speaker. Help an Indonesian learner practice speaking freely. ${safeTopic ? `Begin with this practice topic: ${safeTopic}.` : 'Let the learner choose the topic and begin with a simple, warm question.'} Speak in short, natural turns and ask only one follow-up question at a time. Give the learner time to think. Keep the conversation in English unless they ask for help in Indonesian. Respond to the meaning first, then gently model at most one important correction using a natural alternative, without interrupting or turning every exchange into a lesson. Be encouraging and conversational, like a patient fluent speaking partner. The voice is AI-generated.`;
}

async function handleDaily(request) {
  checkOrigin(request);
  enforceRateLimit(request, 'daily', 15);
  requireApiKey();
  const url = new URL(request.url);
  const date = lessonDate(url.searchParams.get('date'));
  const requestedLevel = url.searchParams.get('level');
  const level = ['beginner', 'elementary', 'intermediate', 'upper-intermediate'].includes(requestedLevel) ? requestedLevel : 'beginner';
  return json(await getDailyLesson(date, level));
}

async function handleSpeakingFeedback(request) {
  checkOrigin(request);
  enforceRateLimit(request, 'feedback', 30);
  requireApiKey();
  const body = await readJson(request, 80_000);
  const turns = Array.isArray(body.turns) ? body.turns.slice(-40).map(turn => ({
    role: turn.role === 'assistant' ? 'partner' : 'learner',
    text: typeof turn.text === 'string' ? turn.text.slice(0, 800) : ''
  })).filter(turn => turn.text) : [];
  if (!turns.some(turn => turn.role === 'learner')) throw fail('Belum ada ucapan yang bisa dievaluasi.');
  const feedback = await callResponsesApi({
    model: FEEDBACK_MODEL, name: 'speaking_feedback', schema: FEEDBACK_SCHEMA, maxOutputTokens: 1200,
    instructions: 'You are a supportive English speaking coach for an Indonesian learner. Assess the learner turns in this transcript, not the partner turns. Give specific, kind feedback in Indonesian. Correct only meaningful mistakes and show a natural English alternative. Never infer pronunciation, accent, confidence, or fluency from text alone; explain that pronunciation cannot be reliably judged from this transcript. No grades that could discourage the learner.',
    input: `Give concise feedback on this speaking conversation. Topic: ${String(body.topic || 'free conversation').slice(0, 160)}. Transcript JSON: ${JSON.stringify(turns)}`
  });
  return json(feedback);
}

async function handleWritingFeedback(request) {
  checkOrigin(request);
  enforceRateLimit(request, 'writing', 30);
  requireApiKey();
  const body = await readJson(request, 30_000);
  const writing = typeof body.text === 'string' ? body.text.trim().slice(0, 6000) : '';
  if (writing.split(/\s+/).filter(Boolean).length < 5) throw fail('Tulis setidaknya lima kata sebelum meminta feedback.');
  const feedback = await callResponsesApi({
    model: FEEDBACK_MODEL, name: 'writing_feedback', schema: WRITING_SCHEMA, maxOutputTokens: 1400,
    instructions: 'You are a kind English writing tutor for Indonesian learners. Give useful, accurate corrections in Indonesian while preserving the learner’s intended meaning and voice. Correct only meaningful grammar, spelling, punctuation, or word-choice issues. Do not invent facts or rewrite beyond the learner’s level.',
    input: `Review this learner writing about the daily topic “${String(body.topic || '').slice(0, 120)}”. Return an improved full version, a short overall response, a few specific corrections, and one next tip. Learner text: ${writing}`
  });
  return json(feedback);
}

async function handleRealtime(request) {
  checkOrigin(request);
  enforceRateLimit(request, 'realtime', 20);
  const apiKey = requireApiKey();
  const body = await readJson(request, 150_000);
  if (typeof body.sdp !== 'string' || body.sdp.length > 100_000) throw fail('Data koneksi audio tidak valid.');
  const form = new FormData();
  form.set('sdp', body.sdp);
  form.set('session', JSON.stringify({
    type: 'realtime', model: REALTIME_MODEL, instructions: sessionInstructions(body.topic),
    audio: {
      input: { transcription: { model: 'gpt-live-transcribe', languages: ['en', 'id'], delay: 'low' }, turn_detection: { type: 'semantic_vad' } },
      output: { voice: 'marin' }
    }
  }));
  const userId = typeof body.userId === 'string' ? body.userId.slice(0, 100) : 'lingua-anonymous';
  const safetyId = createHash('sha256').update(userId).digest('hex');
  const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'OpenAI-Safety-Identifier': safetyId },
    body: form, signal: AbortSignal.timeout(40_000)
  });
  const answerSdp = await upstream.text();
  if (!upstream.ok) {
    let detail = 'Tidak dapat membuka sesi percakapan suara.';
    try { detail = JSON.parse(answerSdp).error?.message || detail; } catch {}
    throw fail(detail, 502);
  }
  return new Response(answerSdp, {
    headers: { 'Content-Type': 'application/sdp', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  });
}

export async function handleApi(request) {
  try {
    const url = new URL(request.url);
    if (url.pathname === '/api/status' && request.method === 'GET') {
      return json({ configured: Boolean(process.env.OPENAI_API_KEY), lessonModel: LESSON_MODEL, realtimeModel: REALTIME_MODEL });
    }
    if (url.pathname === '/api/daily' && request.method === 'GET') return await handleDaily(request);
    if (url.pathname === '/api/feedback' && request.method === 'POST') return await handleSpeakingFeedback(request);
    if (url.pathname === '/api/writing-feedback' && request.method === 'POST') return await handleWritingFeedback(request);
    if (url.pathname === '/api/realtime' && request.method === 'POST') return await handleRealtime(request);
    return json({ error: 'Endpoint API tidak ditemukan.' }, 404);
  } catch (error) {
    const headers = error.retryAfter ? { 'Retry-After': error.retryAfter } : {};
    return json({ error: error.message || 'Terjadi kesalahan pada server.' }, error.status || 500, headers);
  }
}
