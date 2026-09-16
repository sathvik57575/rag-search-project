const fs = require("fs");
const path = require("path");

const dataPath =
  process.env.PM_DATA_PATH ||
  path.join(__dirname, "..", "data", "pm-data.json");
const initialData = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const defaultDataPath = path.join(__dirname, "..", "data", "pm-data.json");
const data = initialData;

function expandDefaultDataset() {
  if (path.resolve(dataPath) !== path.resolve(defaultDataPath)) return;
  if (
    initialData.employees.length >= 20 &&
    initialData.projects.length >= 8 &&
    initialData.tasks.length >= 100 &&
    (initialData.project_updates || []).length >= 20
  ) return;
  const employees = initialData.employees;
  for (let index = employees.length + 1; index <= 24; index += 1) {
    employees.push({
      id: `EMP${index}`,
      name: `Team Member ${index}`,
      department: index % 2 ? "Engineering" : "Operations",
      role: index % 3 ? "Engineer" : "Analyst",
    });
  }

  const projects = initialData.projects;
  const extraProjects = [
    ["PROJ_DELTA", "Project Delta", "EMP5"],
    ["PROJ_EPSILON", "Project Epsilon", "EMP6"],
    ["PROJ_ZETA", "Project Zeta", "EMP7"],
    ["PROJ_ETA", "Project Eta", "EMP8"],
    ["PROJ_THETA", "Project Theta", "EMP9"],
    ["PROJ_EMPTY", "Project Empty", "EMP10"],
  ];
  extraProjects.forEach(([id, name, ownerId], index) =>
    projects.push({
      id,
      name,
      status: index === 5 ? "active" : "active",
      ownerId,
      startDate: "2026-01-15",
      deadline: `2026-${String(10 + (index % 2)).padStart(2, "0")}-15`,
      budget: [210000, 165000, 195000, 150000, 175000, 90000][index],
    }),
  );
  projects.forEach((project, index) => {
    project.startDate ||= "2026-01-01";
    project.deadline ||= index % 2 ? "2026-10-15" : "2026-09-30";
    project.budget ||= [250000, 180000, 120000, 210000, 165000, 195000, 150000, 175000, 90000][index];
  });

  const tasks = initialData.tasks;
  let nextTask = 7;
  for (const project of projects.filter((item) => item.id !== "PROJ_EMPTY")) {
    while (tasks.filter((task) => task.projectId === project.id).length < 13) {
      const taskNumber = nextTask;
      const overdue =
        project.id !== "PROJ_ALPHA" &&
        project.id !== "PROJ_BETA" &&
        taskNumber % 4 === 0;
      tasks.push({
        id: `TASK${taskNumber}`,
        projectId: project.id,
        title: `Delivery task ${taskNumber}`,
        assigneeId: `EMP${((taskNumber - 1) % 20) + 1}`,
        dueDate: overdue ? "2026-08-01" : "2026-10-20",
        status:
          taskNumber % 9 === 0
            ? "blocked"
            : taskNumber % 5 === 0
              ? "done"
              : "todo",
        estimatedHours: 8 + (taskNumber % 5),
        actualHours: 6 + (taskNumber % 9),
      });
      nextTask += 1;
    }
  }
  tasks.push({
    id: `TASK${nextTask++}`,
    projectId: "PROJ_DELTA",
    title: "Invalid status record",
    assigneeId: "EMP999",
    dueDate: null,
    status: "unknown",
  });

  initialData.project_updates = initialData.project_updates || [];
  let nextUpdate = initialData.project_updates.length + 1;
  for (const project of projects) {
    if (project.id === "PROJ_EMPTY") continue;
    initialData.project_updates.push({
      id: `UPD${nextUpdate++}`,
      projectId: project.id,
      updateDate: "2026-09-10",
      description: "Weekly delivery update",
      riskLevel: project.id === "PROJ_ALPHA" ? "high" : "low",
    });
  }
  initialData.project_updates.push({
    id: `UPD${nextUpdate++}`,
    projectId: "PROJ_ALPHA",
    updateDate: "2026-01-01",
    description: "Old status update",
    riskLevel: "low",
  });
  initialData.project_updates.push({
    id: `UPD${nextUpdate++}`,
    projectId: "PROJ_ALPHA",
    updateDate: "2026-09-14",
    description: "Critical dependency discovered",
    riskLevel: "high",
  });
  while (initialData.project_updates.length < 24) {
    const project =
      projects[
        (initialData.project_updates.length - 1) % (projects.length - 1)
      ];
    initialData.project_updates.push({
      id: `UPD${nextUpdate++}`,
      projectId: project.id,
      updateDate: "2026-09-01",
      description: "Additional delivery observation",
      riskLevel: "medium",
    });
  }
}

