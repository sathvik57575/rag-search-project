/**
 All functions take:
  retrievedDocIds: string[]- ranked list of source_doc_id returned by search, best first
relevantDocIds: string[] - ground-truth correct source_doc_ids for this question
 k: number
 */

//this is for hit@k
function hitAtK(retrievedDocIds, relevantDocIds, k) {
  const topK = retrievedDocIds.slice(0, k);
  return topK.some((id) => relevantDocIds.includes(id)) ? 1 : 0;
  //this is just checking if any id exists in top k of retrivedDocIds that also exists in relevantDocIds
}

//Precision@K
function precisionAtK(retrievedDocIds, relevantDocIds, k) {
  const topK = retrievedDocIds.slice(0, k);
  const relevantCount = topK.filter((id) => relevantDocIds.includes(id)).length;
  return relevantCount / k;

  //this is checking out of the topk results shown in retrievedDocIds how are relevant, which means they should also exist in relevantDocIds
  /*
  Example: topK = ["HR003","HR001","HR007"]
relevant = ["HR001"]
After filter: ["HR001"]
.length = 1
return relevantCount / k;

1 / 3
Result: 0.333
Meaning: 33% of returned results were relevant.
*/
}

//recall@k
function recallAtK(retrievedDocIds, relevantDocIds, k) {
  if (relevantDocIds.length === 0) return 0;
  const topK = retrievedDocIds.slice(0, k);
  const relevantCount = topK.filter((id) => relevantDocIds.includes(id)).length;
  return relevantCount / relevantDocIds.length;
  //meaning how many relevant documents we managed to find out of all relevant documents in the relevantDocIds
}

//MRR
function reciprocalRank(retrievedDocIds, relevantDocIds) {
  for (let i = 0; i < retrievedDocIds.length; i++) {
    if (relevantDocIds.includes(retrievedDocIds[i])) {
        return 1 / (i + 1)
      };
  }
  return 0;

  //this is just basically returning how early does the first result appear
}

/**
Runs all metrics across a full question set and averages them.
  @param {Array<{retrievedDocIds: string[], relevantDocIds: string[]}>} runs
  @param {number} k

runs
looks like this:
[
  {
    retrievedDocIds: [...],
    relevantDocIds: [...]
  },
  {
    retrievedDocIds: [...],
    relevantDocIds: [...]
  }

  ...so on
]

Each object represents one question.
 */
function evaluateAll(runs, k) {
  //performing all the above rank checks for whole dataset

  const n = runs.length;
  const totals = { hit: 0, precision: 0, recall: 0, mrr: 0 };

  for (const { retrievedDocIds, relevantDocIds } of runs) {
    totals.hit += hitAtK(retrievedDocIds, relevantDocIds, k);
    totals.precision += precisionAtK(retrievedDocIds, relevantDocIds, k);
    totals.recall += recallAtK(retrievedDocIds, relevantDocIds, k);
    totals.mrr += reciprocalRank(retrievedDocIds, relevantDocIds);
  }

  return {
    [`Hit@${k}`]: totals.hit / n,
    [`Precision@${k}`]: totals.precision / n,
    [`Recall@${k}`]: totals.recall / n,
    MRR: totals.mrr / n,
  };
  // averaging them
}

module.exports = { hitAtK, precisionAtK, recallAtK, reciprocalRank, evaluateAll };
