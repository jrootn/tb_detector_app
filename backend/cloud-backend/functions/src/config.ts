export type TriggerConfig = {
  projectId: string;
  region: string;
  queueRegion: string;
  queueName: string;
  inferenceUrl: string;
  tasksInvokerServiceAccount: string;
  targetModelVersion: string;
};

function env(name: string): string {
  return process.env[name]?.trim() || "";
}

function projectIdFromFirebaseConfig(): string {
  const raw = process.env.FIREBASE_CONFIG;
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { projectId?: string; project_id?: string };
    return (parsed.projectId || parsed.project_id || "").trim();
  } catch {
    return "";
  }
}

export const CFG: TriggerConfig = {
  // Avoid import-time crashes during firebase deploy code analysis.
  // Runtime validation happens before task enqueue.
  projectId: env("APP_PROJECT_ID") || env("GCLOUD_PROJECT") || env("GOOGLE_CLOUD_PROJECT") || projectIdFromFirebaseConfig(),
  region: env("APP_FUNCTION_REGION") || env("FUNCTION_REGION") || "us-east4",
  queueRegion: env("TASKS_REGION") || "us-east4",
  queueName: env("INFERENCE_QUEUE_NAME") || "tb-inference-queue",
  inferenceUrl: env("INFERENCE_URL"),
  tasksInvokerServiceAccount: env("TASKS_INVOKER_SERVICE_ACCOUNT"),
  targetModelVersion: env("TARGET_MODEL_VERSION") || "medgemma-4b-it-v1",
};

export function validateEnqueueConfig(cfg: TriggerConfig): void {
  const missing: string[] = [];
  if (!cfg.projectId) missing.push("APP_PROJECT_ID/GCLOUD_PROJECT");
  if (!cfg.inferenceUrl) missing.push("INFERENCE_URL");
  if (!cfg.tasksInvokerServiceAccount) missing.push("TASKS_INVOKER_SERVICE_ACCOUNT");

  if (missing.length > 0) {
    throw new Error(`Missing required runtime env var(s): ${missing.join(", ")}`);
  }
}
