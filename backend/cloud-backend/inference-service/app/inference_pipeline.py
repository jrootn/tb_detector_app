from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

import librosa
import numpy as np
import pandas as pd
import tensorflow as tf

from .models import ModelBundle


def _to_upper(value: Any) -> str:
    return str(value).strip().upper() if value is not None else ""


def _normalize_answer(value: Any) -> str:
    v = str(value).strip().lower() if value is not None else ""
    if v in {"yes", "y", "true", "1"}:
        return "yes"
    if v in {"no", "n", "false", "0"}:
        return "no"
    return "missing"


def _extract_patient_features(patient_doc: Dict[str, Any]) -> Dict[str, Any]:
    demographics = patient_doc.get("demographics") if isinstance(patient_doc.get("demographics"), dict) else {}
    vitals = patient_doc.get("vitals") if isinstance(patient_doc.get("vitals"), dict) else {}
    clinical = patient_doc.get("clinical") if isinstance(patient_doc.get("clinical"), dict) else {}

    answers = clinical.get("risk_factor_answers") if isinstance(clinical.get("risk_factor_answers"), dict) else {}

    history_tb = _normalize_answer(answers.get("historyOfTB"))
    smoker = _normalize_answer(answers.get("smoker"))

    weight_loss_answer = _normalize_answer(clinical.get("weight_loss"))
    if weight_loss_answer == "missing":
        weight_loss_answer = _normalize_answer(answers.get("weightLoss"))

    night_sweats_answer = _normalize_answer(clinical.get("night_sweats"))
    if night_sweats_answer == "missing":
        night_sweats_answer = _normalize_answer(answers.get("nightSweats"))

    fever_history = _to_upper(clinical.get("fever_history"))
    cough_nature = _to_upper(clinical.get("cough_nature"))

    gender = str(demographics.get("gender", "other")).strip().lower()
    sex = "Missing" if gender == "other" else gender.capitalize()

    def yes_no_missing(v: str) -> str:
        if v == "yes":
            return "Yes"
        if v == "no":
            return "No"
        return "Missing"

    patient_dict = {
        "age": float(demographics.get("age")) if demographics.get("age") is not None else np.nan,
        "height": float(vitals.get("height_cm")) if vitals.get("height_cm") is not None else np.nan,
        "weight": float(vitals.get("weight_kg")) if vitals.get("weight_kg") is not None else np.nan,
        "reported_cough_dur": float(clinical.get("cough_duration_days")) if clinical.get("cough_duration_days") is not None else np.nan,
        "heart_rate": float(clinical.get("heart_rate_bpm")) if clinical.get("heart_rate_bpm") is not None else np.nan,
        "temperature": float(clinical.get("body_temperature_c")) if clinical.get("body_temperature_c") is not None else np.nan,
        "n_recordings": 1.0,
        "n_cough_windows_total": 1.0,  # replaced after audio processing
        "sex": sex,
        "tb_prior": "Yes" if history_tb == "yes" else "No",
        "tb_prior_Pul": "Missing",
        "tb_prior_Extrapul": "Missing",
        "tb_prior_Unknown": "Yes" if history_tb == "yes" else "Missing",
        "hemoptysis": "Yes" if cough_nature == "BLOOD_STAINED" else "No",
        "weight_loss": yes_no_missing(weight_loss_answer),
        "smoke_lweek": yes_no_missing(smoker),
        "fever": "No" if fever_history in {"", "NONE"} else "Yes",
        "night_sweats": yes_no_missing(night_sweats_answer),
    }
    return patient_dict


def _process_audio(audio_path: str, hear_serving: Any) -> Tuple[np.ndarray, int]:
    sr = 16000
    win_samples = 32000
    hop_samples = 16000

    audio, _ = librosa.load(audio_path, sr=sr, mono=True)

    if len(audio) < win_samples:
        repeats = int(np.ceil(win_samples / max(len(audio), 1)))
        audio = np.tile(np.concatenate((audio, audio[::-1])), repeats)[:win_samples]

    windows = [
        audio[i : i + win_samples].astype(np.float32)
        for i in range(0, len(audio) - win_samples + 1, hop_samples)
    ]
    if not windows:
        windows = [audio[:win_samples].astype(np.float32)]

    x = tf.constant(np.stack(windows), dtype=tf.float32)
    embs = list(hear_serving(x=x).values())[0].numpy().astype(np.float32)

    mean = embs.mean(axis=0)
    std = embs.std(axis=0)
    p25, p50, p75 = np.percentile(embs, [25, 50, 75], axis=0)
    agg_emb = np.concatenate([mean, std, p25, p50, p75]).astype(np.float32)
    return agg_emb.reshape(1, -1), len(windows)


