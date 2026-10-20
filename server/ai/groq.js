/**
 * EDX Digital - Groq, the AI behind the opportunity analysis and the message suggestions
 *
 * One key for the whole system, in Secret Manager (GROQ_API_KEY), never in the browser.
 * Which models a key reaches depends on the Groq project (models can be turned off there, and
 * Groq retires models over time), so the server asks Groq which ones this key has and tries
 * them in the order below; when none of the preferred ones is there, any chat model the key
 * has. The free tier counts tokens per model and per day: when one is out (429), the next answers.
 */

const PREFERRED = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant'
];
// not for conversation: speech, guards
const NOT_CHAT = /whisper|tts|orpheus|guard|safeguard/i;
// the function has 30 s in all: three tries of up to 9 s, after the list of models
const TIMEOUT_MS = 9000;
const MODELS_TTL_MS = 60 * 60 * 1000;

function apiBase() {
  return process.env.GROQ_API_BASE || 'https://api.groq.com/openai/v1';
}

const apiKey = () => String(process.env.GROQ_API_KEY || '').trim();

function isConfigured() {
  return Boolean(apiKey());
}

let cachedModels = null; // { at, ids }

/** The models to try, in order; [] lets the caller fall back to the preferred list */
async function availableModels({ fetchFn = fetch, now = Date.now } = {}) {
  if (cachedModels && now() - cachedModels.at < MODELS_TTL_MS) return cachedModels.ids;
  const res = await fetchFn(`${apiBase()}/models`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`lista de modelos: HTTP ${res.status}`);
  const data = await res.json();
  const ids = (Array.isArray(data && data.data) ? data.data : [])
    .filter(model => model && model.id && model.active !== false && !NOT_CHAT.test(model.id))
    .map(model => String(model.id));
  const ordered = [...PREFERRED.filter(id => ids.includes(id)), ...ids.filter(id => !PREFERRED.includes(id))];
  cachedModels = { at: now(), ids: ordered };
  return ordered;
}

/**
 * Sends a prompt and returns the parsed JSON object it answers with.
 * The prompt must ask for JSON (Groq's JSON mode requires the word in it).
 */
async function completeJson(prompt, { fetchFn = fetch, now = Date.now } = {}) {
  let models;
  try {
    models = await availableModels({ fetchFn, now });
  } catch (err) {
    console.error('[IA]', err.message);
    models = [];
  }
  if (models.length === 0) models = PREFERRED;

  const errors = [];
  for (const model of models.slice(0, 3)) {
    try {
      const res = await fetchFn(`${apiBase()}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.6,
          max_tokens: 1500
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(`HTTP ${res.status} ${String(detail?.error?.message || '').slice(0, 160)}`);
      }
      const data = await res.json();
      const text = String(data?.choices?.[0]?.message?.content || '').trim();
      if (!text) throw new Error('resposta vazia');
      return JSON.parse(text);
    } catch (err) {
      errors.push(`${model}: ${err.message}`);
    }
  }
  // a model that vanished from the key is forgotten, so the next call asks Groq again
  cachedModels = null;
  throw new Error(errors.join(' | ') || 'sem resposta');
}

function resetModelCache() {
  cachedModels = null;
}

module.exports = { completeJson, isConfigured, resetModelCache, PREFERRED };
