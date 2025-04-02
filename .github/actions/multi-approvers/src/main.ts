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

import { context as gitHubContext, getOctokit } from "@actions/github";
import * as actionsCore from "@actions/core";
import { RestEndpointMethodTypes } from "@octokit/rest";
import { OctokitOptions } from "@octokit/core";
import { RequestError } from "@octokit/request-error";

type PullRequestReview =
  RestEndpointMethodTypes["pulls"]["listReviews"]["response"]["data"];
type Context = typeof gitHubContext;
type Octokit = ReturnType<typeof getOctokit>;
type Core = typeof actionsCore;

const MIN_APPROVED_COUNT = 2;
const APPROVED = "approved";
const COMMENTED = "commented";
const PULL_REQUEST_REVIEW = "pull_request_review";
const PULL_REQUEST = "pull_request";
const SUPPORTED_EVENTS = new Set<string>([PULL_REQUEST, PULL_REQUEST_REVIEW]);

/** Members backed by a GitHub team. */
class TeamMembers {
  private static readonly ALLOWED_ROLES = new Set<string>([
    "maintainer",
    "member",
  ]);
  private static readonly ACTIVE = "active";

  private readonly org: string;
  private readonly teamSlug: string;
  private readonly core: Core;
  private readonly octokit: Octokit;

  constructor(org: string, teamSlug: string, core: Core, octokit: Octokit) {
    this.org = org;
    this.teamSlug = teamSlug;
    this.core = core;
    this.octokit = octokit;
  }

  private hasStatus(err: unknown, status: number): boolean {
    if (!err) {
      return false;
    }
    if (typeof err !== "object") {
      return false;
    }
    if (!Object.prototype.hasOwnProperty.call(err, "status")) {
      return false;
    }
    const v: any = (err as any).status;
    if (typeof v !== "number") {
      return false;
    }
    return v === status;
  }

  async contains(login: string): Promise<boolean> {
    try {
      const response = await this.octokit.rest.teams.getMembershipForUserInOrg({
        org: this.org,
        team_slug: this.teamSlug,
        username: login,
      });
      return (
        TeamMembers.ALLOWED_ROLES.has(response.data.role) &&
        response.data.state === TeamMembers.ACTIVE
      );
    } catch (err) {
      if (
        (err instanceof RequestError && err.status === 404) ||
        this.hasStatus(err, 404)
      ) {
        this.core.debug(
          `Received 404 testing membership; assuming user is not a member: ${JSON.stringify(
            err,
          )}`,
        );
        // We can get here for a few known reasons:
        // 1) The user is not a member
        // 2) The team does not exist
        // 3) Invalid token
        // In all these cases, it's safe to return false.
        return false;
      }
      throw err;
    }
  }

  /** Returns the number of approvals from members in the given list. */
  async approvedCount(
    submittedReviews: PullRequestReview,
    prLogin: string,
  ): Promise<number> {
    // Sort by chronological order.
    const sortedReviews = submittedReviews.sort(
      (a, b) =>
        new Date(a.submitted_at || 0).getTime() -
        new Date(b.submitted_at || 0).getTime(),
    );
    const reviewStateByLogin = new Map<string, string>();

    for (const r of sortedReviews) {
      const reviewerLogin = r.user!.login;

      // Ignore the PR user.
      if (reviewerLogin === prLogin) {
        continue;
      }

      // Only consider internal users.
      const isInternalUser = await this.contains(reviewerLogin);
      if (!isInternalUser) {
        continue;
      }

      // Set state if it does not exist.
      if (!reviewStateByLogin.has(reviewerLogin)) {
        reviewStateByLogin.set(reviewerLogin, r.state);
        continue;
      }

      // Always update state if not approved.
      if (reviewStateByLogin.get(reviewerLogin) !== APPROVED) {
        reviewStateByLogin.set(reviewerLogin, r.state);
        continue;
      }

      // Do not update approved state for a comment.
      if (
        reviewStateByLogin.get(reviewerLogin) === APPROVED &&
        r.state !== COMMENTED
      ) {
        reviewStateByLogin.set(reviewerLogin, r.state);
        continue;
      }
    }

    return Array.from(reviewStateByLogin.values()).filter((s) => s === APPROVED)
      .length;
  }
}

