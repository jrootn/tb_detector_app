import { CloudTasksClient } from "@google-cloud/tasks";
import { CFG, validateEnqueueConfig } from "./config";

const client = new CloudTasksClient();

function safeTaskId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 490);
}

function taskWriteToken(writeTime?: string): string {
  if (writeTime && writeTime.trim()) {
    return writeTime.replace(/[^A-Za-z0-9]/g, "").slice(-20);
  }
  return Date.now().toString();
}

export async function enqueueInferenceTask(patientId: string, writeTime?: string) {
  validateEnqueueConfig(CFG);

  const parent = client.queuePath(CFG.projectId, CFG.queueRegion, CFG.queueName);

  const payload = {
    patient_id: patientId,
    target_model_version: CFG.targetModelVersion,
    source_write_time: writeTime || null,
  };

  // Include source write time to avoid Cloud Tasks name dedup collisions on requeue.
  const taskId = safeTaskId(`${patientId}-${CFG.targetModelVersion}-${taskWriteToken(writeTime)}`);
  const taskName = `${parent}/tasks/${taskId}`;

  const task = {
    name: taskName,
    httpRequest: {
      httpMethod: "POST" as const,
      url: CFG.inferenceUrl,
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(JSON.stringify(payload)).toString("base64"),
      oidcToken: {
        serviceAccountEmail: CFG.tasksInvokerServiceAccount,
        audience: CFG.inferenceUrl,
      },
    },
  };

  try {
    const [resp] = await client.createTask({ parent, task });
    return { created: true, name: resp.name };
  } catch (err: unknown) {
    const e = err as { code?: number };
    // 6 = ALREADY_EXISTS
    if (e?.code === 6) {
      return { created: false, duplicate: true };
    }
    throw err;
  }
}
