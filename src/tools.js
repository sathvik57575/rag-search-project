const toolDefinitions = [
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
      description: 'List projects, optionally filtered by owner ID, owner employee name, status, or project name. Prefer get_employee first and then pass its ID as ownerId. If using ownerName, resolve exactly one employee; never return all projects for a person-specific ownership question.',
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
  }
];

module.exports = { toolDefinitions };
