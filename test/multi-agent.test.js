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
  const result = await runCoordinator('What is the status of Project Alpha?', { askModel: fakeCoordinatorModel, employeeId: 'EMP3' });
  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(result.collaboration, 'single-specialist');
  assert.strictEqual(result.results[0].agent, 'project');
}

async function testTaskSpecialistRouting() {
  assert.deepStrictEqual(chooseAgents('Show overdue tasks for Project Alpha.'), ['project', 'task']);
  const result = await runCoordinator('Show overdue tasks for Project Alpha.', { askModel: fakeCoordinatorModel, employeeId: 'EMP3' });
  assert.strictEqual(result.status, 'completed');
  assert(result.results.some((item) => item.agent === 'task'));
  assert(result.results.find((item) => item.agent === 'task').result.count > 0);
}

async function testMultipleAgentsAndCombinedResults() {
  const result = await runCoordinator('Analyze Project Alpha overdue tasks and team workload.', { askModel: fakeCoordinatorModel, employeeId: 'EMP3' });
  assert.deepStrictEqual(result.selectedAgents, ['project', 'task', 'employee']);
  assert.strictEqual(result.collaboration, 'multi-specialist-combined');
  assert.strictEqual(result.results.length, 3);
  assert(result.finalAnswer.includes('Project Alpha'));
  assert(result.finalAnswer.includes('overdue'));
}

async function testAmbiguousQueryRequestsClarification() {
  const result = await runCoordinator('Tell me about the status.', { askModel: fakeCoordinatorModel, employeeId: 'EMP3' });
  assert.strictEqual(result.status, 'needs_clarification');
  assert.deepStrictEqual(result.selectedAgents, []);
  assert(result.message.includes('projects, tasks, or employee workload'));
}

async function testSpecialistResultsUseOneSharedContext() {
  const result = await runCoordinator('Analyze Project Alpha overdue tasks and team workload.', { askModel: fakeCoordinatorModel, employeeId: 'EMP3' });
  const projectResult = result.results.find((item) => item.agent === 'project').result;
  const taskResult = result.results.find((item) => item.agent === 'task').result;
  assert.strictEqual(projectResult.projects[0].project.id, 'PROJ_ALPHA');
  assert(taskResult.tasks.every((task) => task.projectId === 'PROJ_ALPHA'));
}

async function testCoordinatorRequiresActor() {
  let modelCalls = 0;
  const result = await runCoordinator('What is the status of Project Alpha?', {
    askModel: () => {
      modelCalls += 1;
      return { content: '{}' };
    },
  });
  assert.strictEqual(result.status, 'denied');
  assert.strictEqual(modelCalls, 0);
}

async function testEmployeeScopeAndSensitiveActionDenial() {
  const scoped = await runCoordinator('What is the status of Project Beta?', {
    askModel: fakeCoordinatorModel,
    employeeId: 'EMP1',
  });
  const projects = scoped.results[0].result.projects;
  assert(projects.every((item) => item.project.ownerId === 'EMP1'));

  const denied = await runCoordinator('Change TASK1 status to done.', {
    askModel: () => { throw new Error('model should not be called'); },
    employeeId: 'EMP1',
  });
  assert.strictEqual(denied.status, 'denied');
}

async function testAdminMutationConfirmationAndExecution() {
  const askModel = () => { throw new Error('model should not be called for mutations'); };
  const pending = await runCoordinator('Mark TASK1 done.', {
    askModel,
    employeeId: 'EMP2',
  });
  assert.strictEqual(pending.status, 'confirmation_required');
  assert.strictEqual(pending.action, 'update_task_status');

  const status = await runCoordinator('Mark TASK1 done.', {
    askModel,
    employeeId: 'EMP2',
    confirmed: true,
  });
  assert.strictEqual(status.status, 'completed');
  assert.strictEqual(status.result.updated, true);

  const assignment = await runCoordinator('Assign TASK1 to EMP2.', {
    askModel,
    employeeId: 'EMP2',
    confirmed: true,
  });
  assert.strictEqual(assignment.result.updated, true);
  assert.strictEqual(assignment.result.task.assigneeId, 'EMP2');

  const risk = await runCoordinator('Update UPD4 risk to high.', {
    askModel,
    employeeId: 'EMP2',
    confirmed: true,
  });
  assert.strictEqual(risk.result.updated, true);
  assert.strictEqual(risk.result.update.riskLevel, 'high');
}

async function testAdminCanExecuteCombinedMutations() {
  const tools = require('../src/toolImpl');
  const context = tools.createContext();
  context.data.project_updates.push({
    id: 'UPD4',
    projectId: 'PROJ_ALPHA',
    updateDate: '2026-09-20',
    description: 'Combined mutation test',
    riskLevel: 'low',
  });
  const result = await runCoordinator('Update UPD4 risk to high and status of TASK44 as todo', {
    context,
    employeeId: 'EMP2',
    confirmed: true,
    askModel: () => { throw new Error('model should not be called for mutations'); },
  });
  assert.strictEqual(result.status, 'completed');
  assert.deepStrictEqual(result.actions, ['update_project_update_risk', 'update_task_status']);
  assert.strictEqual(result.results[0].result.update.riskLevel, 'high');
  assert.strictEqual(result.results[1].result.task.status, 'todo');
}

async function testDuplicateRoutingAndSpecialistFailureIsolation() {
  const toolModule = require('../src/toolImpl');
  const originalGetProject = toolModule.get_project;
  toolModule.get_project = () => { throw new Error('simulated failure'); };
  try {
    const result = await runCoordinator('Analyze Project Alpha overdue tasks and team workload.', {
      askModel(messages) {
        if (messages[0].content.includes('select every specialist')) {
          return { content: '{"agents":["project","project","task","unknown"]}' };
        }
        return { content: 'The project specialist failed; task results are available.' };
      },
      employeeId: 'EMP3',
    });
    assert.deepStrictEqual(result.selectedAgents, ['project', 'task']);
    assert.strictEqual(result.results[0].result.error, 'Specialist failed to complete the request.');
    assert.strictEqual(result.results.length, 2);
  } finally {
    toolModule.get_project = originalGetProject;
  }
}

(async () => {
  await testSingleSpecialistRouting();
  await testTaskSpecialistRouting();
  await testMultipleAgentsAndCombinedResults();
  await testAmbiguousQueryRequestsClarification();
  await testSpecialistResultsUseOneSharedContext();
  await testCoordinatorRequiresActor();
  await testEmployeeScopeAndSensitiveActionDenial();
  await testAdminMutationConfirmationAndExecution();
  await testAdminCanExecuteCombinedMutations();
  await testDuplicateRoutingAndSpecialistFailureIsolation();
  console.log('multi-agent checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