expandDefaultDataset();

function createContext(options = {}) {
  return {
    data: JSON.parse(JSON.stringify(initialData)),
    recommendations: [],
    plan: null,
    planHistory: [],
    persist: options.persist === true,
  };
}

function persistContext(context) {
  if (!context || !context.persist) return;
  const temporaryPath = `${dataPath}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify(context.data, null, 2)}\n`,
    "utf8",
  );
  fs.renameSync(temporaryPath, dataPath);
  initialData.employees = context.data.employees;
  initialData.projects = context.data.projects;
  initialData.tasks = context.data.tasks;
  initialData.project_updates = context.data.project_updates;
}

function getContextData(context) {
  return context && context.data ? context.data : data;
}

function isTrue(value) {
  return value === true || value === "true";
}

function findById(items, id) {
  return items.find(
    (item) => item.id.toLowerCase() === String(id).toLowerCase(),
  );
}

function normalizeStatus(status) {
  if (!status) return status;
  const normalized = String(status).toLowerCase().replace(/[- ]/g, "_");
  return normalized === "pending" ? undefined : normalized;
}

function get_employee({ id, name } = {}, context) {
  const contextData = getContextData(context);
  if (!id && !name)
    return {
      count: contextData.employees.length,
      employees: contextData.employees,
    };

  const matches = contextData.employees.filter(
    (employee) =>
      (id && employee.id.toLowerCase() === String(id).toLowerCase()) ||
      (name && employee.name.toLowerCase().includes(name.toLowerCase())),
  );
  if (matches.length === 0)
    return { error: "No employee found", query: { id, name } };
  if (matches.length > 1)
    return {
      ambiguous: true,
      message: "Multiple employees matched; ask the user to clarify.",
      matches,
    };
  return matches[0];
}

function get_employee_by_query(argumentsObject, context) {
  return get_employee(argumentsObject, context);
}

function get_project({ id, name } = {}, context) {
  const contextData = getContextData(context);
  const matches = contextData.projects.filter(
    (project) =>
      (id && project.id.toLowerCase() === String(id).toLowerCase()) ||
      (name && project.name.toLowerCase() === name.toLowerCase()),
  );
  if (matches.length === 0)
    return { error: "No project found", query: { id, name } };
  if (matches.length > 1)
    return {
      ambiguous: true,
      message: "Multiple projects matched; ask the user to clarify.",
      matches,
    };
  return matches[0];
}

function get_projects({ ownerId, ownerName, status, name } = {}, context) {
  const contextData = getContextData(context);
  if (ownerId) {
    const owner = findById(contextData.employees, ownerId);
    if (!owner) {
      return {
        error: `Unknown ownerId '${ownerId}'. Resolve the employee name with get_employee and use the returned employee ID.`,
      };
    }
    ownerId = owner.id;
  }

  if (
    ownerId &&
    !contextData.employees.some((employee) => employee.id === ownerId)
  ) {
    return {
      error: `Unknown ownerId '${ownerId}'. Resolve the employee name with get_employee and use the returned employee ID.`,
    };
  }

  if (ownerName) {
    const matches = contextData.employees.filter((employee) =>
      employee.name.toLowerCase().includes(ownerName.toLowerCase()),
    );
    if (matches.length === 0)
      return { error: `No employee matched '${ownerName}'.` };
    if (matches.length > 1)
      return {
        ambiguous: true,
        message: "Multiple employees matched; ask the user to clarify.",
        matches,
      };
    ownerId = matches[0].id;
  }

  const projects = contextData.projects.filter(
    (project) =>
      (!ownerId || project.ownerId === ownerId) &&
      (!status || project.status === status) &&
      (!name || project.name.toLowerCase().includes(name.toLowerCase())),
  );
  return { count: projects.length, projects };
}