/** Checks that approval requirements are satisfied. */
async function validateApprovers(
  team: string,
  prNumber: number,
  repoName: string,
  repoOwner: string,
  core: Core,
  octokit: Octokit,
) {
  const members = new TeamMembers(repoOwner, team, core, octokit);
  const prResponse = await octokit.rest.pulls.get({
    owner: repoOwner,
    repo: repoName,
    pull_number: prNumber,
  });
  const prLogin = prResponse.data.user.login;

  const isInternalPr = await members.contains(prLogin);
  if (isInternalPr) {
    // Do nothing if the pull request owner is an internal user.
    core.info(
      `Pull request login ${
        prLogin
      } is an internal member, therefore no special approval rules apply.`,
    );
    return;
  }
  const submittedReviews: PullRequestReview = await octokit.paginate(
    octokit.rest.pulls.listReviews,
    {
      owner: repoOwner,
      repo: repoName,
      pull_number: prNumber,
    },
  );

  const approvedCount = await members.approvedCount(submittedReviews, prLogin);

  core.info(`Found ${approvedCount} ${APPROVED} internal reviews.`);

  if (approvedCount < MIN_APPROVED_COUNT) {
    core.setFailed(
      `This pull request has ${approvedCount} of ${
        MIN_APPROVED_COUNT
      } required internal approvals.`,
    );
  }
}

/**
 * Re-runs the approval checks on pull request review.
 *
 * This is required because GitHub treats checks made by pull_request and
 * pull_request_review as different status checks.
 */
async function revalidateApprovers(
  workflowId: number,
  repoName: string,
  repoOwner: string,
  branch: string,
  prNumber: number,
  octokit: Octokit,
) {
  // Get all failed runs.
  const runs = await octokit.paginate(octokit.rest.actions.listWorkflowRuns, {
    owner: repoOwner,
    repo: repoName,
    workflow_id: workflowId,
    branch,
    event: "pull_request",
    status: "failure",
    per_page: 100,
  });

  const failedRuns = runs
    .filter((r) =>
      (r.pull_requests || []).map((pr) => pr.number).includes(prNumber),
    )
    .sort((v) => v.id);

  // If there are failed runs for this PR, re-run the workflow.
  if (failedRuns.length > 0) {
    await octokit.rest.actions.reRunWorkflow({
      owner: repoOwner,
      repo: repoName,
      run_id: failedRuns[0].id,
    });
  }
}

async function getWorkflowId(
  octokit: Octokit,
  repoOwner: string,
  repoName: string,
  runId: number,
): Promise<number> {
  const response = await octokit.rest.actions.getWorkflowRun({
    owner: repoOwner,
    repo: repoName,
    run_id: runId,
  });
  return response.data.workflow_id;
}

function validateInputs(token?: string, team?: string) {
  const errors = [];
  if (!token) {
    errors.push("token is required");
  }
  if (!team) {
    errors.push("team is required");
  }
  if (errors.length > 0) {
    throw new Error(`Invalid input(s): ${errors.join("; ")}`);
  }
}

function validateEvent(eventName: string) {
  if (!SUPPORTED_EVENTS.has(eventName)) {
    throw new Error(
      `Unexpected event [${eventName}]. Supported events are ${[
        ...SUPPORTED_EVENTS,
      ].join(", ")}`,
    );
  }
}

export async function main(
  core: Core,
  context: Context,
  octokitOptions?: OctokitOptions,
) {
  try {
    const eventName = context.eventName;
    const runId = context.runId;
    const payload = context.payload;
    const branch = payload.pull_request!.head.ref;
    const prNumber = payload.pull_request!.number;
    const repoName = payload.repository!.name;
    const repoOwner = payload.repository!.owner.login;
    const token = core.getInput("token");
    const team = core.getInput("team");

    validateEvent(eventName);
    validateInputs(token, team);

    const octokit = getOctokit(token, octokitOptions);

    await validateApprovers(team, prNumber, repoName, repoOwner, core, octokit);

    // If this action was triggered by a review, we want to re-run for previous
    // failed runs.
    if (eventName === PULL_REQUEST_REVIEW) {
      const workflowId = await getWorkflowId(
        octokit,
        repoOwner,
        repoName,
        runId,
      );
      await revalidateApprovers(
        workflowId,
        repoName,
        repoOwner,
        branch,
        prNumber,
        octokit,
      );
    }
  } catch (err) {
    core.debug(JSON.stringify(err));

    let msg: string;
    if (typeof err === 'string') {
      msg = err;
    } else if (err instanceof Error) {
      msg = err.message;
    } else {
      msg = String(`[${typeof err}] ${err}`);
    }
    core.setFailed(`Multi-approvers action failed: ${msg}`);
  }
}
