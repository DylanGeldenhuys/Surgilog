# Theatre register and executive reporting proposal

Source analysis dated 15 October 2026. **Historical proposal; see the [implemented local preview](theatre-register.md) for current status (16 October).** Dylan subsequently approved development with existing planned session hours and Admin-configurable 15–30-minute turnaround. The preview was subsequently published to the fictional-data review on 16 October; it is not clinically approved. Dylan supplied a pasted conversation attributed to Tobela and Claude; the workbook, scans and generated attachments were not supplied. This document deliberately excludes patient identifiers, transcribed rows and the raw conversation.

## What the conversation establishes

The requested product combines a single theatre activity register, views by operating location, and executive efficiency reporting. It complements Leo's backlog/planning reference; it does not supersede confirmed backlog priorities, permissions or offline requirements.

Explicit requests/answers in the supplied conversation:

- Enter activity once, then automatically populate each relevant theatre view and operation-type totals. Include ICU alongside theatres and Day Theatre; these are operating locations, distinct from clinical departments.
- Executive outputs for weekly, monthly, quarterly and annual periods, prioritising utilisation, cases/procedures completed, average turnaround and average starting time. Financial year starts in April; quarters are Apr–Jun, Jul–Sep, Oct–Dec and Jan–Mar.
- Match department reporting labels to the actual department list. Monthly surgeon/anaesthetist activity summaries were requested (case count, total time, average time per case).
- Enter age directly when historical registers contain age rather than DOB. Never infer a purported exact DOB from age.
- Interpret source dates as DD/MM/YYYY. Gastro/colonoscopy entries in the discussed source map to Day Theatre and General Surgery, without a new department. This is a source-specific mapping, not a universal hospital rule.
- Support reviewed transcription of scanned handwritten registers and a printable review output. Later instruction permitted monthly draft batches for subsequent verification; that is not equivalent to approving the extracted values.

The chat also discusses admission/operation dates, patient reference/name, age/sex, ward, department, theatre, procedure, start/end, surgeon, assistant and anaesthetist. These establish candidate fields, not a complete approved data dictionary. Anaesthetic drug/dose and a source major/minor notation were noticed but no final handling is established.

## App gaps at the time of analysis (superseded by the preview)

Existing foundations: patients separate from surgical cases, scoped roles, session/booking conflict checks, entry/completion timestamps, audit and idempotency, encrypted offline entry, recorded-event metrics and aggregate reporting.

Constraints identified before implementation (not a current feature list):

- Actual activity is attached to a prior case/booking/session; there is no dedicated retrospective register import or unplanned-procedure workflow.
- Patient DOB is required in the current schema. Ward/admission date, recorded historical age, assistant, anaesthetist and multiple actual procedures are not structured register fields.
- Bookings have `inAt`/`outAt` (theatre entry/exit), which must not silently become incision/closure or anaesthesia times.
- Theatre and surgeon resources are currently strings. There is no full location/team directory or recurring capacity/downtime model.
- Existing utilisation measures recorded occupancy within staffed sessions. Current performance reporting does not implement Tobela's complete four-period executive dashboard or staff activity tables.
- CSV import creates waiting cases, not historical completed operations. It cannot safely serve as the register import without additional contracts.
- Pilot collection caps and unbounded report fan-out need addressing before a full financial-year workload; merely adding yearly filters would not solve this.

## Recommended shape

Keep one app and one authoritative dataset. Add a **Theatre Register** for actual activity alongside **Theatre Planning** for intended activity and **Surgical Backlog** for people awaiting care. Extend **Performance** with period selection, theatre/department breakdowns, graphs and an aggregate printable executive summary. The new navigation and reports are now implemented locally; the preview currently uses a single selected department.

An operative encounter should support several actual procedures and clinicians, an operating location, event timestamps, provenance and a verification state. Link to the existing patient/case/booking when genuinely known. Allow authorised recording of historical/unplanned activity without inventing a booking, urgency assessment or backlog waiting clock. Define this workflow's nurse/clerk permissions explicitly while preserving the existing prohibition on booking/cancelling/reprioritising.