function get_tasks(
  { projectId, assigneeId, assigneeName, status, pending, overdue } = {},
  context,
) {
  const contextData = getContextData(context);
  if (projectId) {
    const project = findById(contextData.projects, projectId);
    if (!project)
      return {
        error: `Unknown projectId '${projectId}'. Resolve the project with get_project first.`,
      };
    projectId = project.id;
  }

  if (assigneeId) {
    const assignee = findById(contextData.employees, assigneeId);
    if (!assignee) {
      return {
        error: `Unknown assigneeId '${assigneeId}'. Resolve the employee name with get_employee and use the returned employee ID.`,
      };
    }
    assigneeId = assignee.id;
  }

  if (assigneeName) {
    const matches = contextData.employees.filter((employee) =>
      employee.name.toLowerCase().includes(assigneeName.toLowerCase()),
    );
    if (matches.length === 0)
      return { error: `No employee matched '${assigneeName}'.` };
    if (matches.length > 1)
      return {
        ambiguous: true,
        message: "Multiple employees matched; ask the user to clarify.",
        matches,
      };
    assigneeId = matches[0].id;
  }

  if (isTrue(pending) && !projectId && !assigneeId) {
    return {
      error:
        "A pending task query needs an assigneeId, assigneeName, or projectId. Do not query all tasks for a person-specific question.",
    };
  }

  if (isTrue(pending) || String(status || "").toLowerCase() === "pending") {
    pending = true;
    status = undefined;
  } else {
    status = normalizeStatus(status);
  }

  const today = new Date().toISOString().slice(0, 10);
  const tasks = contextData.tasks.filter(
    (task) =>
      (!projectId || task.projectId === projectId) &&
      (!assigneeId || task.assigneeId === assigneeId) &&
      (!status || task.status === status) &&
      (!isTrue(pending) ||
        task.status === "todo" ||
        task.status === "in_progress") &&
      (!isTrue(overdue) || (task.dueDate < today && task.status !== "done")),
  );
  return { count: tasks.length, tasks };
}

function get_task({ id } = {}, context) {
  const task = findById(getContextData(context).tasks, id || "");
  if (!task) throw new Error(`Task '${id || ""}' was not found`);
  return task;
}

