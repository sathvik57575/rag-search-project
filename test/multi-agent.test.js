const assert = require('assert');
const { chooseAgents, runCoordinator } = require('../src/multiAgent');

function fakeCoordinatorModel(messages) {
  const system = messages[0].content;
  if (system.includes('select every specialist')) {
    const query = messages[1].content;
    if (query.includes('status of Project Alpha')) return { content: '{"agents":["project"]}' };
    if (query.includes('team workload')) return { content: '{"agents":["project","task","employee"]}' };
    if (query.includes('overdue tasks')) return { content: '{"agents":["project","task"]}' };
    return { content: '{"agents":[],"clarification":"Should I investigate projects, tasks, or employee workload?"}' };
  }
  return { content: 'Project Alpha is active with 31% completion and 2 overdue tasks.' };
}

async function testSingleSpecialistRouting() {
  assert.deepStrictEqual(chooseAgents('What is the status of Project Alpha?'), ['project']);
  const result = await runCoordinator('What is the status of Project Alpha?', { askModel: fakeCoordinatorModel });
  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(result.collaboration, 'single-specialist');
  assert.strictEqual(result.results[0].agent, 'project');
}

async function testTaskSpecialistRouting() {
  assert.deepStrictEqual(chooseAgents('Show overdue tasks for Project Alpha.'), ['project', 'task']);
  const result = await runCoordinator('Show overdue tasks for Project Alpha.', { askModel: fakeCoordinatorModel });
  assert.strictEqual(result.status, 'completed');
  assert(result.results.some((item) => item.agent === 'task'));
  assert(result.results.find((item) => item.agent === 'task').result.count > 0);
}

async function testMultipleAgentsAndCombinedResults() {
  const result = await runCoordinator('Analyze Project Alpha overdue tasks and team workload.', { askModel: fakeCoordinatorModel });
  assert.deepStrictEqual(result.selectedAgents, ['project', 'task', 'employee']);
  assert.strictEqual(result.collaboration, 'multi-specialist-combined');
  assert.strictEqual(result.results.length, 3);
  assert(result.finalAnswer.includes('Project Alpha'));
  assert(result.finalAnswer.includes('overdue'));
}

async function testAmbiguousQueryRequestsClarification() {
  const result = await runCoordinator('Tell me about the status.', { askModel: fakeCoordinatorModel });
  assert.strictEqual(result.status, 'needs_clarification');
  assert.deepStrictEqual(result.selectedAgents, []);
  assert(result.message.includes('projects, tasks, or employee workload'));
}

async function testSpecialistResultsUseOneSharedContext() {
  const result = await runCoordinator('Analyze Project Alpha overdue tasks and team workload.', { askModel: fakeCoordinatorModel });
  const projectResult = result.results.find((item) => item.agent === 'project').result;
  const taskResult = result.results.find((item) => item.agent === 'task').result;
  assert.strictEqual(projectResult.projects[0].project.id, 'PROJ_ALPHA');
  assert(taskResult.tasks.every((task) => task.projectId === 'PROJ_ALPHA'));
}

(async () => {
  await testSingleSpecialistRouting();
  await testTaskSpecialistRouting();
  await testMultipleAgentsAndCombinedResults();
  await testAmbiguousQueryRequestsClarification();
  await testSpecialistResultsUseOneSharedContext();
  console.log('multi-agent checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
