# NTEP Hierarchy Rollout Plan (Error-Proof)

## Goal
Introduce facility-tagged routing and a new `ADMIN` monitoring role without breaking existing ASHA/Doctor/Lab workflows.

## Phase 0: Safe Baseline
- Keep legacy patient fields unchanged (`asha_id`, `status`, `sample_id`, `ai`).
- Add new fields in parallel (`facility_id`, `tu_id`, `assigned_doctor_id`, `assigned_lab_tech_id`, `assignment_mode`).
- Ensure UI keeps fallback behavior for records that do not yet have new fields.

## Phase 1: Deploy Code First (No Data Reset Yet)
- Deploy frontend with:
  - `ADMIN` route and dashboard.
  - doctor/lab filtering by assigned user or facility.
  - fallback visibility for legacy records.
- Deploy backend sync with auto-assignment from ASHA facility.

## Phase 2: Rules Update
- Update Firestore/Storage rules to include `ADMIN` read rights and keep no-delete policy.
- Keep writes restricted by role as before.

## Phase 3: Controlled Data Reset and Seed
- Execute reset only with explicit flag:
  - `RESET_DB=1 python backend/populate_db.py`
- Seed NTEP-style hierarchy dataset:
  - 1 TU, 2 PHCs, 1 admin(STS), 2 doctors, 2 lab techs, 10 ASHAs.
  - facility-tagged patients with realistic status and rank fields.

## Phase 4: Verification Checklist
- Login/redirect works for all four roles.
- ASHA create -> sync writes patient with `facility_id` and assigned doctor/lab IDs.
- Doctor sees only assigned/facility patients.
- Lab sees only assigned/facility patients.
- Admin sees global monitoring view.
- File upload and notes thread still function.

## Rollback
- Frontend rollback only: previous commit restore (`git checkout <old_commit> frontend`).
- Seed rollback: re-run old script version or reseed from backup export.
- Rule rollback: revert rules in Firebase console to last working version.
