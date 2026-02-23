from __future__ import annotations

from typing import Any, Dict, List

from .models import ModelBundle


def _to_upper(value: Any) -> str:
    return str(value).strip().upper() if value is not None else ""


def _answer_yes(value: Any) -> bool:
    return _to_upper(value) in {"YES", "Y", "TRUE", "1"}


def _clinical_risk_score(patient_doc: Dict[str, Any]) -> float:
    clinical = patient_doc.get("clinical") if isinstance(patient_doc.get("clinical"), dict) else {}
    answers = clinical.get("risk_factor_answers") if isinstance(clinical.get("risk_factor_answers"), dict) else {}

    score = 0.0

    cough_days = clinical.get("cough_duration_days")
    if isinstance(cough_days, (int, float)) and cough_days >= 14:
        score += 0.20

    if _to_upper(clinical.get("cough_nature")) == "BLOOD_STAINED":
        score += 0.20

    if _to_upper(clinical.get("fever_history")) in {"LOW_GRADE", "HIGH_GRADE"}:
        score += 0.10

    if _answer_yes(clinical.get("night_sweats")) or _answer_yes(answers.get("nightSweats")):
        score += 0.15

    if _answer_yes(clinical.get("weight_loss")) or _answer_yes(answers.get("weightLoss")):
        score += 0.15

    if _answer_yes(answers.get("historyOfTB")):
        score += 0.10

    if _answer_yes(answers.get("familyMemberHasTB")):
        score += 0.05

    if _answer_yes(answers.get("historyOfHIV")):
        score += 0.15

    return max(0.0, min(1.0, score))


def _audio_risk_score(audio_paths: List[str]) -> float:
    if not audio_paths:
        return 0.30
    # Conservative heuristic until full audio model integration is wired.
    return max(0.30, min(0.95, 0.35 + 0.06 * len(audio_paths)))


def _risk_level(score: float) -> str:
    if score >= 0.75:
        return "HIGH"
    if score >= 0.45:
        return "MEDIUM"
    return "LOW"


def _summaries(level: str, score: float) -> Dict[str, str]:
    pct = int(round(score * 100))
    if level == "HIGH":
        en = f"TB risk is high ({pct}%). Prioritize confirmatory testing and urgent clinical review."
        hi = f"टीबी जोखिम उच्च है ({pct}%). त्वरित पुष्टि जांच और शीघ्र चिकित्सकीय समीक्षा की सलाह है।"
    elif level == "MEDIUM":
        en = f"TB risk is moderate ({pct}%). Schedule diagnostic testing and close follow-up."
        hi = f"टीबी जोखिम मध्यम है ({pct}%). जांच निर्धारित करें और नज़दीकी फॉलो-अप रखें।"
    else:
        en = f"TB risk is currently low ({pct}%). Continue monitoring and reassess if symptoms persist."
        hi = f"टीबी जोखिम अभी कम है ({pct}%). लक्षण बने रहने पर पुनर्मूल्यांकन करें।"
    return {"en": en, "hi": hi}


def run_tb_inference(
    patient_doc: Dict[str, Any],
    audio_paths: List[str],
    model_version: str,
    model_bundle: ModelBundle,
) -> Dict[str, Any]:
    # TODO: Replace fallback logic with your final HEAR + classical + MedGemma pipeline.
    # This implementation keeps service functional and deterministic now.
    clinical = _clinical_risk_score(patient_doc)
    hear = _audio_risk_score(audio_paths)
    risk = max(0.0, min(1.0, 0.55 * clinical + 0.45 * hear))

    level = _risk_level(risk)
    summaries = _summaries(level, risk)

    return {
        "hear_score": round(hear, 4),
        "risk_score": round(risk, 4),
        "risk_level": level,
        "medgemini_summary_en": summaries["en"],
        "medgemini_summary_hi": summaries["hi"],
        "model_version": model_version,
        "inference_backend": "fallback_pipeline" if not model_bundle.loaded else "hybrid_pipeline",
    }
