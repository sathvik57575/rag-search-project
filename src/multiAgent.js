const tools = require('./toolImpl');
const { askConfiguredModel, DEFAULT_MODEL } = require('./agent');

const SPECIALIZED_AGENTS = {
  project: {
    name: 'Project Agent',
    description: 'Handles project identity, status, metrics, updates, and project risk.',
  },
  task: {
    name: 'Task Agent',
    description: 'Handles task discovery, overdue work, pending work, and task status.',
  },
  employee: {
    name: 'Employee/Workload Agent',
    description: 'Handles employee lookup, ownership, workload, and assignee concentration.',
  },
};

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function extractProjectName(query) {
  const match = query.match(/\bproject\s+(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|empty)\b/i);
  return match ? `Project ${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}` : null;
}

function extractEmployeeName(query) {
  const knownNames = ['John Smith', 'John Doe', 'Priya Shah', 'Marcus Lee'];
  return knownNames.find((name) => query.toLowerCase().includes(name.toLowerCase())) || null;
}

function runProjectAgent(query, context) {
  const projectName = extractProjectName(query);
  const project = projectName
    ? tools.get_project({ name: projectName }, context)
    : tools.get_projects({ status: 'active' }, context);
  if (project.error || project.ambiguous) return { agent: 'project', result: project };

  const projects = project.projects || [project];
  const wantsRisk = includesAny(query, ['risk', 'delay', 'delayed', 'blocked', 'health', 'cause', 'problem']);
  const wantsMetrics = includesAny(query, ['metric', 'progress', 'completion', 'status', 'delivery']);
  const wantsUpdates = includesAny(query, ['update', 'report', 'latest', 'stale', 'conflict']);
  const details = projects.map((item) => {
    const result = { project: item };
    if (wantsMetrics || wantsRisk) result.metrics = tools.get_project_metrics({ projectId: item.id }, context);
    if (wantsRisk) result.risks = tools.find_project_risks({ projectId: item.id }, context);
    if (wantsUpdates) result.updates = tools.get_project_updates({ projectId: item.id }, context);
    return result;
  });
  return { agent: 'project', result: { count: details.length, projects: details } };
}

function runTaskAgent(query, context) {
  const projectName = extractProjectName(query);
  let projectId;
  if (projectName) {
    const project = tools.get_project({ name: projectName }, context);
    if (project.error || project.ambiguous) return { agent: 'task', result: project };
    projectId = project.id;
  }
  const employeeName = extractEmployeeName(query);
  const filters = {
    projectId,
    overdue: includesAny(query, ['overdue', 'late', 'delayed']),
    pending: includesAny(query, ['pending', 'open', 'unfinished', 'incomplete']),
  };
  if (employeeName) filters.assigneeName = employeeName;
  const result = tools.get_tasks(filters, context);
  return { agent: 'task', result };
}

function runEmployeeAgent(query, context) {
  const employeeName = extractEmployeeName(query);
  const employee = employeeName
    ? tools.get_employee({ name: employeeName }, context)
    : tools.get_employee({}, context);
  if (employee.error || employee.ambiguous) return { agent: 'employee', result: employee };

  const employees = employee.employees || [employee];
  const details = employees.map((item) => {
    const projects = tools.get_projects({ ownerId: item.id }, context);
    const tasks = tools.get_tasks({ assigneeId: item.id, pending: true }, context);
    return {
      employee: item,
      projects: projects.projects || [],
      pendingTaskCount: tasks.count || 0,
      pendingTasks: tasks.tasks || [],
    };
  });
  return { agent: 'employee', result: { count: details.length, employees: details } };
}

function chooseAgents(query) {
  const normalized = String(query || '').toLowerCase();
  const projectMentioned = includesAny(normalized, ['project', 'portfolio', 'risk', 'metric', 'delivery', 'update']);
  const taskMentioned = includesAny(normalized, ['task', 'overdue', 'late', 'pending', 'blocked', 'unfinished', 'incomplete', 'assign']);
  const taskStatusQuery = normalized.includes('status') && includesAny(normalized, ['task', 'tasks']);
  const selected = [];
  if (projectMentioned) selected.push('project');
  if (taskMentioned || taskStatusQuery) selected.push('task');
  if (includesAny(normalized, ['employee', 'person', 'people', 'team', 'workload', 'capacity', 'owner', 'john', 'priya', 'marcus'])) selected.push('employee');
  return [...new Set(selected)];
}

function summarize(query, results) {
  const failures = results.filter((item) => item.result && item.result.error);
  if (failures.length) return `The coordinator could not complete the ${failures.map((item) => item.agent).join(' and ')} investigation because the specialist returned an error.`;
  const parts = results.map((item) => {
    if (item.agent === 'project') return `Project Agent found ${item.result.count || 0} project result(s) with project details, metrics, and risk evidence where requested.`;
    if (item.agent === 'task') return `Task Agent found ${item.result.count || 0} matching task(s).`;
    return `Employee/Workload Agent found ${item.result.count || 0} employee result(s) with ownership and pending-task workload.`;
  });
  return `For “${query}”: ${parts.join(' ')} The coordinator combined these specialist results into one response.`;
}