function calculate_project_metrics({ projectId } = {}, context) {
  const contextData = getContextData(context);
  const project = findById(contextData.projects, projectId || "");
  if (!project) return { error: "No project found", projectId };
  const tasks = contextData.tasks.filter(
    (task) => task.projectId === project.id,
  );
  const today = new Date().toISOString().slice(0, 10);
  const done = tasks.filter((task) => task.status === "done").length;
  const overdue = tasks.filter(
    (task) => task.dueDate < today && task.status !== "done",
  ).length;
  return {
    project,
    totalTasks: tasks.length,
    doneTasks: done,
    inProgressTasks: tasks.filter((task) => task.status === "in_progress")
      .length,
    todoTasks: tasks.filter((task) => task.status === "todo").length,
    overdueTasks: overdue,
    completionRate: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
}

function get_project_metrics(argumentsObject, context) {
  return calculate_project_metrics(argumentsObject, context);
}

function get_project_updates({ projectId, riskLevel } = {}, context) {
  const contextData = getContextData(context);
  if (projectId && !findById(contextData.projects, projectId)) {
    return {
      error: `Unknown projectId '${projectId}'. Resolve the project with get_project first.`,
    };
  }
  const updates = (
    contextData.project_updates ||
    contextData.projectUpdates ||
    []
  ).filter(
    (update) =>
      (!projectId ||
        update.projectId.toLowerCase() === String(projectId).toLowerCase()) &&
      (!riskLevel ||
        String(update.riskLevel).toLowerCase() ===
          String(riskLevel).toLowerCase()),
  );
  const today = new Date().toISOString().slice(0, 10);
  const staleCutoff = new Date(`${today}T00:00:00Z`);
  staleCutoff.setDate(staleCutoff.getDate() - 30);
  const stale = updates.filter(
    (update) =>
      !update.updateDate ||
      new Date(`${update.updateDate}T00:00:00Z`) < staleCutoff,
  );
  const byProject = updates.reduce((groups, update) => {
    (groups[update.projectId] ||= []).push(update);
    return groups;
  }, {});
  const conflicting = Object.values(byProject).flatMap((projectUpdates) => {
    const levels = new Set(
      projectUpdates
        .map((update) => String(update.riskLevel || "").toLowerCase())
        .filter(Boolean),
    );
    return levels.size > 1 ? projectUpdates : [];
  });
  return {
    count: updates.length,
    updates,
    staleUpdateIds: stale.map((update) => update.id),
    conflictingUpdateIds: conflicting.map((update) => update.id),
  };
}

function create_plan({ objective, steps } = {}, context) {
  if (!objective || !Array.isArray(steps) || steps.length === 0)
    return { error: "A plan needs an objective and at least one step." };
  context.plan = {
    version: context.plan ? context.plan.version + 1 : 1,
    objective,
    steps,
    status: "active",
  };
  context.planHistory.push({ type: "plan_created", plan: context.plan });
  return { planned: true, plan: context.plan };
}

function replan({ reason, steps } = {}, context) {
  if (!reason || !Array.isArray(steps) || steps.length === 0)
    return { error: "A replan needs a reason and replacement steps." };
  context.plan = {
    ...(context.plan || {}),
    version: context.plan ? context.plan.version + 1 : 1,
    steps,
    status: "active",
    replanReason: reason,
  };
  context.planHistory.push({ type: "replanned", reason, plan: context.plan });
  return { replanned: true, plan: context.plan };
}

function find_project_risks({ projectId } = {}, context) {
  const contextData = getContextData(context);
  const project = findById(contextData.projects, projectId || "");
  if (!project) return { error: "No project found", projectId };

  const today = new Date().toISOString().slice(0, 10);
  const tasks = contextData.tasks.filter(
    (task) => task.projectId === project.id,
  );
  const overdueTasks = tasks.filter(
    (task) => task.dueDate < today && task.status !== "done",
  );
  const blockedTasks = tasks.filter((task) => task.status === "blocked");
  const allowedStatuses = ["todo", "in_progress", "blocked", "done"];
  const inconsistentTasks = tasks.filter(
    (task) =>
      !allowedStatuses.includes(task.status) ||
      !task.dueDate ||
      !findById(contextData.employees, task.assigneeId),
  );
  const assigneeCounts = tasks.reduce((counts, task) => {
    counts[task.assigneeId] = (counts[task.assigneeId] || 0) + 1;
    return counts;
  }, {});
  const concentratedAssignee = Object.entries(assigneeCounts).sort(
    (left, right) => right[1] - left[1],
  )[0];
  const risks = [];
  const updatesResult = get_project_updates({ projectId }, context);
  const deadlineInvalid =
    !project.deadline ||
    (project.deadline &&
      project.startDate &&
      project.deadline < project.startDate);
  if (!tasks.length)
    risks.push({ type: "no_task_coverage", severity: "high", count: 0 });
  if (overdueTasks.length)
    risks.push({
      type: "overdue_work",
      severity: "high",
      count: overdueTasks.length,
      taskIds: overdueTasks.map((task) => task.id),
    });
  if (blockedTasks.length)
    risks.push({
      type: "blocked_work",
      severity: "high",
      count: blockedTasks.length,
      taskIds: blockedTasks.map((task) => task.id),
    });
  if (inconsistentTasks.length)
    risks.push({
      type: "inconsistent_data",
      severity: "medium",
      count: inconsistentTasks.length,
      taskIds: inconsistentTasks.map((task) => task.id),
    });
  if (concentratedAssignee && concentratedAssignee[1] >= 3)
    risks.push({
      type: "assignee_concentration",
      severity: "medium",
      assigneeId: concentratedAssignee[0],
      taskCount: concentratedAssignee[1],
    });
  if (deadlineInvalid)
    risks.push({ type: "invalid_deadline_data", severity: "medium" });
  if (updatesResult.staleUpdateIds.length)
    risks.push({
      type: "stale_updates",
      severity: "medium",
      updateIds: updatesResult.staleUpdateIds,
    });
  if (updatesResult.conflictingUpdateIds.length)
    risks.push({
      type: "conflicting_updates",
      severity: "high",
      updateIds: updatesResult.conflictingUpdateIds,
    });
  if (
    tasks.some(
      (task) => task.status !== "done" && task.dueDate < today && task.dueDate,
    )
  )
    risks.push({ type: "schedule_slippage", severity: "high" });
  return {
    project,
    riskCount: risks.length,
    risks,
    evidence: {
      taskCount: tasks.length,
      overdueTaskIds: overdueTasks.map((task) => task.id),
      blockedTaskIds: blockedTasks.map((task) => task.id),
      inconsistentTaskIds: inconsistentTasks.map((task) => task.id),
      staleUpdateIds: updatesResult.staleUpdateIds,
      conflictingUpdateIds: updatesResult.conflictingUpdateIds,
    },
  };
}

function update_task_status({ taskId, status, reason } = {}, context) {
  const contextData = getContextData(context);
  const task = findById(contextData.tasks, taskId || "");
  const allowedStatuses = ["todo", "in_progress", "blocked", "done"];
  if (!task) return { error: `Task '${taskId || ""}' was not found` };
  if (!allowedStatuses.includes(String(status || "").toLowerCase()))
    return {
      error: `Invalid status '${status}'. Use todo, in_progress, blocked, or done.`,
    };
  const previousStatus = task.status;
  task.status = String(status).toLowerCase();
  try {
    persistContext(context);
  } catch (error) {
    task.status = previousStatus;
    return { error: `Task status was not persisted: ${error.message}` };
  }
  return {
    updated: true,
    persisted: Boolean(context && context.persist),
    task,
    previousStatus,
    reason: reason || null,
  };
}

function assign_task({ taskId, assigneeId, reason } = {}, context) {
  const contextData = getContextData(context);
  const task = findById(contextData.tasks, taskId || "");
  const assignee = findById(contextData.employees, assigneeId || "");
  if (!task) return { error: `Task '${taskId || ""}' was not found` };
  if (!assignee)
    return { error: `Employee '${assigneeId || ""}' was not found` };
  const previousAssigneeId = task.assigneeId;
  task.assigneeId = assignee.id;
  try {
    persistContext(context);
  } catch (error) {
    task.assigneeId = previousAssigneeId;
    return { error: `Task assignment was not persisted: ${error.message}` };
  }
  return {
    updated: true,
    persisted: Boolean(context && context.persist),
    task,
    previousAssigneeId,
    reason: reason || null,
  };
}

function create_recommendation(
  { projectId, title, rationale, action, priority } = {},
  context,
) {
  const recommendation = {
    id: `REC_${(context && context.recommendations ? context.recommendations.length : 0) + 1}`,
    projectId: projectId || null,
    title,
    rationale,
    action,
    priority: priority || "medium",
  };
  if (context && context.recommendations)
    context.recommendations.push(recommendation);
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
  create_recommendation,
  get_employee_by_query,
  get_project_metrics,
  get_project_updates,
  create_plan,
  replan,
};
