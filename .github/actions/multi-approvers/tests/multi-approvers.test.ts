// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/*eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_$" }]*/

import assert from "node:assert/strict";
import { test } from "node:test";
import nock from "nock";
import {
  MultiApproversAction,
  MultiApproversParams,
} from "../src/multi-approvers";

const GITHUB_API_BASE_URL = "https://api.github.com";

const BASE_PARAMS = {
  eventName: "pull_request",
  runId: 21,
  branch: "twig",
  pullNumber: 12,
  repoName: "anvils",
  repoOwner: "acme",
  token: "fake-token",
  team: "hunters",
  octokitOptions: { request: fetch },
  logDebug: (_: string) => {},
  logInfo: (_: string) => {},
} as MultiApproversParams;

async function assertRejects(
  nockScope: any,
  message: string,
  overrideParams: Partial<MultiApproversParams> = {},
) {
  const multiApproversAction = new MultiApproversAction(
    Object.assign({}, BASE_PARAMS, overrideParams),
  );

  await assert.rejects(async () => await multiApproversAction.validate(), {
    name: "Error",
    message,
  });
  assert(
    nockScope.isDone(),
    `Pending nock mocks: ${JSON.stringify(nockScope.pendingMocks())}`,
  );
}

async function assertDoesNotReject(
  nockScope: any,
  overrideParams: Partial<MultiApproversParams> = {},
) {
  const multiApproversAction = new MultiApproversAction(
    Object.assign({}, BASE_PARAMS, overrideParams),
  );

  await assert.doesNotReject(async () => await multiApproversAction.validate());
  assert(
    nockScope.isDone(),
    `Pending nock mocks: ${JSON.stringify(nockScope.pendingMocks())}`,
  );
}

