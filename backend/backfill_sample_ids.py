#!/usr/bin/env python3
import argparse
import hashlib
from typing import Dict, List, Set, Tuple

from google.cloud import firestore


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill missing patient sample_id values in Firestore.")
    parser.add_argument("--project", required=True, help="GCP project id")
    parser.add_argument("--dry-run", action="store_true", help="Print planned updates without writing")
    parser.add_argument("--limit", type=int, default=0, help="Optional max number of docs to update")
    return parser.parse_args()


def has_sample_id(value: object) -> bool:
    return isinstance(value, str) and value.strip() not in {"", "-"}


def build_candidate(doc_id: str, used_ids: Set[str]) -> str:
    seed = int(hashlib.sha1(doc_id.encode("utf-8")).hexdigest()[:10], 16) % 1_000_000
    for _ in range(1_000_000):
        candidate = f"TX-{seed:06d}"
        if candidate not in used_ids:
            return candidate
        seed = (seed + 1) % 1_000_000
    raise RuntimeError("Unable to generate unique sample id: namespace exhausted")


def main() -> None:
    args = parse_args()
    db = firestore.Client(project=args.project)

    print(f"[info] scanning patients in project={args.project}")
    docs = list(db.collection("patients").stream())
    print(f"[info] total docs={len(docs)}")

    used_ids: Set[str] = set()
    first_owner_by_sample_id: Dict[str, str] = {}
    missing: List[Tuple[firestore.DocumentReference, str]] = []
    duplicate: List[Tuple[firestore.DocumentReference, str, str]] = []

    for snap in docs:
        data = snap.to_dict() or {}
        raw_sample_id = data.get("sample_id")
        if has_sample_id(raw_sample_id):
            sample_id = str(raw_sample_id).strip()
            if sample_id in first_owner_by_sample_id:
                duplicate.append((snap.reference, snap.id, sample_id))
            else:
                first_owner_by_sample_id[sample_id] = snap.id
                used_ids.add(sample_id)
            continue
        missing.append((snap.reference, snap.id))

    print(f"[info] missing sample_id docs={len(missing)}")
    print(f"[info] duplicate sample_id docs={len(duplicate)}")
    if not missing and not duplicate:
        print("[done] nothing to update")
        return

    planned: List[Tuple[firestore.DocumentReference, str]] = []
    for ref, doc_id, old_sample_id in duplicate:
        sample_id = build_candidate(f"{doc_id}:{old_sample_id}", used_ids)
        used_ids.add(sample_id)
        planned.append((ref, sample_id))
        if args.limit and len(planned) >= args.limit:
            break

    if args.limit and len(planned) >= args.limit:
        print(f"[info] limit reached while resolving duplicates (limit={args.limit})")
    else:
        remaining_limit = (args.limit - len(planned)) if args.limit else 0
        missing_candidates = missing if not args.limit else missing[:remaining_limit]
        for ref, doc_id in missing_candidates:
            sample_id = build_candidate(doc_id, used_ids)
            used_ids.add(sample_id)
            planned.append((ref, sample_id))
            if args.limit and len(planned) >= args.limit:
                break

    print(f"[info] planned updates={len(planned)}")
    for ref, sample_id in planned[:20]:
        print(f"[plan] {ref.id} -> {sample_id}")
    if len(planned) > 20:
        print(f"[plan] ... and {len(planned) - 20} more")

    if args.dry_run:
        print("[done] dry-run only")
        return

    batch = db.batch()
    written = 0
    for idx, (ref, sample_id) in enumerate(planned, start=1):
        batch.set(ref, {"sample_id": sample_id}, merge=True)
        if idx % 400 == 0:
            batch.commit()
            written += 400
            batch = db.batch()
            print(f"[write] committed {written}")

    remainder = len(planned) % 400
    if remainder:
        batch.commit()
        written += remainder
    print(f"[done] updated {written} docs")


if __name__ == "__main__":
    main()
