const assert = require('assert');
const tools = require('../src/toolImpl');

function testPlanAndReplan() {
  const context = tools.createContext();
  const planned = tools.create_plan({
    objective: 'Prioritize active project risks',
    steps: [
      { id: 'discover', tool: 'get_projects', dependsOn: [] },
      { id: 'assess', tool: 'find_project_risks', dependsOn: ['discover'] }
    ]
  }, context);
  assert.strictEqual(planned.planned, true);
  const revised = tools.replan({
    reason: 'Project updates contain conflicting risk levels.',
    steps: [
      { id: 'discover', tool: 'get_projects', dependsOn: [] },
      { id: 'updates', tool: 'get_project_updates', dependsOn: ['discover'] },
      { id: 'assess', tool: 'find_project_risks', dependsOn: ['updates'] }
    ]
  }, context);
  assert.strictEqual(revised.replanned, true);
  assert.strictEqual(context.plan.version, 2);
}

function testRiskEvidence() {
  const context = tools.createContext();
  context.data.projects.push({ id: 'PROJ_EMPTY', name: 'Empty Project', status: 'active', ownerId: 'EMP1', startDate: '2026-01-01', deadline: '2026-12-01' });
  context.data.project_updates = [
    { id: 'UPD1', projectId: 'PROJ_EMPTY', updateDate: '2026-01-01', description: 'Green', riskLevel: 'low' },
    { id: 'UPD2', projectId: 'PROJ_EMPTY', updateDate: '2026-09-14', description: 'Critical dependency', riskLevel: 'high' }
  ];
  const updates = tools.get_project_updates({ projectId: 'PROJ_EMPTY' }, context);
  assert.deepStrictEqual(updates.conflictingUpdateIds.sort(), ['UPD1', 'UPD2']);
  assert.deepStrictEqual(updates.staleUpdateIds, ['UPD1']);
  const risk = tools.find_project_risks({ projectId: 'PROJ_EMPTY' }, context);
  assert(risk.risks.some((item) => item.type === 'no_task_coverage'));
  assert(risk.risks.some((item) => item.type === 'conflicting_updates'));
}

function testInvalidDataDoesNotGuess() {
  const context = tools.createContext();
  const result = tools.get_project_updates({ projectId: 'DOES_NOT_EXIST' }, context);
  assert(result.error.includes('Unknown projectId'));
  const tasks = tools.get_tasks({ projectId: 'DOES_NOT_EXIST' }, context);
  assert(tasks.error.includes('Unknown projectId'));
}

function testEmployeeNameOwnershipFallback() {
  const context = tools.createContext();
  const result = tools.get_projects({ name: 'Priya Shah' }, context);
  assert.strictEqual(result.count, 1);
  assert.strictEqual(result.projects[0].id, 'PROJ_ALPHA');
}

testPlanAndReplan();
testRiskEvidence();
testInvalidDataDoesNotGuess();
testEmployeeNameOwnershipFallback();
console.log('planning and risk checks passed');
