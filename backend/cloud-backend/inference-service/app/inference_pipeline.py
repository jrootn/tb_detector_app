from __future__ import annotations

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


def _clean_llm_output(prompt: str, output: str) -> str:
    text = output.replace(prompt, "")
    text = text.replace("<end_of_turn>", "").strip()
    return text


def _generate_summaries(patient_dict: Dict[str, Any], prob_a: float, prob_m: float, final_score: float, medgemma: Any) -> Tuple[str, str]:
    prompt_en = (
        "<start_of_turn>user\n"
        "You are an expert AI Triage Assistant in a tuberculosis clinic.\n"
        f"PATIENT DATA: {int(patient_dict.get('age', 0))} year old {patient_dict.get('sex', 'patient')}. "
        f"Weight loss: {patient_dict.get('weight_loss', 'Missing')}, Night Sweats: {patient_dict.get('night_sweats', 'Missing')}.\n"
        f"AI Assessment: Acoustic Risk: {prob_a:.2f}, Clinical Risk: {prob_m:.2f}, Final Risk: {final_score:.2f}.\n"
        "TASK: Write a concise 2-sentence clinical justification in English.\n"
        "<end_of_turn>\n<start_of_turn>model\n"
    )
    out_en = medgemma.generate(prompt_en, max_length=256)
    summary_en = _clean_llm_output(prompt_en, out_en)

    prompt_hi = (
        "<start_of_turn>user\n"
        "You are an expert AI Triage Assistant in a tuberculosis clinic.\n"
        f"PATIENT DATA: {int(patient_dict.get('age', 0))} year old {patient_dict.get('sex', 'patient')}. "
        f"Weight loss: {patient_dict.get('weight_loss', 'Missing')}, Night Sweats: {patient_dict.get('night_sweats', 'Missing')}.\n"
        f"AI Assessment: Acoustic Risk: {prob_a:.2f}, Clinical Risk: {prob_m:.2f}, Final Risk: {final_score:.2f}.\n"
        "TASK: Write a concise 2-sentence clinical justification in Hindi (Devanagari script).\n"
        "<end_of_turn>\n<start_of_turn>model\n"
    )
    out_hi = medgemma.generate(prompt_hi, max_length=256)
    summary_hi = _clean_llm_output(prompt_hi, out_hi)

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

    return {
        "hear_score": round(prob_a, 4),
        "risk_score": round(final_score, 4),
        "risk_level": _risk_level(final_score),
        "medgemini_summary_en": summary_en,
        "medgemini_summary_hi": summary_hi,
        "model_version": model_version,
        "clinical_score": round(prob_m, 4),
    }
