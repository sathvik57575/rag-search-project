const axios = require('axios');
const { toolDefinitions } = require('./tools');
const toolImpl = require('./toolImpl');

// const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'llama3.2';
const DEFAULT_MODEL =  'llama3.2';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/chat';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
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

function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;

  const { additionalProperties, properties, items, ...supportedSchema } = schema;
  if (properties) {
    supportedSchema.properties = Object.fromEntries(
      Object.entries(properties).map(([name, property]) => [name, toGeminiSchema(property)])
    );
  }
  if (items) supportedSchema.items = toGeminiSchema(items);
  return supportedSchema;
}

async function askModel1(messages, model) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required');

  const systemInstruction = messages.find((message) => message.role === 'system');
  const contents = messages
    .filter((message) => message.role !== 'system')
    .map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'user',
          parts: [{
            functionResponse: {
              name: message.tool_name,
              response: JSON.parse(message.content)
            }
          }]
        };
      }

      if (message.role === 'assistant') {
        return {
          role: 'model',
          parts: message.tool_calls
            ? message.tool_calls.map((call) => ({
              functionCall: {
                name: call.function.name,
                args: parseArguments(call.function.arguments)
              },
              ...(call.function.thoughtSignature
                ? { thoughtSignature: call.function.thoughtSignature }
                : {})
            }))
            : [{ text: message.content || '' }]
        };
      }

      return { role: 'user', parts: [{ text: message.content }] };
    });

  let response;
  try {
    response = await axios.post(
      `${GEMINI_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        systemInstruction: systemInstruction
          ? { parts: [{ text: systemInstruction.content }] }
          : undefined,
        contents,
        tools: [{
          functionDeclarations: toolDefinitions.map((tool) => ({
            ...tool.function,
            parameters: toGeminiSchema(tool.function.parameters)
          }))
        }]
      }
    );
  } catch (error) {
    const geminiMessage = error.response
      && error.response.data
      && error.response.data.error
      && error.response.data.error.message;
    throw new Error(geminiMessage || error.message);
  }

  const parts = response.data
    && response.data.candidates
    && response.data.candidates[0]
    && response.data.candidates[0].content
    && response.data.candidates[0].content.parts;
  if (!parts) throw new Error('Gemini returned no content');

  const toolCalls = parts
    .filter((part) => part.functionCall)
    .map((part) => ({
      function: {
        name: part.functionCall.name,
        arguments: JSON.stringify(part.functionCall.args || {}),
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {})
      }
    }));

  return {
    role: 'assistant',
    content: parts.filter((part) => part.text).map((part) => part.text).join(''),
    ...(toolCalls.length ? { tool_calls: toolCalls } : {})
  };
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
    // const assistantMessage = await askModel1(messages, model);
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