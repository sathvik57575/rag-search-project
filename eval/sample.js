require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const OUTPUT_PATH = path.join(__dirname, 'results1.js');
//ask
const tests = [
  {
    name: 'direct question',
    question: 'How many paid leave days does the current policy give employees?',
    expectedSources: ['HR002'],
    sourceMode: 'any',
    answerMustContain: ['28'],
  },
  {
    name: 'paraphrased question',
    question: 'How much advance warning do I need before taking time off?',
    expectedSources: ['HR002'],
    sourceMode: 'any',
    answerMustContain: ['five'],
  },
  {
    name: 'several HR documents',
    question: 'What rules cover working from home, flexible schedules, and attendance records?',
    expectedSources: ['HR004', 'HR011', 'HR014'],
    sourceMode: 'some',
    answerMustContain: [],
  },
  {
    name: 'information across engineering documents',
    question: 'What needs to happen before, during, and after a production database change?',
    expectedSources: ['EN002', 'EN006', 'EN010'],
    sourceMode: 'some',
    answerMustContain: ['rollback'],
  },
  {
    name: 'information across finance documents',
    question: 'How are expenses approved and what evidence is needed before reimbursement?',
    expectedSources: ['FI001', 'FI014'],
    sourceMode: 'some',
    answerMustContain: ['receipt'],
  },
  {
    name: 'missing information',
    question: 'What is the company policy for employee stock options and equity grants?',
    expectedSources: [],
    sourceMode: 'none',
    answerMustContain: ["don't know"],
  },
  {
    name: 'conflicting old and new policy',
    question: 'The old leave policy says 24 days and the newer one says 28 days. Which allowance is current?',
    expectedSources: ['HR001', 'HR002'],
    sourceMode: 'all',
    answerMustContain: ['28', '2025'],
  },
  {
    name: 'security paraphrase',
    question: 'What should I do if I think a message is a phishing attempt?',
    expectedSources: ['SE002'],
    sourceMode: 'any',
    answerMustContain: ['report'],
  },
  {
    name: 'security evidence and logs',
    question: 'During an investigation, how should evidence and security logs be handled?',
    expectedSources: ['SE008', 'SE016'],
    sourceMode: 'some',
    answerMustContain: ['preserv'],
  },
  {
    name: 'IT access process',
    question: 'What approvals are needed before a user receives access to a system?',
    expectedSources: ['IT008'],
    sourceMode: 'any',
    answerMustContain: ['manager'],
  },
  {
    name: 'operations and continuity',
    question: 'How often are business continuity plans reviewed and tested?',
    expectedSources: ['OP004'],
    sourceMode: 'any',
    answerMustContain: ['annual'],
  },
  {
    name: 'unsupported specific detail',
    question: 'What is the exact salary increase percentage for employees who complete training?',
    expectedSources: [],
    sourceMode: 'none',
    answerMustContain: ["don't know"],
  },
];

function getSourceIds(response) {
  return [...new Set((response.sources || []).map((source) => source.documentId))];
}

function checkSources(sourceIds, expectedSources, sourceMode) {
  if (sourceMode === 'none') return sourceIds.length === 0 || expectedSources.every((id) => !sourceIds.includes(id));
  if (sourceMode === 'all') return expectedSources.every((id) => sourceIds.includes(id));
  if (sourceMode === 'some') return expectedSources.some((id) => sourceIds.includes(id));
  return expectedSources.some((id) => sourceIds.includes(id));
}

async function runTest(test) {
  const startedAt = new Date().toISOString();
  try {
    const { data } = await axios.post(`${BASE_URL}/ask`, {
      question: test.question,
      k: 6,
    });
    const sourceIds = getSourceIds(data);
    const answer = String(data.answer || '');
    const answerLower = answer.toLowerCase();
    const sourcePassed = checkSources(sourceIds, test.expectedSources, test.sourceMode);
    const answerPassed = test.answerMustContain.every((term) => answerLower.includes(term.toLowerCase()));

    return {
      name: test.name,
      question: test.question,
      expectedSources: test.expectedSources,
      retrievedSourceIds: sourceIds,
      answer,
      sources: data.sources || [],
      model: data.model,
      sourcePassed,
      answerPassed,
      passed: sourcePassed && answerPassed,
      startedAt,
    };
  } catch (error) {
    return {
      name: test.name,
      question: test.question,
      expectedSources: test.expectedSources,
      retrievedSourceIds: [],
      answer: null,
      sources: [],
      sourcePassed: false,
      answerPassed: false,
      passed: false,
      error: error.response?.data?.error || error.message,
      startedAt,
    };
  }
}

async function main() {
  const results = [];
  for (const test of tests) {
    const result = await runTest(test);
    results.push(result);
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}`);
    if (result.error) console.log(`  error: ${result.error}`);
    else console.log(`  sources: ${result.retrievedSourceIds.join(', ') || '(none)'}`);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    endpoint: `${BASE_URL}/ask`,
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    results,
  };

  const outPath = path.join(__dirname, 'results1.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nSaved detailed results to ${outPath}`);
  console.log(`Summary: ${summary.passed}/${summary.total} passed`);
}

main().catch((error) => {
  console.error('Sample evaluation failed:', error.message);
  process.exit(1);
});
