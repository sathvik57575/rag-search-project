const axios = require('axios');
const { toolDefinitions } = require('./tools');
const toolImpl = require('./toolImpl');

const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/chat';
const MAX_ITERATIONS = 8;

const systemMessage = {
  role: 'system',
  content: 'You are a project management agent. Use the tool that matches the entity named by the user: employees use get_employee, projects use get_project or get_projects, and tasks use get_task or get_tasks. When a task question names a person, make an actual get_employee tool call first and pass the returned employee ID to get_tasks. When an ownership question names a person, make an actual get_employee tool call first and pass the returned employee ID to get_projects. Never pass an empty assigneeId or ownerId, a person name as assigneeId or ownerId, or the string get_employee as an ID. Never write a proposed tool call as text or JSON in your answer. When the user asks about pending tasks, use pending=true. When the user asks what employees exist or asks to list employees without naming one, call get_employee with an empty object. Use tools for project data; never invent records. If a tool returns ambiguous matches, ask the user to clarify. Explain the answer concisely and mention relevant names, projects, and dates.'
};

async function askModel(messages, model) {
  const response = await axios.post(OLLAMA_URL, {
    model,
    messages,
    tools: toolDefinitions,
    stream: false
  });
  const message = response.data && response.data.message;
  if (!message) throw new Error('Ollama returned no message');
  return message;
}

function parseArguments(rawArguments) {
  if (!rawArguments) return {};
  if (typeof rawArguments === 'object') return rawArguments;
  return JSON.parse(rawArguments);
}

async function runAgent(userMessage, options = {}) {
  if (!userMessage || typeof userMessage !== 'string') throw new Error('message is required');
  const model = options.model || DEFAULT_MODEL;
  const messages = [systemMessage, { role: 'user', content: userMessage }];
  const log = [];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const assistantMessage = await askModel(messages, model);
    messages.push(assistantMessage);
    const calls = assistantMessage.tool_calls || [];

    if (calls.length === 0) {
      return { finalAnswer: assistantMessage.content || '', model, iterations: iteration, log };
    }

    for (const call of calls) {
      const toolName = call.function && call.function.name;
      const argumentsValue = call.function && call.function.arguments;
      const argumentsObject = parseArguments(argumentsValue);
      let result;

      try {
        if (!toolImpl[toolName]) throw new Error(`Unknown tool '${toolName}'`);
        result = toolImpl[toolName](argumentsObject);
      } catch (error) {
        result = { error: error.message };
      }

      log.push({ iteration, tool: toolName, arguments: argumentsObject, result });
      messages.push({
        role: 'tool',
        tool_name: toolName,
        content: JSON.stringify(result)
      });
    }
  }

  return {
    finalAnswer: 'I could not complete the request within the tool-call limit.',
    model,
    iterations: MAX_ITERATIONS,
    stopped: 'max_iterations',
    log
  };
}

module.exports = { runAgent, MAX_ITERATIONS };


/*
{
  "tool_calls": [
    {
      "function": {
        "name": "get_employee",
        "arguments": {
          "name": "John"
        }
      }
    }
  ]
}
*/