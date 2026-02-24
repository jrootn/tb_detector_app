# TB Screening Ranker V10 - Final Training Block and Results

This document captures the final model-training design used in Kaggle for the CODA-TB pipeline, along with the reported outcomes that informed deployment artifacts.

## Final block identity

Title used in notebook:

`TB SCREENING RANKER: MASTER TRAINING & EXPORT PIPELINE (VERSION 10)`

Key intent:
- train decoupled Audio and Clinical experts,
- fuse with stacked supervisor + calibration,
- optimize and report pAUC-focused behavior,
- export deployment-ready `.pkl` artifacts and config.

## Core training setup (as used)

- Dataset roots in Kaggle:
  - `/kaggle/input/tb-audio/Tuberculosis/metadata`
  - `/kaggle/input/tb-audio/Tuberculosis/raw_data/solicited_data`
- Sampling rate: `16kHz`
- HeAR input window hard constraint: `2s` (`32000` samples)
- Overlap hop: `16000` (50%)
- Embedding dim: `512`
- Aggregation functions per participant:
  - `mean`, `std`, `p25`, `p50`, `p75`
- Final aggregated acoustic vector: `2560` dims
- CV strategy:
  - outer folds: `StratifiedKFold(n_splits=5)`
  - inner folds for OOF expert generation
- Models:
  - Audio expert: LightGBM (fallback LogisticRegression if missing)
  - Clinical expert: LightGBM (fallback LogisticRegression)
  - Supervisor: LightGBM then `CalibratedClassifierCV(method="sigmoid")`

## CODA-TB + HeAR limitation and mitigation

### Limitation
Many CODA-TB cough files are variable-length and often shorter than HeAR's fixed 2-second input requirement.

### Mitigation used in V10
1. Short audio:
   - mirror+tile padding to reach exact `32000` samples.
2. Long audio:
   - overlapping multi-window slicing (`32000` win, `16000` hop).
3. Participant-level robustness:
   - aggregate all window embeddings and recording counts into stable participant features.

This is the key reason the deployed pipeline uses robust multi-window aggregation instead of single-clip naive inference.

## Feature audit snapshot (reported)

- Total metadata features observed: `18`
- Excluded for leakage/ID: `participant_id`, `label_raw`

Final numerical features (`8`):
- `age`
- `height`
- `weight`
- `reported_cough_dur`
- `heart_rate`
- `temperature`
- `n_recordings`
- `n_cough_windows_total`

Final categorical features (`10`):
- `sex`
- `tb_prior`
- `tb_prior_Pul`
- `tb_prior_Extrapul`
- `tb_prior_Unknown`
- `hemoptysis`
- `weight_loss`
- `smoke_lweek`
- `fever`
- `night_sweats`

## Fold-wise results (reported from final run)

| Fold | ROC-AUC | pAUC@90% |
|---|---:|---:|
| 1 | 0.8364 | 0.9681 |
| 2 | 0.8297 | 0.9682 |
| 3 | 0.7926 | 0.9815 |
| 4 | 0.7877 | 0.9619 |
| 5 | 0.7427 | 0.9480 |
| **Mean** | **0.7978** | **0.9655** |

## Exported deployment artifacts in V10 notebook

- `final_meta_preprocessor.pkl`
- `final_audio_expert.pkl`
- `final_clinical_expert.pkl`
- `final_supervisor.pkl`
- `final_calibrated_supervisor.pkl`
- `final_inference_config.json`
- evaluation outputs:
  - ROC/pAUC plots
  - confusion matrix
  - human-readable metrics text
  - zipped output package (`outputs_v10.zip`)

## Full code provenance

The exact development history is retained in this same folder as notebooks:
- `hear-ablation (2).ipynb`
- `hear-ablation (3).ipynb`
- `hear-ablation (4).ipynb`
- `Fastapidemo.ipynb`

The final "V10 master block" is the one described above and reflected in exported model artifacts consumed by backend inference packaging.

