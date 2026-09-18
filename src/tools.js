const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'create_plan',
      description: 'Create a dynamic plan for the current goal. Include ordered steps, dependencies, and the information each step must produce. Use this before a multi-project investigation.',
      parameters: {
        type: 'object',
        properties: {
          objective: { type: 'string' },
          steps: { type: 'array', items: { type: 'object' } }
        },
        required: ['objective', 'steps'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replan',
      description: 'Revise the current plan after a tool failure, missing data, invalid data, or conflicting evidence. Explain the blocked step and the replacement steps.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          steps: { type: 'array', items: { type: 'object' } }
        },
        required: ['reason', 'steps'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_employee',
      description: 'Find an employee by exact ID or partial name, or list all employees when no ID or name is provided. Return ambiguous matches instead of guessing when multiple employees match.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Employee ID, for example EMP1' },
          name: { type: 'string', description: 'Employee name or first name' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_project',
      description: 'Find one project by exact ID or name. Use this before project-specific task queries when the project identifier is unknown.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Project ID, for example PROJ_ALPHA' },
          name: { type: 'string', description: 'Project name' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_projects',
      description: 'List projects, optionally filtered by owner ID, owner employee name, status, or project name. Prefer get_employee first and then pass its ID as ownerId. If using ownerName, resolve exactly one employee; never return all projects for a person-specific ownership question. If a person name is mistakenly passed as name and matches an employee exactly, interpret it as an owner filter when it is not a project name.',
      parameters: {
        type: 'object',
        properties: {
          ownerId: { type: 'string' },
          ownerName: { type: 'string', description: 'Employee name fallback when get_employee was not called first' },
          status: { type: 'string' },
          name: { type: 'string' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_tasks',
      description: 'List tasks filtered by project ID, assignee ID or employee name, status, pending=true, or overdue=true. Prefer get_employee first and then pass its ID as assigneeId. If using assigneeName, resolve exactly one employee; never return tasks for all employees when a person was named. pending=true means status is todo or in_progress. overdue means dueDate is before today and status is not done.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          assigneeId: { type: 'string', description: 'Employee ID, not a display name; for example EMP1' },
          assigneeName: { type: 'string', description: 'Employee name fallback when get_employee was not called first' },
          status: { type: 'string' },
          pending: { type: 'boolean' },
          overdue: { type: 'boolean' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_task',
      description: 'Get one task by exact task ID. Returns a not-found error when the task does not exist.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate_project_metrics',
      description: 'Calculate task counts and completion metrics for a project. Use this for project progress summaries rather than fetching every task.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_project_metrics',
      description: 'Calculate deterministic delivery metrics for one project, including task counts, overdue work, completion, and deadline status.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_project_updates',
      description: 'List updates for a project or all projects. Use update dates and risk levels as evidence, and report stale or conflicting updates rather than choosing silently.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string' }, riskLevel: { type: 'string' } },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_project_risks',
      description: 'Analyze a project for delivery risks using overdue tasks, pending work, inconsistent dates, and assignee concentration. Use this when the goal asks for causes, risks, or delayed-project analysis.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_task_status',
      description: 'Change a task status. This is an impactful action and requires user confirmation. Use only when the user explicitly asks to change task status or approves a pending confirmation.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          status: { type: 'string', description: 'todo, in_progress, blocked, or done' },
          reason: { type: 'string' }
        },
        required: ['taskId', 'status'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'assign_task',
      description: 'Assign or reassign a task to an employee. This is an impactful action and requires user confirmation. Resolve a person to an employee ID before calling this tool.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          assigneeId: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['taskId', 'assigneeId'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_project_update_risk',
      description: 'Change the risk level of an existing project update. This is an impactful action and requires user confirmation. Resolve the exact update ID before calling this tool.',
      parameters: {
        type: 'object',
        properties: {
          updateId: { type: 'string', description: 'Project update ID, for example UPD4' },
          riskLevel: { type: 'string', description: 'low, medium, or high' },
          reason: { type: 'string' }
        },
        required: ['updateId', 'riskLevel'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_recommendation',
      description: 'Create a structured project-management recommendation or proposed action from evidence gathered during the goal. This does not change task data and is safe to execute.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          title: { type: 'string' },
          rationale: { type: 'string' },
          action: { type: 'string' },
          priority: { type: 'string' }
        },
        required: ['title', 'rationale', 'action'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: 'Save durable user information only when the user explicitly asks you to remember it, such as a preference or an important standing fact. Use a stable key so a later statement can update it.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Stable memory key, for example priority' },
          content: { type: 'string', description: 'The information to remember' },
          type: { type: 'string', description: 'preference, fact, or instruction' },
          tags: { type: 'array', items: { type: 'string' } }
        },
        required: ['key', 'content'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'forget',
      description: 'Remove a previously stored memory when the user explicitly says it is no longer true or asks you to forget it.',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description: 'Retrieve relevant stored memories for the current request. Do not retrieve or mention memories that are unrelated to the user request.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
        required: ['query'],
        additionalProperties: false
      }
    }
  }
];

module.exports = { toolDefinitions };
