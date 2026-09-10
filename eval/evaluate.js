require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const questions = require('./questions.json');
const { hitAtK, precisionAtK, recallAtK, reciprocalRank, evaluateAll } = require('./metrics');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const K = 5;

// Runs one pipeline endpoint across all questions, returning both the per-question detail(for failure analysis) and the data evaluateAll needs.
async function runPipeline(endpoint) {
  const perQuestion = [];

  for (const { question, relevantDocIds } of questions) {
    const { data } = await axios.post(`${BASE_URL}${endpoint}`, { query: question, k: K });
    const retrievedDocIds = data.results.map((r) => r.source_doc_id); //extracting only ids from the data.results.

    perQuestion.push({
      question,
      relevantDocIds,
      retrievedDocIds,
      hitAtK: hitAtK(retrievedDocIds, relevantDocIds, K),
      precisionAtK: precisionAtK(retrievedDocIds, relevantDocIds, K),
      recallAtK: recallAtK(retrievedDocIds, relevantDocIds, K),
      reciprocalRank: reciprocalRank(retrievedDocIds, relevantDocIds),
    });
  }

  const aggregate = evaluateAll(
    perQuestion.map(({ retrievedDocIds, relevantDocIds }) => ({ retrievedDocIds, relevantDocIds })),
    K
  );

  return { perQuestion, aggregate };
}

async function main() {
  console.log(`Evaluating on ${questions.length} questions, K=${K}...\n`);

  const basic = await runPipeline('/search');
  const reranked = await runPipeline('/search/rerank');

  console.log('Basic vector search:', basic.aggregate);
  console.log('Reranked search:    ', reranked.aggregate);

  const output = {
    k: K,
    timestamp: new Date().toISOString(),
    basic,
    reranked,
  };

  const outPath = path.join(__dirname, 'results.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nFull per question results written to ${outPath}`);
}

main().catch((err) => {
  const serverMessage = err.response?.data?.error;
  console.error('Evaluation failed:', serverMessage || err.message);
  process.exit(1);
});


/*
Basic vector search: {
  'Hit@5': 0.9333333333333333,
  'Precision@5': 0.36666666666666664,
  'Recall@5': 0.5472222222222222,
  MRR: 0.6955555555555556
}
Reranked search:     {
  'Hit@5': 0.8666666666666667,
  'Precision@5': 0.3466666666666667,
  'Recall@5': 0.5111111111111112,
  MRR: 0.6733333333333332
}


for another set of data

Basic vector search:
{
  'Hit@5': 0.8833333333333333,
  'Precision@5': 0.33666666666666667,
  'Recall@5': 0.4944444444444445,
  'MRR': 0.6588888888888888
}

Reranked search:
{
  'Hit@5': 0.9166666666666666,
  'Precision@5': 0.35333333333333334,
  'Recall@5': 0.5277777777777778,
  'MRR': 0.6844444444444444
}

for another set of data
Basic vector search: {
  'Hit@5': 0.8,
  'Precision@5': 0.31333333333333335,
  'Recall@5': 0.7583333333333332,
  MRR: 0.6649999999999999
}
Reranked search:     {
  'Hit@5': 0.6666666666666666,
  'Precision@5': 0.2666666666666667,
  'Recall@5': 0.6305555555555556,
  MRR: 0.5916666666666667
}

for another set of data
Basic vector search: {
  'Hit@5': 0.9,
  'Precision@5': 0.41333333333333344,
  'Recall@5': 0.8555555555555556,
  MRR: 0.8666666666666667
}
Reranked search:     {
  'Hit@5': 0.8333333333333334,
  'Precision@5': 0.3466666666666667,
  'Recall@5': 0.75,
  MRR: 0.7416666666666667
}


for local model

Basic vector search: {
  'Hit@5': 0.9,
  'Precision@5': 0.41333333333333344,
  'Recall@5': 0.8555555555555556,
  MRR: 0.8666666666666667
}
Reranked search:     {
  'Hit@5': 0.8666666666666667,
  'Precision@5': 0.36666666666666675,
  'Recall@5': 0.7666666666666668,
  MRR: 0.7388888888888888
}
*/