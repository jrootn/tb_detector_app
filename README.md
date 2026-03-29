# MedGemma TB Triage
## Privacy-first, offline-first tuberculosis screening and triage for rural first-mile care workflows

MedGemma TB Triage is an end-to-end prototype for AI-assisted tuberculosis screening and triage designed around the realities of low-connectivity public health settings.

It was built to explore a very specific healthcare systems problem: in many rural TB workflows, the biggest failure is not lack of awareness, and not even lack of diagnostic tools. The real failure often happens in the gap between first-mile screening and timely testing. Field workers may identify symptomatic patients, but internet access is unreliable, lab throughput is limited, queues are often first-come-first-served, and higher-risk patients do not always move through the system quickly enough.

This project proposes a different workflow. Instead of treating screening as an isolated form-entry task, it treats triage as an operational pipeline:

- **ASHA workers collect data offline in the field**
- **cough audio and symptom metadata are synced when connectivity returns**
- **a private-cloud ML pipeline computes a calibrated TB triage risk score**
- **MedGemma generates concise clinician-facing summaries**
- **labs and doctors receive a ranked queue rather than an unprioritized stream**
- **admins get a control-tower view of workload, sync health, and bottlenecks**

The result is a full-stack, role-based system built around real deployment constraints rather than a benchmark-only AI demo.

---

## Table of Contents

- [Why this project exists](#why-this-project-exists)
- [The problem](#the-problem)
- [The core idea](#the-core-idea)
- [What the platform does](#what-the-platform-does)
- [Screenshots](#screenshots)
- [System walkthrough](#system-walkthrough)
- [Architecture overview](#architecture-overview)
- [Machine learning and AI pipeline](#machine-learning-and-ai-pipeline)
- [Why MedGemma was used](#why-medgemma-was-used)
- [Why HeAR mattered](#why-hear-mattered)
- [Model performance](#model-performance)
- [Data flow and backend orchestration](#data-flow-and-backend-orchestration)
- [Offline-first behavior](#offline-first-behavior)
- [Role-based product design](#role-based-product-design)
- [Data safety and privacy posture](#data-safety-and-privacy-posture)
- [Repository structure](#repository-structure)
- [Research and training artifacts](#research-and-training-artifacts)
- [Why this is more than a hackathon demo](#why-this-is-more-than-a-hackathon-demo)
- [Limitations](#limitations)
- [Future work](#future-work)
- [Competition context](#competition-context)
- [Author](#author)

---

## Why this project exists

India carries a very large share of the global tuberculosis burden, and frontline case finding often depends on ASHA workers operating in difficult conditions: limited infrastructure, patchy connectivity, constrained device quality, and communities where time spent traveling for care can directly translate into lost daily wages.

That changes the nature of the product problem.

A lot of AI healthcare prototypes focus only on prediction quality. But in rural TB screening, the central problem is often not just “can a model score risk?” It is “can a system fit into the actual workflow of field collection, sample movement, queue management, doctor review, and public health operations?”

That is what this project was built to explore.

---

## The problem

Many TB workflows still break down in the handoff between community screening and downstream clinical action.

Common failure points include:

- data is captured in locations with poor or no internet access
- symptomatic patients may delay testing because travel and waiting time cost income
- labs often work through queues with limited capacity
- first-come-first-served processing can delay higher-risk patients
- clinical context gets fragmented across field worker, lab, and doctor roles
- AI prototypes often fail deployment reality because they assume constant connectivity, ignore privacy constraints, or provide outputs that are hard to audit

In other words, the problem is not only medical classification. It is coordination.

---

## The core idea

This project is based on a simple but powerful workflow idea.

If sputum can be collected and transported safely under practical field conditions, then a patient does not necessarily need to enter the testing process only by physically waiting in a walk-in queue. A field worker can screen multiple households, collect relevant information and samples, and feed a structured, risk-aware queue into the system when connectivity returns.

That transforms the operational logic from this:

**walk-in arrival -> generic queue -> delayed review**

to this:

**field screening -> offline capture -> asynchronous inference -> ranked triage queue -> targeted review**

The project therefore focuses on **prioritization**, **workflow continuity**, and **clinical explainability**, not just raw model scoring.

---

## What the platform does

MedGemma TB Triage models the workflow through four user roles.

### 1. ASHA worker
The ASHA-facing interface is built for first-mile screening in the field.

An ASHA worker can:
- register patients
- record cough audio
- enter structured symptom metadata
- continue working without internet
- sync records later when connectivity returns

The design goal here is practical usability. The product is meant to fit the field workflow rather than ask the field worker to adapt to a technically impressive but unrealistic system.

### 2. Lab technician
The lab interface receives queued patients and samples in a structured order. Rather than treating everything as a flat incoming stream, the system supports risk-aware prioritization and report upload workflow.

### 3. Doctor
The doctor dashboard presents ranked patients with:
- calibrated risk score
- risk tier
- triage status
- short AI-generated clinical summary
- operational action context
- manual ranking override controls

The doctor remains in control. This is not an autonomous triage engine. It is a prioritization and explainability layer that helps clinicians review faster and with better context.

### 4. Admin / control tower
The admin view provides a higher-level operational dashboard:
- total users and facilities
- stale sync monitoring
- queue pressure
- missing assignment alerts
- status distribution
- high-level throughput visibility

This role-based separation matters because the project is not just a single-screen AI demo. It is a multi-role care coordination prototype.

---

## Screenshots

Because the live server is being retired, screenshots are important and should absolutely be included in the repository.

Recommended folder structure:

```text
docs/
  images/
    asha-dashboard.png
    doctor-dashboard.png
    lab-dashboard.png
    admin-dashboard.png