def _risk_level(score: float) -> str:
    if score >= 0.70:
        return "HIGH"
    if score >= 0.40:
        return "MEDIUM"
    return "LOW"


def _is_yes(value: Any) -> bool:
    return str(value).strip().upper() in {"YES", "Y", "TRUE", "1"}


def _safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        numeric = float(value)
        if np.isnan(numeric):
            return None
        return numeric
    except Exception:
        return None


def _build_rule_actions(patient_doc: Dict[str, Any], final_score: float) -> Tuple[List[str], List[str]]:
    risk_level = _risk_level(final_score)
    clinical = patient_doc.get("clinical") if isinstance(patient_doc.get("clinical"), dict) else {}
    symptoms = patient_doc.get("symptoms") if isinstance(patient_doc.get("symptoms"), list) else []

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
    has_short_breath = "shortnessofbreath" in {re.sub(r"[^a-z0-9]", "", s) for s in signs}

    # Support legacy symptom arrays as fallback.
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

    # Symptom-specific augmentation to keep advice actionable in field settings.
    if has_long_cough and not any("2 weeks" in item for item in en):
        en.append("Persistent cough for 2 weeks or more warrants presumptive TB work-up as per program guidance.")
        hi.append("2 सप्ताह या अधिक की लगातार खांसी में कार्यक्रम दिशानिर्देश अनुसार संभावित टीबी की जांच करें।")
    if has_high_fever or weight_loss or night_sweats:
        en.append("Document fever/weight-loss/night-sweats in referral notes to support faster triage at facility level.")
        hi.append("फीवर/वजन घटना/रात में पसीना रेफरल नोट में लिखें ताकि केंद्र स्तर पर तेज ट्रायेज हो सके।")

    # Keep concise and deterministic for UI rendering.
    return en[:5], hi[:5]