// Note that the { request: fetch } OctokitOptions are required for nock to work
// with octokit. This is because, by default, octokit uses a non-standard http
// library that nock does not recognize.
test("#multi-approvers", { concurrency: true }, async (suite) => {
  suite.beforeEach(async () => {
    nock.cleanAll();
  });

  await suite.test("should ignore PRs from internal users", async () => {
    const { repoOwner, repoName, pullNumber, team } = BASE_PARAMS;
    const prLogin = "wile-e-coyote";

    const nockScope = nock(GITHUB_API_BASE_URL)
      .get(`/repos/${repoOwner}/${repoName}/pulls/${pullNumber}`)
      .reply(200, {
        owner: repoOwner,
        pull_number: pullNumber,
        repoName,
        user: {
          login: prLogin,
        },
      })
      .get(`/orgs/${repoOwner}/teams/${team}/memberships/${prLogin}`)
      .reply(200, {
        org: repoOwner,
        team_slug: team,
        username: prLogin,
        role: "member",
        state: "active",
      });

    await assertDoesNotReject(nockScope);
  });

  await suite.test(
    "should reject PRs from external users and no internal approvals",
    async () => {
      const { repoOwner, repoName, pullNumber, team } = BASE_PARAMS;
      const prLogin = "wile-e-coyote";

      const nockScope = nock(GITHUB_API_BASE_URL)
        .get(`/repos/${repoOwner}/${repoName}/pulls/${pullNumber}`)
        .reply(200, {
          owner: repoOwner,
          pull_number: pullNumber,
          repoName,
          user: {
            login: prLogin,
          },
        })
        .get(`/orgs/${repoOwner}/teams/${team}/memberships/${prLogin}`)
        .reply(404)
        .get(`/repos/${repoOwner}/${repoName}/pulls/${pullNumber}/reviews`)
        .reply(200, []);

      await assertRejects(
        nockScope,
        "This pull request has 0 of 2 required internal approvals.",
      );
    },
  );

  await suite.test(
    "should succeed for PRs from external users and 2 internal approvals",
    async () => {
      const { repoOwner, repoName, pullNumber, team } = BASE_PARAMS;
      const prLogin = "pr-owner";
      const approver1 = "approver-1";
      const approver2 = "approver-2";

      const nockScope = nock(GITHUB_API_BASE_URL)
        .get(`/repos/${repoOwner}/${repoName}/pulls/${pullNumber}`)
        .reply(200, {
          owner: repoOwner,
          pull_number: pullNumber,
          repoName: repoName,
          user: {
            login: prLogin,
          },
        })
        .get(`/orgs/${repoOwner}/teams/${team}/memberships/${prLogin}`)
        .reply(404)
        .get(`/repos/${repoOwner}/${repoName}/pulls/${pullNumber}/reviews`)
        .reply(200, [
          {
            submitted_at: 1714636800,
            user: {
              login: approver1,
            },
            state: "approved",
          },
          {
            submitted_at: 1714636801,
            user: {
              login: approver2,
            },
            state: "approved",
          },
        ])
        .get(`/orgs/${repoOwner}/teams/${team}/memberships/${approver1}`)
        .reply(200, {
          org: repoOwner,
          team_slug: team,
          username: approver1,
          role: "member",
          state: "active",
        })
        .get(`/orgs/${repoOwner}/teams/${team}/memberships/${approver2}`)
        .reply(200, {
          org: repoOwner,
          team_slug: team,
          username: approver2,
          role: "member",
          state: "active",
        });

      await assertDoesNotReject(nockScope);
    },
  );

  await suite.test("should ignore PR review comments", async () => {
    const { repoOwner, repoName, pullNumber, team } = BASE_PARAMS;
    const prLogin = "pr-owner";
    const approver1 = "approver-1";
    const approver2 = "approver-2";

    const nockScope = nock(GITHUB_API_BASE_URL)
      .get(`/repos/${repoOwner}/${repoName}/pulls/${pullNumber}`)
      .reply(200, {
        owner: repoOwner,
        pull_number: pullNumber,
        repoName,
        user: {
          login: prLogin,
        },
      })
      .get(`/orgs/${repoOwner}/teams/${team}/memberships/${prLogin}`)
      .reply(404)
      .get(`/repos/${repoOwner}/${repoName}/pulls/${pullNumber}/reviews`)
      .reply(200, [
        {
          submitted_at: 1714636800,
          user: {
            login: approver1,
          },
          state: "approved",
        },
        {
          submitted_at: 1714636801,
          user: {
            login: approver2,
          },
          state: "commented",
        },
      ])
      .get(`/orgs/${repoOwner}/teams/${team}/memberships/${approver1}`)
      .reply(200, {
        org: repoOwner,
        team_slug: team,
        username: approver1,
        role: "member",
        state: "active",
      })
      .get(`/orgs/${repoOwner}/teams/${team}/memberships/${approver2}`)
      .reply(200, {
        org: repoOwner,
        team_slug: team,
        username: approver2,
        role: "member",
        state: "active",
      });

    await assertRejects(
      nockScope,
      "This pull request has 1 of 2 required internal approvals.",
    );
  });

  await suite.test("should handle rescinded approval", async () => {
    const { repoOwner, repoName, pullNumber, team } = BASE_PARAMS;
    const prLogin = "pr-owner";
    const approver1 = "approver-1";
    const approver2 = "approver-2";

    const nockScope = nock(GITHUB_API_BASE_URL)
      .get(`/repos/${repoOwner}/${repoName}/pulls/${pullNumber}`)
      .reply(200, {
        owner: repoOwner,
        pull_number: pullNumber,
        repoName,
        user: {
          login: prLogin,
        },
      })
      .get(`/orgs/${repoOwner}/teams/${team}/memberships/${prLogin}`)
      .reply(404)
      .get(`/repos/${repoOwner}/${repoName}/pulls/${pullNumber}/reviews`)
      .reply(200, [
        {
          submitted_at: 1714636800,
          user: {
            login: approver1,
          },
          state: "approved",
        },
        {
          submitted_at: 1714636801,
          user: {
            login: approver2,
          },
          state: "approved",
        },
        {
          submitted_at: 1714636802,
          user: {
            login: approver2,
          },
          state: "request_changes",
        },
      ])
      .get(`/orgs/${repoOwner}/teams/${team}/memberships/${approver1}`)
      .reply(200, {
        org: repoOwner,
        team_slug: team,
        username: approver1,
        role: "member",
        state: "active",
      })
      .get(`/orgs/${repoOwner}/teams/${team}/memberships/${approver2}`)
      .reply(200, {
        org: repoOwner,
        team_slug: team,
        username: approver2,
        role: "member",
        state: "active",
      })
      .get(`/orgs/${repoOwner}/teams/${team}/memberships/${approver2}`)
      .reply(200, {
        org: repoOwner,
        team_slug: team,
        username: approver2,
        role: "member",
        state: "active",
      });

    await assertRejects(
      nockScope,
      "This pull request has 1 of 2 required internal approvals.",
    );
  });

  await suite.test("should fail with pending member approval", async () => {
    const { repoOwner, repoName, pullNumber, team } = BASE_PARAMS;
    const prLogin = "pr-owner";
    const approver1 = "approver-1";
    const approver2 = "approver-2";

    const nockScope = nock(GITHUB_API_BASE_URL)
      .get(`/repos/${repoOwner}/${repoName}/pulls/${pullNumber}`)
      .reply(200, {
        owner: repoOwner,
        pull_number: pullNumber,
        repoName,
        user: {
          login: prLogin,
        },
      })
      .get(`/orgs/${repoOwner}/teams/${team}/memberships/${prLogin}`)
      .reply(404)
      .get(`/repos/${repoOwner}/${repoName}/pulls/${pullNumber}/reviews`)
      .reply(200, [
        {
          submitted_at: 1714636800,
          user: {
            login: approver1,
          },
          state: "approved",
        },
        {
          submitted_at: 1714636801,
          user: {
            login: approver2,
          },
          state: "approved",
        },
      ])
      .get(`/orgs/${repoOwner}/teams/${team}/memberships/${approver1}`)
      .reply(200, {
        org: repoOwner,
        team_slug: team,
        username: approver1,
        role: "member",
        state: "active",
      })
      .get(`/orgs/${repoOwner}/teams/${team}/memberships/${approver2}`)
      .reply(200, {
        org: repoOwner,
        team_slug: team,
        username: approver2,
        role: "member",
        state: "pending",
      });

    await assertRejects(
      nockScope,
      "This pull request has 1 of 2 required internal approvals.",
    );
  });

  await suite.test(
    "should re-run most recent failed run on PR reviews",
    async () => {
      const { repoOwner, repoName, pullNumber, team, branch, runId } =
        BASE_PARAMS;
      const eventName = "pull_request_review";
      const prLogin = "pr-owner";
      const approver1 = "approver-1";
      const approver2 = "approver-2";
      const workflowId = 37;
      const failedRunId = 827;

      const nockScope = nock(GITHUB_API_BASE_URL)
        .get(`/repos/${repoOwner}/${repoName}/pulls/${pullNumber}`)
        .reply(200, {
          owner: repoOwner,
          pull_number: pullNumber,
          repoName,
          user: {
            login: prLogin,
          },
        })
        .get(`/orgs/${repoOwner}/teams/${team}/memberships/${prLogin}`)
        .reply(404)
        .get(`/repos/${repoOwner}/${repoName}/pulls/${pullNumber}/reviews`)
        .reply(200, [
          {
            submitted_at: 1714636800,
            user: {
              login: approver1,
            },
            state: "approved",
          },
          {
            submitted_at: 1714636801,
            user: {
              login: approver2,
            },
            state: "approved",
          },
        ])
        .get(`/orgs/${repoOwner}/teams/${team}/memberships/${approver1}`)
        .reply(200, {
          org: repoOwner,
          team_slug: team,
          username: approver1,
          role: "member",
          state: "active",
        })
        .get(`/orgs/${repoOwner}/teams/${team}/memberships/${approver2}`)
        .reply(200, {
          org: repoOwner,
          team_slug: team,
          username: approver2,
          role: "member",
          state: "active",
        })
        .get(`/repos/${repoOwner}/${repoName}/actions/runs/${runId}`)
        .reply(200, {
          workflow_id: workflowId,
        })
        .get(
          `/repos/${repoOwner}/${repoName}/actions/workflows/${workflowId}/runs`,
        )
        .query({
          branch,
          event: "pull_request",
          status: "failure",
          per_page: 100,
        })
        .reply(200, [
          {
            id: 12,
            pull_requests: [
              {
                number: pullNumber,
              },
            ],
            run_started_at: "2024-05-02T10:00:00Z",
          },
          {
            id: failedRunId,
            pull_requests: [
              {
                number: pullNumber,
              },
            ],
            run_started_at: "2024-05-02T12:00:00Z",
          },
          {
            id: 21,
            pull_requests: [
              {
                number: pullNumber,
              },
            ],
            run_started_at: "2024-05-02T11:00:00Z",
          },
        ])
        .post(
          `/repos/${repoOwner}/${repoName}/actions/runs/${failedRunId}/rerun`,
        )
        .reply(200, {});

      await assertDoesNotReject(nockScope, { eventName });
    },
  );
});
