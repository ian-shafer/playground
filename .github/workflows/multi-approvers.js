const APPROVED = 'APPROVED';
const COMMENTED = 'COMMENTED';
const MIN_IN_ORG_APPROVAL_COUNT = 2;

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
async function run(orgMembersPath, prNumber, repoName, repoOwner, github, core) {
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

module.exports = async ({orgMembersPath, prNumber, repoName, repoOwner, github, core}) =>
  run(orgMembersPath, prNumber, repoName, repoOwner, github, core);
