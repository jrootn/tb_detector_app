export type AnyDoc = Record<string, unknown>;

function hasAudio(doc: AnyDoc): boolean {
  const audio = doc?.audio;
  if (!Array.isArray(audio)) return false;

  return audio.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const e = entry as Record<string, unknown>;
    const uri = e.storage_uri;
    const path = e.storage_path;
    const hasUri = typeof uri === "string" && uri.trim().length > 0;
    const hasPath = typeof path === "string" && path.trim().length > 0;
    return hasUri || hasPath;
  });
}

function triageReady(doc: AnyDoc): boolean {
  const status = doc?.status;
  if (!status || typeof status !== "object") return false;
  const triage = (status as Record<string, unknown>).triage_status;
  return typeof triage === "string" && triage.trim().length > 0 && triage !== "DRAFT";
}

function stripAi(doc: AnyDoc): AnyDoc {
  const clone = JSON.parse(JSON.stringify(doc)) as AnyDoc;
  delete clone.ai;
  return clone;
}

export function shouldEnqueue(
  before: AnyDoc | undefined,
  after: AnyDoc | undefined,
  targetModelVersion: string
): { enqueue: boolean; reason: string } {
  if (!after) return { enqueue: false, reason: "deleted" };
  if (!hasAudio(after)) return { enqueue: false, reason: "no_audio" };
  if (!triageReady(after)) return { enqueue: false, reason: "not_ready" };

  const ai = after.ai as Record<string, unknown> | undefined;
  if (
    ai?.model_version === targetModelVersion &&
    ai?.inference_status === "SUCCESS"
  ) {
    return { enqueue: false, reason: "already_succeeded_same_version" };
  }

  if (before) {
    const beforeNoAi = stripAi(before);
    const afterNoAi = stripAi(after);
    if (JSON.stringify(beforeNoAi) === JSON.stringify(afterNoAi)) {
      return { enqueue: false, reason: "ai_only_update" };
    }
  }

  return { enqueue: true, reason: "eligible" };
}
