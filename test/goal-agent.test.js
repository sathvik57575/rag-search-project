const assert = require('assert');

process.env.GEMINI_API_KEY = 'test-key';
process.env.DEFAULT_MODEL = 'gemini-3.5-flash-lite';

const axios = require('axios');
const originalPost = axios.post;
const { runAgent } = require('../src/agent');
const tools = require('../src/toolImpl');

function functionResponse(name, args, thoughtSignature) {
  return {
    data: {
      candidates: [{
        content: {
          parts: [{
            functionCall: { name, args },
            ...(thoughtSignature ? { thoughtSignature } : {})
          }]
        }
      }]
    }
  };
}

function textResponse(text) {
  return { data: { candidates: [{ content: { parts: [{ text }] } }] } };
}

async function withGeminiResponses(responses, callback) {
  let index = 0;
  axios.post = async (url, body) => {
    assert(url.includes('generateContent'));
    assert(body.tools && body.tools[0].functionDeclarations.length >= 10);
    const response = responses[index++];
    if (!response) throw new Error('Unexpected extra Gemini request');
    return response;
  };
  try {
    return await callback();
  } finally {
    axios.post = originalPost;
  }
}

async function testComplexGoal() {
  const responses = [
    functionResponse('get_projects', {}, 'sig-1'),
    functionResponse('get_tasks', { projectId: 'PROJ_ALPHA', overdue: true }, 'sig-2'),
    functionResponse('calculate_project_metrics', { projectId: 'PROJ_ALPHA' }, 'sig-3'),
    functionResponse('find_project_risks', { projectId: 'PROJ_ALPHA' }, 'sig-4'),
    functionResponse('create_recommendation', {
      projectId: 'PROJ_ALPHA',
      title: 'Unblock overdue work',
      rationale: 'Two tasks are overdue.',
      action: 'Review ownership and unblock the overdue tasks.',
      priority: 'high'
    }, 'sig-5'),
    textResponse('Project Alpha is delayed because of overdue work. I recommend reviewing ownership and unblocking those tasks.')
  ];
  const result = await withGeminiResponses(responses, () => runAgent('Find delayed projects, identify causes, and recommend actions.', { model: 'gemini-3.5-flash-lite' }));
  assert.strictEqual(result.log.length, 5);
  assert.strictEqual(result.log[4].tool, 'create_recommendation');
  assert(result.finalAnswer.includes('Project Alpha'));
  assert.strictEqual(result.state.recommendations.length, 1);
}

async function testFailureRecoveryAndDuplicateAvoidance() {
  const responses = [
    functionResponse('get_task', { id: 'MISSING' }, 'sig-1'),
    functionResponse('get_tasks', { projectId: 'PROJ_ALPHA', pending: true }, 'sig-2'),
    functionResponse('get_tasks', { projectId: 'PROJ_ALPHA', pending: true }, 'sig-3'),
    textResponse('The task was missing, so I used the available pending tasks for Project Alpha. The repeated lookup was unnecessary.')
  ];
  const result = await withGeminiResponses(responses, () => runAgent('Find the missing task and then report pending work for Alpha.', { model: 'gemini-3.5-flash-lite' }));
  assert.strictEqual(result.state.failures.length, 1);
  assert.strictEqual(result.log[2].result.cached, true);
  assert(result.finalAnswer.includes('pending'));
}

async function testMutationConfirmation() {
  const responses = [
    functionResponse('update_task_status', { taskId: 'TASK1', status: 'done', reason: 'Verified complete' }, 'sig-1')
  ];
  const pending = await withGeminiResponses(responses, () => runAgent('Mark TASK1 done.', { model: 'gemini-3.5-flash-lite' }));
  assert(pending.pendingConfirmation);
  assert.strictEqual(pending.log[0].result.confirmation_required, true);

  const confirmedResponses = [
    functionResponse('update_task_status', { taskId: 'TASK1', status: 'done', reason: 'Verified complete' }, 'sig-1'),
    textResponse('TASK1 was marked done.')
  ];
  const confirmed = await withGeminiResponses(confirmedResponses, () => runAgent('Mark TASK1 done.', { model: 'gemini-3.5-flash-lite', confirmed: true, persist: false }));
  assert.strictEqual(confirmed.log[0].result.updated, true);
  assert.strictEqual(confirmed.log[0].result.previousStatus, 'in_progress');
}

