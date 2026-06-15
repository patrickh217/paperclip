/**
 * Tests for SCH-630: manager-chain override on issue:mutate
 * Covers the 8-case test matrix from the binding spec (SCH-626 ADR).
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const issueId = "aaa00000-0000-4000-8000-000000000001";
const companyId = "bbb00000-0000-4000-8000-000000000002";
const managerAgentId = "ccc00000-0000-4000-8000-000000000003"; // direct manager / CTO-equivalent
const reportAgentId = "ddd00000-0000-4000-8000-000000000004";  // report / assignee
const grandReportAgentId = "eee00000-0000-4000-8000-000000000005"; // transitive report
const peerAgentId = "fff00000-0000-4000-8000-000000000006";    // no chain relationship
const managerRunId = "rrr00000-0000-4000-8000-000000000007";

// ──────────────────────────────────────────────────────────
// Hoisted mocks
// ──────────────────────────────────────────────────────────

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

const mockIssueService = vi.hoisted(() => ({
  addComment: vi.fn(),
  assertCheckoutOwner: vi.fn(),
  create: vi.fn(),
  createChild: vi.fn(),
  getAttachmentById: vi.fn(),
  getByIdentifier: vi.fn(),
  getById: vi.fn(),
  getRelationSummaries: vi.fn(),
  getWakeableParentAfterChildCompletion: vi.fn(),
  getDependencyReadiness: vi.fn(),
  getCurrentScheduledRetry: vi.fn(),
  list: vi.fn(),
  listAttachments: vi.fn(),
  listWakeableBlockedDependents: vi.fn(),
  remove: vi.fn(),
  removeAttachment: vi.fn(),
  update: vi.fn(),
  findMentionedAgents: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  decide: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  list: vi.fn(),
  resolveByReference: vi.fn(),
}));

const mockCompanyService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockDocumentService = vi.hoisted(() => ({
  upsertIssueDocument: vi.fn(),
}));

const mockWorkProductService = vi.hoisted(() => ({
  createForIssue: vi.fn(),
  getById: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
}));

const mockStorageService = vi.hoisted(() => ({
  provider: "local_disk",
  putFile: vi.fn(),
  getObject: vi.fn(),
  headObject: vi.fn(),
  deleteObject: vi.fn(),
}));

const mockIssueThreadInteractionService = vi.hoisted(() => ({
  expireRequestConfirmationsSupersededByComment: vi.fn(async () => []),
  expireStaleRequestConfirmationsForIssueDocument: vi.fn(async () => []),
}));

const mockIssueRecoveryActionService = vi.hoisted(() => ({
  getActiveForIssue: vi.fn(async () => null),
  listActiveForIssues: vi.fn(async () => new Map()),
  resolveActiveForIssue: vi.fn(async () => null),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  reportRunActivity: vi.fn(async () => undefined),
  getRun: vi.fn(async () => null),
  getActiveRunForAgent: vi.fn(async () => null),
  cancelRun: vi.fn(async () => null),
}));

// ──────────────────────────────────────────────────────────
// Module mock registration
// ──────────────────────────────────────────────────────────

function registerRouteMocks() {
  vi.doMock("@paperclipai/shared/telemetry", () => ({
    trackAgentTaskCompleted: vi.fn(),
    trackErrorHandlerCrash: vi.fn(),
  }));
  vi.doMock("../telemetry.js", () => ({
    getTelemetryClient: vi.fn(() => ({ track: vi.fn() })),
  }));
  vi.doMock("../services/access.js", () => ({
    accessService: () => mockAccessService,
  }));
  vi.doMock("../services/agents.js", () => ({
    agentService: () => mockAgentService,
  }));
  vi.doMock("../services/documents.js", () => ({
    documentAnnotationService: () => ({ remapOpenThreadsForDocument: async () => [] }),
    documentService: () => mockDocumentService,
  }));
  vi.doMock("../services/issues.js", () => ({
    issueService: () => mockIssueService,
  }));
  vi.doMock("../services/work-products.js", () => ({
    workProductService: () => mockWorkProductService,
  }));
  vi.doMock("../services/activity-log.js", () => ({
    logActivity: mockLogActivity,
    setPluginEventBus: vi.fn(),
    publishPluginDomainEvent: vi.fn(),
  }));
  vi.doMock("../services/index.js", () => ({
    ISSUE_LIST_DEFAULT_LIMIT: 100,
    ISSUE_LIST_MAX_LIMIT: 500,
    accessService: () => mockAccessService,
    agentService: () => mockAgentService,
    clampIssueListLimit: (v: number) => Math.min(Math.max(v, 1), 500),
    companyService: () => mockCompanyService,
    documentAnnotationService: () => ({ remapOpenThreadsForDocument: async () => [] }),
    documentService: () => mockDocumentService,
    executionWorkspaceService: () => ({}),
    feedbackService: () => ({
      listIssueVotesForUser: vi.fn(async () => []),
      saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
    }),
    goalService: () => ({}),
    heartbeatService: () => mockHeartbeatService,
    instanceSettingsService: () => ({
      get: vi.fn(async () => ({
        id: "instance-settings-1",
        general: { censorUsernameInLogs: false, feedbackDataSharingPreference: "prompt" },
      })),
      getGeneral: vi.fn(async () => ({ censorUsernameInLogs: false })),
      listCompanyIds: vi.fn(async () => [companyId]),
    }),
    issueApprovalService: () => ({}),
    issueRecoveryActionService: () => mockIssueRecoveryActionService,
    issueReferenceService: () => ({
      deleteDocumentSource: async () => undefined,
      diffIssueReferenceSummary: () => ({
        addedReferencedIssues: [],
        removedReferencedIssues: [],
        currentReferencedIssues: [],
      }),
      emptySummary: () => ({ outbound: [], inbound: [] }),
      listIssueReferenceSummary: async () => ({ outbound: [], inbound: [] }),
      syncComment: async () => undefined,
      syncDocument: async () => undefined,
      syncIssue: async () => undefined,
    }),
    issueService: () => mockIssueService,
    issueThreadInteractionService: () => mockIssueThreadInteractionService,
    logActivity: mockLogActivity,
    projectService: () => ({}),
    routineService: () => ({
      syncRunStatusForIssue: vi.fn(async () => undefined),
    }),
    workProductService: () => mockWorkProductService,
  }));
}

// ──────────────────────────────────────────────────────────
// DB factory — returns a mock db with controllable agent rows
// ──────────────────────────────────────────────────────────

type AgentRow = { id: string; reportsTo: string | null };

function createManagerChainDb(agentRows: AgentRow[], actorAgentId: string = managerAgentId) {
  const runRows = [{
    id: managerRunId,
    companyId,
    agentId: actorAgentId,
    agentCompanyId: companyId,
    contextSnapshot: {},
  }];

  const buildQuery = (rows: unknown[]) => {
    const whereResult = {
      orderBy: vi.fn(async () => []),
      limit: vi.fn(() => whereResult),
      then: async (resolve: (r: unknown[]) => unknown) => resolve(rows),
    };
    const q: Record<string, unknown> = {
      innerJoin: vi.fn(() => q),
      where: vi.fn(() => whereResult),
    };
    return q;
  };

  return {
    transaction: async (cb: (tx: Record<string, never>) => Promise<unknown>) => cb({} as Record<string, never>),
    select: vi.fn((selection: Record<string, unknown> = {}) => {
      const keys = Object.keys(selection);
      let rows: unknown[];
      if (keys.includes("entityId") || keys.includes("createdAt")) {
        rows = []; // activity log reads
      } else if (keys.includes("contextSnapshot") || keys.includes("agentCompanyId")) {
        rows = runRows; // heartbeat run queries
      } else if (keys.includes("reportsTo")) {
        rows = agentRows; // buildManagerChainPath
      } else {
        rows = [{ id: actorAgentId, companyId, permissions: {}, role: "engineer", reportsTo: null }];
      }
      return { from: vi.fn(() => buildQuery(rows)) };
    }),
  };
}

// ──────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: issueId,
    companyId,
    status: "todo",
    priority: "medium",
    projectId: null,
    goalId: null,
    parentId: null,
    billingCode: null,
    title: "Report's issue",
    description: null,
    assigneeAgentId: reportAgentId,
    assigneeUserId: null,
    executionPolicy: null,
    executionState: null,
    executionRunId: null,
    hiddenAt: null,
    createdByUserId: "board-user",
    identifier: "SCH-9001",
    ...overrides,
  };
}

function managerActor() {
  return {
    type: "agent",
    agentId: managerAgentId,
    companyId,
    source: "agent_key",
    runId: managerRunId,
  };
}

function agentActor(agentId: string, runId = "rrr00000-0000-4000-8000-000000000099") {
  return { type: "agent", agentId, companyId, source: "agent_key", runId };
}

// Single-hop chain: managerAgentId → reportAgentId
const directChainRows: AgentRow[] = [
  { id: managerAgentId, reportsTo: null },
  { id: reportAgentId, reportsTo: managerAgentId },
];

// Two-hop chain: managerAgentId → reportAgentId → grandReportAgentId
const transitiveChainRows: AgentRow[] = [
  { id: managerAgentId, reportsTo: null },
  { id: reportAgentId, reportsTo: managerAgentId },
  { id: grandReportAgentId, reportsTo: reportAgentId },
];

function makeApp(actor: Record<string, unknown>, db: ReturnType<typeof createManagerChainDb>) {
  return async () => {
    const [{ errorHandler }, { issueRoutes }] = await Promise.all([
      vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
      vi.importActual<typeof import("../routes/issues.js")>("../routes/issues.js"),
    ]);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as Record<string, unknown>).actor = actor;
      next();
    });
    app.use("/api", issueRoutes(db as never, mockStorageService as never));
    app.use(errorHandler);
    return app;
  };
}

// ──────────────────────────────────────────────────────────
// Shared beforeEach setup
// ──────────────────────────────────────────────────────────

function setupDefaultMocks() {
  mockAccessService.canUser.mockReset();
  mockAccessService.decide.mockReset();
  mockAccessService.hasPermission.mockReset();
  mockAccessService.canUser.mockResolvedValue(true);
  mockAccessService.hasPermission.mockResolvedValue(false);

  mockAgentService.getById.mockReset();
  mockAgentService.list.mockReset();
  mockAgentService.resolveByReference.mockReset();
  mockAgentService.resolveByReference.mockResolvedValue({ ambiguous: false, agent: null });

  mockCompanyService.getById.mockReset();
  mockCompanyService.getById.mockResolvedValue({ id: companyId, issuePrefix: "SCH" });

  mockIssueService.getById.mockReset();
  mockIssueService.getByIdentifier.mockReset();
  mockIssueService.getByIdentifier.mockResolvedValue(null);
  mockIssueService.update.mockReset();
  mockIssueService.addComment.mockReset();
  mockIssueService.listWakeableBlockedDependents.mockReset();
  mockIssueService.listWakeableBlockedDependents.mockResolvedValue([]);
  mockIssueService.getWakeableParentAfterChildCompletion.mockReset();
  mockIssueService.getWakeableParentAfterChildCompletion.mockResolvedValue(null);
  mockIssueService.findMentionedAgents.mockReset();
  mockIssueService.findMentionedAgents.mockResolvedValue([]);
  mockIssueService.getRelationSummaries.mockReset();
  mockIssueService.getRelationSummaries.mockResolvedValue({ blockedBy: [], blocks: [] });
  mockIssueService.getDependencyReadiness.mockReset();
  mockIssueService.getDependencyReadiness.mockResolvedValue({ unresolvedBlockerCount: 0 });
  mockIssueService.getCurrentScheduledRetry.mockReset();
  mockIssueService.getCurrentScheduledRetry.mockResolvedValue(null);
  mockIssueService.assertCheckoutOwner.mockReset();
  mockIssueService.assertCheckoutOwner.mockResolvedValue({ adoptedFromRunId: null });

  mockIssueRecoveryActionService.getActiveForIssue.mockReset();
  mockIssueRecoveryActionService.getActiveForIssue.mockResolvedValue(null);
  mockIssueRecoveryActionService.listActiveForIssues.mockReset();
  mockIssueRecoveryActionService.listActiveForIssues.mockResolvedValue(new Map());

  mockHeartbeatService.cancelRun.mockReset();
  mockHeartbeatService.cancelRun.mockResolvedValue(null);
  mockHeartbeatService.getRun.mockReset();
  mockHeartbeatService.getRun.mockResolvedValue(null);
  mockHeartbeatService.wakeup.mockReset();
  mockHeartbeatService.wakeup.mockResolvedValue(undefined);

  mockLogActivity.mockReset();
  mockLogActivity.mockResolvedValue(undefined);

  // Default update returns updated issue
  mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
    ...makeIssue(),
    ...patch,
    id: issueId,
    companyId,
  }));
}

/** Mock access.decide to return allow_manager_chain for issue:mutate, allow for reads. */
function allowManagerChainDecide() {
  mockAccessService.decide.mockImplementation(async (input: { action: string }) => {
    const allowedActions = ["issue:read", "company_scope:read", "tasks:manage_active_checkouts"];
    if (allowedActions.includes(input.action)) {
      return { allowed: true, action: input.action, reason: "allow_explicit_grant", explanation: "Allowed." };
    }
    if (input.action === "issue:mutate") {
      return { allowed: true, action: input.action, reason: "allow_manager_chain", explanation: "Manager chain." };
    }
    return { allowed: false, action: input.action, reason: "deny_missing_grant", explanation: "Denied." };
  });
}

