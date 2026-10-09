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
  content: 'You are a goal-oriented project management agent. For any query about projects, employees, tasks, metrics, or ownership, ALWAYS call the appropriate tool (such as get_project, get_projects, get_employee, get_tasks) to inspect system data before answering or asking for clarification. For questions about uploaded files, company policies, guidelines, or other documents, use search_documents and base document claims on its relevant passages. For mixed questions, use both document search and the relevant project-data tools. If document search returns no relevant passages, say so rather than inventing document facts. Do not invent project records or assume data is missing without querying the tools first. Create a dynamic plan for multi-project investigations. Evaluate every tool result. If a tool returns an error or ambiguous results, refine the query or ask the user to clarify. Mutations require confirmation from the application. Treat conversation context as short-term and user memories as long-term. Save information only when the user explicitly asks to remember it.'
};

async function askModel(messages, model, options = {}) {
  const payload = {
    model,
    messages,
    stream: false
  };
  if (options.useTools !== false) {
    payload.tools = toolDefinitions;
  }
  if (options.format) {
    payload.format = options.format;
  }
  const response = await axios.post(OLLAMA_URL, payload);
  const message = response.data && response.data.message;
  if (!message) throw new Error('Ollama returned no message');
  return message;
}

async function askConfiguredModel(messages, model, options = {}) {
  if (String(model).toLowerCase().includes('gemini')) return askModel1(messages, model, options);
  return askModel(messages, model, options);
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

async function askModel1(messages, model, options = {}) {
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

  const requestBody = {
    systemInstruction: systemInstruction
      ? { parts: [{ text: systemInstruction.content }] }
      : undefined,
    contents,
  };

  if (options.useTools !== false) {
    requestBody.tools = [{
      functionDeclarations: toolDefinitions.map((tool) => ({
        ...tool.function,
        parameters: toGeminiSchema(tool.function.parameters)
      }))
    }];
  }

  let response;
  try {
    response = await axios.post(
      `${GEMINI_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      requestBody
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

  if (toolName === 'update_project_update_risk') {
    if (!/^UPD[0-9]+$/i.test(String(argumentsObject.updateId || ''))) {
      return { error: `Invalid updateId '${argumentsObject.updateId || ''}'. Resolve and use a real project update ID.` };
    }
    if (!['low', 'medium', 'high'].includes(String(argumentsObject.riskLevel || '').toLowerCase())) {
      return { error: `Invalid risk level '${argumentsObject.riskLevel || ''}'. Use low, medium, or high.` };
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
  const match = userMessage.match(/\bremember\s+that\s+(?:i\s+)?(.+)$/i)
    || userMessage.match(/\bremember\s+(?:the|my|this|i)\s+(.+)$/i)
    || userMessage.match(/^(?:the\s+)?(?:project\s+)?(?:i\s+)?want\s+(?:you\s+)?to\s+remember\s+(?:today\s+)?is\s+(.+)$/i)
    || userMessage.match(/^(?:the\s+)?project\s+i\s+want\s+to\s+remember\s+(?:today\s+)?is\s+(.+)$/i)
    || userMessage.match(/^(?:the\s+)?project\s+i\s+want\s+to\s+focus\s+on\s+(?:today\s+)?is\s+(.+)$/i)
    || userMessage.match(/\bmy\s+(?:focus|preference|priority)\s+is\s+(.+)$/i);
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
  const isQuestion = /^\s*(?:what|which|tell|show|do|list)\b/i.test(userMessage) || /\?$/i.test(userMessage);

  const isStatementToRemember = !isQuestion && (
    /^(?:the\s+)?(?:project|task|item)?.*?\bwant\b.*?\bremember\b.*?\bis\b/i.test(userMessage)
    || /^\s*remember\b/i.test(userMessage)
    || /^(?:the\s+)?project\s+i\s+want\s+to/i.test(userMessage)
  );

  if (isStatementToRemember) {
    return null;
  }

  const asksWhatWasRemembered = /\b(what|which|tell|show|do|list)\b.*\b(?:did\s+i\s+ask|have\s+i\s+asked|wanted|want|tell|told|ask|asked|say|said|remem(?:ber|eber)|memory|memories|stored|saved|know)\b/i.test(userMessage)
    || (/\?$/i.test(userMessage) && /\bremem(?:ber|eber)\b/i.test(userMessage));
  const asksPreference = /\b(what|which)\b.*\b(?:want|wanted|wanna|need|focus|priority)\b/i.test(userMessage);
  if (!asksWhatWasRemembered && !asksPreference) {
    return null;
  }
  const result = memory.search({
    userId: memorySession.userId,
    query: userMessage,
  }, memorySession);

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
  const hasUserSession = memorySession.hasUserId;
  const directMemoryResult = hasUserSession ? rememberProjectsOwnedBy(userMessage, memorySession) : null;
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
  const preferenceResult = hasUserSession ? rememberPreference(userMessage, memorySession) : null;
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
  const directMemoryAnswer = hasUserSession ? answerMemoryQuestion(userMessage, memorySession) : null;
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
  const relevantMemories = hasUserSession
    ? memory.search({
      userId: memorySession.userId,
      query: userMessage,
      limit: options.memoryLimit || 5,
    }, memorySession)
    : { count: 0, memories: [] };
  const recentTurns = hasUserSession ? memory.getRecentTurns(memorySession) : [];
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
  const mutatingTools = new Set(['update_task_status', 'assign_task', 'update_project_update_risk']);
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
      if (hasUserSession) {
        memory.recordTurn({
          userId: memorySession.userId,
          conversationId: memorySession.conversationId,
          userMessage,
          assistantMessage: assistantMessage.content || '',
        });
      }
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

module.exports = { runAgent, MAX_ITERATIONS, askConfiguredModel, DEFAULT_MODEL };


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