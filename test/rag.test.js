const assert = require('assert');
const { searchKnowledgeBase } = require('../src/rag');
const { chooseAgents, runCoordinator } = require('../src/multiAgent');

function fakeModel(messages) {
  const system = messages[0].content;
  if (system.includes('select every specialist')) {
    const query = messages[1].content;
    if (query.includes('remote work policy') && (query.includes('overdue tasks') || query.includes('tasks'))) {
      return { content: '{"agents":["knowledge","task","project"]}' };
    }
    if (query.includes('remote work policy')) {
      return { content: '{"agents":["knowledge"]}' };
    }
    if (query.includes('status of Project Alpha')) {
      return { content: '{"agents":["project"]}' };
    }
    return { content: '{"agents":["knowledge"]}' };
  }
  return { content: 'Synthesized response combining RAG Knowledge Base and Database records.' };
}

async function testRAGSearchDirect() {
  const result = searchKnowledgeBase('remote work policy', 3);
  assert(result.count > 0, 'RAG search should return results for remote work policy');
  assert(result.results.some((item) => item.source === 'company_policies.md'));
  assert.strictEqual(searchKnowledgeBase('quantum telescope calibration').count, 0);
  console.log('✔ Direct RAG search check passed');
}

async function testAgentSelectionForKnowledge() {
  const agentsOnlyKnowledge = chooseAgents('What is our remote work policy?');
  assert.deepStrictEqual(agentsOnlyKnowledge, ['knowledge']);

  const agentsCombined = chooseAgents('What is our remote work policy and which tasks in Project Alpha are overdue?');
  assert(agentsCombined.includes('knowledge'), 'Should select knowledge agent');
  assert(agentsCombined.includes('task'), 'Should select task agent');
  assert(agentsCombined.includes('project'), 'Should select project agent');
  console.log('✔ Specialist selection for RAG & Combined queries passed');
}

async function testCoordinatorExecutionWithRAG() {
  const result = await runCoordinator('What is our remote work policy and which tasks in Project Alpha are overdue?', {
    askModel: fakeModel,
    employeeId: 'EMP3',
  });

  assert.strictEqual(result.status, 'completed');
  assert(result.selectedAgents.includes('knowledge'), 'selectedAgents must include knowledge');
  assert(result.results.some((r) => r.agent === 'knowledge'), 'Results must contain knowledge agent output');
  assert(result.results.some((r) => r.agent === 'task'), 'Results must contain task agent output');
  console.log('✔ Coordinator multi-agent RAG + Database integration passed');
}

async function testOwnerQuestionUsesProjectEvidenceOnly() {
  const result = await runCoordinator('Who is owner of Project Alpha?', {
    askModel(messages) {
      if (messages[0].content.includes('select every specialist')) {
        return { content: '{"agents":["project","employee"]}' };
      }
      throw new Error('Owner answer should be composed from project evidence.');
    },
    employeeId: 'EMP2',
  });

  assert.deepStrictEqual(result.selectedAgents, ['project']);
  assert.strictEqual(result.finalAnswer, 'Project Alpha is owned by Priya Shah (EMP3).');
}

async function testWorkingHoursQuestionUsesKnowledgeEvidence() {
  const result = await runCoordinator('At what time should workers report?', {
    askModel(messages) {
      if (messages[0].content.includes('select every specialist')) {
        return { content: '{"agents":["project","employee"]}' };
      }
      throw new Error('Knowledge-only answer should use retrieved document text.');
    },
    employeeId: 'EMP2',
  });

  assert.deepStrictEqual(result.selectedAgents, ['knowledge']);
  assert(result.finalAnswer.includes('10:00 AM'));
  assert(result.finalAnswer.includes('company_policies.md'));
  assert(!result.finalAnswer.includes('Project Risk Assessment Criteria'));
}

async function testCombinedPolicyAndProjectOwnerAnswer() {
  const result = await runCoordinator('What is our task escalation policy and who is owner for project alpha?', {
    askModel: fakeModel,
    employeeId: 'EMP2',
  });

  assert(result.finalAnswer.includes('3 business days'));
  assert(result.finalAnswer.includes('Project Alpha is owned by Priya Shah (EMP3).'));
  assert(!result.finalAnswer.includes('Project Risk Assessment Criteria'));
  assert(!result.finalAnswer.includes('Data Governance and Role Permissions'));
}

async function runAll() {
  await testRAGSearchDirect();
  await testAgentSelectionForKnowledge();
  await testCoordinatorExecutionWithRAG();
  await testOwnerQuestionUsesProjectEvidenceOnly();
  await testWorkingHoursQuestionUsesKnowledgeEvidence();
  await testCombinedPolicyAndProjectOwnerAnswer();
  console.log('All RAG tests passed successfully!');
}

runAll().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
