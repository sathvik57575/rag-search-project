const axios = require('axios');

const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const MODEL = 'llama3.2';
const REQUEST_TIMEOUT_MS = 30000;
const MAX_CONCURRENT_REQUESTS = 4;

function lexicalScore(query, content) {
  const queryTerms = new Set(query.toLowerCase().match(/[a-z0-9]+/g) || []);
  const contentTerms = new Set(content.toLowerCase().match(/[a-z0-9]+/g) || []);
  if (queryTerms.size === 0) return 0;
  let matches = 0;
  for (const term of queryTerms) if (contentTerms.has(term)) matches += 1;
  return matches / queryTerms.size;
}

async function scoreOne(query, content) {
  const prompt = `Rate how relevant this document is to the query, on a scale of 0 to 1 (just the number, nothing else).

Query: ${query}
Document: ${content}

Relevance score:`;

  const res = await axios.post(OLLAMA_URL, {
    model: MODEL,
    prompt,
    stream: false,
    options: { temperature: 0 },
  }, { timeout: REQUEST_TIMEOUT_MS });

  const score = Number(res.data.response.trim());
  return Number.isFinite(score) && score >= 0 && score <= 1 ? score : null;
}

async function rerank(query, candidates) {
  if (candidates.length === 0) return [];

  const scores = [];
  for (let i = 0; i < candidates.length; i += MAX_CONCURRENT_REQUESTS) {
    const batch = candidates.slice(i, i + MAX_CONCURRENT_REQUESTS);
    const batchScores = await Promise.all(batch.map(async (c) => {
      try {
        const score = await scoreOne(query, c.content);
        return score !== null ? score : lexicalScore(query, c.content);
      } catch {
        return lexicalScore(query, c.content);
      }
    }));
    scores.push(...batchScores);
  }

  return candidates
    .map((c, i) => ({ ...c, rerankScore: scores[i] }))
    .sort((a, b) => b.rerankScore - a.rerankScore);
}

module.exports = { rerank };