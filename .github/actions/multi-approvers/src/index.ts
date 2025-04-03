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

import * as ghCore from "@actions/core";
import { context as ghContext } from "@actions/github";
import { errorMessage } from "@google-github-actions/actions-utils";
import { EventName, isEventName, MultiApproversAction } from "./main";

type Core = typeof ghCore;
type Context = typeof ghContext;

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

function validateEvent(rawEventName: string): EventName {
  if (isEventName(rawEventName)) {
    return rawEventName as EventName;
  }
  throw new Error(`Unexpected event [${rawEventName}].`);
}

export async function main(core: Core = ghCore, context: Context = ghContext) {
  try {
    const payload = context.payload;
    const token = core.getInput("token");
    const team = core.getInput("team");
    const rawEventName = context.eventName;

    const eventName = validateEvent(rawEventName);
    validateInputs(token, team);

    const multiApproversAction = new MultiApproversAction({
      eventName,
      runId: context.runId,
      branch: payload.pull_request!.head.ref,
      pullNumber: payload.pull_request!.number,
      repoName: payload.repository!.name,
      repoOwner: payload.repository!.owner.login,
      token,
      team,
      logDebug: core.debug,
      logInfo: core.info,
    });

    multiApproversAction.validate();
  } catch (err) {
    core.debug(JSON.stringify(err));
    core.setFailed(`Multi-approvers action failed: ${errorMessage(err)}`);
  }
}
