import argparse
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple

import firebase_admin
from firebase_admin import credentials, firestore


def init_firestore() -> firestore.Client:
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not cred_path:
        local_key = Path(__file__).resolve().parents[1] / "serviceAccountKey.json"
        if local_key.exists():
            cred_path = str(local_key)

    if not firebase_admin._apps:
        if cred_path:
            firebase_admin.initialize_app(credentials.Certificate(cred_path))
        else:
            firebase_admin.initialize_app()
    return firestore.client()


def _to_upper(value: Any) -> str:
    return str(value).strip().upper() if value is not None else ""


def _safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        numeric = float(value)
        return None if numeric != numeric else numeric
    except Exception:
        return None


def _is_yes(value: Any) -> bool:
    return _to_upper(value) in {"YES", "Y", "TRUE", "1"}


def _risk_level(score_0_to_1: float) -> str:
    if score_0_to_1 >= 0.70:
        return "HIGH"
    if score_0_to_1 >= 0.40:
        return "MEDIUM"
    return "LOW"


def _normalize_risk_score(raw: float) -> float:
    # Legacy data may contain either probability (0-1) or scaled score (0-10).
    if raw < 0:
        return 0.0
    if raw <= 1:
        return raw
    if raw <= 10:
        return raw / 10.0
    return 1.0


def _build_rule_actions(doc: Dict[str, Any], score_0_to_1: float) -> Tuple[List[str], List[str]]:
    risk_level = _risk_level(score_0_to_1)
    clinical = doc.get("clinical") if isinstance(doc.get("clinical"), dict) else {}
    symptoms = doc.get("symptoms") if isinstance(doc.get("symptoms"), list) else []

    cough_nature = _to_upper(clinical.get("cough_nature"))
    cough_days = _safe_float(clinical.get("cough_duration_days"))
    high_temp_c = _safe_float(clinical.get("body_temperature_c"))
    weight_loss = _is_yes(clinical.get("weight_loss"))
    night_sweats = _is_yes(clinical.get("night_sweats"))
    has_blood = cough_nature == "BLOOD_STAINED"
    has_high_fever = high_temp_c is not None and high_temp_c >= 38.5
    has_long_cough = cough_days is not None and cough_days >= 14

    physical_signs = clinical.get("physical_signs") if isinstance(clinical.get("physical_signs"), list) else []
    signs = {str(item).strip().lower() for item in physical_signs if isinstance(item, str)}
    normalized_signs = {re.sub(r"[^a-z0-9]", "", s) for s in signs}
    has_short_breath = "shortnessofbreath" in normalized_signs

    symptom_codes = {
        str(item.get("symptom_code", "")).strip().upper()
        for item in symptoms
        if isinstance(item, dict)
    }
    if "HEMOPTYSIS" in symptom_codes:
        has_blood = True
    if "COUGH" in symptom_codes and cough_days is None:
        has_long_cough = True

    red_flag = has_blood or has_short_breath

    en: List[str] = []
    hi: List[str] = []

    if red_flag:
        en.append(
            "Red-flag symptoms are present. Refer the patient urgently to the nearest PHC/CHC or district hospital today."
        )
        hi.append(
            "उच्च-जोखिम लक्षण मौजूद हैं। मरीज को आज ही निकटतम PHC/CHC या जिला अस्पताल में तुरंत रेफर करें।"
        )

    if risk_level == "HIGH":
        en.extend(
            [
                "Arrange same-day TB diagnostic testing (sputum + NAAT/Truenat/Xpert as per facility protocol) at the nearest government center.",
                "Until evaluation, use source control: wear a mask, follow cough etiquette, and keep rooms well ventilated.",
                "Prioritize this case in the testing queue and ensure ASHA follow-up call the same day.",
            ]
        )
        hi.extend(
            [
                "निकटतम सरकारी केंद्र में आज ही टीबी जांच (थूक + NAAT/Truenat/Xpert, सुविधा प्रोटोकॉल अनुसार) कराएं।",
                "जांच तक स्रोत-नियंत्रण अपनाएं: मास्क पहनें, खांसी शिष्टाचार रखें और कमरे में पर्याप्त हवा/वेंटिलेशन रखें।",
                "इस केस को जांच कतार में प्राथमिकता दें और ASHA द्वारा उसी दिन फॉलो-अप कॉल सुनिश्चित करें।",
            ]
        )
    elif risk_level == "MEDIUM":
        en.extend(
            [
                "Schedule TB diagnostic testing within 24-48 hours at the nearest PHC/TU.",
                "Continue mask use and cough hygiene, and reduce close indoor contact with children, elderly, or immunocompromised family members.",
                "If symptoms worsen (especially blood in sputum, persistent fever, or breathlessness), escalate to urgent referral.",
            ]
        )
        hi.extend(
            [
                "निकटतम PHC/TU में 24-48 घंटों के भीतर टीबी जांच की व्यवस्था करें।",
                "मास्क और खांसी शिष्टाचार जारी रखें, तथा बच्चों, बुजुर्गों और कम प्रतिरक्षा वाले परिवारजनों से नजदीकी बंद संपर्क कम करें।",
                "यदि लक्षण बढ़ें (खासतौर पर खून वाली खांसी, लगातार बुखार, या सांस फूलना), तो तुरंत रेफरल करें।",
            ]
        )
    else:
        en.extend(
            [
                "Maintain symptom monitoring and ASHA follow-up; re-evaluate promptly if cough persists for 2 weeks or more.",
                "Keep cough hygiene and household ventilation practices active.",
                "If blood in sputum, persistent fever, weight loss, or night sweats are present, move to fast-track TB testing.",
            ]
        )
        hi.extend(
            [
                "लक्षणों की निगरानी और ASHA फॉलो-अप जारी रखें; यदि खांसी 2 सप्ताह या अधिक रहे तो तुरंत पुनर्मूल्यांकन करें।",
                "खांसी शिष्टाचार और घर में वेंटिलेशन की आदतें जारी रखें।",
                "यदि खून वाली खांसी, लगातार बुखार, वजन घटना या रात में पसीना हो, तो टीबी जांच को फास्ट-ट्रैक करें।",
            ]
        )

    if has_long_cough and not any("2 weeks" in item for item in en):
        en.append("Persistent cough for 2 weeks or more warrants presumptive TB work-up as per program guidance.")
        hi.append("2 सप्ताह या अधिक की लगातार खांसी में कार्यक्रम दिशानिर्देश अनुसार संभावित टीबी की जांच करें।")
    if has_high_fever or weight_loss or night_sweats:
        en.append("Document fever/weight-loss/night-sweats in referral notes to support faster triage at facility level.")
        hi.append("फीवर/वजन घटना/रात में पसीना रेफरल नोट में लिखें ताकि केंद्र स्तर पर तेज ट्रायेज हो सके।")

    return en[:5], hi[:5]


