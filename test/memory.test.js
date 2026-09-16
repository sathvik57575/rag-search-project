const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const memory = require('../src/memory');
const tools = require('../src/toolImpl');
const { runAgent } = require('../src/agent');

const memoryPath = path.join(os.tmpdir(), `project-agent-memory-${process.pid}.json`);

function cleanMemory() {
  if (fs.existsSync(memoryPath)) fs.unlinkSync(memoryPath);
  memory.clearMemoryCache();
}

function testSaveUpdateForgetAndIsolation() {
  cleanMemory();
  const session = memory.createSession({ userId: 'alice', memoryPath });
  assert.strictEqual(memory.remember({ userId: 'alice', key: 'priority', content: 'Project Alpha is my priority.', tags: ['focus'] }, session).saved, true);
  assert.strictEqual(memory.remember({ userId: 'alice', key: 'priority', content: 'Project Beta is now my priority.', tags: ['focus'] }, session).updated, true);
  assert.strictEqual(memory.search({ userId: 'alice', query: 'What should I focus on today?', limit: 5 }, session).memories[0].content, 'Project Beta is now my priority.');
  assert.strictEqual(memory.search({ userId: 'bob', query: 'What should I focus on today?', limit: 5 }, session).count, 0);
  assert.strictEqual(memory.forget({ userId: 'alice', key: 'priority' }, session).removed, true);
  assert.strictEqual(memory.search({ userId: 'alice', query: 'priority', limit: 5 }, session).count, 0);
}

function testMemoryToolsUseUserSession() {
  cleanMemory();
  const context = tools.createContext({ memorySession: memory.createSession({ userId: 'alice', memoryPath }) });
  assert.strictEqual(tools.remember({ key: 'priority', content: 'Project Alpha is my priority.' }, context).saved, true);
  assert.strictEqual(tools.search_memory({ query: 'priority' }, context).count, 1);
  assert.strictEqual(tools.forget({ key: 'priority' }, context).removed, true);
}

function testShortTermConversationIsolation() {
  cleanMemory();
  memory.recordTurn({ userId: 'alice', conversationId: 'planning', userMessage: 'Project Alpha is the one we discussed.', assistantMessage: 'I will keep that context.' });
  assert.strictEqual(memory.getRecentTurns({ userId: 'alice', conversationId: 'planning' }).length, 1);
  assert.strictEqual(memory.getRecentTurns({ userId: 'bob', conversationId: 'planning' }).length, 0);
  assert.strictEqual(memory.getRecentTurns({ userId: 'alice', conversationId: 'other' }).length, 0);
}

async function testRememberProjectsIntent() {
  cleanMemory();
  const result = await runAgent('remember all the projects Priya owns', {
    userId: 'naresh',
    memoryPath,
    model: 'llama3.2',
  });
  assert(result.finalAnswer.includes('Project Alpha'));
  assert.strictEqual(result.log[0].tool, 'remember');
  assert.strictEqual(memory.search({ userId: 'naresh', query: 'Priya projects' }, { memoryPath }).count, 1);
}

async function testRememberPreferenceAndIsolation() {
  cleanMemory();
  const saved = await runAgent('remember that I want to focus on Project Alpha', {
    userId: 'sathvik',
    memoryPath,
    model: 'llama3.2',
  });
  assert(saved.finalAnswer.includes('saved'));
  const ownMemory = await runAgent('what project do I want to remember today', {
    userId: 'sathvik',
    memoryPath,
    model: 'llama3.2',
  });
  assert(ownMemory.finalAnswer.includes('Project Alpha'));
  const otherMemory = await runAgent('what project do I want to remember today', {
    userId: 'another-user',
    memoryPath,
    model: 'llama3.2',
  });
  assert(otherMemory.finalAnswer.includes('do not have a saved preference'));
  assert.strictEqual(memory.search({ userId: 'another-user', query: 'Project Alpha' }, { memoryPath }).count, 0);
  const wannaMemory = await runAgent('what project do I wanna focus on today', {
    userId: 'different-user',
    memoryPath,
    model: 'llama3.2',
  });
  assert(wannaMemory.finalAnswer.includes('do not have a saved preference'));
}

async function run() {
  testSaveUpdateForgetAndIsolation();
  testMemoryToolsUseUserSession();
  testShortTermConversationIsolation();
  await testRememberProjectsIntent();
  await testRememberPreferenceAndIsolation();
  cleanMemory();
  console.log('memory checks passed');
}

run().catch((error) => {
  cleanMemory();
  console.error(error);
  process.exitCode = 1;
});
