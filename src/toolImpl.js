const fs = require('fs');
const path = require('path');

const dataPath = process.env.PM_DATA_PATH || path.join(__dirname, '..', 'data', 'pm-data.json');
const initialData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const data = initialData;

function createContext(options = {}) {
  return {
    data: JSON.parse(JSON.stringify(initialData)),
    recommendations: [],
    persist: options.persist === true
  };
}

function persistContext(context) {
  if (!context || !context.persist) return;
  const temporaryPath = `${dataPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(context.data, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, dataPath);
  initialData.employees = context.data.employees;
  initialData.projects = context.data.projects;
  initialData.tasks = context.data.tasks;
}

function getContextData(context) {
  return context && context.data ? context.data : data;
}

function isTrue(value) {
  return value === true || value === 'true';
}

function findById(items, id) {
  return items.find((item) => item.id.toLowerCase() === String(id).toLowerCase());
}

function normalizeStatus(status) {
  if (!status) return status;
  const normalized = String(status).toLowerCase().replace(/[- ]/g, '_');
  return normalized === 'pending' ? undefined : normalized;
}

function get_employee({ id, name } = {}, context) {
  const contextData = getContextData(context);
  if (!id && !name) return { count: contextData.employees.length, employees: contextData.employees };

  const matches = contextData.employees.filter((employee) =>
    (id && employee.id.toLowerCase() === String(id).toLowerCase()) ||
    (name && employee.name.toLowerCase().includes(name.toLowerCase()))
  );
  if (matches.length === 0) return { error: 'No employee found', query: { id, name } };
  if (matches.length > 1) return { ambiguous: true, message: 'Multiple employees matched; ask the user to clarify.', matches };
  return matches[0];
}

function get_project({ id, name } = {}, context) {
  const contextData = getContextData(context);
  const matches = contextData.projects.filter((project) =>
    (id && project.id.toLowerCase() === String(id).toLowerCase()) ||
    (name && project.name.toLowerCase() === name.toLowerCase())
  );
  if (matches.length === 0) return { error: 'No project found', query: { id, name } };
  if (matches.length > 1) return { ambiguous: true, message: 'Multiple projects matched; ask the user to clarify.', matches };
  return matches[0];
}

function get_projects({ ownerId, ownerName, status, name } = {}, context) {
  const contextData = getContextData(context);
  if (ownerId) {
    const owner = findById(contextData.employees, ownerId);
    if (!owner) {
      return { error: `Unknown ownerId '${ownerId}'. Resolve the employee name with get_employee and use the returned employee ID.` };
    }
    ownerId = owner.id;
  }

  if (ownerId && !contextData.employees.some((employee) => employee.id === ownerId)) {
    return { error: `Unknown ownerId '${ownerId}'. Resolve the employee name with get_employee and use the returned employee ID.` };
  }

  if (ownerName) {
    const matches = contextData.employees.filter((employee) => employee.name.toLowerCase().includes(ownerName.toLowerCase()));
    if (matches.length === 0) return { error: `No employee matched '${ownerName}'.` };
    if (matches.length > 1) return { ambiguous: true, message: 'Multiple employees matched; ask the user to clarify.', matches };
    ownerId = matches[0].id;
  }

  const projects = contextData.projects.filter((project) =>
    (!ownerId || project.ownerId === ownerId) &&
    (!status || project.status === status) &&
    (!name || project.name.toLowerCase().includes(name.toLowerCase()))
  );
  return { count: projects.length, projects };
}

function get_tasks({ projectId, assigneeId, assigneeName, status, pending, overdue } = {}, context) {
  const contextData = getContextData(context);
  if (projectId) {
    const project = findById(contextData.projects, projectId);
    if (!project) return { error: `Unknown projectId '${projectId}'. Resolve the project with get_project first.` };
    projectId = project.id;
  }

  if (assigneeId) {
    const assignee = findById(contextData.employees, assigneeId);
    if (!assignee) {
      return { error: `Unknown assigneeId '${assigneeId}'. Resolve the employee name with get_employee and use the returned employee ID.` };
    }
    assigneeId = assignee.id;
  }

  if (assigneeName) {
    const matches = contextData.employees.filter((employee) => employee.name.toLowerCase().includes(assigneeName.toLowerCase()));
    if (matches.length === 0) return { error: `No employee matched '${assigneeName}'.` };
    if (matches.length > 1) return { ambiguous: true, message: 'Multiple employees matched; ask the user to clarify.', matches };
    assigneeId = matches[0].id;
  }

  if (isTrue(pending) && !projectId && !assigneeId) {
    return { error: 'A pending task query needs an assigneeId, assigneeName, or projectId. Do not query all tasks for a person-specific question.' };
  }

  if (isTrue(pending) || String(status || '').toLowerCase() === 'pending') {
    pending = true;
    status = undefined;
  } else {
    status = normalizeStatus(status);
  }

  const today = new Date().toISOString().slice(0, 10);
  const tasks = contextData.tasks.filter((task) =>
    (!projectId || task.projectId === projectId) &&
    (!assigneeId || task.assigneeId === assigneeId) &&
    (!status || task.status === status) &&
    (!isTrue(pending) || task.status === 'todo' || task.status === 'in_progress') &&
    (!isTrue(overdue) || (task.dueDate < today && task.status !== 'done'))
  );
  return { count: tasks.length, tasks };
}

function get_task({ id } = {}, context) {
  const task = findById(getContextData(context).tasks, id || '');
  if (!task) throw new Error(`Task '${id || ''}' was not found`);
  return task;
}

function calculate_project_metrics({ projectId } = {}, context) {
  const contextData = getContextData(context);
  const project = findById(contextData.projects, projectId || '');
  if (!project) return { error: 'No project found', projectId };
  const tasks = contextData.tasks.filter((task) => task.projectId === projectId);
  const today = new Date().toISOString().slice(0, 10);
  const done = tasks.filter((task) => task.status === 'done').length;
  const overdue = tasks.filter((task) => task.dueDate < today && task.status !== 'done').length;
  return {
    project,
    totalTasks: tasks.length,
    doneTasks: done,
    inProgressTasks: tasks.filter((task) => task.status === 'in_progress').length,
    todoTasks: tasks.filter((task) => task.status === 'todo').length,
    overdueTasks: overdue,
    completionRate: tasks.length ? Math.round((done / tasks.length) * 100) : 0
  };
}

function find_project_risks({ projectId } = {}, context) {
  const contextData = getContextData(context);
  const project = findById(contextData.projects, projectId || '');
  if (!project) return { error: 'No project found', projectId };

  const today = new Date().toISOString().slice(0, 10);
  const tasks = contextData.tasks.filter((task) => task.projectId === project.id);
  const overdueTasks = tasks.filter((task) => task.dueDate < today && task.status !== 'done');
  const blockedTasks = tasks.filter((task) => task.status === 'blocked');
  const allowedStatuses = ['todo', 'in_progress', 'blocked', 'done'];
  const inconsistentTasks = tasks.filter((task) =>
    !allowedStatuses.includes(task.status) ||
    !task.dueDate ||
    !findById(contextData.employees, task.assigneeId)
  );
  const assigneeCounts = tasks.reduce((counts, task) => {
    counts[task.assigneeId] = (counts[task.assigneeId] || 0) + 1;
    return counts;
  }, {});
  const concentratedAssignee = Object.entries(assigneeCounts)
    .sort((left, right) => right[1] - left[1])[0];
  const risks = [];
  if (overdueTasks.length) risks.push({ type: 'overdue_work', severity: 'high', count: overdueTasks.length, taskIds: overdueTasks.map((task) => task.id) });
  if (blockedTasks.length) risks.push({ type: 'blocked_work', severity: 'high', count: blockedTasks.length, taskIds: blockedTasks.map((task) => task.id) });
  if (inconsistentTasks.length) risks.push({ type: 'inconsistent_data', severity: 'medium', count: inconsistentTasks.length, taskIds: inconsistentTasks.map((task) => task.id) });
  if (concentratedAssignee && concentratedAssignee[1] >= 3) risks.push({ type: 'assignee_concentration', severity: 'medium', assigneeId: concentratedAssignee[0], taskCount: concentratedAssignee[1] });
  if (tasks.some((task) => task.status !== 'done' && task.dueDate < today && task.dueDate)) risks.push({ type: 'schedule_slippage', severity: 'high' });
  return { project, riskCount: risks.length, risks, evidence: { taskCount: tasks.length, overdueTaskIds: overdueTasks.map((task) => task.id), blockedTaskIds: blockedTasks.map((task) => task.id), inconsistentTaskIds: inconsistentTasks.map((task) => task.id) } };
}

function update_task_status({ taskId, status, reason } = {}, context) {
  const contextData = getContextData(context);
  const task = findById(contextData.tasks, taskId || '');
  const allowedStatuses = ['todo', 'in_progress', 'blocked', 'done'];
  if (!task) return { error: `Task '${taskId || ''}' was not found` };
  if (!allowedStatuses.includes(String(status || '').toLowerCase())) return { error: `Invalid status '${status}'. Use todo, in_progress, blocked, or done.` };
  const previousStatus = task.status;
  task.status = String(status).toLowerCase();
  try {
    persistContext(context);
  } catch (error) {
    task.status = previousStatus;
    return { error: `Task status was not persisted: ${error.message}` };
  }
  return { updated: true, persisted: Boolean(context && context.persist), task, previousStatus, reason: reason || null };
}

function assign_task({ taskId, assigneeId, reason } = {}, context) {
  const contextData = getContextData(context);
  const task = findById(contextData.tasks, taskId || '');
  const assignee = findById(contextData.employees, assigneeId || '');
  if (!task) return { error: `Task '${taskId || ''}' was not found` };
  if (!assignee) return { error: `Employee '${assigneeId || ''}' was not found` };
  const previousAssigneeId = task.assigneeId;
  task.assigneeId = assignee.id;
  try {
    persistContext(context);
  } catch (error) {
    task.assigneeId = previousAssigneeId;
    return { error: `Task assignment was not persisted: ${error.message}` };
  }
  return { updated: true, persisted: Boolean(context && context.persist), task, previousAssigneeId, reason: reason || null };
}

function create_recommendation({ projectId, title, rationale, action, priority } = {}, context) {
  const recommendation = {
    id: `REC_${(context && context.recommendations ? context.recommendations.length : 0) + 1}`,
    projectId: projectId || null,
    title,
    rationale,
    action,
    priority: priority || 'medium'
  };
  if (context && context.recommendations) context.recommendations.push(recommendation);
  return { created: true, recommendation };
}

module.exports = {
  createContext,
  get_employee,
  get_project,
  get_projects,
  get_tasks,
  get_task,
  calculate_project_metrics,
  find_project_risks,
  update_task_status,
  assign_task,
  create_recommendation
};