Preserve actual DOB where known; add recorded age with unit and an as-of/operation date when only age is known. Historical recorded age must not change as the patient gets older. Keep source sex terminology distinguishable from the app's gender field pending clinical agreement. Admission-to-operation interval and backlog waiting time are different measures.

Retain detailed historical records continuously. Date-filtered theatre/month views replace workbook copying and month-end clearing. Fiscal reports should identify their year explicitly (e.g. FY 2026/27 is 1 Apr 2026–31 Mar 2027). Define week boundaries and treatment of partial weeks with the hospital.

## Definitions to settle before graphs

1. **Capacity and utilisation.** Claude adopted seven hours multiplied only by days with operations; the option prompt supporting that choice is absent. This can hide idle staffed days. Use explicitly recorded available/staffed capacity, including unused available sessions, and identify closures/downtime. Agree on elective, emergency, overtime, ICU and Day Theatre denominators. Do not assume every location has identical hours or copy seven hours into the app.
2. **Starting time.** Specify first patient in theatre, anaesthetic start or procedure start. Average the first relevant event per eligible session/day, not all case starts. Show delayed starts against planned times and missing-data coverage separately where appropriate.
3. **Turnaround.** Define endpoints, typically previous patient out to next patient in for the same location/list. A last case without a next case has no observation. Distinguish overnight/closed intervals and missing or overlapping times; do not copy an arbitrary long-gap exclusion just because a workbook formula returned a spurious 13-hour result. The original fixed 15-minute allowance is superseded by the Admin-configurable 15–30-minute preview setting; it remains a planning estimate, not an actual measurement.
4. **Counts and duration.** Cases, encounters and individual procedures need distinct counts. Duration categories in the chat overlap (`<30` also satisfies `<90`) and omit exactly 90 minutes (`>90` versus `<90`). Decide whether nested indicators or mutually exclusive duration bands are wanted. Duration alone must not silently assert clinical major/minor classification.
5. **Roll-ups.** Aggregate utilisation as total eligible occupied minutes / total available minutes; carry sums and observation counts for weighted turnaround/duration means. Never average monthly percentages or means without their denominators. Missing observations remain unknown, not zero.
6. **Staff reporting.** Case volume and duration describe activity, not comparative clinical quality. Define attribution for multiple surgeons/assistants/anaesthetists and case mix. Staff directory membership must not automatically grant an application login or access.

## Imports and scanning

Start with manual entry and a structured CSV import preview. Proposed later scan flow: restricted upload → extracted draft rows → source-linked uncertainties → authorised verification/correction → duplicate checks → idempotent import → audit. Unverified drafts should be excluded from official totals; keep source-page/row provenance and record who verified them. Establish source retention, authorised access and the approved processing service before accepting identifiable scans. No patient data from the supplied chat was imported.

Do not inherit Claude's assurance that handwriting can be read reliably or that its generated workbook contains no formula errors. The conversation itself reports ambiguous identifiers, repeated corrections and only 11 records processed from 27 pages. We cannot independently inspect either the handwriting or formulas without attachments. No scanner purchase or OCR vendor choice is justified by this text alone.

## Suggested implementation order

1. Agree minimum register fields and timing/capacity/count definitions; design backward-compatible encounter and age support.
2. Build manual register entry, booking linkage, retrospective/unplanned recording, audited corrections and appropriate permissions/offline behaviour.
3. Add reviewed structured import, data-quality coverage and deduplication. Validate against synthetic representative records.
4. Add bounded server-side reporting and fiscal-period summaries with printable graphs; verify idle days, multiple procedures, midnight crossings, partial periods and weighted totals.
5. Add scan extraction as a separate draft/review workflow after the underlying register and verification process work.

The missing workbook would help validate exact dropdown lists and layouts, but it is not necessary to plan the structure above. None of these proposals changes the implemented clinical priority bands or authorises real-data import.
