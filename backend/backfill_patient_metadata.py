import argparse
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set

import firebase_admin
from firebase_admin import credentials, firestore


def _normalize_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _normalize_answer(value: Optional[str]) -> str:
    if not value:
        return "dontKnow"
    raw = value.strip().lower()
    if raw in {"yes", "y", "true"}:
        return "yes"
    if raw in {"no", "n", "false"}:
        return "no"
    if raw in {"dontknow", "don't know", "dont know", "unknown"}:
        return "dontKnow"
    if raw in {"prefernottosay", "prefer not to say"}:
        return "preferNotToSay"
    return "dontKnow"


def _api_answer(value: str) -> str:
    if value == "yes":
        return "YES"
    if value == "no":
        return "NO"
    if value == "preferNotToSay":
        return "PREFER_NOT_TO_SAY"
    return "DONT_KNOW"


ALIASES: Dict[str, Set[str]] = {
    "historyOfTB": {"historyoftb", "historytb"},
    "familyMemberHasTB": {"familymemberhastb", "familytb"},
    "diabetes": {"diabetes"},
    "smoker": {"smoker"},
    "historyOfCovid": {"historyofcovid", "covid", "covid19"},
    "historyOfHIV": {"historyofhiv", "hiv", "aids"},
    "nightSweats": {"nightsweats"},
    "weightLoss": {"weightloss"},
}


def _extract_risk_factor_tokens(risk_factors: Any) -> Set[str]:
    tokens: Set[str] = set()
    if not isinstance(risk_factors, list):
        return tokens
    for item in risk_factors:
        if isinstance(item, str):
            tokens.add(_normalize_token(item))
    return tokens


def _extract_symptom_tokens(symptoms: Any) -> Set[str]:
    tokens: Set[str] = set()
    if not isinstance(symptoms, list):
        return tokens
    for symptom in symptoms:
        if isinstance(symptom, dict):
            code = symptom.get("symptom_code")
            if isinstance(code, str):
                tokens.add(_normalize_token(code))
        elif isinstance(symptom, str):
            tokens.add(_normalize_token(symptom))
    return tokens


def _infer_answer(
    key: str,
    factor_tokens: Set[str],
    symptom_tokens: Set[str],
) -> str:
    aliases = ALIASES.get(key, set())
    if factor_tokens.intersection(aliases):
        return "yes"

    if key == "nightSweats" and "nightsweats" in symptom_tokens:
        return "yes"
    if key == "weightLoss" and "weightloss" in symptom_tokens:
        return "yes"

    # Historical data did not preserve full answers for many records.
    # We use "dontKnow" instead of "no" to avoid introducing false negatives.
    return "dontKnow"


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def init_firestore_client():
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not cred_path:
        local_key = Path(__file__).with_name("serviceAccountKey.json")
        if local_key.exists():
            cred_path = str(local_key)

    if not firebase_admin._apps:
        if cred_path:
            firebase_admin.initialize_app(credentials.Certificate(cred_path))
        else:
            firebase_admin.initialize_app(credentials.ApplicationDefault())
    return firestore.client()


def build_updates(patient: Dict[str, Any]) -> Dict[str, Any]:
    clinical = patient.get("clinical") if isinstance(patient.get("clinical"), dict) else {}
    symptoms = patient.get("symptoms", [])
    risk_factor_tokens = _extract_risk_factor_tokens(clinical.get("risk_factors"))
    symptom_tokens = _extract_symptom_tokens(symptoms)

    existing_answers = clinical.get("risk_factor_answers")
    answers: Dict[str, str] = {}
    if isinstance(existing_answers, dict):
        for k, v in existing_answers.items():
            if isinstance(k, str):
                answers[k] = _normalize_answer(v if isinstance(v, str) else None)

    for key in [
        "historyOfTB",
        "familyMemberHasTB",
        "diabetes",
        "smoker",
        "historyOfCovid",
        "historyOfHIV",
        "nightSweats",
        "weightLoss",
    ]:
        if key not in answers:
            answers[key] = _infer_answer(key, risk_factor_tokens, symptom_tokens)

    clinical_updates: Dict[str, Any] = {}
    if answers != existing_answers:
        clinical_updates["risk_factor_answers"] = answers

    if "night_sweats" not in clinical:
        clinical_updates["night_sweats"] = _api_answer(answers.get("nightSweats", "dontKnow"))

    if "weight_loss" not in clinical:
        clinical_updates["weight_loss"] = _api_answer(answers.get("weightLoss", "dontKnow"))

    if "heart_rate_bpm" not in clinical:
        clinical_updates["heart_rate_bpm"] = None

    # Keep temperature in Celsius in the canonical field.
    if "body_temperature_c" not in clinical:
        c = _to_float(clinical.get("body_temperature_c"))
        if c is None:
            f = _to_float(clinical.get("body_temperature_f"))
            if f is not None:
                c = round((f - 32.0) * 5.0 / 9.0, 1)
        clinical_updates["body_temperature_c"] = c

    if "body_temperature_source_unit" not in clinical:
        if _to_float(clinical.get("body_temperature_f")) is not None:
            clinical_updates["body_temperature_source_unit"] = "F"
        elif _to_float(clinical.get("body_temperature_c")) is not None:
            clinical_updates["body_temperature_source_unit"] = "C"
        elif _to_float(clinical_updates.get("body_temperature_c")) is not None:
            clinical_updates["body_temperature_source_unit"] = "C"
        else:
            clinical_updates["body_temperature_source_unit"] = None

    if not clinical_updates:
        return {}
    return {"clinical": clinical_updates}


def run_backfill(apply: bool, limit: Optional[int]) -> None:
    db = init_firestore_client()
    docs = db.collection("patients").stream()

    seen = 0
    updated = 0
    examples: List[str] = []

    for snap in docs:
        if limit is not None and seen >= limit:
            break
        seen += 1
        data = snap.to_dict() or {}
        payload = build_updates(data)
        if not payload:
            continue

        updated += 1
        if len(examples) < 5:
            examples.append(snap.id)

        if apply:
            snap.reference.set(payload, merge=True)

    mode = "APPLY" if apply else "DRY-RUN"
    print(f"[{mode}] scanned={seen} would_update={updated}")
    if examples:
        print("sample_docs:", ", ".join(examples))


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill new patient metadata fields in Firestore.")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write updates. Without this flag, script runs in dry-run mode.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional max number of patient docs to scan.",
    )
    args = parser.parse_args()

    run_backfill(apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
