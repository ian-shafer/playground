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

import assert from "node:assert/strict";
import { test } from "node:test";
import nock from "nock";
import { MultiApproversAction } from "../src/main";

const GITHUB_API_BASE_URL = "https://api.github.com";

test("#main", { concurrency: true }, async (suite) => {
  suite.beforeEach(async () => {
    nock.cleanAll();
  });

  /*
  await suite.test("should fail on unsupported event", async (t) => {
    const inputs = {
      team: "fake-team",
      token: "fake-token",
    };
    const core = getFakeCore(inputs);
    const setFailed = t.mock.method(core, "setFailed", () => {});
    const context = {
      eventName: "push",
      runId: 1,
      payload: {
        pull_request: {
          number: 1,
          head: {
            ref: "fake-branch",
          },
        },
        repository: {
          name: "fake-repository",
          owner: {
            login: "test-org",
          },
        },
      },
    } as unknown as Context;

    await main(core, context);

    assert.equal(setFailed.mock.calls.length, 1);
    const failMsg = setFailed.mock.calls[0].arguments[0];
    assert.equal(
      failMsg,
      "Multi-approvers action failed: unexpected event [push]. Supported events are pull_request, pull_request_review",
    );
  });

  await suite.test("fails when no inputs are set", async (t) => {
    const inputs = {};
    const core = getFakeCore(inputs);
    const setFailed = t.mock.method(core, "setFailed", () => {});
    const context = {
      eventName: "pull_request",
      runId: 1,
      payload: {
        pull_request: {
          number: 1,
          head: {
            ref: "fake-branch",
          },
        },
        repository: {
          name: "fake-repository",
          owner: {
            login: "test-org",
          },
        },
      },
    } as unknown as Context;

    await main(core, context);

    assert.equal(setFailed.mock.calls.length, 1);
    const failMsg = setFailed.mock.calls[0].arguments[0];
    assert.equal(
      failMsg,
      "Multi-approvers action failed: invalid input(s): token is required; team is required",
    );
  });

  await suite.test("fails when token input is not set", async (t) => {
    const inputs = {
      team: "fake-team",
    };
    const core = getFakeCore(inputs);
    const setFailed = t.mock.method(core, "setFailed", () => {});
    const context = {
      eventName: "pull_request",
      runId: 1,
      payload: {
        pull_request: {
          number: 1,
          head: {
            ref: "fake-branch",
          },
        },
        repository: {
          name: "fake-repository",
          owner: {
            login: "test-org",
          },
        },
      },
    } as unknown as Context;

    await main(core, context);

    assert.equal(setFailed.mock.calls.length, 1);
    const failMsg = setFailed.mock.calls[0].arguments[0];
    assert.equal(
      failMsg,
      "Multi-approvers action failed: invalid input(s): token is required",
    );
  });

  await suite.test("fails when team input is not set", async (t) => {
    const inputs = {
      token: "fake-token",
    };
    const core = getFakeCore(inputs);
    const setFailed = t.mock.method(core, "setFailed", () => {});
    const context = {
      eventName: "pull_request",
      runId: 1,
      payload: {
        pull_request: {
          number: 1,
          head: {
            ref: "fake-branch",
          },
        },
        repository: {
          name: "fake-repository",
          owner: {
            login: "test-org",
          },
        },
      },
    } as unknown as Context;

    await main(core, context);

    assert.equal(setFailed.mock.calls.length, 1);
    const failMsg = setFailed.mock.calls[0].arguments[0];
    assert.equal(
      failMsg,
      "Multi-approvers action failed: invalid input(s): team is required",
    );
  });
  */

  await suite.test("should ignore PRs from internal users", async () => {
    const eventName = "pull_request";
    const org = "acme";
    const repoName = "anvils";
    const pullNumber = 12;
    const team = "hunters";
    const prLogin = "wile-e-coyote";

    nock(GITHUB_API_BASE_URL)
      .get(`/repos/${org}/${repoName}/pulls/${pullNumber}`)
      .reply(200, {
        owner: org,
        pull_number: pullNumber,
        repoName,
        user: {
          login: prLogin,
        },
      })
      .get(`/orgs/${org}/teams/${team}/memberships/${prLogin}`)
      .reply(200, {
        org,
        team_slug: team,
        username: prLogin,
        role: "member",
        state: "active",
      });

    const multiApproversAction = new MultiApproversAction({
      eventName,
      runId: 1,
      branch: "twig",
      pullNumber,
      repoName,
      repoOwner: org,
      token: "fake-token",
      team,
      octokitOptions: { request: fetch },
      logDebug: (msg: string) => {},
      logInfo: (msg: string) => {},
    });

    await assert.doesNotReject(
      async () => await multiApproversAction.validate(),
    );
  });

  await suite.test(
    "should reject PRs from external users and no internal approvals",
    async () => {
      const eventName = "pull_request";
      const org = "acme";
      const repoName = "anvils";
      const pullNumber = 12;
      const prLogin = "wile-e-coyote";
      const team = "hunters";

      nock(GITHUB_API_BASE_URL)
        .get(`/repos/${org}/${repoName}/pulls/${pullNumber}`)
        .reply(200, {
          owner: org,
          pull_number: pullNumber,
          repoName,
          user: {
            login: prLogin,
          },
        })
        .get(`/orgs/${org}/teams/${team}/memberships/${prLogin}`)
        .reply(404)
        .get(`/repos/${org}/${repoName}/pulls/${pullNumber}/reviews`)
        .reply(200, []);

      const multiApproversAction = new MultiApproversAction({
        eventName,
        runId: 12,
        branch: "twig",
        pullNumber,
        repoName,
        repoOwner: org,
        token: "fake-token",
        team,
        octokitOptions: { request: fetch },
        logDebug: (msg: string) => {},
        logInfo: (msg: string) => {},
      });

      await assert.rejects(async () => await multiApproversAction.validate(), {
        name: "Error",
        message: "This pull request has 0 of 2 required internal approvals.",
      });
    },
  );

  await suite.test(
    "should succeed for PRs from external users and 2 internal approvals",
    async () => {
      const eventName = "pull_request";
      const org = "test-org";
      const repoName = "test-repo";
      const pullNumber = 1;
      const prLogin = "pr-owner";
      const team = "test-team";
      const approver1 = "approver-1";
      const approver2 = "approver-2";

      nock(GITHUB_API_BASE_URL)
        .get(`/repos/${org}/${repoName}/pulls/${pullNumber}`)
        .reply(200, {
          owner: org,
          pull_number: pullNumber,
          repoName: repoName,
          user: {
            login: prLogin,
          },
        })
        .get(`/orgs/${org}/teams/${team}/memberships/${prLogin}`)
        .reply(404)
        .get(`/repos/${org}/${repoName}/pulls/${pullNumber}/reviews`)
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
        .get(`/orgs/${org}/teams/${team}/memberships/${approver1}`)
        .reply(200, {
          org,
          team_slug: team,
          username: approver1,
          role: "member",
          state: "active",
        })
        .get(`/orgs/${org}/teams/${team}/memberships/${approver2}`)
        .reply(200, {
          org,
          team_slug: team,
          username: approver2,
          role: "member",
          state: "active",
        });

      const multiApproversAction = new MultiApproversAction({
        eventName,
        runId: 12,
        branch: "twig",
        pullNumber,
        repoName,
        repoOwner: org,
        token: "fake-token",
        team,
        octokitOptions: { request: fetch },
        logDebug: (msg: string) => {},
        logInfo: (msg: string) => {},
      });

      await assert.doesNotReject(
        async () => await multiApproversAction.validate(),
      );
    },
  );

  await suite.test("should ignore PR review comments", async () => {
    const eventName = "pull_request";
    const org = "test-org";
    const repoName = "test-repo";
    const pullNumber = 1;
    const prLogin = "pr-owner";
    const team = "test-team";
    const approver1 = "approver-1";
    const approver2 = "approver-2";

    nock(GITHUB_API_BASE_URL)
      .get(`/repos/${org}/${repoName}/pulls/${pullNumber}`)
      .reply(200, {
        owner: org,
        pull_number: pullNumber,
        repoName,
        user: {
          login: prLogin,
        },
      })
      .get(`/orgs/${org}/teams/${team}/memberships/${prLogin}`)
      .reply(404)
      .get(`/repos/${org}/${repoName}/pulls/${pullNumber}/reviews`)
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
      .get(`/orgs/${org}/teams/${team}/memberships/${approver1}`)
      .reply(200, {
        org,
        team_slug: team,
        username: approver1,
        role: "member",
        state: "active",
      })
      .get(`/orgs/${org}/teams/${team}/memberships/${approver2}`)
      .reply(200, {
        org,
        team_slug: team,
        username: approver2,
        role: "member",
        state: "active",
      });

    const multiApproversAction = new MultiApproversAction({
      eventName,
      runId: 12,
      branch: "twig",
      pullNumber,
      repoName,
      repoOwner: org,
      token: "fake-token",
      team,
      octokitOptions: { request: fetch },
      logDebug: (msg: string) => {},
      logInfo: (msg: string) => {},
    });

    await assert.rejects(async () => await multiApproversAction.validate(), {
      name: "Error",
      message: "This pull request has 1 of 2 required internal approvals.",
    });
  });

  await suite.test("should handle rescinded approval", async () => {
    const eventName = "pull_request";
    const org = "test-org";
    const repoName = "test-repo";
    const pullNumber = 1;
    const prLogin = "pr-owner";
    const team = "test-team";
    const approver1 = "approver-1";
    const approver2 = "approver-2";

    nock(GITHUB_API_BASE_URL)
      .get(`/repos/${org}/${repoName}/pulls/${pullNumber}`)
      .reply(200, {
        owner: org,
        pull_number: pullNumber,
        repoName,
        user: {
          login: prLogin,
        },
      })
      .get(`/orgs/${org}/teams/${team}/memberships/${prLogin}`)
      .reply(404)
      .get(`/repos/${org}/${repoName}/pulls/${pullNumber}/reviews`)
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
      .get(`/orgs/${org}/teams/${team}/memberships/${approver1}`)
      .reply(200, {
        org,
        team_slug: team,
        username: approver1,
        role: "member",
        state: "active",
      })
      .get(`/orgs/${org}/teams/${team}/memberships/${approver2}`)
      .reply(200, {
        org,
        team_slug: team,
        username: approver2,
        role: "member",
        state: "active",
      })
      .get(`/orgs/${org}/teams/${team}/memberships/${approver2}`)
      .reply(200, {
        org,
        team_slug: team,
        username: approver2,
        role: "member",
        state: "active",
      });

    const multiApproversAction = new MultiApproversAction({
      eventName,
      runId: 12,
      branch: "twig",
      pullNumber,
      repoName,
      repoOwner: org,
      token: "fake-token",
      team,
      octokitOptions: { request: fetch },
      logDebug: (msg: string) => {},
      logInfo: (msg: string) => {},
    });

    await assert.rejects(async () => await multiApproversAction.validate(), {
      name: "Error",
      message: "This pull request has 1 of 2 required internal approvals.",
    });
  });

  await suite.test("should fail with pending member approval", async () => {
    const eventName = "pull_request";
    const org = "test-org";
    const repoName = "test-repo";
    const pullNumber = 1;
    const prLogin = "pr-owner";
    const team = "test-team";
    const approver1 = "approver-1";
    const approver2 = "approver-2";

    nock(GITHUB_API_BASE_URL)
      .get(`/repos/${org}/${repoName}/pulls/${pullNumber}`)
      .reply(200, {
        owner: org,
        pull_number: pullNumber,
        repoName,
        user: {
          login: prLogin,
        },
      })
      .get(`/orgs/${org}/teams/${team}/memberships/${prLogin}`)
      .reply(404)
      .get(`/repos/${org}/${repoName}/pulls/${pullNumber}/reviews`)
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
      .get(`/orgs/${org}/teams/${team}/memberships/${approver1}`)
      .reply(200, {
        org,
        team_slug: team,
        username: approver1,
        role: "member",
        state: "active",
      })
      .get(`/orgs/${org}/teams/${team}/memberships/${approver2}`)
      .reply(200, {
        org,
        team_slug: team,
        username: approver2,
        role: "member",
        state: "pending",
      });

    const multiApproversAction = new MultiApproversAction({
      eventName,
      runId: 12,
      branch: "twig",
      pullNumber,
      repoName,
      repoOwner: org,
      token: "fake-token",
      team,
      octokitOptions: { request: fetch },
      logDebug: (msg: string) => {},
      logInfo: (msg: string) => {},
    });

    await assert.rejects(async () => await multiApproversAction.validate(), {
      name: "Error",
      message: "This pull request has 1 of 2 required internal approvals.",
    });
  });

  await suite.test("should re-run failed runs on PR reviews", async () => {
    const eventName = "pull_request_review";
    const org = "test-org";
    const repoName = "test-repo";
    const pullNumber = 1;
    const prLogin = "pr-owner";
    const team = "test-team";
    const approver1 = "approver-1";
    const approver2 = "approver-2";
    const runId = 21;
    const workflowId = 37;
    const failedRunId = 827;
    const branch = "test-branch";

    nock(GITHUB_API_BASE_URL)
      .get(`/repos/${org}/${repoName}/pulls/${pullNumber}`)
      .reply(200, {
        owner: org,
        pull_number: pullNumber,
        repoName,
        user: {
          login: prLogin,
        },
      })
      .get(`/orgs/${org}/teams/${team}/memberships/${prLogin}`)
      .reply(404)
      .get(`/repos/${org}/${repoName}/pulls/${pullNumber}/reviews`)
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
      .get(`/orgs/${org}/teams/${team}/memberships/${approver1}`)
      .reply(200, {
        org,
        team_slug: team,
        username: approver1,
        role: "member",
        state: "active",
      })
      .get(`/orgs/${org}/teams/${team}/memberships/${approver2}`)
      .reply(200, {
        org,
        team_slug: team,
        username: approver2,
        role: "member",
        state: "pending",
      })
      .get(`/repos/${org}/${repoName}/actions/runs/${runId}`)
      .reply(200, {
        workflow_id: workflowId,
      })
      .get(`/repos/${org}/${repoName}/actions/workflows/${workflowId}/runs`)
      .query({
        branch,
        event: "pull_request",
        status: "failure",
        per_page: 100,
      })
      .reply(200, [
        {
          id: failedRunId,
          pull_requests: [
            {
              number: pullNumber,
            },
          ],
        },
      ])
      .post(`/repos/${org}/${repoName}/actions/runs/${failedRunId}/rerun`)
      .reply(200, {});

    const multiApproversAction = new MultiApproversAction({
      eventName,
      runId: 12,
      branch: "twig",
      pullNumber,
      repoName,
      repoOwner: org,
      token: "fake-token",
      team,
      octokitOptions: { request: fetch },
      logDebug: (msg: string) => {},
      logInfo: (msg: string) => {},
    });

    await assert.rejects(async () => await multiApproversAction.validate(), {
      name: "Error",
      message: "This pull request has 1 of 2 required internal approvals.",
    });
  });
});
