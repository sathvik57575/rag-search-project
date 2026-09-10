const axios = require('axios');

const OLLAMA_URL = 'http://127.0.0.1:11434/api/embeddings';
const MODEL =  'all-minilm';

/*
  Calls Ollama's local embedding endpoint for a single text.
  No API key needed since this runs locally.
 */
async function callOllama(text, retries = 3) {
  try {
    const res = await axios.post(OLLAMA_URL, {
      model: MODEL,
      prompt: text,
    });

    return res.data.embedding; // single vector, e.g. [0.01, -0.23, ...]

  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 1000));
      return callOllama(text, retries - 1);
    }
    throw new Error(`Ollama embedding request failed: ${err.response?.data?.error || err.message}`);
  }
}

/*
  Embedding an array of texts. Ollama's API only accepts one text per request
  (unlike HF, which took a batch array), so we loop and call one at a time.
  batchSize is kept as a parameter for interface compatibility but now controls
  how many requests run concurrently, not payload size.
 */
async function embedTexts(texts, batchSize = 16) {
  const results = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const vectors = await Promise.all(batch.map((text) => callOllama(text)));
    results.push(...vectors);
  }
  return results;
}

async function embedOne(text) {
  return callOllama(text);
}

module.exports = { embedTexts, embedOne };