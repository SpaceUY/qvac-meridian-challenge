# Meridian RAG benchmark — 215 questions (English reference)

Source: `docs/preguntas-rag-28-09.md` (2026-09-28, @Lucas), normalized to English for use as the
Stage 2 held-out evaluation set (I.5 LoRA spike) and as a general reference. IDs are preserved
exactly as in the source for traceability.

**Translation note:** the "In Spanish" category (IDs 193–202) exists specifically to test
multilingual query handling. Those 10 questions are kept in their **original Spanish** (that's
the literal text sent to the API) with an English gloss added in brackets — translating the
question itself would remove the thing that category tests. Everything else (questions, expected
answers, category notes) is in English. Two of the "answer" cells in that category also mix a
Spanish unit ("por unidad") into an otherwise-English answer in the source; normalized to English
below.

**Do not use any of these 215 as LoRA training examples** — they are held-out evaluation data for
the before/after comparison (Stage 2).

---

## Ad-hoc findings (context only — not part of the 215-question bench)

These 13 questions were run manually against the live API on 2026-09-28 and are **not** part of
the scored 215-question bank. Kept here because they're a useful early signal of failure modes
(quarter-boundary confusion, ARR-vs-revenue confusion, follow-up context loss, an infinite-loop
bug, and an image-based trap question) worth checking whether the formal bench also catches.

### Front-end captures (6)

Six confusing questions Lucas asked in the frontend, repeated against the real API. Only #3 passed.

| # | Question | What happened |
|---|---|---|
| 1 | What was last quarter's revenue and NPS? | **Fails.** The Q1 summary (titled "Prior Quarter Reference") wins retrieval and occupies all 3 slots; answers $16.2M / NPS 41, which are Q1 figures. Correct answer: Q2, $18.4M / NPS 47. |
| 2 | How much revenue did Atlas contribute in Q2? | **Model failure.** The correct chunk is retrieved, but the model confuses ARR ($2.35M, the signed/booked amount) with recognized revenue. |
| 3 | An AE wants to give a multi-site customer the 8% package plus an extra 5% discount. Can the AE approve that alone? | **Correct.** |
| 4 | Can I promise a customer a ControLink Gateway rev C by end of July? What lead time should I quote? | Alone: mostly right, though it contradicts itself on lead times. Asked right after questions 1–3 in the same conversation: **infinite loop**, repeats the same sentence; cut off at 150s. |
| 5 | Did Helix Robotics sign? What did they decide? | Doesn't invent an answer, but doesn't explicitly say the decision isn't in the corpus either. |
| 6 | And P2? (follow-up to the previous question) | The retriever sees only "And P2?" with no prior turn context; nothing clears the 0.54 gate, so the fixed insufficient-context refusal fires. |
| Extra | What was Q2 2026 total revenue? (textual example from the challenge PDF) | With `maxContextChunks=3`, the Q2 report ranks 5th and never reaches the model; with `maxContextChunks=5` it does. |

### Leo's QA pass (7)

Leo's 7 QA questions from his 2026-09-24 report, in Spanish, asked in order in a single
conversation. As of 2026-09-28 they score 3/7 correct, at both `maxContextChunks=3` and `=5`.

