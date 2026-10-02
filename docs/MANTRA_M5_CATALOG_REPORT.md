# Mantra M5 catalog report

Generated 2026-10-03. This is an offline candidate and evidence workspace. It did not write to Supabase or modify production.

## Current state

The captured production inventory contains 29 active records. All 29 remain review-required. M5 carries forward 118 candidate records with 118 unique IDs. Normalized-name analysis found one likely duplicate pair for `Angaraka Stotram`, leaving 117 distinct candidate works pending human canonical resolution. No candidate is publication-ready.

| Measure | Count |
|---|---:|
| Production snapshot records | 29 |
| Candidate records | 118 |
| Distinct candidate works after likely duplicate | 117 |
| Sanskrit text present | 29 |
| Sanskrit text missing | 89 |
| Fully text-sourced and verified | 0 |
| Transliteration present | 29 |
| Transliteration verified | 0 |
| Meaning verified | 0 |
| Practice verified | 0 |
| Pronunciation verified | 0 |
| Audio verified | 0 |
| Rights cleared | 0 |
| Publication ready | 0 |
| Blocked | 118 |

The 29 legacy records contain text, transliteration, and some meanings, but none has edition-level source evidence or field-specific approval in the captured data. The other 89 entries are discovery records with titles and links only. Classification remains review-required for all records. One title collision must be resolved as an alias, variant, or duplicate by a reviewer.

## Content and Japa classification

M5 conservatively recognizes 12 Mantra, 9 Bija Mantra, 3 Nama Japa, 1 Gayatri Mantra, 1 Vedic Mantra, 2 Prayer, 1 Shloka, 70 Stotra, 14 Ashtakam, and 5 Namavali candidates. Title-based refinements are candidate metadata and do not constitute textual or religious verification.

Twenty-six records have a Japa-oriented content type. Ninety-two are reading or recitation content and cannot open bead-counted Japa by default. Long-form Stotra, Ashtakam, Kavacha, Chalisa, Namavali, and Sahasranama are explicitly excluded from ordinary Japa unless a future reviewed record supplies a distinct supported practice mode.

## Source research

The 89 discovery URLs identify possible works on SanskritDocuments, but its FAQ does not grant unrestricted reuse for a commercial or promotional website. They remain discovery references with no supported fields and `REVIEW_REQUIRED` rights. No text was copied from those pages.

SARIT was assessed as a possible edition-level source because its records expose edition metadata and per-text Creative Commons terms. No current candidate was automatically mapped to a SARIT edition. Muktabodha was assessed as a scholarly discovery/archive source, especially for Śaiva, Śākta, and Vedic materials; access alone was not treated as republication permission. Neither repository promoted a candidate in this run.

The source registry provides a project-material registration template with document identity, edition/publisher, URL or project reference, rights, page, section, verse/mantra identifier, exact evidence, supported field, reviewer, and review state. OCR or AI extraction can only enter `EXTRACTION_CANDIDATE`; a human must approve the evidence separately.

## Required next evidence

Every blocked record needs edition-level sacred text evidence, explicit reusable rights, and human text review. Records with transliteration, meaning, practice, pronunciation, or audio must receive separate evidence and review for each field. Discovery pages and source popularity do not satisfy these requirements. Practice instructions must remain absent until an appropriate practice source supports them. Advanced or initiation-bound material must retain its restrictions.

Machine-readable outputs are in `data/mantra/m5`. `publication_ready.json` is deliberately empty. `production_snapshot.json` is neither read by the M5 builder nor eligible for use as a publication manifest.