def run(apply: bool, limit: int | None, only_success: bool, target_model_version: str | None) -> None:
    db = init_firestore()
    docs = db.collection("patients").stream()

    scanned = 0
    updated = 0
    skipped_no_ai = 0
    skipped_no_score = 0
    skipped_status = 0

    for snap in docs:
        if limit is not None and scanned >= limit:
            break
        scanned += 1

        doc = snap.to_dict() or {}
        ai = doc.get("ai")
        if not isinstance(ai, dict):
            skipped_no_ai += 1
            continue

        if target_model_version and ai.get("model_version") != target_model_version:
            skipped_status += 1
            continue
        if only_success and ai.get("inference_status") != "SUCCESS":
            skipped_status += 1
            continue

        score_raw = _safe_float(ai.get("risk_score"))
        if score_raw is None:
            skipped_no_score += 1
            continue
        score = _normalize_risk_score(score_raw)

        actions_en, actions_hi = _build_rule_actions(doc, score)
        payload = {
            "ai.action_items_en": actions_en,
            "ai.action_items_hi": actions_hi,
            "ai.action_items_i18n": {"en": actions_en, "hi": actions_hi},
            "ai.actions_source": "rule_based_v1",
            "ai.actions_generated_at": firestore.SERVER_TIMESTAMP,
        }
        if apply:
            snap.reference.update(payload)
        updated += 1

    mode = "APPLY" if apply else "DRY-RUN"
    print(
        f"[{mode}] scanned={scanned} updated={updated} skipped_no_ai={skipped_no_ai} "
        f"skipped_no_score={skipped_no_score} skipped_status={skipped_status}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Backfill rule-based bilingual action items into ai.action_items_* using existing ai.risk_score."
    )
    parser.add_argument("--apply", action="store_true", help="Write updates. Without this flag, dry-run only.")
    parser.add_argument("--limit", type=int, default=None, help="Optional limit for scanned documents.")
    parser.add_argument(
        "--only-success",
        action="store_true",
        help="Update only records with ai.inference_status=SUCCESS.",
    )
    parser.add_argument(
        "--target-model-version",
        default=None,
        help="Optional filter for ai.model_version.",
    )
    args = parser.parse_args()
    run(
        apply=args.apply,
        limit=args.limit,
        only_success=args.only_success,
        target_model_version=args.target_model_version,
    )
