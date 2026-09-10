const axios = require('axios');

// const HF_URL = `https://api-inference.huggingface.co/pipeline/feature-extraction/${process.env.HF_EMBED_MODEL}`;
const HF_URL = `https://router.huggingface.co/hf-inference/models/${process.env.HF_EMBED_MODEL}/pipeline/feature-extraction`;

//mapping it in a 3d vector space
/*
  This calls the Hugging Face Inference API for one batch of texts.
 Also handles the common "model loading" 503 by waiting and retrying once.
 */
async function callHF(texts, retries = 3) {
  try {
    const res = await axios.post(
      HF_URL,
      { inputs: texts, options: { wait_for_model: true } },
      { headers: { Authorization: `Bearer ${process.env.HF_API_TOKEN}` } }
    );

    return res.data; //array of vectors (or array of token-vectors, depends on model)

  } catch (err) {
    const status = err.response?.status;
    if ((status === 503 || status === 429) && retries > 0) {
      await new Promise((r) => setTimeout(r, 3000));
      return callHF(texts, retries - 1);
    }
    throw new Error(`HF embedding request failed: ${err.response?.data?.error || err.message}`);
  }
}

/*
 Embedding an array of texts, batching to keep request payloads small or else they once threw error for large chunk of data.
 //429
 */
async function embedTexts(texts, batchSize = 16) {
  const results = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const vectors = await callHF(batch);
    results.push(...vectors);
  }
  return results;
}

async function embedOne(text) {
  const [vec] = await embedTexts([text], 1);
  return vec;
}

module.exports = { embedTexts, embedOne };
