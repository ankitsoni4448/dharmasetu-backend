# Prokerala primary Kundli module coverage

Source: Prokerala Astrology API v2 OpenAPI specification, checked 2026-08-23.

| Product data | Official endpoint | Required option | Credits | Current integration | Certification |
|---|---|---|---:|---|---|
| Birth details, Lagna, Moon sign, Nakshatra/Pada | `GET /v2/astrology/birth-details` | `ayanamsa=1` (Lahiri) | 50 | Yes | PARTIAL until live response/reference validation |
| Basic Kundli facts | `GET /v2/astrology/kundli` | `ayanamsa=1` | 50 | Yes | PARTIAL |
| Detailed Nakshatra, Dasha, Yoga and Mangal data | `GET /v2/astrology/kundli/advanced` | `ayanamsa=1` | 300 | Implemented behind backend feature gate | LIVE_CAPABILITY_TEST_REQUIRED |
| D1/Rashi chart | `GET /v2/astrology/chart` | `chart_type=rasi`, `chart_style=north-indian`, `format=svg` | 50 | Required deep module | LIVE_CAPABILITY_TEST_REQUIRED |
| D9/Navamsa chart | `GET /v2/astrology/chart` | `chart_type=navamsa`, style, `format=svg` | 50 | Optional deep module | LIVE_CAPABILITY_TEST_REQUIRED |
| Bhava chart | `GET /v2/astrology/chart` | `chart_type=bhava`, style, `format=svg` | 50 | Optional deep module | LIVE_CAPABILITY_TEST_REQUIRED |
| Graha longitudes/signs/retrograde | `GET /v2/astrology/planet-position` | `ayanamsa=1` | 30 | Required deep module | LIVE_CAPABILITY_TEST_REQUIRED |
| Vimshottari Dasha/Antardasha timeline | Included in advanced Kundli | `ayanamsa=1` | included | Parsed from advanced response; avoids a redundant 200-credit call | LIVE_FIXTURE_REQUIRED |
| Raja Yoga details | Included in advanced Kundli | `ayanamsa=1` | included | Parsed from advanced response; avoids a redundant 200-credit call | LIVE_FIXTURE_REQUIRED |
| Mangal Dosha | Included in advanced Kundli | `ayanamsa=1` | included | Parsed from advanced response; avoids a redundant call | LIVE_FIXTURE_REQUIRED |
| Kaal Sarp Dosha | `GET /v2/astrology/kaal-sarp-dosha` | `ayanamsa=1` | 30 | Optional deep module | LIVE_CAPABILITY_TEST_REQUIRED |

The chart endpoint returns provider SVG, not normalized astronomical chart JSON. It must be sanitized/stored and rendered as provider output, while planet/house facts remain sourced from documented JSON modules. Do not derive missing facts from SVG or local approximate calculations.

Deep mode is disabled unless the backend has `PROKERALA_DEEP_KUNDLI_ENABLED=true`. The selected English bundle costs 560 credits (the documented non-English multiplier would make it 1120), but calls deliberately use `la=en` and localize presentation separately. Required modules are birth details, advanced Kundli, planet positions, and D1. D9, Bhava and Kaal Sarp are optional and receive explicit module states.

Do not enable the gate until the account plan supports the aggregate credit cost, redacted live fixtures are captured, and trusted reference-chart comparisons are available. Basic mode remains the existing 100-credit birth-details plus Kundli flow.
