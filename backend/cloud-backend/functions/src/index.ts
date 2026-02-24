import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";

import { CFG } from "./config";
import { enqueueInferenceTask } from "./enqueue";
import { AnyDoc, shouldEnqueue } from "./guards";

export const onPatientWriteEnqueueInference = onDocumentWritten(
  {
    document: "patients/{patientId}",
    region: CFG.region,
    retry: false,
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (event) => {
    const patientId = event.params.patientId;
    const before = event.data?.before?.data() as AnyDoc | undefined;
    const after = event.data?.after?.data() as AnyDoc | undefined;

    const decision = shouldEnqueue(before, after, CFG.targetModelVersion);

    logger.info("inference_enqueue_decision", {
      patientId,
      decision,
      targetModelVersion: CFG.targetModelVersion,
    });

    if (!decision.enqueue) return;

    const writeTime = event.data?.after?.updateTime?.toDate?.().toISOString?.() ?? undefined;

    const result = await enqueueInferenceTask(patientId, writeTime);

    logger.info("inference_task_enqueued", {
      patientId,
      enqueued: result.created,
      duplicate: !!(result as { duplicate?: boolean }).duplicate,
      targetModelVersion: CFG.targetModelVersion,
    });
  }
);
