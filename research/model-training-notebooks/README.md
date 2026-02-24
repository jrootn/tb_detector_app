# Model Training Artifacts (Development + Final V10)

This folder contains the raw notebook history used during model development, plus a structured record of the final training pipeline and metrics that informed the deployed backend stack.

## Contents

### Trial-and-error notebooks (kept intentionally)
- `Fastapidemo.ipynb`
- `hear-ablation (2).ipynb`
- `hear-ablation (3).ipynb`
- `hear-ablation (4).ipynb`

These are intentionally uncleaned and preserve experimentation history.

### Final training record
- `V10_FINAL_BLOCK_AND_RESULTS.md`
  - Final Kaggle V10 master pipeline block (as provided)
  - Reported fold-wise performance
  - CODA-TB/HeAR constraints and mitigation choices

## Dataset and training context

- Primary dataset used: CODA-TB metadata + solicited cough audio (Kaggle environment paths in the final block).
- Core challenge addressed: HeAR expects fixed 2-second windows (`32000` samples at `16kHz`), while many CODA cough clips are shorter/variable-length.
- Mitigation used:
  - mirror+tile padding for short clips,
  - sliding multi-window extraction for long clips,
  - participant-level aggregation over windows and recordings.

## Kaggle notebook link

Add your public Kaggle notebook link(s) here before final submission:

- `TODO: https://www.kaggle.com/...`

