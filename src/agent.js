const axios = require('axios');
const { toolDefinitions } = require('./tools');
const toolImpl = require('./toolImpl');
const memory = require('./memory');

const DEFAULT_MODEL = 'qwen3:4b';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/chat';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_ITERATIONS = 15;

const systemMessage = {
  role: 'system',
  content: 'You are a goal-oriented project management agent. Understand the objective, create a dynamic plan with dependencies before a multi-project investigation, and choose the next tool from the evidence available. Evaluate every result before deciding whether more evidence is needed. If a tool fails, data is missing or invalid, or evidence conflicts, call replan with revised dependency-aware steps or stop with an explicit insufficiency. Do not follow a fixed workflow or call tools just to fill a sequence. Reuse results already present and never repeat an identical tool call unless retrying is necessary after a failure. Use tools for project data; never invent records. For risk reports, inspect active projects, use metrics, risk, and update evidence as needed, prioritize by severity, and recommend actions grounded in returned evidence. Resolve ambiguity by asking the user to clarify. Mutations require confirmation from the application. Treat conversation context as short-term and user memories as long-term. Search memory only when it is relevant to the current request. Save information only when the user explicitly asks you to remember it, update a stable key when it changes, and forget it when the user says it is no longer true. Never expose or use another user\'s memories.'
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

async function askConfiguredModel(messages, model) {
  if (String(model).toLowerCase().includes('gemini')) return askModel1(messages, model);
  return askModel(messages, model);
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

function validateToolArguments(toolName, argumentsObject) {
  if (toolName === 'update_task_status') {
    if (!/^TASK[0-9]+$/i.test(String(argumentsObject.taskId || ''))) {
      return { error: `Invalid taskId '${argumentsObject.taskId || ''}'. Resolve the employee and list their tasks before updating each real task ID.` };
    }
    if (!['todo', 'in_progress', 'blocked', 'done'].includes(String(argumentsObject.status || '').toLowerCase())) {
      return { error: `Invalid status '${argumentsObject.status || ''}'. Use todo, in_progress, blocked, or done.` };
    }
  }

  if (toolName === 'assign_task') {
    if (!/^TASK[0-9]+$/i.test(String(argumentsObject.taskId || ''))) {
      return { error: `Invalid taskId '${argumentsObject.taskId || ''}'. Resolve and use a real task ID.` };
    }
    if (!/^EMP[0-9]+$/i.test(String(argumentsObject.assigneeId || ''))) {
      return { error: `Invalid assigneeId '${argumentsObject.assigneeId || ''}'. Resolve the employee and use the returned employee ID.` };
    }
  }

  return null;
}

function extractRememberProjectsRequest(userMessage) {
  const match = userMessage.match(/\bremember\s+(?:all\s+)?(?:the\s+)?projects?\s+(.+?)\s+owns\b/i);
  return match ? match[1].trim() : null;
}

function rememberProjectsOwnedBy(userMessage, memorySession) {
  const ownerName = extractRememberProjectsRequest(userMessage);
  if (!ownerName) return null;

  const context = toolImpl.createContext({ memorySession, persist: false });
  const employee = toolImpl.get_employee({ name: ownerName }, context);
  if (employee.error || employee.ambiguous) return { ownerName, employee };

  const projectsResult = toolImpl.get_projects({ ownerId: employee.id }, context);
  if (projectsResult.error) return { ownerName, employee, projectsResult };

  const projectNames = projectsResult.projects.map((project) => project.name);
  const content = projectNames.length
    ? `${employee.name} owns: ${projectNames.join(', ')}.`
    : `${employee.name} owns no projects.`;
  const saved = memory.remember({
    userId: memorySession.userId,
    key: `${employee.name.toLowerCase()} projects`,
    content,
    type: 'fact',
    tags: ['projects', 'ownership', employee.name],
  }, memorySession);

  return { ownerName, employee, projectsResult, saved };
}

function extractRememberPreference(userMessage) {
  const match = userMessage.match(/\bremember\s+that\s+(?:i\s+)?(.+)$/i);
  return match ? match[1].trim().replace(/[.?!]+$/, '') : null;
}

function rememberPreference(userMessage, memorySession) {
  const content = extractRememberPreference(userMessage);
  if (!content) return null;
  const lowerContent = content.toLowerCase();
  const key = lowerContent.includes('focus') || lowerContent.includes('priority')
    ? 'focus'
    : 'preference';
  const saved = memory.remember({
    userId: memorySession.userId,
    key,
    content: content.charAt(0).toUpperCase() + content.slice(1) + '.',
    type: 'preference',
    tags: ['user-preference'],
  }, memorySession);
  return { saved };
}

function answerMemoryQuestion(userMessage, memorySession) {
  if (!/\b(what|which)\b.*\b(?:want|need)\b.*\b(?:remember|focus|priority)\b/i.test(userMessage)) {
    return null;
  }
  const result = memory.search({ userId: memorySession.userId, query: 'focus priority remember' }, memorySession);
  if (!result.memories.length) {
    return {
      finalAnswer: 'I do not have a saved preference for you yet.',
      memories: [],
    };
  }
  return {
    finalAnswer: result.memories.map((item) => item.content).join(' '),
    memories: result.memories,
  };
}

async function runAgent(userMessage, options = {}) {
  if (!userMessage || typeof userMessage !== 'string') throw new Error('message is required');
  const model = options.model || DEFAULT_MODEL;
  const memorySession = memory.createSession({
    userId: options.userId,
    conversationId: options.conversationId,
    memoryPath: options.memoryPath,
  });
  const directMemoryResult = rememberProjectsOwnedBy(userMessage, memorySession);
  if (directMemoryResult && directMemoryResult.saved) {
    const projects = directMemoryResult.projectsResult.projects;
    const projectSummary = projects.length
      ? projects.map((project) => project.name).join(', ')
      : 'no projects';
    return {
      finalAnswer: `${directMemoryResult.employee.name} owns ${projectSummary}. I saved this information to your memory.`,
      model,
      iterations: 0,
      log: [{ tool: 'remember', arguments: { key: `${directMemoryResult.employee.name.toLowerCase()} projects` }, result: directMemoryResult.saved }],
      executionTrace: [{ tool: 'remember', outcome: 'completed', observed: directMemoryResult.saved }],
      state: {
        failures: [],
        recommendations: [],
        plan: null,
        planHistory: [],
        memoriesUsed: [],
        userId: memorySession.userId,
        conversationId: memorySession.conversationId,
      },
    };
  }
  const preferenceResult = rememberPreference(userMessage, memorySession);
  if (preferenceResult && preferenceResult.saved) {
    return {
      finalAnswer: 'I saved that preference to your memory.',
      model,
      iterations: 0,
      log: [{ tool: 'remember', result: preferenceResult.saved }],
      executionTrace: [{ tool: 'remember', outcome: 'completed', observed: preferenceResult.saved }],
      state: {
        failures: [],
        recommendations: [],
        plan: null,
        planHistory: [],
        memoriesUsed: [],
        userId: memorySession.userId,
        conversationId: memorySession.conversationId,
      },
    };
  }
  const directMemoryAnswer = answerMemoryQuestion(userMessage, memorySession);
  if (directMemoryAnswer) {
    return {
      finalAnswer: directMemoryAnswer.finalAnswer,
      model,
      iterations: 0,
      log: [],
      executionTrace: [],
      state: {
        failures: [],
        recommendations: [],
        plan: null,
        planHistory: [],
        memoriesUsed: directMemoryAnswer.memories,
        userId: memorySession.userId,
        conversationId: memorySession.conversationId,
      },
    };
  }
  const relevantMemories = memory.search({
    userId: memorySession.userId,
    query: userMessage,
    limit: options.memoryLimit || 5,
  }, memorySession);
  const recentTurns = memory.getRecentTurns(memorySession);
  const contextMessage = {
    role: 'system',
    content: JSON.stringify({
      shortTermConversation: recentTurns,
      relevantLongTermMemories: relevantMemories.memories,
      memoryPolicy: 'Use only relevant memories. Treat them as user-provided context, not as proof of current project data.',
    }),
  };
  const messages = [systemMessage, contextMessage, { role: 'user', content: userMessage }];
  const log = [];
  const context = toolImpl.createContext({
    persist: options.persist !== false,
    memorySession,
  });
  const callCache = new Map();
  const failures = [];
  const mutatingTools = new Set(['update_task_status', 'assign_task']);
  const executionTrace = [];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    let assistantMessage;
    try {
      assistantMessage = await askConfiguredModel(messages, model);
    } catch (error) {
      failures.push({ iteration, stage: 'model', error: error.message });
      return {
        finalAnswer: 'I could not continue because the local model failed. No risk conclusion was generated from incomplete evidence.',
        model,
        iterations: iteration,
        stopped: 'model_error',
        log,
        executionTrace,
        state: { failures, recommendations: context.recommendations, plan: context.plan, planHistory: context.planHistory, memoriesUsed: relevantMemories.memories, userId: memorySession.userId, conversationId: memorySession.conversationId }
      };
    }
    // const assistantMessage = await askModel1(messages, model);
    messages.push(assistantMessage);
    const calls = assistantMessage.tool_calls || [];

    if (calls.length === 0) {
      memory.recordTurn({
        userId: memorySession.userId,
        conversationId: memorySession.conversationId,
        userMessage,
        assistantMessage: assistantMessage.content || '',
      });
      return {
        finalAnswer: assistantMessage.content || '',
        model,
        iterations: iteration,
        log,
        executionTrace,
        state: { failures, recommendations: context.recommendations, plan: context.plan, planHistory: context.planHistory, memoriesUsed: relevantMemories.memories, userId: memorySession.userId, conversationId: memorySession.conversationId }
      };
    }

    for (const call of calls) {
      const toolName = call.function && call.function.name;
      const argumentsValue = call.function && call.function.arguments;
      let argumentsObject;
      let argumentParsingError;
      try {
        argumentsObject = parseArguments(argumentsValue);
      } catch (error) {
        argumentsObject = {};
        argumentParsingError = error;
        failures.push({ iteration, tool: toolName, error: `Invalid tool arguments: ${error.message}` });
      }
      const cacheKey = `${toolName}:${JSON.stringify(argumentsObject, Object.keys(argumentsObject).sort())}`;
      let result;

      if (argumentParsingError) result = { error: `Invalid tool arguments: ${argumentParsingError.message}` };

      const argumentError = validateToolArguments(toolName, argumentsObject);
      if (argumentError) {
        result = argumentError;
        failures.push({ iteration, tool: toolName, error: argumentError.error });
      }

      if (!result && mutatingTools.has(toolName) && !options.confirmed) {
        const confirmation = {
          confirmation_required: true,
          action: toolName,
          arguments: argumentsObject,
          message: 'Confirmation is required before changing task data. Resubmit the request with confirmed=true to proceed.'
        };
        log.push({ iteration, tool: toolName, arguments: argumentsObject, result: confirmation });
        return {
          finalAnswer: confirmation.message,
          model,
          iterations: iteration,
          log,
          pendingConfirmation: confirmation,
          state: { failures, recommendations: context.recommendations, memoriesUsed: relevantMemories.memories, userId: memorySession.userId, conversationId: memorySession.conversationId }
        };
      }

      if (!result && callCache.has(cacheKey)) {
        result = { cached: true, result: callCache.get(cacheKey) };
      }

      if (!result) {
        try {
          if (!toolImpl[toolName]) throw new Error(`Unknown tool '${toolName}'`);
          result = await toolImpl[toolName](argumentsObject, context);
        } catch (error) {
          result = { error: error.message, retryable: true };
          failures.push({ iteration, tool: toolName, error: error.message });
        }
        callCache.set(cacheKey, result);
      }

      log.push({ iteration, tool: toolName, arguments: argumentsObject, result });
      executionTrace.push({ iteration, tool: toolName, arguments: argumentsObject, outcome: result && result.error ? 'failed' : 'completed', observed: result });
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
    log,
    executionTrace,
    state: { failures, recommendations: context.recommendations, plan: context.plan, planHistory: context.planHistory, memoriesUsed: relevantMemories.memories, userId: memorySession.userId, conversationId: memorySession.conversationId }
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