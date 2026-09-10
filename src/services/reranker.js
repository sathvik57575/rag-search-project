const axios = require('axios');

const HF_URL = `https://router.huggingface.co/hf-inference/models/${process.env.HF_RERANK_MODEL}/pipeline/sentence-similarity`;
4
//failsafe
function lexicalScore(query, content) {
  const queryTerms = new Set(query.toLowerCase().match(/[a-z0-9]+/g) || []);
  const contentTerms = new Set(content.toLowerCase().match(/[a-z0-9]+/g) || []);
  if (queryTerms.size === 0) return 0;

  let matches = 0;
  for (const term of queryTerms) {
    if (contentTerms.has(term)) matches += 1;
  }
  return matches / queryTerms.size;
}


/**
This re-scores a list of candidate chunks against a query using a cross-encoder, which reads (query, chunk) together and tends to be  more accurate than cosine similarity on separately encoded vectors.

 */
async function rerank(query, candidates) {
  if (candidates.length === 0) return [];

  let scores;
  try {
    const res = await axios.post(
      HF_URL,
      {
        inputs: {
          source_sentence: query,
          sentences: candidates.map((c) => c.content),
        },
        options: { wait_for_model: true },
      },
      { headers: { Authorization: `Bearer ${process.env.HF_API_TOKEN}` } }
    );
    scores = res.data;
    console.log("HF RERANKER is working");
  } catch (err) {
    if (err.response?.status !== 400 && err.response?.status !== 404) throw err;
    scores = candidates.map((candidate) => lexicalScore(query, candidate.content));

    //here if the HF reranker fails the program falls back to the lexical reranker which is much less smarter. This is adviced by chatgpt because sometimes HF api can fail, but as of now it never failed for me except once
  }

  return candidates
    .map((c, i) => ({ ...c, rerankScore: scores[i] }))
    .sort((a, b) => b.rerankScore - a.rerankScore);
}

module.exports = { rerank };

/*
rerank(query, candidates)
if (candidates.length === 0) return [];

Guard clause, nothing to rerank if the pool was empty. Not our case (we have 4).

Try the real reranker (a Hugging Face cross-encoder model)
const res = await axios.post(HF_URL, {
  inputs: {
    source_sentence: query,
    sentences: candidates.map((c) => c.content),
  },
  ...
});
scores = res.data;
This sends one request containing the query plus all 4 chunk texts, together:
{
  "source_sentence": "sick leave policy",
  "sentences": [
    "Employees get 12 sick leave days per year",
    "Sick leave must be applied via the HR portal",
    "Annual leave policy is 20 days",
    "Office hours are 9 to 5"
  ]
}

Unlike the vector search (which compared the query's number-list to each chunk's number-list separately, computed ahead of time), the cross-encoder reads the query and each chunk together, at the same time, and judges: "given both of these side-by-side, how relevant is this chunk to this query?" That joint reading tends to be more accurate, it can catch things pure vector math misses.

It returns one relevance score per chunk, in the same order sent:
scores = [0.95, 0.88, 0.40, 0.05]

(High score = model thinks it's genuinely relevant to "sick leave policy." Note row 4, "office hours," correctly gets a low score now — the cross-encoder isn't fooled the way vector distance was.)

The fallback (only if the API call fails)
catch (err) {
  if (err.response?.status !== 400 && err.response?.status !== 404) throw err;
  scores = candidates.map((c) => lexicalScore(query, c.content));
}

If the HF call fails with specifically a 400 or 404 (e.g., wrong model name, bad request shape), not a network error or auth failure, it doesn't crash the whole request. Instead it falls back to lexicalScore, a much dumber measure:

function lexicalScore(query, content) {
  queryTerms = words in query, e.g. {"sick","leave","policy"}
  contentTerms = words in content
  matches = how many queryTerms also appear in contentTerms
  return matches / queryTerms.size
}

For row 3 ("Annual leave policy is 20 days"): query words {sick, leave, policy}, content has leave and policy → 2/3 = 0.67. This just counts overlapping words with no understanding of meaning, but better than nothing if the real reranker is down.

(In our dry run, assume the real API succeeded, so we use scores = [0.95, 0.88, 0.40, 0.05].)

Next we attach scores and re-sort
return candidates
  .map((c, i) => ({ ...c, rerankScore: scores[i] }))
  .sort((a, b) => b.rerankScore - a.rerankScore);

Each candidate gets its matching score attached (by position — scores[0] goes with candidates[0], etc.):
id	                content	                  rerankScore
1	                  sick leave days per year	0.95
2	                  sick leave via HR portal	0.88
3	                  annual leave policy	      0.40
4	                  office hours	            0.05

Then sorted descending by rerankScore (best relevance first), here it happens to already be in that order, but this sort is what would fix it if the vector-distance order and the true-relevance order disagreed.

This whole sorted list is rerankedAll, returned to search.js.

back in search.js, cut to final k
res.json({ results: rerankedAll.slice(0, k) });   // k = 2
Takes only the top 2:
{
  "results": [
    { "id": 1, "content": "Employees get 12 sick leave days per year", "rerankScore": 0.95, ... },
    { "id": 2, "content": "Sick leave must be applied via the HR portal", "rerankScore": 0.88, ... }
  ]
}

Row 4 ("office hours"), which had snuck into the top candidates from vector search alone, correctly got filtered out by reranking before the final cut.
*/