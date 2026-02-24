You are taking over the `TB-medgemma` project. Use this as authoritative context for current state and known issues.

Scope and constraints:
- Do not provide implementation steps unless explicitly asked.
- Report current state, blockers, and issue list only.
- Keep responses factual and tied to repo/cloud evidence.

Project summary:
- Product: offline-first TB triage workflow for ASHA, Doctor, Lab, Admin.
- Frontend: Next.js app in `frontend/` with IndexedDB (Dexie) local cache and sync overlay.
- Backend: Firestore + Storage + Cloud Functions + Cloud Run inference pipeline.
- Core flow: ASHA creates patient + audio -> sync to Firestore/Storage -> function enqueues task -> inference writes AI fields -> doctor/lab queues consume ranked output.

Cloud/deployment context:
- Project: `medgemini-tb-triage`
- Region: `us-east4`
- Inference service: Cloud Run `tb-inference`
- Trigger function: `onPatientWriteEnqueueInference` (v2, Firestore document written trigger)
- Queue: `tb-inference-queue`

Data/status observations:
- Firestore confirms ASHA user `sunita.asha@indiatb.gov` exists and owns records under UID `zrKKpqz05TSyz4hEUJ2auXaOM0l1`.
- Firestore confirms doctor `aditi.doctor@indiatb.gov` exists and has assigned patients.
- Patient `sample_id` backfill scripts exist and have been executed to remove missing/duplicate IDs.
- `asha_name` backfill script exists and has been executed for existing patients.

Recent code areas changed:
- `frontend/lib/sync.ts`
- `frontend/components/app-shell.tsx`
- `frontend/components/dashboard-screen.tsx`
- `frontend/components/doctor-dashboard.tsx`
- `frontend/components/lab-queue.tsx`
- `frontend/app/*/patient/[id]/page.tsx`
- `frontend/lib/db.ts`
- `frontend/lib/user-names.ts`
- `frontend/components/screening-flow.tsx`
- `backend/backfill_sample_ids.py`
- `backend/backfill_patient_asha_metadata.py`

Current known issues (do not include fixes here):
1. ASHA dashboard can still render empty patient list in UI even when cloud data exists for that ASHA.
2. ASHA-side visibility consistency is unstable across refresh/session state (local cache vs cloud hydration race symptoms).
3. User reports intermittent mismatch between expected queue state and ASHA list rendering after multiple refreshes.
4. Geolocation warning appears in ASHA header (`Only secure origins are allowed`) in non-secure browsing contexts.
5. Some UX confusion remains around filter state leading to perceived “no data” conditions.

Validation posture:
- `next build` succeeds for frontend.
- Cloud checks have been run for users/patients/task queue/logs.
- Remaining blocker is primarily ASHA UI data visibility consistency, not confirmed backend outage.

