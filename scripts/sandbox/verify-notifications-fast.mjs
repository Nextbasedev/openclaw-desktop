#!/usr/bin/env node

import process from "node:process";

function parseArgs(argv) {
  const options = { host: "127.0.0.1", port: 3000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;
    if (key === "host") options.host = value;
    else if (key === "port") options.port = Number(value);
    else throw new Error(`Unknown option: --${key}`);
  }
  return options;
}

async function ipc(baseUrl, command, input = {}) {
  const response = await fetch(`${baseUrl}/api/ipc/${command}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-jarvis-fixture": "1",
    },
    body: JSON.stringify({ input }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${command} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const { host, port } = parseArgs(process.argv.slice(2));
  const baseUrl = `http://${host}:${port}`;
  const checks = [];

  await ipc(baseUrl, "middleware_cron_reset_fixtures");
  checks.push("fixtures:reset");

  const route = await fetch(`${baseUrl}/notifications`);
  assert(route.ok, `/notifications returned ${route.status}`);
  checks.push("route:/notifications");

  const jobsResult = await ipc(baseUrl, "middleware_cron_list_jobs");
  assert(Array.isArray(jobsResult.jobs), "cron jobs response is missing jobs[]");
  assert(jobsResult.jobs.length > 0, "cron jobs fixture returned no rows");
  const firstJob = jobsResult.jobs[0];
  assert(firstJob.jobId && firstJob.name, "cron job row is missing id/name");
  checks.push(`jobs:${jobsResult.jobs.length}`);

  const updatedJobName = `${firstJob.name} edited`;
  await ipc(baseUrl, "middleware_cron_update_job", {
    jobId: firstJob.jobId,
    name: updatedJobName,
    scheduleType: "every",
    schedule: "45m",
    timezone: "UTC",
    model: "fixture/gpt-review",
    deliveryMode: "webhook",
    deliveryChannel: "webhook",
    deliveryTo: "https://fixture.local/cron-hook",
  });
  const updatedJobsResult = await ipc(baseUrl, "middleware_cron_list_jobs");
  const updatedJob = updatedJobsResult.jobs.find(
    (job) => job.jobId === firstJob.jobId,
  );
  assert(updatedJob?.name === updatedJobName, "cron edit did not save name");
  assert(updatedJob?.schedule === "45m", "cron edit did not save schedule");
  assert(updatedJob?.scheduleType === "every", "cron edit did not save schedule type");
  assert(updatedJob?.timezone === "UTC", "cron edit did not save timezone");
  assert(updatedJob?.model === "fixture/gpt-review", "cron edit did not save model");
  assert(updatedJob?.deliveryMode === "webhook", "cron edit did not save delivery mode");
  assert(updatedJob?.deliveryChannel === "webhook", "cron edit did not save delivery channel");
  assert(
    updatedJob?.deliveryTo === "https://fixture.local/cron-hook",
    "cron edit did not save delivery target",
  );
  checks.push("edit:schedule-model-delivery");

  const projectsResult = await ipc(baseUrl, "middleware_projects_list");
  assert(
    Array.isArray(projectsResult.projects),
    "projects fixture is missing projects[]",
  );
  checks.push("projects:fixture");

  const runNowResult = await ipc(baseUrl, "middleware_cron_run_job", {
    jobId: firstJob.jobId,
  });
  assert(runNowResult.queued === true, "run now did not report queued=true");
  assert(
    runNowResult.run?.status === "running",
    "run now did not return a running fixture run",
  );
  checks.push("run-now:running");

  const pausedResult = await ipc(baseUrl, "middleware_cron_pause_job", {
    jobId: firstJob.jobId,
    paused: true,
  });
  assert(pausedResult.paused === true, "pause did not report paused=true");
  const pausedJobs = await ipc(baseUrl, "middleware_cron_list_jobs");
  assert(
    pausedJobs.jobs.find((job) => job.jobId === firstJob.jobId)?.paused === true,
    "paused state did not persist in fixture jobs",
  );
  checks.push("pause:persisted");

  await ipc(baseUrl, "middleware_cron_pause_job", {
    jobId: firstJob.jobId,
    paused: false,
  });
  const resumedJobs = await ipc(baseUrl, "middleware_cron_list_jobs");
  assert(
    resumedJobs.jobs.find((job) => job.jobId === firstJob.jobId)?.enabled === true,
    "resume state did not persist in fixture jobs",
  );
  checks.push("resume:persisted");

  const activityResult = await ipc(baseUrl, "middleware_cron_recent_activity", {
    limit: 5,
  });
  assert(
    Array.isArray(activityResult.events),
    "cron activity response is missing events[]",
  );
  assert(activityResult.events.length > 0, "cron activity fixture returned no rows");
  const runningEvent = activityResult.events.find(
    (event) => event.jobId === firstJob.jobId && event.status === "running",
  );
  assert(
    runningEvent?.type === "cron.run.started",
    "running cron event was not reported as started",
  );
  checks.push(`activity:${activityResult.events.length}`);

  const runsResult = await ipc(baseUrl, "middleware_cron_list_runs", {
    jobId: firstJob.jobId,
    limit: 5,
  });
  assert(Array.isArray(runsResult.runs), "cron runs response is missing runs[]");
  assert(runsResult.runs.length > 0, "cron runs fixture returned no rows");
  checks.push(`runs:${runsResult.runs.length}`);

  const conversationResult = await ipc(
    baseUrl,
    "middleware_cron_job_conversation",
    { jobId: firstJob.jobId },
  );
  assert(
    Array.isArray(conversationResult.messages),
    "cron conversation response is missing messages[]",
  );
  assert(
    conversationResult.messages.length > 0,
    "cron conversation fixture returned no messages",
  );
  checks.push(`conversation:${conversationResult.messages.length}`);

  const createdChat = await ipc(baseUrl, "middleware_chats_create", {
    name: firstJob.name,
    sessionKey: conversationResult.sessionKey,
  });
  assert(
    createdChat.chat?.sessionKey === conversationResult.sessionKey,
    "created chat did not preserve cron conversation session key",
  );
  const historyResult = await ipc(baseUrl, "middleware_chat_history", {
    sessionKey: createdChat.chat.sessionKey,
  });
  assert(
    Array.isArray(historyResult.messages) && historyResult.messages.length > 0,
    "chat history fixture returned no messages",
  );
  const branchResult = await ipc(baseUrl, "middleware_branch_list", {
    sourceSessionKey: createdChat.chat.sessionKey,
  });
  assert(
    Array.isArray(branchResult.branches),
    "branch list fixture is missing branches[]",
  );
  checks.push("chat-history:loaded");

  const chatStream = await fetch(
    `${baseUrl}/api/stream/chat/${createdChat.chat.sessionKey}`,
  );
  assert(chatStream.ok, `/api/stream/chat returned ${chatStream.status}`);
  assert(
    chatStream.headers.get("content-type")?.includes("text/event-stream"),
    "chat stream is not text/event-stream",
  );
  await chatStream.body?.cancel();
  checks.push("stream:chat");

  const ptyResult = await ipc(baseUrl, "middleware_pty_spawn", {
    rows: 24,
    cols: 80,
  });
  assert(ptyResult.ptyId, "pty fixture did not return ptyId");
  const ptyStream = await fetch(`${baseUrl}/api/stream/pty/${ptyResult.ptyId}`);
  assert(ptyStream.ok, `/api/stream/pty returned ${ptyStream.status}`);
  assert(
    ptyStream.headers.get("content-type")?.includes("text/event-stream"),
    "pty stream is not text/event-stream",
  );
  await ptyStream.body?.cancel();
  await ipc(baseUrl, "middleware_pty_kill", { ptyId: ptyResult.ptyId });
  checks.push("pty:fixture");

  const stream = await fetch(`${baseUrl}/api/stream/cron`);
  assert(stream.ok, `/api/stream/cron returned ${stream.status}`);
  assert(
    stream.headers.get("content-type")?.includes("text/event-stream"),
    "cron stream is not text/event-stream",
  );
  await stream.body?.cancel();
  checks.push("stream:cron");

  await ipc(baseUrl, "middleware_cron_reset_fixtures");
  checks.push("fixtures:restored");

  console.log(`notifications fast smoke passed (${checks.join(", ")})`);
}

main().catch((error) => {
  console.error(`notifications fast smoke failed: ${error.message}`);
  process.exit(1);
});
