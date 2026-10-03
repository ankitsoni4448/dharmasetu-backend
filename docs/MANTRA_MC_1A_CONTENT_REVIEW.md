# Mantra MC-1A content review pack

Generated 2026-10-03 from the immutable 29-record production snapshot. This is an editorial package, not human Sanskrit approval or a publication manifest.

## Inventory

| Measure | Count |
|---|---:|
| Records audited and queued | 29 |
| Strong exact-text source matches | 3 |
| Partial/variant source matches | 7 |
| Discovery-only leads | 1 |
| Records with no acceptable source yet | 18 |
| Records with reported textual variants | 7 |
| Rights-clear candidates | 0 |
| Records requiring a rights decision | 29 |
| Proposed Japa-eligible | 26 |
| Proposed non-Japa | 3 |
| Transliteration present for review | 29 |
| Meaning present for review | 29 |

The 29 saved sacred texts are reproduced unchanged in `records.json` and the human review queue. Automated Unicode checks found no corruption. Existing transliterations are labeled generated-or-legacy and human-review-required. Existing meanings are withheld pending evidence and rights review.

## Source coverage

Strong exact-text leads were found for:

- `aditya_hridaya_seed`: an institutional MSRVVP textbook contains `ॐ आदित्याय नमः`, but does not support the current “Aditya Hridaya Seed” title.
- `om_namo_bhagavate`: Bhāgavata Purāṇa 4.8.54 prints `ॐ नमो भगवते वासुदेवाय`.
- `om_namo_narayanaya`: Nārāyaṇa Upaniṣad 3 constructs and states `ॐ नमो नारायणाय`.

Partial or variant leads cover `asato_ma`, `gayatri`, `mahamrityunjaya`, `hare_krishna`, `om_namah_shivay`, `shiva_panchakshara`, and `surya_moola`. `vishnu_sahasranama_seed` has a discovery-only Nārāyaṇapūrvatāpinīya lead whose reading differs from production. Eighteen records, predominantly unsourced bīja or modern devotional formulas, still lack an acceptable primary or edition-level source.

No modern meaning, transliteration, commentary, or audio was copied. Ancient underlying text, modern edition, transliteration, translation, practice commentary, and audio rights are tracked separately. Every record still requires a human rights decision.

## `asato_ma`

The production string has no detected encoding defect. Bṛhadāraṇyaka Upaniṣad 1.3.28 supports the three central lines. Production additionally contains `ॐ` and a threefold śānti closing, which the cited passage does not establish. That closing, punctuation, transliteration, meaning, and exact edition choice remain human decisions. Production was not altered.

## Reviewer workflow

`human_review_queue.json` supplies, for every record:

- Current DharmaSetu text
- Source text or evidence
- Source location and URLs
- Normalized comparison differences
- Separate rights dimensions
- Proposed classification
- Japa eligibility
- Seven explicit reviewer decisions

No item is marked `HUMAN_VERIFIED`. Final approved content must be stored in DharmaSetu’s own backend; none of the external research sources is introduced as a mobile runtime dependency.
