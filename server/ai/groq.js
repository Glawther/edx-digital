/**
 * EDX Digital - Groq, the AI behind the opportunity analysis and the message suggestions
 *
 * One key for the whole system, in Secret Manager (GROQ_API_KEY), never in the browser.
 * The free tier counts tokens per model and per day: when the larger model is out (429) or
 * fails, the smaller one answers.
 */

const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const TIMEOUT_MS = 20000;

function apiBase() {
  return process.env.GROQ_API_BASE || 'https://api.groq.com/openai/v1';
}

const apiKey = () => String(process.env.GROQ_API_KEY || '').trim();

function isConfigured() {
  return Boolean(apiKey());
}

/**
 * Sends a prompt and returns the parsed JSON object it answers with.
 * The prompt must ask for JSON (Groq's JSON mode requires the word in it).
 */
async function completeJson(prompt, { fetchFn = fetch } = {}) {
  let lastError = null;
  for (const model of MODELS) {
    try {
      const res = await fetchFn(`${apiBase()}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.6,
          max_tokens: 1200
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(`${model}: HTTP ${res.status} ${String(detail?.error?.message || '').slice(0, 160)}`);
      }
      const data = await res.json();
      const text = String(data?.choices?.[0]?.message?.content || '').trim();
      if (!text) throw new Error(`${model}: resposta vazia`);
      return JSON.parse(text);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('sem resposta');
}

module.exports = { completeJson, isConfigured };