function parseJsonResponse(content) {
  if (!content) throw new Error('Coordinator model returned no content.');
  const normalized = String(content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('Coordinator model did not return a JSON object.');
  return JSON.parse(normalized.slice(start, end + 1));
}

async function askCoordinator(messages, model, options = {}) {
  const ask = options.askModel || askConfiguredModel;
  return ask(messages, model, options);
}

function isGenericAmbiguousQuery(query) {
  const normalized = String(query || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  const projectName = extractProjectName(query);
  const employeeName = extractEmployeeName(query);
  const hasTaskId = /\btask\s*\d+\b/i.test(query);

  if (projectName || employeeName || hasTaskId) {
    return false;
  }

  const genericPatterns = [
    /^(?:tell\s+me\s+about\s+)?(?:the\s+)?status$/i,
    /^(?:what\s+is\s+)?(?:the\s+)?status$/i,
    /^(?:show\s+me\s+)?(?:the\s+)?status$/i,
    /^(?:give\s+me\s+an?\s+)?update$/i,
    /^(?:help\s+me)$/i,
    /^(?:tell\s+me\s+about\s+the\s+status)$/i,
  ];

  if (genericPatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const words = normalized.split(/\s+/);
  if (words.length <= 6 && (normalized.includes('status') || normalized.includes('update') || normalized.includes('overview'))) {
    const specificKeywords = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'empty', 'john', 'priya', 'marcus', 'overdue', 'pending', 'blocked', 'workload', 'capacity'];
    if (!specificKeywords.some((kw) => normalized.includes(kw))) {
      return true;
    }
  }

  return false;
}

async function runCoordinator(query, options = {}) {
  if (!query || typeof query !== 'string') throw new Error('query is required');
  const model = options.model || DEFAULT_MODEL;

  if (isGenericAmbiguousQuery(query)) {
    return {
      status: 'needs_clarification',
      coordinator: 'Coordinator Agent',
      model,
      selectedAgents: [],
      message: 'Should I investigate projects, tasks, or employee workload?',
      agentDirectory: SPECIALIZED_AGENTS,
    };
  }

  const deterministicAgents = chooseAgents(query);

  const routingPrompt = [
    'You are the Coordinator Agent for a project-management multi-agent system.',
    'Understand the user query and select every specialist needed.',
    'Available agents:',
    '- "project": project status, metrics, updates, and risks when a specific project is targetted.',
    '- "task": task lookup, overdue, pending, blocked, or task status when tasks are specified.',
    '- "employee": employees, ownership, workload, or capacity.',
    'CRITICAL RULE FOR AMBIGUOUS QUERIES: If the query is generic without a specific project, task, or employee target (e.g. "Tell me about the status", "What is the status", "Give me an update"), YOU MUST return an empty agents array and ask for clarification:',
    '{"agents":[],"clarification":"Should I investigate projects, tasks, or employee workload?"}',
    'CRITICAL: Respond ONLY with a valid JSON object in this exact format:',
    '{"agents":["project"|"task"|"employee"],"clarification":"optional question"}',
    `User query: ${query}`,
  ].join('\n');

  let selectedAgents = [];
  let clarificationMessage = null;

  try {
    const routingMessage = await askCoordinator([
      { role: 'system', content: routingPrompt },
      { role: 'user', content: query },
    ], model, { ...options, useTools: false, format: 'json' });

    const routing = parseJsonResponse(routingMessage.content);
    if (Array.isArray(routing.agents)) {
      selectedAgents = [...new Set(routing.agents.filter((agent) => Object.prototype.hasOwnProperty.call(SPECIALIZED_AGENTS, agent)))];
    }
    clarificationMessage = routing.clarification || null;
  } catch (error) {
    if (deterministicAgents.length > 0) {
      selectedAgents = deterministicAgents;
    }
  }

  if (!selectedAgents.length && deterministicAgents.length > 0) {
    selectedAgents = deterministicAgents;
  }

  if (!selectedAgents.length) {
    return {
      status: 'needs_clarification',
      coordinator: 'Coordinator Agent',
      model,
      selectedAgents: [],
      message: clarificationMessage || 'Should I investigate projects, tasks, or employee workload?',
      agentDirectory: SPECIALIZED_AGENTS,
    };
  }

  const context = options.context || tools.createContext({ persist: false });
  const runners = { project: runProjectAgent, task: runTaskAgent, employee: runEmployeeAgent };
  const results = selectedAgents.map((agent) => runners[agent](query, context));

  const synthesisPrompt = [
    'You are the Coordinator Agent synthesizing specialist results for a project-management user.',
    'Answer the original query directly and clearly using only the JSON evidence below.',
    'Mention important names, counts, statuses, risks, overdue work, or workload when present.',
    'If a specialist returned an error or the evidence is insufficient, say so explicitly.',
    'Do not mention internal routing unless it helps explain the answer. Do not invent facts.',
    `Original query: ${query}`,
    `Specialist evidence: ${JSON.stringify(results)}`,
  ].join('\n');

  let synthesisMessage = null;
  try {
    synthesisMessage = await askCoordinator([
      { role: 'system', content: synthesisPrompt },
      { role: 'user', content: query },
    ], model, { ...options, useTools: false });
  } catch (err) {
    synthesisMessage = null;
  }

  let finalAnswer;
  if (synthesisMessage && synthesisMessage.content && synthesisMessage.content.trim()) {
    finalAnswer = synthesisMessage.content.trim();
  } else {
    console.log('[Coordinator] LLM synthesis fallback triggered: running summarize()');
    finalAnswer = summarize(query, results);
  }

  return {
    status: 'completed',
    coordinator: 'Coordinator Agent',
    model,
    selectedAgents,
    collaboration: selectedAgents.length > 1 ? 'multi-specialist-combined' : 'single-specialist',
    results,
    finalAnswer,
  };
}

module.exports = {
  SPECIALIZED_AGENTS,
  chooseAgents,
  runCoordinator,
  runProjectAgent,
  runTaskAgent,
  runEmployeeAgent,
};