def _clean_llm_output(prompt: str, output: str, *, language: str) -> str:
    text = str(output or "").replace(prompt, "")
    text = text.replace("<end_of_turn>", "")
    text = text.replace("<start_of_turn>model", "")
    text = text.replace("<start_of_turn>user", "")
    text = re.sub(r"<unused\d+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    # Prefer explicit tagged final output if model follows instructions.
    final_match = re.search(r"<final>(.*?)</final>", text, flags=re.IGNORECASE | re.DOTALL)
    if final_match:
        text = final_match.group(1).strip()

    # Remove common reasoning/chain-of-thought artifacts.
    bad_fragments = (
        "thinking process",
        "chain of thought",
        "let's think",
        "reasoning:",
        "analysis:",
        "step-by-step",
        "first,",
        "second,",
        "third,",
    )
    lines = [ln.strip() for ln in re.split(r"[\r\n]+", text) if ln.strip()]
    lines = [ln for ln in lines if not any(b in ln.lower() for b in bad_fragments)]
    text = " ".join(lines).strip()

    if language == "hi":
        # Keep Hindi answer body if mixed with English artifacts.
        m = re.search(r"[\u0900-\u097F].*", text)
        if m:
            text = m.group(0).strip()

    # Keep only first 2 sentences to match UI expectation.
    parts = [p.strip() for p in re.split(r"(?<=[\.\!\?।])\s+", text) if p.strip()]
    if len(parts) > 2:
        text = " ".join(parts[:2]).strip()

    return text


def _contains_devanagari(text: str) -> bool:
    return bool(re.search(r"[\u0900-\u097F]", text or ""))


def _fallback_summary_en(patient_dict: Dict[str, Any], final_score: float) -> str:
    level = _risk_level(final_score)
    return (
        f"The clinical and acoustic features indicate a {level.lower()} TB risk profile with final score {final_score:.2f}. "
        "Please correlate with clinical examination and confirmatory testing."
    )


def _fallback_summary_hi(patient_dict: Dict[str, Any], final_score: float) -> str:
    level_map = {"HIGH": "उच्च", "MEDIUM": "मध्यम", "LOW": "निम्न"}
    level = level_map.get(_risk_level(final_score), "मध्यम")
    return (
        f"क्लिनिकल और ऑडियो संकेतों के आधार पर टीबी जोखिम {level} है और अंतिम स्कोर {final_score:.2f} है। "
        "कृपया नैदानिक जांच और पुष्टिकरण परीक्षण के साथ निर्णय लें।"
    )


def _generate_summaries(patient_dict: Dict[str, Any], prob_a: float, prob_m: float, final_score: float, medgemma: Any) -> Tuple[str, str]:
    prompt_en = (
        "<start_of_turn>user\n"
        "You are an expert AI Triage Assistant in a tuberculosis clinic.\n"
        f"PATIENT DATA: {int(patient_dict.get('age', 0))} year old {patient_dict.get('sex', 'patient')}. "
        f"Weight loss: {patient_dict.get('weight_loss', 'Missing')}, Night Sweats: {patient_dict.get('night_sweats', 'Missing')}.\n"
        f"AI Assessment: Acoustic Risk: {prob_a:.2f}, Clinical Risk: {prob_m:.2f}, Final Risk: {final_score:.2f}.\n"
        "TASK: Write a concise 2-sentence clinical justification in English.\n"
        "Output strictly as:\n<final>Sentence 1. Sentence 2.</final>\n"
        "Do not include reasoning, analysis, or meta text.\n"
        "<end_of_turn>\n<start_of_turn>model\n"
    )
    out_en = medgemma.generate(prompt_en, max_length=256)
    summary_en = _clean_llm_output(prompt_en, out_en, language="en")
    if (
        not summary_en
        or summary_en.lower().startswith("sentence 1")
        or "thought" in summary_en.lower()
        or "user wants me" in summary_en.lower()
    ):
        summary_en = _fallback_summary_en(patient_dict, final_score)

    prompt_hi = (
        "<start_of_turn>user\n"
        "You are an expert AI Triage Assistant in a tuberculosis clinic.\n"
        f"PATIENT DATA: {int(patient_dict.get('age', 0))} year old {patient_dict.get('sex', 'patient')}. "
        f"Weight loss: {patient_dict.get('weight_loss', 'Missing')}, Night Sweats: {patient_dict.get('night_sweats', 'Missing')}.\n"
        f"AI Assessment: Acoustic Risk: {prob_a:.2f}, Clinical Risk: {prob_m:.2f}, Final Risk: {final_score:.2f}.\n"
        "TASK: Write a concise 2-sentence clinical justification in Hindi (Devanagari script).\n"
        "Output strictly as:\n<final>Sentence 1. Sentence 2.</final>\n"
        "Do not include reasoning, analysis, transliteration, or English meta text.\n"
        "<end_of_turn>\n<start_of_turn>model\n"
    )
    out_hi = medgemma.generate(prompt_hi, max_length=256)
    summary_hi = _clean_llm_output(prompt_hi, out_hi, language="hi")
    if (
        not summary_hi
        or not _contains_devanagari(summary_hi)
        or "thought" in summary_hi.lower()
        or "user wants me" in summary_hi.lower()
    ):
        summary_hi = _fallback_summary_hi(patient_dict, final_score)

    return summary_en, summary_hi


def run_tb_inference(
    patient_doc: Dict[str, Any],
    audio_paths: List[str],
    model_version: str,
    model_bundle: ModelBundle,
) -> Dict[str, Any]:
    if not audio_paths:
        raise RuntimeError("No audio files provided for inference")

    patient_dict = _extract_patient_features(patient_doc)

    # Use first available audio for now; multi-recording fusion can be added later.
    audio_features, n_windows = _process_audio(audio_paths[0], model_bundle.hear_serving)
    patient_dict["n_recordings"] = float(len(audio_paths))
    patient_dict["n_cough_windows_total"] = float(n_windows)

    df_meta = pd.DataFrame([patient_dict])

    x_m_processed = model_bundle.meta_prep.transform(df_meta)
    prob_a = float(model_bundle.clf_audio.predict_proba(audio_features)[:, 1][0])
    prob_m = float(model_bundle.clf_clinical.predict_proba(x_m_processed)[:, 1][0])

    x_stack = np.column_stack([
        np.array([prob_a], dtype=np.float32),
        np.array([prob_m], dtype=np.float32),
        x_m_processed,
    ])
    final_score = float(model_bundle.cal_supervisor.predict_proba(x_stack)[:, 1][0])

    summary_en, summary_hi = _generate_summaries(
        patient_dict=patient_dict,
        prob_a=prob_a,
        prob_m=prob_m,
        final_score=final_score,
        medgemma=model_bundle.medgemma,
    )
    actions_en, actions_hi = _build_rule_actions(patient_doc, final_score)

    return {
        "hear_score": round(prob_a, 4),
        "risk_score": round(final_score, 4),
        "risk_level": _risk_level(final_score),
        "medgemini_summary_en": summary_en,
        "medgemini_summary_hi": summary_hi,
        "action_items_en": actions_en,
        "action_items_hi": actions_hi,
        "actions_source": "rule_based_v1",
        "model_version": model_version,
        "clinical_score": round(prob_m, 4),
    }
