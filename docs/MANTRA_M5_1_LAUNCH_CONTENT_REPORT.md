# Mantra M5.1 launch content report

Generated 2026-10-03. This is a read-only launch audit of the 29 records in the captured production snapshot. It did not change Supabase or production content.

## Launch result

| Measure | Count |
|---|---:|
| Existing records audited | 29 |
| Exact source matches | 0 |
| Specific source leads registered | 4 |
| Ready for human source comparison | 4 |
| Rights cleared at record level | 0 |
| Transliteration verified and displayable | 0 |
| Meaning verified and displayable | 0 |
| Core launch ready | 0 |
| Japa ready after core approval | 0 |
| Text-only launch ready | 0 |
| Human Sanskrit review required | 29 |
| Rights work required | 29 |
| Records with existing enrichment withheld | 29 |

Optional meaning, mantra-specific practice, pronunciation, audio, and founder voice no longer block a valid core text record. A core record still requires canonical identity, sacred-text evidence, human text review, reviewed classification, rights clearance, reviewer attribution, active publication state, and explicit publication approval.

Existing transliterations and meanings are retained in the review artifacts but withheld from a launch record until their own evidence and review are present. Transliteration verification is independent from pronunciation verification.

## Source leads

Four records have passage-specific research leads. These are review inputs, not verification:

- `asato_ma`: Bṛhadāraṇyaka Upaniṣad 1.3.28, using the IGNCA digitized edition as a passage witness. The three central lines are attested, but the production record also includes `ॐ` and a threefold śānti ending. That addition is not established by the cited passage.
- `gayatri`: Ṛgveda 3.62.10 on Sanskrit Wikisource. The Savitṛ verse is present, while production also includes `ॐ` and the three vyāhṛtis. Vedic accents, orthography, attribution, and page-specific reuse terms require review.
- `mahamrityunjaya`: Ṛgveda 7.59.12. The production text corresponds to the normalized core verse but adds `ॐ` and omits Vedic accents. The selected edition and reuse terms still require confirmation.
- `hare_krishna`: Kali-santaraṇa Upaniṣad, located through the IGNCA index of the Gaudiya Grantha Mandira repository. The actual edition must be inspected because ordering and textual variants cannot be settled from the index.

Wikisource requires hosted works to be public domain or available under a compatible Creative Commons license, but its own reuse guidance says each work and jurisdiction must still be checked. Consequently, source-level license information was recorded without marking any DharmaSetu record rights-cleared.

## `asato_ma` conclusion

The saved UTF-8 string contains valid Devanagari and no replacement character, mojibake, invalid surrogate, HTML entity, invalid whitespace, or mixed Indic-script finding. The earlier warning is therefore not a confirmed encoding defect.

The record remains blocked because its exact published form is not fully supported by Bṛhadāraṇyaka Upaniṣad 1.3.28: the three central lines have a specific primary passage, while the prefixed `ॐ`, appended threefold śānti, punctuation, transliteration, and meanings require separate evidence and human review. M5.1 does not alter the text.

## Remaining blockers

All 29 records require text-source approval, text review, canonical identity review, classification review, rights clearance, reviewer attribution, and publication approval. Twenty-five still lack a passage-specific authoritative source lead in this workspace. Existing transliteration and meaning are withheld pending independent evidence. Optional practice, pronunciation, and audio may remain absent without preventing a future core text launch.

The machine-readable review artifacts are in `data/mantra/m5_1`. `launch_ready.json` is intentionally empty.
