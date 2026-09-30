# Project Management Guidelines and Delivery Standards

## Project Risk Assessment Criteria
- High Risk Project: A project is classified as High Risk if it satisfies any of the following conditions:
  1. Has 2 or more overdue tasks.
  2. The latest project update has a `riskLevel` of "high".
  3. No project update has been submitted for more than 14 days (stale update).
  4. Task completion rate is under 50% with less than 30 days remaining until the deadline.
- Medium Risk Project: A project with 1 overdue task or conflicting project updates.
- Low Risk Project: Projects meeting all milestone deadlines with completion rates above 75% and active updates.

## Task Lifecycle Rules
- Valid Task Statuses: `todo`, `in_progress`, `blocked`, `done`.
- Status Transitions: Tasks cannot transition directly from `todo` to `done` without passing through `in_progress` or QA review.
- Assignee Workload: No single employee should be assigned more than 5 concurrent `in_progress` tasks.

## Code Review and Quality Assurance Standards
- Review Requirements: Every task code change requires at least one peer code review approval before marking as `done`.
- QA Testing: Critical features require QA testing sign-off by a designated QA Engineer (e.g. Marcus Lee).