async function testProjectUpdateRiskMutation() {
  const responses = [
    functionResponse('get_project_updates', {}, 'sig-1'),
    functionResponse('update_project_update_risk', { updateId: 'UPD4', riskLevel: 'high', reason: 'User requested update' }, 'sig-2')
  ];
  const pending = await withGeminiResponses(responses, () => runAgent('Update project update UPD4 to risk level high.', { model: 'gemini-3.5-flash-lite' }));
  assert(pending.pendingConfirmation);
  assert.strictEqual(pending.pendingConfirmation.action, 'update_project_update_risk');
  assert.strictEqual(pending.log[1].result.confirmation_required, true);

  const confirmedResponses = [
    functionResponse('update_project_update_risk', { updateId: 'UPD4', riskLevel: 'high', reason: 'User requested update' }, 'sig-1'),
    textResponse('UPD4 was updated to high risk.')
  ];
  const confirmed = await withGeminiResponses(confirmedResponses, () => runAgent('Update project update UPD4 to risk level high.', { model: 'gemini-3.5-flash-lite', confirmed: true, persist: false }));
  assert.strictEqual(confirmed.log[0].result.updated, true);
  assert.strictEqual(confirmed.log[0].result.previousRiskLevel, 'low');
}

async function testAmbiguousInput() {
  const responses = [
    functionResponse('get_employee', { name: 'John' }, 'sig-1'),
    textResponse('There are multiple employees named John. Please specify John Smith or John Doe.')
  ];
  const result = await withGeminiResponses(responses, () => runAgent('Show me John\'s pending tasks.', { model: 'gemini-3.5-flash-lite' }));
  assert.strictEqual(result.log[0].result.ambiguous, true);
  assert(result.finalAnswer.includes('multiple'));
}

async function testInvalidMutationRecovery() {
  const responses = [
    functionResponse('update_task_status', { taskId: 'get_tasks', status: 'done' }, 'sig-1'),
    functionResponse('get_employee', { name: 'John Doe' }, 'sig-2'),
    functionResponse('get_tasks', { assigneeId: 'EMP2', pending: true }, 'sig-3'),
    textResponse('John Doe has no pending tasks to update.')
  ];
  const result = await withGeminiResponses(responses, () => runAgent('Make all John Doe tasks completed.', { model: 'gemini-3.5-flash-lite', confirmed: true, persist: false }));
  assert(result.state.failures.some((failure) => failure.error.includes('Invalid taskId')));
  assert.strictEqual(result.log[0].result.error.startsWith('Invalid taskId'), true);
  assert.strictEqual(result.log[2].tool, 'get_tasks');
}

function testToolContextIsolationAndConflictingData() {
  const first = tools.createContext();
  const second = tools.createContext();
  const update = tools.update_task_status({ taskId: 'TASK1', status: 'blocked' }, first);
  assert.strictEqual(update.updated, true);
  assert.strictEqual(tools.get_task({ id: 'TASK1' }, first).status, 'blocked');
  assert.strictEqual(tools.get_task({ id: 'TASK1' }, second).status, 'in_progress');
  const risk = tools.find_project_risks({ projectId: 'PROJ_ALPHA' }, second);
  assert(risk.risks.some((item) => item.type === 'overdue_work'));
  second.data.tasks[0].status = 'unknown_status';
  const inconsistent = tools.find_project_risks({ projectId: 'PROJ_ALPHA' }, second);
  assert(inconsistent.risks.some((item) => item.type === 'inconsistent_data'));
}

(async () => {
  await testComplexGoal();
  await testFailureRecoveryAndDuplicateAvoidance();
  await testMutationConfirmation();
  await testProjectUpdateRiskMutation();
  await testAmbiguousInput();
  await testInvalidMutationRecovery();
  testToolContextIsolationAndConflictingData();
  console.log('goal agent checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
