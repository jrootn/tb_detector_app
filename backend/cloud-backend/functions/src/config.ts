function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const CFG = {
  projectId: required("GCLOUD_PROJECT"),
  region: process.env.FUNCTION_REGION || "asia-south1",
  queueRegion: process.env.TASKS_REGION || "asia-south1",
  queueName: process.env.INFERENCE_QUEUE_NAME || "tb-inference-queue",
  inferenceUrl: required("INFERENCE_URL"),
  tasksInvokerServiceAccount: required("TASKS_INVOKER_SERVICE_ACCOUNT"),
  targetModelVersion: process.env.TARGET_MODEL_VERSION || "medgemma-4b-it-v1",
};
