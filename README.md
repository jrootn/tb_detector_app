# MedGemma TB Triage

[![Watch the demo](https://img.youtube.com/vi/mGofBr-sYLI/maxresdefault.jpg)](https://youtu.be/mGofBr-sYLI)

**Demo video:** https://youtu.be/mGofBr-sYLI

MedGemma TB Triage is an end-to-end prototype for AI-assisted tuberculosis screening and triage designed for low-connectivity public health workflows.

This project was built around a practical systems problem: in many rural TB workflows, the biggest breakdown is not awareness, and not even the absence of diagnostic tools. It is the gap between first-mile screening and timely testing. Community health workers may identify symptomatic patients, but connectivity is unreliable, lab throughput is limited, queues are often first-come-first-served, and higher-risk patients do not always move through the system quickly enough.

MedGemma TB Triage explores a different operational model:

- ASHA workers collect patient data offline in the field
- Cough audio and symptom metadata sync when connectivity returns
- A private-cloud ML pipeline computes a calibrated TB triage risk score
- MedGemma generates concise clinician-facing summaries
- Labs and doctors receive a ranked queue instead of an unprioritized stream
- Admins get a control-tower view of workload, sync health, and bottlenecks

The result is a full-stack, role-based system designed around real deployment constraints rather than a benchmark-only AI demo.

---

## Overview

This repository showcases the project as a product system, not just a competition submission.

It brings together:

- An offline-first field workflow
- Multi-role healthcare interfaces
- Private-cloud inference
- Acoustic and clinical risk modeling
- MedGemma-based explainability
- Queue prioritization instead of first-come-first-served processing
- Operational visibility for clinicians and administrators

The original competition deployment is being retired, so this repository now serves as the main artifact for understanding the product, architecture, and technical work.

---

## The problem

Many TB workflows break down in the handoff between community screening and downstream clinical action.

Common failure points include:

- Data is captured in locations with poor or no internet access
- Symptomatic patients may delay testing because travel and waiting time cost income
- Labs operate with limited throughput
- First-come-first-served processing can delay higher-risk patients
- Clinical context gets fragmented across field worker, lab, and doctor roles
- AI prototypes often fail deployment reality because they assume constant connectivity, ignore privacy constraints, or produce outputs that are difficult to audit

In other words, the problem is not only medical classification. It is coordination.

---

## The core idea

This project is based on a practical workflow idea.

If sputum can be collected and transported under workable field conditions, then a patient does not necessarily need to enter the testing system only by physically waiting in a walk-in queue. A field worker can screen multiple households, collect relevant information and samples, and feed a structured, risk-aware queue into the system when connectivity returns.

That changes the operational logic from this:

Walk-in arrival -> generic queue -> delayed review

to this:

Field screening -> offline capture -> asynchronous inference -> ranked triage queue -> targeted review

The project therefore focuses on prioritization, workflow continuity, and clinical explainability, not just raw model scoring.

---

## Why this project exists

India carries a very large share of the global tuberculosis burden, and frontline case finding often depends on ASHA workers operating in difficult conditions: limited infrastructure, patchy connectivity, constrained device quality, and communities where time spent traveling for care can directly translate into lost daily wages.

That changes the nature of the product problem.

A lot of AI healthcare prototypes focus only on prediction quality. But in rural TB screening, the central problem is often not just "can a model score risk?" It is "can a system fit into the real workflow of field collection, sample movement, queue management, doctor review, and public health operations?"

That is what this project was built to explore.

---

## What the platform does

MedGemma TB Triage models the workflow through four user roles.

### 1. ASHA worker

The ASHA-facing interface is designed for first-mile screening in the field.

An ASHA worker can:

- Register patients
- Record cough audio
- Enter structured symptom metadata
- Continue working without internet
- Sync records later when connectivity returns

The design goal is practical usability. The product is meant to fit the field workflow rather than ask the field worker to adapt to a technically impressive but unrealistic system.

### 2. Lab technician

The lab interface receives queued patients and samples in a structured order. Rather than treating everything as a flat incoming stream, the system supports risk-aware prioritization and report upload workflow.

### 3. Doctor

The doctor dashboard presents ranked patients with:

- Calibrated risk score
- Risk tier
- Triage status
- Short AI-generated clinical summary
- Operational action context
- Manual ranking override controls

The doctor remains in control. This is not an autonomous triage engine. It is a prioritization and explainability layer that helps clinicians review faster and with better context.

### 4. Admin / control tower

The admin view provides a higher-level operational dashboard:

- Total users and facilities
- Stale sync monitoring
- Queue pressure
- Missing assignment alerts
- Status distribution
- High-level throughput visibility

This role-based separation matters because the project is not just a single-screen AI demo. It is a multi-role care coordination prototype.

---

## System walkthrough

At a high level, the platform works like this:

1. An ASHA worker screens a patient in the field
2. The app captures structured metadata and cough audio
3. The record can remain local while offline
4. When connectivity returns, the data syncs to the backend
5. A backend trigger determines whether the case is eligible for inference
6. Eligible cases are queued for asynchronous processing
7. The inference service loads the patient record and audio
8. The risk model computes a calibrated triage score
9. MedGemma generates a concise clinical summary
10. AI outputs are written back to the patient record under `ai.*`
11. Doctor, Lab, and Admin views update based on the shared backend state

The important design point is that this is not synchronous "submit form and wait" AI. The product is intentionally built as an event-driven workflow system because that better matches the constraints of low-connectivity field operations and backend model serving.

---

## Architecture overview

The platform follows this end-to-end flow:

- ASHA app captures patient metadata offline
- Cough audio is uploaded and stored in cloud storage when sync is available
- Patient records are written to Firestore
- A Firebase Function detects eligible patient updates
- Eligible cases are enqueued through Cloud Tasks
- A private Cloud Run inference service processes the patient record and audio
- The inference service writes AI outputs back under `ai.*`
- Doctor, Lab, and Admin dashboards read from the shared backend state

### Main architectural choices

#### Offline-first frontend

The frontend is designed so that the field workflow can continue even when the network fails.

#### Event-driven backend

Inference is asynchronous and queue-based rather than directly tied to frontend request latency.

#### Private inference boundary

Sensitive patient-related inference is routed through a private cloud service rather than public API calls.

#### Shared operational state

Firestore serves as the backend state layer that all role-based dashboards observe.

---

## Machine learning and AI pipeline

The ML stack is intentionally modular. Different components handle different responsibilities.

### 1. Acoustic feature extraction

Cough audio is processed using Google HeAR as a feature extractor.

Because raw recordings vary in length, the pipeline:

- Resamples audio to 16 kHz
- Splits recordings into overlapping 2-second windows
- Pads shorter clips when necessary
- Extracts embeddings window by window
- Aggregates these embeddings into a patient-level acoustic representation

This produces a stable acoustic fingerprint that can be consumed by downstream models.

### 2. Structured clinical modeling

Clinical metadata is modeled separately from audio. This includes symptom-related and patient-context features that should not be collapsed into the same representation as the acoustic pathway.

### 3. Stacked ensemble

The final risk score comes from a stacked architecture:

- An acoustic expert model
- A clinical expert model
- A supervisor model that fuses both probabilities

The output is a calibrated risk score designed for ranking and triage.

### 4. MedGemma summary generation

MedGemma is used to generate concise, clinician-facing summaries that explain why a patient is being surfaced higher in the queue.

These summaries are intended to be:

- Short
- Readable
- Clinically relevant
- Useful under time pressure

The goal is not open-ended reasoning. The goal is fast human review.

### 5. Deterministic action generation

Operational next steps are generated by a rule-based policy layer rather than free-form LLM output.

That makes the action layer:

- More consistent
- Easier to audit
- Safer for triage workflow support

This separation is deliberate:

- ML model for risk
- MedGemma for explanation
- Rules for next-step actions

---

## Why MedGemma was used

MedGemma was not used as the primary classifier, and that was a conscious design decision.

A triage ranking system needs numeric output that is calibrated, stable, and easy to evaluate. That is better handled by the structured risk model.

MedGemma adds value in a different place: it can synthesize multiple signals into a short, readable explanation that a clinician can scan quickly.

A rigid template system would often be too limited, while a general-purpose model would not be as suitable for clinically framed summary generation. MedGemma offered a stronger fit for concise medical-context summarization.

So the system uses MedGemma where it is most useful:

- Not to replace the risk model
- Not to replace clinician judgment
- But to improve explainability and speed of review

---

## Why HeAR mattered

HeAR was a major part of the technical story in this project because it allowed the system to use cough audio as a meaningful signal without training an end-to-end audio foundation model from scratch.

The practical contribution of HeAR in this pipeline was:

- Turning variable real-world cough recordings into structured embeddings
- Enabling the acoustic branch of the ensemble
- Providing a reusable audio representation that could be fused with clinical metadata

This matters because TB screening in the field is noisy, device quality varies, and hand-engineering a complete acoustic representation pipeline would be far less practical. HeAR provided a strong intermediate layer between raw cough audio and the final triage model.

---

## Model performance

The modeling work emphasized clinical safety in the high-sensitivity region, not only generic average-case classification quality.

### Why pAUC mattered

A triage system should not be judged only by ROC-AUC in the abstract. In this setting, missing higher-risk patients is especially costly. That is why the project focused on partial AUC in a high-sensitivity operating region, which better reflects triage usefulness.

### Reported performance

Across 5-fold cross-validation, the pipeline achieved:

- Mean ROC-AUC: `0.7978`
- Mean pAUC@90% sensitivity: `0.9655`

### Fold-level pAUC@90%

- `0.9681`
- `0.9682`
- `0.9815`
- `0.9619`
- `0.9480`

### Interpretation

These results suggest that the system performed especially well in the region that matters most for triage prioritization: preserving strong behavior at high sensitivity rather than optimizing only broad average discrimination.

That distinction is important. A model can have acceptable overall ROC-AUC and still be weak in the exact region where a triage workflow needs reliability.

---

## Dataset and training basis

The modeling work used the CODA TB DREAM Challenge dataset, a large cough-audio dataset with associated TB evaluation information collected across multiple countries.

The pipeline was built to handle one of the core practical issues in this setting: cough clips are variable in length, while the acoustic feature extractor expects fixed-length input windows. The preprocessing and aggregation logic was designed specifically to bridge that mismatch.

Training artifacts, experiment history, and notebook work are preserved in the research section of the repository.

---

## Data flow and backend orchestration

The backend is designed around a production-style asynchronous inference workflow.

### Inference lifecycle

1. A patient record is written or updated
2. A Firestore-triggered function checks whether the case is inference-eligible
3. Eligible cases are enqueued into Cloud Tasks
4. Cloud Tasks invokes a private Cloud Run inference endpoint using OIDC
5. The inference service loads patient metadata and audio
6. The service runs the model pipeline
7. Outputs are written back to the record under `ai.*`

### Why this approach was used

This design supports:

- Idempotency
- Retries
- Durable queueing
- Reduced duplicate inference calls
- Better separation between user interaction and heavy backend processing

That makes it much more realistic than a one-shot synchronous AI endpoint tied directly to a screen action.

---

## Offline-first behavior

The offline-first ASHA workflow is one of the most important product decisions in the repository.

### What offline-first means here

- Data can be created locally
- Pending records can sit safely on device storage
- Connectivity is not required for the core field workflow
- Sync happens later
- The user experience is built around intermittent connectivity rather than assuming always-online behavior

### Technical basis

The frontend uses local persistence through IndexedDB via Dexie.js for:

- Locally captured patient data
- Pending upload state
- Synchronization continuity

This matters because low-connectivity usability is not a nice-to-have in this domain. It is central to whether the product makes sense at all.

---

## Role-based product design

One of the strengths of the project is that it maps the UI and workflow to real operational roles.

### ASHA

Community-level first-mile capture and sync.

### Lab

Structured queue and testing workflow.

### Doctor

Prioritized review, clinical context, and human override.

### Admin

Facility-level and district or TU-style operational visibility.

This is important because healthcare workflow systems fail when they collapse everyone into one generic dashboard. The product becomes much more credible when handoffs and responsibilities are explicitly modeled.

---

## Data safety and privacy posture

This project was built with data governance and operational realism in mind.

### AI writes only to `ai.*`

One of the most important system rules is that inference only writes AI-derived outputs into a dedicated namespace.

Examples include:

- `ai.hear_score`
- `ai.risk_score`
- `ai.risk_level`
- `ai.medgemma_summary_en`
- `ai.medgemma_summary_hi`
- `ai.action_items_en`
- `ai.action_items_hi`
- `ai.generated_at`
- `ai.model_version`
- `ai.inference_status`
- `ai.error_message`

This prevents inference from overwriting source-of-truth operational and clinical fields such as:

- Demographics
- Symptoms
- Status
- Assignment
- Metadata
- Audio references

### Private-cloud inference

The architecture avoids depending on public medical-data API calls for core inference. This was part of the deployment realism of the project and reflects a stronger privacy and governance posture.

### Role-based access patterns

The codebase also includes role-aware access control patterns for data and storage, aligning with the multi-role nature of the application.

---

## Repository structure

```text
backend/
  main.py
  populate_db.py
  cloud-backend/
    inference-service/
    functions/
    deploy_workbench.sh
    report_inference_status.py

frontend/
  app/
  components/
  lib/
  deploy_cloud_run.sh

research/
  model-training-notebooks/
```

### Structure notes

#### `frontend/`

Contains the Next.js application and role-based UI flows.

#### `backend/`

Contains backend sync logic, orchestration, utilities, and deployment helpers.

#### `cloud-backend/inference-service/`

Contains the private inference-serving logic.

#### `functions/`

Contains event-driven backend function logic, including inference enqueue behavior.

#### `research/model-training-notebooks/`

Contains notebook history, experimentation, and model development artifacts.

---

## Research and training artifacts

The repository includes training and experimentation material so readers can follow the model-development story, not just the product surface.

This is valuable because it shows:

- How the model evolved
- How performance was measured
- What technical constraints were encountered
- How the final pipeline design was chosen

This strengthens the repository as a technical showcase even after the live deployment is taken down.

---

## Why this is more than a hackathon demo

A lot of AI project repositories fall into one of two buckets:

1. A notebook with an interesting model but no real workflow integration
2. A polished UI with mock or shallow AI behind it

This project tried to avoid both extremes.

It includes:

- A real workflow problem
- Offline-first product design
- Multi-role interfaces
- Asynchronous backend orchestration
- Actual acoustic plus clinical modeling
- MedGemma used for a specific explainability role
- Deterministic action logic
- A privacy-conscious deployment approach
- Human override in the doctor workflow

That combination is what makes it interesting. The goal was not just to prove that a model can score something. The goal was to show what it might look like to embed models into a realistic rural public health triage pipeline.

---

## Limitations

This is still a prototype, and it has important limitations.

### Audio variability

Real-world cough recordings vary by:

- Device quality
- Recording distance
- Background noise
- User behavior
- Environmental conditions

### Generalization

The system still needs stronger prospective validation across:

- Regions
- Dialects
- Populations
- Devices
- Deployment conditions

### Product hardening

A production rollout would require deeper testing around:

- Sync conflicts
- Partial uploads
- Duplicate records
- Corrupted audio
- Permission edge cases
- Degraded inference service behavior
- Audit trail integrity

### Clinical deployment

This project is a triage and workflow prototype, not a production medical device or standalone diagnostic authority.

---

## Future work

There are several directions that would meaningfully strengthen the platform.

### Model and product improvements

- Prospective field pilots
- Stronger real-world evaluation on queue outcomes and throughput
- Improved recording quality guidance on device
- Tighter summary consistency through adaptation or fine-tuning
- More robust analytics and outcome tracking
- Stronger multilingual support
- Deeper integration with public health reporting workflows

### Deployment improvements

- Regional infrastructure alignment
- Stronger operational monitoring
- More robust failure-mode handling
- Warm-start mitigation for heavy inference services
- Better packaging for managed device rollout

---

## Current status of the repository

The original competition deployment is being retired, so this repository should now be read primarily as:

- A technical showcase
- A product systems demo
- An architecture artifact
- A model-and-workflow integration project

The codebase, video, and documentation are now the primary way to understand the project.

---

## Competition context

This project was created for the MedGemma Impact Challenge.

The broader goal was to demonstrate how open healthcare models can support human-centered applications in settings where privacy, deployment realism, and workflow fit matter as much as raw model capability.

The core thesis of this work was:

> AI should not just predict risk in isolation. It should help move the right patient forward sooner inside the real system that care actually flows through.

---

## Author

**Jerardh Josekutty**  
AI Engineer / Builder / Solopreneur

Built the project end to end, including:

- Product concept
- Offline-first workflow
- Frontend interfaces
- Backend orchestration
- ML risk pipeline
- MedGemma integration
- Role-based dashboards
- Deployment architecture
- Feasibility framing

---

## Notes

- Any screenshots, seeded records, or walkthrough data in this repository are for demonstration purposes.
- Demo records should not be interpreted as real patient data.
- This repository is intended as a technical and product showcase and not as medical advice.
