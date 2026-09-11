const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'data', 'pm-data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

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

function get_employee({ id, name } = {}) {
  if (!id && !name) return { count: data.employees.length, employees: data.employees };

  const matches = data.employees.filter((employee) =>
    (id && employee.id.toLowerCase() === String(id).toLowerCase()) ||
    (name && employee.name.toLowerCase().includes(name.toLowerCase()))
  );
  if (matches.length === 0) return { error: 'No employee found', query: { id, name } };
  if (matches.length > 1) return { ambiguous: true, message: 'Multiple employees matched; ask the user to clarify.', matches };
  return matches[0];
}

function get_project({ id, name } = {}) {
  const matches = data.projects.filter((project) =>
    (id && project.id.toLowerCase() === String(id).toLowerCase()) ||
    (name && project.name.toLowerCase() === name.toLowerCase())
  );
  if (matches.length === 0) return { error: 'No project found', query: { id, name } };
  if (matches.length > 1) return { ambiguous: true, message: 'Multiple projects matched; ask the user to clarify.', matches };
  return matches[0];
}

function get_projects({ ownerId, ownerName, status, name } = {}) {
  if (ownerId) {
    const owner = findById(data.employees, ownerId);
    if (!owner) {
      return { error: `Unknown ownerId '${ownerId}'. Resolve the employee name with get_employee and use the returned employee ID.` };
    }
    ownerId = owner.id;
  }

  if (ownerId && !data.employees.some((employee) => employee.id === ownerId)) {
    return { error: `Unknown ownerId '${ownerId}'. Resolve the employee name with get_employee and use the returned employee ID.` };
  }

  if (ownerName) {
    const matches = data.employees.filter((employee) => employee.name.toLowerCase().includes(ownerName.toLowerCase()));
    if (matches.length === 0) return { error: `No employee matched '${ownerName}'.` };
    if (matches.length > 1) return { ambiguous: true, message: 'Multiple employees matched; ask the user to clarify.', matches };
    ownerId = matches[0].id;
  }

  const projects = data.projects.filter((project) =>
    (!ownerId || project.ownerId === ownerId) &&
    (!status || project.status === status) &&
    (!name || project.name.toLowerCase().includes(name.toLowerCase()))
  );
  return { count: projects.length, projects };
}

function get_tasks({ projectId, assigneeId, assigneeName, status, pending, overdue } = {}) {
  if (projectId) {
    const project = findById(data.projects, projectId);
    if (!project) return { error: `Unknown projectId '${projectId}'. Resolve the project with get_project first.` };
    projectId = project.id;
  }

  if (assigneeId) {
    const assignee = findById(data.employees, assigneeId);
    if (!assignee) {
      return { error: `Unknown assigneeId '${assigneeId}'. Resolve the employee name with get_employee and use the returned employee ID.` };
    }
    assigneeId = assignee.id;
  }

  if (assigneeName) {
    const matches = data.employees.filter((employee) => employee.name.toLowerCase().includes(assigneeName.toLowerCase()));
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
  const tasks = data.tasks.filter((task) =>
    (!projectId || task.projectId === projectId) &&
    (!assigneeId || task.assigneeId === assigneeId) &&
    (!status || task.status === status) &&
    (!isTrue(pending) || task.status === 'todo' || task.status === 'in_progress') &&
    (!isTrue(overdue) || (task.dueDate < today && task.status !== 'done'))
  );
  return { count: tasks.length, tasks };
}

function get_task({ id } = {}) {
  const task = findById(data.tasks, id || '');
  if (!task) throw new Error(`Task '${id || ''}' was not found`);
  return task;
}

function calculate_project_metrics({ projectId } = {}) {
  const project = findById(data.projects, projectId || '');
  if (!project) return { error: 'No project found', projectId };
  const tasks = data.tasks.filter((task) => task.projectId === projectId);
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

module.exports = {
  get_employee,
  get_project,
  get_projects,
  get_tasks,
  get_task,
  calculate_project_metrics
};