/** Mock access.decide to return deny for issue:mutate (simulates peer / reverse-direction). */
function denyIssueMutateDecide() {
  mockAccessService.decide.mockImplementation(async (input: { action: string }) => {
    const allowedActions = ["issue:read", "company_scope:read"];
    if (allowedActions.includes(input.action)) {
      return { allowed: true, action: input.action, reason: "allow_explicit_grant", explanation: "Allowed." };
    }
    return { allowed: false, action: input.action, reason: "deny_missing_grant", explanation: "Denied." };
  });
}

/** Mock access.decide for allow_self (actor === assignee). */
function allowSelfDecide() {
  mockAccessService.decide.mockImplementation(async (input: { action: string }) => ({
    allowed: true,
    action: input.action,
    reason: "allow_self",
    explanation: "Self.",
  }));
}

/** Mock access.decide for allow_company_agent (no assignee). */
function allowCompanyAgentDecide() {
  mockAccessService.decide.mockImplementation(async (input: { action: string }) => ({
    allowed: true,
    action: input.action,
    reason: "allow_company_agent",
    explanation: "Company agent.",
  }));
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe("manager-chain override on issue:mutate (SCH-630)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@paperclipai/shared/telemetry");
    vi.doUnmock("../telemetry.js");
    vi.doUnmock("../services/access.js");
    vi.doUnmock("../services/activity-log.js");
    vi.doUnmock("../services/agents.js");
    vi.doUnmock("../services/documents.js");
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../services/issues.js");
    vi.doUnmock("../services/work-products.js");
    vi.doUnmock("../routes/issues.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerRouteMocks();
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // ── Test 1: Direct manager → report's todo issue → 200 + audit row ──
  it("allows direct manager to PATCH report's todo issue and emits audit row", async () => {
    allowManagerChainDecide();
    mockIssueService.getById.mockResolvedValue(makeIssue({ status: "todo" }));
    const db = createManagerChainDb(directChainRows);
    const app = await makeApp(managerActor(), db)();

    const res = await request(app)
      .patch(`/api/issues/${issueId}`)
      .send({ status: "todo", blockedByIssueIds: [] });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.manager_override_mutate",
        entityId: issueId,
        details: expect.objectContaining({
          actorAgentId: managerAgentId,
          assigneeAgentId: reportAgentId,
        }),
      }),
    );
  });

  // ── Test 2: Transitive manager (grand-manager) → 200 + audit row ──
  it("allows transitive (grand-)manager to PATCH grand-report's issue and emits audit row", async () => {
    allowManagerChainDecide();
    mockIssueService.getById.mockResolvedValue(makeIssue({ status: "backlog", assigneeAgentId: grandReportAgentId }));
    const db = createManagerChainDb(transitiveChainRows);
    const app = await makeApp(managerActor(), db)();

    const res = await request(app)
      .patch(`/api/issues/${issueId}`)
      .send({ status: "todo", blockedByIssueIds: [] });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.manager_override_mutate",
        details: expect.objectContaining({ assigneeAgentId: grandReportAgentId }),
      }),
    );
  });

  // ── Test 3: Peer agent (no chain) → 403, no audit row ──
  it("rejects peer agent with no chain relationship with 403 and no audit row", async () => {
    denyIssueMutateDecide();
    mockIssueService.getById.mockResolvedValue(makeIssue({ status: "todo" }));
    const db = createManagerChainDb(directChainRows, peerAgentId);
    const app = await makeApp(agentActor(peerAgentId), db)();

    const res = await request(app)
      .patch(`/api/issues/${issueId}`)
      .send({ status: "todo", blockedByIssueIds: [] });

    expect(res.status).toBe(403);
    expect(mockLogActivity).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "issue.manager_override_mutate" }),
    );
  });

  // ── Test 4: Report → manager's issue (reverse direction) → 403, no audit row ──
  it("rejects report trying to PATCH manager's issue (reverse direction) with 403", async () => {
    denyIssueMutateDecide();
    // The issue is assigned to managerAgentId; the actor is the report
    mockIssueService.getById.mockResolvedValue(makeIssue({ status: "todo", assigneeAgentId: managerAgentId }));
    const db = createManagerChainDb(directChainRows, reportAgentId);
    const app = await makeApp(agentActor(reportAgentId), db)();

    const res = await request(app)
      .patch(`/api/issues/${issueId}`)
      .send({ status: "todo" });

    expect(res.status).toBe(403);
    expect(mockLogActivity).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "issue.manager_override_mutate" }),
    );
  });

  // ── Test 5: Manager → report's in_progress issue with active checkout → 409 ──
  it("rejects manager PATCH on in_progress report issue with 409 (active checkout guard)", async () => {
    allowManagerChainDecide();
    mockIssueService.getById.mockResolvedValue(makeIssue({ status: "in_progress" }));
    const db = createManagerChainDb(directChainRows);
    const app = await makeApp(managerActor(), db)();

    const res = await request(app)
      .patch(`/api/issues/${issueId}`)
      .send({ status: "todo", blockedByIssueIds: [] });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: expect.stringContaining("active checkout") });
    expect(mockLogActivity).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "issue.manager_override_mutate" }),
    );
  });

  // ── Test 6: Manager → report's issue, body contains assigneeAgentId → 403 ──
  it("rejects manager PATCH that contains non-allowlisted field assigneeAgentId with 403", async () => {
    allowManagerChainDecide();
    mockIssueService.getById.mockResolvedValue(makeIssue({ status: "todo" }));
    const db = createManagerChainDb(directChainRows);
    const app = await makeApp(managerActor(), db)();

    const res = await request(app)
      .patch(`/api/issues/${issueId}`)
      .send({ status: "todo", assigneeAgentId: reportAgentId });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: "field outside manager-override allowlist",
      fields: expect.arrayContaining(["assigneeAgentId"]),
    });
    expect(mockIssueService.update).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "issue.manager_override_mutate" }),
    );
  });

  // ── Test 7: Regression — allow_self path still works, no manager_override_mutate audit row ──
  it("regression: assignee PATCHing own issue (allow_self) returns 200 with no manager_override_mutate audit row", async () => {
    allowSelfDecide();
    mockIssueService.getById.mockResolvedValue(makeIssue({ status: "in_progress", assigneeAgentId: reportAgentId }));
    mockIssueService.assertCheckoutOwner.mockResolvedValue({ adoptedFromRunId: null });
    const db = createManagerChainDb(directChainRows, reportAgentId);
    const app = await makeApp(agentActor(reportAgentId, "run-report-1"), db)();

    const res = await request(app)
      .patch(`/api/issues/${issueId}`)
      .send({ status: "todo" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockLogActivity).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "issue.manager_override_mutate" }),
    );
  });

  // ── Test 7b: Regression — allow_company_agent path (no assignee) returns 200, no manager_override_mutate ──
  it("regression: PATCH on unassigned issue (allow_company_agent) returns 200 with no manager_override_mutate audit row", async () => {
    allowCompanyAgentDecide();
    mockIssueService.getById.mockResolvedValue(makeIssue({ status: "todo", assigneeAgentId: null }));
    const db = createManagerChainDb([], peerAgentId);
    const app = await makeApp(agentActor(peerAgentId), db)();

    const res = await request(app)
      .patch(`/api/issues/${issueId}`)
      .send({ status: "todo" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockLogActivity).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "issue.manager_override_mutate" }),
    );
  });

  // ── Integration test: reproduces SCH-622 → SCH-238 failure scenario ──
  it("integration: CTO PATCHes {status:todo, blockedByIssueIds:[]} on CTO-managed agent's issue → 200", async () => {
    // This mirrors the original failure where the CTO could not unblock a report's issue.
    allowManagerChainDecide();
    mockIssueService.getById.mockResolvedValue(makeIssue({ status: "blocked", assigneeAgentId: reportAgentId }));
    mockIssueService.getRelationSummaries.mockResolvedValue({
      blockedBy: [{ id: "blocker-1", identifier: "SCH-500", title: "Old blocker", status: "done", priority: "high" }],
      blocks: [],
    });
    const db = createManagerChainDb(directChainRows);
    const app = await makeApp(managerActor(), db)();

    const res = await request(app)
      .patch(`/api/issues/${issueId}`)
      .send({ status: "todo", blockedByIssueIds: [] });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.manager_override_mutate",
        details: expect.objectContaining({
          actorAgentId: managerAgentId,
          assigneeAgentId: reportAgentId,
          patchedFields: expect.objectContaining({
            status: { from: "blocked", to: "todo" },
          }),
        }),
      }),
    );
  });
});
