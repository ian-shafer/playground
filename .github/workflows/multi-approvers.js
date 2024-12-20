const APPROVED = 'APPROVED';
const COMMENTED = 'COMMENTED';
const MIN_IN_ORG_APPROVAL_COUNT = 1;

/** Returns true if the login exists in the members list. */
function containsLogin(members, login) {
  return !!members.find((member) => member.login === login);
}

/** Returns the number of approvals from members in the given list. */
function inOrgApprovedCount(members, submittedReviews, prLogin) {
  const reviewStateByLogin = {};
  submittedReviews
    // Remove the PR user.
    .filter((r) => r.user.login !== prLogin)
    // Only consider users in the org.
    .filter((r) => containsLogin(members, r.user.login))
    // Sort chronologically ascending. Note that a reviewer can submit multiple reviews.
    .sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at))
    .forEach((r) => {
      const reviewerLogin = r.user.login;

      // Set state if it does not exist.
      if (!Object.hasOwn(reviewStateByLogin, reviewerLogin)) {
        reviewStateByLogin[reviewerLogin] = r.state;
        return;
      }

      // Always update state if not approved.
      if (reviewStateByLogin[reviewerLogin] !== APPROVED) {
        reviewStateByLogin[reviewerLogin] = r.state;
        return;
      }

      // Do not update approved state for a comment.
      if (reviewStateByLogin[reviewerLogin] === APPROVED && r.state !== COMMENTED) {
        reviewStateByLogin[reviewerLogin] = r.state;
      }
    })

  return Object.values(reviewStateByLogin).filter((s) => s === APPROVED).length;
}

/** Checks that approval requirements are satisfied. */
async function onPullRequest({orgMembersPath, prNumber, repoName, repoOwner, github, core}) {
  const members = require(orgMembersPath);
  const prResponse = await github.rest.pulls.get({owner: repoOwner, repo: repoName, pull_number: prNumber});
  const prLogin = prResponse.data.user.login;

  const isOrgMember = containsLogin(members, prLogin);

  if (isOrgMember) {
    // Do nothing if the pull request owner is a member of the org.
    core.info(`Pull request login ${prLogin} is a member of the org, therefore no special approval rules apply.`);
    return;
  }

  const submittedReviews = await github.paginate(github.rest.pulls.listReviews, {
    owner: repoOwner,
    repo: repoName,
    pull_number: prNumber,
  });

  const approvedCount = inOrgApprovedCount(members, submittedReviews, prLogin);

  core.info(`Found ${approvedCount} ${APPROVED} reviews.`);

  if (approvedCount < MIN_IN_ORG_APPROVAL_COUNT) {
    core.setFailed(`This pull request has ${approvedCount} of ${MIN_IN_ORG_APPROVAL_COUNT} required approvals from members of the org.`);
  }
}

async function onPullRequestReview({workflowRef, repoName, repoOwner, branch, prNumber, github, core}) {
  // Get the filename of the workflow.
  const workflowFilename = workflowRef.split('@')[0].split('/').pop();

  core.info(`Args: workflowRef: [${workflowRef}], repoName: [${repoName}], repoOwner: [${repoOwner}], branch: [${branch}], prNumber: [${prNumber}]`);

  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    owner: repoOwner,
    repo: repoName,
    workflow_id: workflowFilename,
    branch,
    event: 'pull_request',
    status: 'failure',
    per_page: 100,
  });

  core.info(`Found workflow runs: ${JSON.stringify(runs)}`);

  const failedRuns = runs
    .filter((r) =>
      r.pull_requests.map((pr) => pr.number).includes(prNumber)
    )
    .sort((v) => v.id);

  core.info(`Failed workflow runs: ${JSON.stringify(failedRuns)}`);

  if (failedRuns.length > 0) {
    await github.rest.actions.reRunWorkflow({
      owner: repoOwner,
      repo: repoName,
      run_id: failedRuns[0].id,
    });
  }
}

module.exports = {onPullRequest, onPullRequestReview};