| # | Question (Spanish, as tested) | Question (EN gloss) | Correct answer (source) | Result @ top-3 | Result @ top-5 |
|---|---|---|---|---|---|
| L1 | ¿Cuál fue el revenue reconocido en Q2 2026? | What was recognized revenue in Q2 2026? | $18.4M (`reports/q2-2026-sales-performance-report.md`). $8.1M is Americas only | Correct, but attributes it to the Q1 report | Correct and clean |
| L2 | ¿Cuánto es la garantía estándar de ServoDrive X4? | What is the standard warranty for ServoDrive X4? | 24 months (`policies/warranty-terms.md`); 36 is the extended warranty | Correct | Correct |
| L3 | ¿Cuál es el revenue del trimestre actual? | What is current-quarter revenue? | Q3 only has a forecast, $19.8M; the last closed quarter is Q2, $18.4M | Refuses to answer | Refuses to answer |
| L4 | ¿Por qué el margen bruto de ControlLink Gateway está bajo presión? | Why is ControlLink Gateway's gross margin under pressure? | Trap: no document states this; correct behavior is to say there's no information | Refuses (correct) | Refuses (correct) |
| L5 | ¿Cuál es la cuenta en la watchlist de CS y cuándo vence su EBR? | Which account is on the CS watchlist and when is its EBR due? | Riverton Motors, EBR 11 Jul 2026 (requested: before 15 Jul); Kelso Plastics also applies | Wrong: Atlas, Aug 8 | Wrong: Atlas, Aug 8 |
| L6 | ¿Cuánto creció el revenue de EMEA de Q1 a Q2 en dólares y porcentaje? | How much did EMEA revenue grow from Q1 to Q2, in dollars and percent? | $5.4M → $6.2M: +$0.8M, ~+14.8% (the report's own "+11%" is against target, not Q1) | Refuses to answer | Gets the dollar figure right, miscalculates the percentage (15.2%) |
| L7 | ¿Qué SKUs están en la lista de precios y cuál es su precio? | Which SKUs are on the price list and what do they cost? | SD-X4-001 $48,500 · CL-SUITE-SEAT $1,200 · CL-GW-REV-B $6,800 · CL-GW-REV-C $7,200 · CL-PDM-SITE $18,000 | Prices right, invents SKU codes | Same issue |

---

## The 215-question benchmark

### Easy bank (100) — IDs 001–100

One question per corpus file, a single fact and a single source, ordered by file. All in English.

| ID | Question | Expected answer | Source file |
|---|---|---|---|
| 001 | What is Atlas Manufacturing's health score as of the Q2 close? | 72 | data/account-health-q2-close.json |
| 002 | Who is the named CSM for Riverton Motors? | Priya Nair | data/account-health-q2-close.json |
| 003 | What is Kelso Plastics' health score, and which region is it in? | 35, EMEA | data/account-health-q2-close.json |
| 004 | What is the watchlist threshold used in the account health snapshot? | 40 | data/account-health-q2-close.json |
| 005 | What is the ARR value listed for Helix Robotics in the account health file, and why is it $0? | $0 — it's still open pipeline (OPP-90112, $910,000 if won), not yet closed | data/account-health-q2-close.json |
| 006 | As of the Q2 close, what is Pinnacle Foods' current ARR before its expansion takes effect? | $620,000 | data/account-health-q2-close.json |
| 007 | What is the unweighted open pipeline for EMEA as of June 30, 2026? | $5.1M | data/regional-pipeline-snapshot.csv |
| 008 | What is the Q3 2026 revenue plan for APAC? | $4.4M | data/regional-pipeline-snapshot.csv |
| 009 | What is the total unweighted open pipeline across all regions? | $14.7M | data/regional-pipeline-snapshot.csv |
| 010 | What is the weighted pipeline coverage ratio against the Q3 new ARR target? | 3.4x | data/regional-pipeline-snapshot.csv |
| 011 | What is the SKU code for the ControLink Gateway revision B? | CL-GW-REV-B | data/sku-list-prices.csv |
| 012 | What is the list price of the Predictive maintenance module? | $18,000 per site/year | data/sku-list-prices.csv |
| 013 | What is the list price and unit for ControLink Suite? | $1,200 per seat/year | data/sku-list-prices.csv |
| 014 | Which SKU has a defect rate of 1.9%? | CL-GW-REV-C (ControLink Gateway rev C) | data/sku-list-prices.csv |
| 015 | Who sent the email announcing the Atlas Manufacturing deal closed, and what is their title? | Maya Chen, VP Enterprise Sales | emails/001-atlas-deal-closed.md |
| 016 | What is the opportunity ID for the Atlas Manufacturing deal? | OPP-88421 | emails/001-atlas-deal-closed.md |
| 017 | When does the press embargo lift for the Atlas announcement? | 16 June 2026, 09:00 ET | emails/001-atlas-deal-closed.md |
| 018 | What are the billing terms for the Atlas Manufacturing contract? | annual in advance, net-30 | emails/001-atlas-deal-closed.md |
| 019 | What is the contract number for the Pinnacle Foods expansion amendment? | CTR-PIN-2024-019-A2 | emails/002-pinnacle-expansion.md |
| 020 | How many ControLink Suite seats did Pinnacle Foods add in its expansion? | 120 | emails/002-pinnacle-expansion.md |
| 021 | When is Pinnacle Foods' next renewal date? | 15 March 2027 | emails/002-pinnacle-expansion.md |
| 022 | Which two sites were added in the Pinnacle Foods expansion? | Cincinnati plant + Montreal DC | emails/002-pinnacle-expansion.md |
| 023 | Who locked the Q3 2026 forecast, and what is their title? | Elena Varga, VP Finance | emails/003-q3-forecast-lock.md |
| 024 | What is the assumed logo churn ceiling in the Q3 forecast? | ≤3.5% | emails/003-q3-forecast-lock.md |
| 025 | What approval is required for forecast changes after July 1, 2026? | CFO + CRO dual approval | emails/003-q3-forecast-lock.md |
| 026 | What is the Q3 2026 gross margin plan, and how does it compare to Q2's actual? | 34.0% plan vs 34.5% actual Q2 (slightly lower) | emails/003-q3-forecast-lock.md |
| 027 | Who is the Chief People Officer at Meridian, based on the Q3 hiring plan email? | Sam Okonkwo | emails/004-hiring-plan.md |
| 028 | How many contractors does Meridian have, and are they counted in the FTE headcount? | 27, excluded from FTE | emails/004-hiring-plan.md |
| 029 | What are the three priority geographies for the Q3 AE/SE hires? | Chicago, Munich, Singapore | emails/004-hiring-plan.md |
| 030 | What is the estimated fully-loaded annual budget impact of the 18 new Q3 hires? | ~$2.1M | emails/004-hiring-plan.md |
| 031 | Why was Q2's ARR churn (3.8%) higher than the logo churn (3.1%)? | lost one mid-market account with above-average spend | emails/005-churn-alert.md |
| 032 | Which logo was lost in Q2 due to a plant closure, and how much ARR did it represent? | BrightForge Tooling, $95,000 | emails/005-churn-alert.md |
| 033 | Which logo was lost in Q2 due to competitor displacement on price? | NovaPack EU, $140,000 | emails/005-churn-alert.md |
| 034 | What deadline did Priya Nair recommend for a joint EBR with Riverton Motors? | before 15 July 2026 | emails/005-churn-alert.md |
| 035 | How many respondents were in the June 2026 NPS pulse survey, and what was the response rate? | 186 respondents, 22% response rate | emails/006-nps-pulse.md |
| 036 | What percentage of June NPS respondents were detractors? | 11% | emails/006-nps-pulse.md |
| 037 | What are the top two detractor themes named in the June NPS pulse? | onboarding timeline, spare-parts lead time | emails/006-nps-pulse.md |
| 038 | What NPS target is Meridian holding for the end of Q3 2026? | ≥50 | emails/006-nps-pulse.md |
| 039 | What is the workaround/restore target for a P2 ticket? | 72 hours | emails/007-sla-reminder.md |
| 040 | What was the Q2 actual mean first-response time for P1 tickets? | 2.6 hours | emails/007-sla-reminder.md |
| 041 | On what two dates did P1 SLA breaches occur in May, and why? | 3 May and 19 May, during a regional on-call gap in APAC | emails/007-sla-reminder.md |
| 042 | Who is the Head of Technical Support at Meridian? | Diego Morales | emails/007-sla-reminder.md |
| 043 | What was Meridian's on-time delivery percentage in Q2 2026? | 96.2% | emails/008-quality-board.md |
| 044 | What is the target band for inventory days on hand, and what was the actual Q2 figure? | 35–45 days target, 42 days actual | emails/008-quality-board.md |
| 045 | How long was the outgoing burn-in test extended to under CAPA-441, and from what? | from 2 hours to 6 hours | emails/008-quality-board.md |
| 046 | What is the estimated quarterly cost of the CAPA-441 containment measure? | ~$85,000 | emails/008-quality-board.md |
| 047 | In which city did the Helix Robotics technical validation demo take place? | Stuttgart | emails/009-helix-demo-complete.md |
| 048 | What is Helix Robotics' commit category as of the June 26 demo, and when can it change? | Upside; only after Helix's decision email | emails/009-helix-demo-complete.md |
| 049 | What competitor is Meridian competing against for the Helix Robotics deal? | AxisMotion | emails/009-helix-demo-complete.md |
| 050 | On what date is Helix Robotics' decision expected? | 10 July 2026 | emails/009-helix-demo-complete.md |
| 051 | What time is the Riverton Motors EBR scheduled for on July 11, 2026? | 14:00 ET | emails/010-riverton-ebr-scheduled.md |
| 052 | What is the goal of the Riverton Motors EBR? | unblock adoption on lines 3–5 (currently live on 2 of 5) | emails/010-riverton-ebr-scheduled.md |
| 053 | Which two Meridian employees are attending the Riverton Motors EBR? | Priya Nair and Jordan Blake | emails/010-riverton-ebr-scheduled.md |
| 054 | What is the standard spare-parts lead time for the APAC region? | 18 business days | emails/011-spare-parts-lead-time.md |
| 055 | What surcharge applies for expedited (air) spare-parts shipping? | +40% | emails/011-spare-parts-lead-time.md |
| 056 | Above what parts value does an expedited shipment require Ops approval? | $25,000 | emails/011-spare-parts-lead-time.md |
| 057 | What is the interim checkpoint target for onboarding time, and by when? | ≤38 days by 15 August 2026 | emails/012-onboarding-remediation.md |
| 058 | How many CSMs make up the new onboarding squad, and how are they sourced? | 3 CSMs: 2 from existing roster, 1 from the Q3 CSM hires | emails/012-onboarding-remediation.md |
| 059 | Which account is the pilot for the new onboarding playbook? | Atlas Manufacturing (Cincinnati line) | emails/012-onboarding-remediation.md |
| 060 | According to the H2 FY2026 list pricing update, what is the list price of the ControLink Gateway rev B? | $6,800 per unit | emails/013-list-pricing-update.md |
| 061 | Who published the H2 FY2026 list prices? | Elena Varga, VP Finance | emails/013-list-pricing-update.md |
| 062 | What is the maximum discount a VP of Enterprise Sales can approve without further approval? | 20% | emails/014-discount-authority.md |
| 063 | Does the 8% multi-site package discount count toward an AE's discount ceiling, or is it separate? | It counts toward the ceiling (not additive) | emails/014-discount-authority.md |
| 064 | What approval is required for a discount above 20% off list? | CFO + CRO dual approval | emails/014-discount-authority.md |
| 065 | What is the target go-live date for Atlas Manufacturing's Cincinnati production line? | 8 August 2026 | emails/015-atlas-kickoff-complete.md |
| 066 | When is phase 2 (Montreal DC ControLink seats) targeted for Atlas Manufacturing? | mid-September 2026 | emails/015-atlas-kickoff-complete.md |
| 067 | Within how many business days will Ops reconfirm ETAs for existing ControLink Gateway rev C purchase orders? | five business days | emails/016-capa-441-ship-hold.md |
| 068 | Which ControLink Gateway revision should be quoted for any commitment that must ship in July? | rev B | emails/016-capa-441-ship-hold.md |
| 069 | By approximately what percentage was AxisMotion's price below Meridian's on the deal that led to losing NovaPack EU? | ~12% | faqs/competitor-displacement-notes.md |
| 070 | According to the competitive displacement talking points, what should a rep do before matching AxisMotion's price verbally? | open a deal-desk ticket | faqs/competitor-displacement-notes.md |
| 071 | According to the internal Support SLA FAQ, when did the APAC on-call roster gap that caused May's P1 breaches close? | 15 June 2026 | faqs/support-sla-faq.html |
| 072 | Per the Support SLA FAQ, how quickly must a P1 ticket escalate from L1 to L2 internally? | within 30 minutes | faqs/support-sla-faq.html |
| 073 | What happens if a P1 ticket gets no L2 acknowledgment within 15 minutes, per the escalation matrix? | the on-call engineer is paged | policies/escalation-matrix.txt |
| 074 | What is the internal escalation clock for a P2 ticket from L2 to Engineering? | within 8 hours | policies/escalation-matrix.txt |
| 075 | What is the document ID of the Support Escalation Matrix? | SUP-ESC-2026-002 | policies/escalation-matrix.txt |
| 076 | According to the Field Service Offline SOP, how old can the offline knowledge pack get before the assistant must show a "stale" warning? | 10 days | policies/field-service-offline-sop.md |
| 077 | What is the weakest supported field laptop specification named in the offline SOP? | a 2019 business laptop, 8GB RAM, integrated graphics | policies/field-service-offline-sop.md |
| 078 | What is the target refresh cadence for the offline knowledge pack when a field laptop is on the Meridian network? | at least weekly | policies/field-service-offline-sop.md |
| 079 | What is the standard hardware warranty period on Meridian equipment? | 24 months from ship date | policies/warranty-terms.md |
| 080 | How much does the extended warranty cost, and what coverage period does it provide? | 8% of first-year ARR (or hardware list), extends to 36 months | policies/warranty-terms.md |
| 081 | What is the RMA turnaround target after a unit is received at the regional depot? | 10 business days | policies/warranty-terms.md |
| 082 | Where are Meridian's regional depots located? | Chicago (Americas), Munich (EMEA), Singapore (APAC) | policies/warranty-terms.md |
| 083 | According to the FY2026 product catalog, what was ServoDrive X4's Q2 revenue? | $7.6M | reports/fy2026-product-catalog-excerpt.md |
| 084 | What discount threshold triggers the multi-site package discount on ControLink Suite? | 8% when ≥2 sites on one order | reports/fy2026-product-catalog-excerpt.md |
| 085 | What was Meridian's Q1 2026 win rate? | 25% | reports/q1-2026-sales-summary.md |
| 086 | What was Q1 2026's average enterprise sales cycle length? | 101 days | reports/q1-2026-sales-summary.md |
| 087 | By what percentage did Q1 2026 revenue beat its target? | 4.5% above the $15.5M target ($16.2M actual) | reports/q1-2026-sales-summary.md |
| 088 | What was EMEA's percentage share of Q1 2026 total revenue? | 33.3% | reports/q1-2026-sales-summary.md |
| 089 | By what dollar amount did Q2 2026 revenue beat its target? | $1.4M ($18.4M actual vs $17.0M target) | reports/q2-2026-sales-performance-report.md |
| 090 | What was Q2 2026's average enterprise sales cycle, and how did it compare to the ≤90-day target? | 94 days, missed the ≤90-day target | reports/q2-2026-sales-performance-report.md |
| 091 | How much of Q2 2026's $18.4M revenue came from Spares & aftermarket? | $2.8M | reports/q2-2026-sales-performance-report.md |
| 092 | What was the Q2 2026 average enterprise sales cycle compared to Q1's? | 94 days in Q2 vs 101 days in Q1 (improved) | reports/q2-2026-sales-performance-report.md |
| 093 | Who are the five attendees listed on the June 18, 2026 Q2 Pipeline Review call? | Maya Chen, Jordan Blake, Priya Nair, Elena Varga, Alex Rivera | transcripts/call-2026-06-18-q2-pipeline-review.md |
| 094 | What action item did Maya Chen set regarding the Helix Robotics deal during this call? | move it to Commit only after the 26 June tech demo | transcripts/call-2026-06-18-q2-pipeline-review.md |
| 095 | According to Alex Rivera on this call, what was the Q2 win rate? | 28% | transcripts/call-2026-06-18-q2-pipeline-review.md |
| 096 | Who is the Solutions Engineer on the Helix Robotics tech validation debrief call? | Lena Vogt | transcripts/call-2026-06-26-helix-tech-validation.md |
| 097 | What did Lena Vogt tell Helix Robotics about ControLink Gateway rev C during the debrief? | she steered them to rev B for any July need because of CAPA-441 | transcripts/call-2026-06-26-helix-tech-validation.md |
| 098 | What discount ceiling reminder did Maya Chen give on this call? | AE 10%, VP up to 20%, above needs CFO; don't pre-offer beyond 10% without her | transcripts/call-2026-06-26-helix-tech-validation.md |
| 099 | What three topics did Diego Morales list at the start of the July 2, 2026 Field Ops standup? | APAC on-call, spare-parts quotes, and Gateway rev C | transcripts/call-2026-07-02-field-ops-standup.md |
| 100 | According to Sam Okonkwo on this call, what are the priority geos for the Q3 AE/SE hires? | Chicago, Munich, Singapore | transcripts/call-2026-07-02-field-ops-standup.md |

### Hard bank (115) — IDs 101–215, by category

12 categories, each targeting a distinct way to fail. The two-turn-follow-up and image categories
weren't part of the automated retrieval-only measurement — they need the full model.

#### Relative dates (12) — IDs 101–112

"Last quarter", "current quarter": the last *closed* quarter is Q2 2026; Q3 is forecast only.

| ID | Question | Expected answer | Source file(s) |
|---|---|---|---|
| 101 | What was last quarter's revenue and NPS? | Q2 2026: $18.4M revenue, NPS 47 (Q2 is the latest closed/reported quarter) | reports/q2-2026-sales-performance-report.md |
| 102 | What is the current quarter's revenue? | $18.4M (Q2 2026 — Q3 is only a forecast, not yet actual) | reports/q2-2026-sales-performance-report.md |
| 103 | What was the most recent quarter's win rate? | 28% (Q2 2026) | reports/q2-2026-sales-performance-report.md |
| 104 | How much was Q3's new ARR bookings target, and how does that compare to Q2's actual bookings? | $4.2M target vs $3.9M actual in Q2 | emails/003-q3-forecast-lock.md, reports/q2-2026-sales-performance-report.md |
| 105 | What is the current NPS score? | 47 (June 2026 pulse, the latest survey) | emails/006-nps-pulse.md, reports/q2-2026-sales-performance-report.md |
| 106 | How did the latest quarter's revenue compare to its target? | $18.4M vs $17.0M target, +8.2% / +$1.4M | reports/q2-2026-sales-performance-report.md |
| 107 | What is this quarter's win rate compared to last quarter's? | Q2: 28%, up from Q1: 25% | reports/q2-2026-sales-performance-report.md, reports/q1-2026-sales-summary.md |
| 108 | What was the prior quarter's average sales cycle? | 101 days (Q1, prior to Q2's 94 days) | reports/q1-2026-sales-summary.md |
| 109 | How much is Q3 2026 forecast to grow revenue versus Q2's actual? | $19.8M vs $18.4M = +$1.4M / +7.6% | emails/003-q3-forecast-lock.md, reports/q2-2026-sales-performance-report.md |
| 110 | What was the logo churn in the most recently closed quarter? | 3.1% (Q2 2026) | reports/q2-2026-sales-performance-report.md |
| 111 | As of today's most recent data, what is Meridian's headcount? | 312 FTEs as of 30 June 2026 | emails/004-hiring-plan.md |
| 112 | What was NPS in the survey prior to the most recent one? | 41 (March pulse, prior to June's 47) | emails/006-nps-pulse.md |

#### ARR vs. revenue (8) — IDs 113–120

ARR/bookings (what's been signed) is not the same as recognized revenue (what's been invoiced).

| ID | Question | Expected answer | Source file(s) |
|---|---|---|---|
| 113 | How much revenue did Atlas contribute in Q2? | Not stated — the $2.35M is ARR/bookings, not recognized revenue; revenue lands mostly in Q3/Q4 as implementation delivers | (none: not in the corpus) |
| 114 | What was Meridian's total ARR in Q2 2026? | Not stated as a single total-ARR figure — only new ARR bookings ($3.9M) and total revenue ($18.4M) are given | (none: not in the corpus) |
| 115 | How much ARR did Pinnacle Foods' expansion add to Q2 total ARR? | None yet — the expansion is effective 1 August 2026 (Q3), not counted in Q2 | emails/002-pinnacle-expansion.md |
| 116 | What is Helix Robotics' contribution to Q2 revenue? | $0 — still open pipeline (Stage 3), the $910K is potential ARR, not revenue | data/account-health-q2-close.json, emails/009-helix-demo-complete.md |
| 117 | What was the new ARR bookings figure for Q2 2026, and how does it differ from total revenue? | Bookings $3.9M vs revenue $18.4M — revenue includes existing contracts/spares/services, not just new bookings | reports/q2-2026-sales-performance-report.md |
| 118 | Is Atlas Manufacturing's $2.35M already reflected in Q2 recognized revenue? | No — it's in Q2 bookings; recognized revenue lands mostly in Q3/Q4 as delivery happens | transcripts/call-2026-06-18-q2-pipeline-review.md |
| 119 | How much of Q2's Professional Services revenue came specifically from Atlas? | Not broken out — Atlas's $180K implementation is included with "partial recognition" inside the $2.1M Professional Services line, no exact split given | reports/q2-2026-sales-performance-report.md |
| 120 | What is Pinnacle Foods' ARR as of the Q2 close (before the expansion takes effect)? | $620,000 (rises to $1.1M only after 1 Aug 2026) | data/account-health-q2-close.json |

#### Rules with exceptions (11) — IDs 121–131

Discounts that stack up to a ceiling, the rev C ship-hold that overrides the standard lead time, etc.

| ID | Question | Expected answer | Source file(s) |
|---|---|---|---|
| 121 | An AE wants to give a multi-site customer the 8% package plus an extra 5% discount. Can the AE approve that alone? | No — 8%+5%=13% exceeds the AE's 10% ceiling (the 8% counts toward it, not additive); needs VP Enterprise Sales (up to 20%) | emails/014-discount-authority.md |
| 122 | A VP wants to approve a 15% discount plus the 8% multi-site package for a customer. Is that within their authority? | No — 15%+8%=23% exceeds the VP's 20% ceiling; needs CFO+CRO dual approval | emails/014-discount-authority.md |
| 123 | Can an AE approve an 8% multi-site discount alone, without VP sign-off? | Yes — 8% is within the AE's 10% ceiling on its own | emails/014-discount-authority.md |
| 124 | Is the standard 12-business-day lead time valid for a ControLink Gateway rev C delivery commitment in July? | No — rev C is excluded from the standard lead times by the CAPA-441 ship-hold; no promises before 15 August 2026 without written Ops approval | emails/016-capa-441-ship-hold.md, emails/011-spare-parts-lead-time.md |
| 125 | Do ControLink Gateway rev C units shipped under CAPA-441 burn-in get a shorter warranty? | No — still the standard 24 months unless extended coverage was purchased | policies/warranty-terms.md |
| 126 | For a pure hardware deal, how is the extended-warranty cost of 8% calculated? | 8% of hardware list price (vs 8% of first-year ARR for non-pure-hardware deals) | policies/warranty-terms.md |
| 127 | Does ControLink Suite software carry the same 24-month ship-date warranty clock as hardware? | No — software warranty covers defect remediation during the paid subscription term, no separate ship-date clock | policies/warranty-terms.md |
| 128 | What is the maximum discount an Account Executive can approve on a services/implementation deal? | 10% — services discounts follow the same table as product discounts | emails/014-discount-authority.md |
| 129 | For an order valued at $30,000 in spare parts needing expedited air shipping, is Ops approval required? | Yes — expedite above $25,000 in parts value requires Ops approval | emails/011-spare-parts-lead-time.md |
| 130 | Is the multi-site package discount additive on top of an AE's normal discount allowance? | No — it counts toward the ceiling, it is not additive on top | emails/014-discount-authority.md |
| 131 | Was Pinnacle Foods' expansion discount within AE authority, or did it need VP approval? | Within AE authority — it only used the standard 8% multi-site package, per the discount-authority email's explicit note | emails/014-discount-authority.md, emails/002-pinnacle-expansion.md |

#### Multi-document (combining evidence) (12) — IDs 132–143

Requires combining 2 or more files to answer.

| ID | Question | Expected answer | Source file(s) |
|---|---|---|---|
| 132 | How much did EMEA revenue grow from Q1 to Q2 in dollars and percent? | $5.4M → $6.2M = +$0.8M / +14.8% | reports/q1-2026-sales-summary.md, reports/q2-2026-sales-performance-report.md |
| 133 | What is the combined ARR risk represented by the two accounts on the Q2 CS watchlist? | Riverton $210K + Kelso $165K = $375,000 | emails/005-churn-alert.md, data/account-health-q2-close.json |
| 134 | Is the Q2 pipeline review's mention of Helix Robotics consistent with the later tech-validation call and the sales performance report? | Yes — all three cite OPP-90112, $910,000 ARR, Stage 3, Upside | transcripts/call-2026-06-18-q2-pipeline-review.md, transcripts/call-2026-06-26-helix-tech-validation.md, reports/q2-2026-sales-performance-report.md |
| 135 | How many of the 18 approved Q3 hires are meant to support the onboarding remediation plan? | 1 of the 6 CSM hires (joining 2 existing CSMs) | emails/012-onboarding-remediation.md, emails/004-hiring-plan.md |
| 136 | What defect rate triggered the CAPA-441 ship-hold, and what containment measure was taken? | 1.9% defect on rev C; burn-in extended from 2h to 6h | emails/008-quality-board.md, emails/016-capa-441-ship-hold.md |
| 137 | What was Q1 2026 total revenue, and how does the Q2 report describe Q1 as a reference point? | Q1: $16.2M; the Q2 report treats it as the "Prior quarter" comparison column to Q2's $18.4M | reports/q1-2026-sales-summary.md, reports/q2-2026-sales-performance-report.md |
| 138 | According to both the NPS pulse and the onboarding remediation plan, what onboarding delay is driving detractor sentiment, and what is the fix's timeline? | avg 46 days vs 30 promised; fix targets ≤30 days by 30 Sep 2026, interim ≤38 days by 15 Aug 2026 | emails/006-nps-pulse.md, emails/012-onboarding-remediation.md |
| 139 | What was the Q2 win rate reported in the pipeline review call versus the sales performance report? | Both say 28% (consistent) | transcripts/call-2026-06-18-q2-pipeline-review.md, reports/q2-2026-sales-performance-report.md |
| 140 | What is the total ARR at risk across Helix Robotics (open pipeline) and Riverton Motors (watchlist) combined? | $910,000 + $210,000 = $1,120,000 | emails/009-helix-demo-complete.md, emails/010-riverton-ebr-scheduled.md |
| 141 | Using the SKU price list and the Q2 quality board notes, what is the list price of the SKU with the highest Q2 defect rate? | ControLink Gateway rev C, $7,200/unit, 1.9% defect rate | data/sku-list-prices.csv, emails/008-quality-board.md |
| 142 | Did Pinnacle Foods' expansion actually get countersigned, and does that match what was said on the earlier pipeline-review call? | Yes — countersigned 24 June 2026 per the expansion email; the 18 June call said paperwork was still in legal ("I'll confirm when countersigned") | emails/002-pinnacle-expansion.md, transcripts/call-2026-06-18-q2-pipeline-review.md |
| 143 | What percentage of Q2 2026 total revenue did ServoDrive X4 and ControLink Suite together represent? | ($7.6M + $5.9M) / $18.4M ≈ 73.4% | reports/q2-2026-sales-performance-report.md |

#### Two-turn follow-up (10) — IDs 144–153

T1 and T2 are in the same conversation; T2 only makes sense given T1. The expected answer is T2's.

| ID | Question (T1 → T2) | Expected answer (T2) | Source file(s) |
|---|---|---|---|
| 144 | T1: What is the enterprise P1 first-response SLA? → T2: And P2? | P2: 8 hours first response, 72h restore target | emails/007-sla-reminder.md, policies/escalation-matrix.txt |
| 145 | T1: What was Q1 2026 revenue? → T2: And Q2? | $18.4M | reports/q2-2026-sales-performance-report.md |
| 146 | T1: What is the standard lead time for spare parts in the Americas? → T2: What about APAC? | 18 business days | emails/011-spare-parts-lead-time.md |
| 147 | T1: What is the AE's discount ceiling? → T2: And the VP's? | 20% | emails/014-discount-authority.md |
| 148 | T1: What was Meridian's June NPS? → T2: How does that compare to March? | up from 41 in March to 47 in June | emails/006-nps-pulse.md |
| 149 | T1: Who is the named CSM for Atlas Manufacturing? → T2: What about Riverton Motors? | also Priya Nair | emails/001-atlas-deal-closed.md, data/account-health-q2-close.json |
| 150 | T1: What is ServoDrive X4's list price? → T2: And its warranty? | 24 months standard | policies/warranty-terms.md |
| 151 | T1: What was the Q2 logo churn? → T2: Where does that number come from? | still 3.1% — should cite the churn-alert email / sales performance report, not refuse | emails/005-churn-alert.md, reports/q2-2026-sales-performance-report.md |
| 152 | T1: any question WITHOUT an answer in the corpus → T2: What is Meridian's P1 SLA? | T2 does have an answer (4h) and must not inherit T1's refusal ("refusal contagion") | emails/007-sla-reminder.md |
| 153 | T1: What is the discount authority for a VP? → T2: Can they combine that with the multi-site package? | No — the multi-site 8% counts toward the ceiling, not on top of it | emails/014-discount-authority.md |

#### No answer in the corpus (11) — IDs 154–164

The data isn't there: correct behavior is to say so.

| ID | Question | Expected answer | Source file(s) |
|---|---|---|---|
| 154 | Did Helix Robotics ultimately sign the deal? | Not in the corpus — the newest document (Jul 3) still has the decision pending, expected Jul 10 | (none: not in the corpus) |
| 155 | What was Meridian's Q4 2025 revenue? | Not in the corpus | (none: not in the corpus) |
| 156 | Who is Meridian's CEO? | Not in the corpus | (none: not in the corpus) |
| 157 | What is Meridian's total headcount as of the Q3 2026 close? | Not in the corpus — only the Q2 close (312) and approved Q3 reqs exist | (none: not in the corpus) |
| 158 | What was Kelso Plastics' Q2 revenue contribution? | Not in the corpus — only its ARR ($165,000) and health score exist | (none: not in the corpus) |
| 159 | What is Meridian's total company-wide ARR figure? | Not in the corpus as a single total figure | (none: not in the corpus) |
| 160 | Did Helix Robotics meet its July 10 decision deadline? | Not in the corpus — no documents dated after July 3 | (none: not in the corpus) |
| 161 | What is ServoDrive X4's maximum operating temperature? | Not in the corpus | (none: not in the corpus) |
| 162 | How many vacation days do Meridian employees get per year? | Not in the corpus | (none: not in the corpus) |
| 163 | What is Meridian's parental leave policy? | Not in the corpus | (none: not in the corpus) |
| 164 | What is Meridian's total company headcount as of September 2026? | Not in the corpus — the latest headcount data is from 30 June 2026 (312) | (none: not in the corpus) |

#### Similar/confusable numbers (10) — IDs 165–174

Figures that are easy to mix up (e.g. 0.7% vs 0.4% vs 1.9% defect rates).

| ID | Question | Expected answer | Source file(s) |
|---|---|---|---|
| 165 | Meridian reports a 0.7% defect rate — is that the same figure as ServoDrive X4's or ControLink Gateway rev C's defect rate? | No — 0.7% is the overall field defect rate; ServoDrive X4 is 0.4%; ControLink Gateway rev C is 1.9% | emails/008-quality-board.md |
| 166 | What is the standard warranty period, and how does that compare to the extended warranty period? | 24 months standard vs 36 months extended | policies/warranty-terms.md |
| 167 | What is the discount ceiling for an AE, and how does it compare to a VP's? | AE 10% vs VP 20% | emails/014-discount-authority.md |
| 168 | What is Meridian's average onboarding time, and how does it compare to the promised time? | 46 days actual vs 30 days promised (16-day gap) | emails/006-nps-pulse.md, emails/012-onboarding-remediation.md |
| 169 | What is the Q2 logo churn rate, and how does that compare to the ARR churn rate? | 3.1% logo churn vs 3.8% ARR churn | emails/005-churn-alert.md, reports/q2-2026-sales-performance-report.md |
| 170 | What was Q2's win rate compared to its target? | 28% actual vs 27% target (beat by 1 point) | reports/q2-2026-sales-performance-report.md |
| 171 | What is the price difference between ControLink Gateway rev B and rev C? | $6,800 vs $7,200 = $400 more for rev C | data/sku-list-prices.csv |
| 172 | How does Q2's average sales cycle compare to its target? | 94 days actual vs ≤90 days target (missed by 4 days) | reports/q2-2026-sales-performance-report.md |
| 173 | What is the difference between the P1 and P2 first-response SLAs? | P1: 4 hours vs P2: 8 hours (4-hour difference) | emails/007-sla-reminder.md |
| 174 | What is the interim onboarding checkpoint versus the final target? | interim ≤38 days by 15 Aug vs final ≤30 days by 30 Sep | emails/012-onboarding-remediation.md |

#### Exact IDs (8) — IDs 175–182

Opportunity ID, SKU, document number.

| ID | Question | Expected answer | Source file(s) |
|---|---|---|---|
| 175 | What is the opportunity ID for the Helix Robotics deal? | OPP-90112 | emails/009-helix-demo-complete.md |
| 176 | What is the document ID of the Q2 2026 Sales Performance Report? | FIN-SAL-2026-Q2-014 | reports/q2-2026-sales-performance-report.md |
| 177 | What is the recording ID for the Helix Robotics tech validation debrief call? | REC-SE-2026-0626 | transcripts/call-2026-06-26-helix-tech-validation.md |
| 178 | What is the SKU code for ServoDrive X4? | SD-X4-001 | data/sku-list-prices.csv |
| 179 | What is the contract number for the Pinnacle Foods expansion? | CTR-PIN-2024-019-A2 | emails/002-pinnacle-expansion.md |
| 180 | What is the CAPA number associated with the ControLink Gateway rev C defect issue? | CAPA-441 | emails/016-capa-441-ship-hold.md |
| 181 | What is the document ID of the account health snapshot as of Q2 close? | CS-HLTH-2026-Q2-007 | data/account-health-q2-close.json |
| 182 | What is the opportunity ID for the Atlas Manufacturing deal? | OPP-88421 | emails/001-atlas-deal-closed.md |

#### Calculation (10) — IDs 183–192

A small calculation using two numbers from the corpus.

| ID | Question | Expected answer | Source file(s) |
|---|---|---|---|
| 183 | How many days apart are the interim onboarding checkpoint deadline and the final target deadline? | 15 Aug → 30 Sep ≈ 46 days apart | emails/012-onboarding-remediation.md |
| 184 | By what dollar amount is Q3's new ARR bookings target higher than Q2's actual new ARR bookings? | $4.2M − $3.9M = $300,000 | emails/003-q3-forecast-lock.md, reports/q2-2026-sales-performance-report.md |
| 185 | What is the combined ARR of Atlas Manufacturing and Pinnacle Foods after Pinnacle's expansion takes effect? | $2.35M + $1.1M = $3.45M | emails/001-atlas-deal-closed.md, emails/002-pinnacle-expansion.md |
| 186 | Do the planned Q3 hires across AE, SE, and CSM add up to the stated total of 18? | Yes — 8+4+6=18 | emails/004-hiring-plan.md |
| 187 | What is the percentage-point difference between Q1 and Q2 2026 win rates? | 28% − 25% = 3 percentage points | reports/q1-2026-sales-summary.md, reports/q2-2026-sales-performance-report.md |
| 188 | How many days after the Q2 quality board email was the CAPA-441 ship-hold rule issued? | quality board 30 Jun, ship-hold 1 Jul = 1 day | emails/008-quality-board.md, emails/016-capa-441-ship-hold.md |
| 189 | What is the total combined list price of one ServoDrive X4 unit and one ControLink Gateway rev B unit? | $48,500 + $6,800 = $55,300 | data/sku-list-prices.csv |
| 190 | How many percentage points of headroom does Q2's logo churn have before breaching the ≤3.5% guardrail? | 3.5% − 3.1% = 0.4 points | reports/q2-2026-sales-performance-report.md |
| 191 | What is the dollar gap between Q2 2026's actual revenue and the Q3 2026 forecast? | $19.8M − $18.4M = $1.4M | emails/003-q3-forecast-lock.md, reports/q2-2026-sales-performance-report.md |
| 192 | If an AE uses the full 8% multi-site package, how many more percentage points can they still approve on their own before needing VP sign-off? | 10% − 8% = 2 percentage points | emails/014-discount-authority.md |

#### In Spanish (10) — IDs 193–202

Easy questions, in Spanish — this category specifically tests multilingual query handling, so the
question text below is kept **in its original Spanish** (that's what's actually sent to the API),
with an English gloss in brackets. Expected answers are given in English.

| ID | Question (Spanish, as tested) | [EN gloss] | Expected answer (EN) | Source file |
|---|---|---|---|---|
| 193 | ¿Cuál es el SLA de primera respuesta para un ticket P1? | [What is the first-response SLA for a P1 ticket?] | 4 hours | emails/007-sla-reminder.md |
| 194 | ¿Cuánto es el ARR del acuerdo con Atlas Manufacturing? | [How much is the ARR of the Atlas Manufacturing deal?] | $2.35M ARR | emails/001-atlas-deal-closed.md |
| 195 | ¿Cuál es el precio de lista del ServoDrive X4? | [What is the list price of the ServoDrive X4?] | $48,500 per unit | data/sku-list-prices.csv |
| 196 | ¿Puedo prometer una entrega de ControLink Gateway rev C antes de agosto? | [Can I promise a ControLink Gateway rev C delivery before August?] | No, not without written Ops approval before 15 August 2026 | emails/016-capa-441-ship-hold.md |
| 197 | ¿Cuál es el descuento máximo que puede aprobar un Account Executive? | [What is the maximum discount an Account Executive can approve?] | 10% | emails/014-discount-authority.md |
| 198 | ¿Cuál fue el NPS de Meridian en junio de 2026? | [What was Meridian's NPS in June 2026?] | 47 | emails/006-nps-pulse.md |
| 199 | ¿Cuánto creció el revenue de EMEA de Q1 a Q2? | [How much did EMEA revenue grow from Q1 to Q2?] | from $5.4M to $6.2M, +$0.8M (~14.8%) | reports/q1-2026-sales-summary.md, reports/q2-2026-sales-performance-report.md |
| 200 | ¿Firmó Helix Robotics finalmente? | [Did Helix Robotics ultimately sign?] | Not in the corpus | (none: not in the corpus) |
| 201 | ¿Cuál es la garantía estándar de los equipos de Meridian? | [What is the standard warranty on Meridian equipment?] | 24 months | policies/warranty-terms.md |
| 202 | ¿Cuánto tiempo lleva un repuesto en llegar a la región APAC? | [How long does a spare part take to arrive in the APAC region?] | 18 business days | emails/011-spare-parts-lead-time.md |

#### Images (vision) (5) — IDs 203–207

About the corpus's 2 photos: these don't go through text RAG, they need the vision-capable model.

| ID | Question | Expected answer | Attached image |
|---|---|---|---|
| 203 | What is happening in this image? | Should describe the scene directly from the image (CNC machining / industrial production floor) | pictures/pic1.jpeg |
| 204 | What PPE is the worker wearing in this photo? | Blue hard hat + high-visibility vest, read from the image | pictures/pic2.png |
| 205 | Which Meridian product does this image show? | Trap: the image isn't labeled with any corpus SKU; correct behavior is to say it can't confirm that, not invent "ServoDrive X4" | pictures/pic2.png |
| 206 | What is the ARR of the account associated with this photo? | Trap: there's no photo→account link in the corpus; must not invent a name | pictures/pic2.png |
| 207 | What do you see in the photo I just sent? | Should say no image was received, not invent a description | (none: intentionally sent with no image) |

#### Citation precision (8) — IDs 208–215

The answer can be right while the citation points at the wrong file. Includes the challenge PDF's
own example question.

| ID | Question | Expected answer | Source file(s) |
|---|---|---|---|
| 208 | What was Q2 2026 total revenue? | $18.4M — the challenge's own example question; the citation must be the Q2 report, not the CSV or the Q1 summary | reports/q2-2026-sales-performance-report.md |
| 209 | What is the standard P1 SLA? | 4 hours — any of three sources is valid | emails/007-sla-reminder.md, policies/escalation-matrix.txt, faqs/support-sla-faq.html |
| 210 | What is ServoDrive X4's list price? | $48,500 — any of three sources is valid | emails/013-list-pricing-update.md, data/sku-list-prices.csv, reports/fy2026-product-catalog-excerpt.md |
| 211 | What is Atlas Manufacturing's ARR? | $2.35M — must cite a document that actually mentions Atlas | emails/001-atlas-deal-closed.md, emails/015-atlas-kickoff-complete.md, reports/q2-2026-sales-performance-report.md |
| 212 | What is the AE discount ceiling? | 10% — only one document has the complete table | emails/014-discount-authority.md |
| 213 | What is ControLink Gateway rev C's ship-hold rule? | Not before 15 Aug without Ops approval — the CAPA-441 email is the most complete source | emails/016-capa-441-ship-hold.md |
| 214 | What is the standard warranty period on Meridian hardware? | 24 months — only one document has the complete term | policies/warranty-terms.md |
| 215 | How much is the standard spare-parts lead time in EMEA? | 12 business days | emails/011-spare-parts-lead-time.md, reports/fy2026-product-catalog-excerpt.md |

---

## Category → likely failure type (working hypothesis, to verify in Stage 2 baseline run)

This is a first-pass guess at how each category's failures should be classified once the baseline
run is scored (retrieval failure / LLM reasoning-grounding failure / conversation-context failure
/ citation failure / vision failure) — not a substitute for actually running and classifying it.

| Category | Most likely failure type if it fails |
|---|---|
| Relative dates | LLM reasoning (knows the facts, picks the wrong quarter) — a LoRA candidate |
| ARR vs. revenue | LLM reasoning (conflates two numeric concepts) — the clearest LoRA candidate |
| Rules with exceptions | LLM reasoning (fails to combine a rule + its exception) — LoRA candidate |
| Multi-document | Retrieval (all needed chunks must surface) or LLM reasoning (fails to combine them) — needs per-question triage |
| Two-turn follow-up | Conversation/context (retriever or model losing the prior turn) — likely NOT a LoRA target, more a retrieval/context-assembly issue |
| No answer in corpus | Should be governed by the existing deterministic guard — a failure here is more likely a retrieval near-miss (something scored just above `minScore`) than an LLM problem |
| Similar/confusable numbers | LLM reasoning (picks the wrong of several similar figures) — LoRA candidate |
| Exact IDs | Retrieval/extraction precision — probably not LoRA's job |
| Calculation | LLM reasoning (arithmetic) — possible LoRA candidate, but also just a capability limit of a very small model |
| In Spanish | Could be either retrieval (embedding cross-lingual quality) or LLM (language handling) — needs triage |
| Images | Vision failure by definition — out of scope for a text-only LoRA adapter |
| Citation precision | Deterministic citation logic (`citations.ts`) plus retrieval ranking — not an LLM/LoRA target |
