# CAEX 3.0 schema — source

- File: `CAEX_ClassModel_V.3.0.xsd` — **NOT included in any distributed ZIP** (sha256 `36275ee6f39d75a0ba831f44b67a8bda01f44fa0eff103cadc5396cf54ef123f`; targetNamespace `http://www.dke.de/CAEX`, `SchemaVersion` fixed value `3.0`).
- Source: AutomationML e.V., "Chapter 2 – The CAEX and AutomationML Guide" (A Practical Guide / AML book), section "CAEX Schema file — Download CAEX_ClassModel_V.3.0.xsd (zip compressed)":
  https://www.automationml.org/about-automationml/publications/amlbook/a-practical-guide/chapter-2-the-caex-and-automationml-guide/
- Downloaded zip sha256: `dfeeaf41dc4ee12960085069795216114ef75df748e0851078bad7ad25cda4bf` (CAEX_ClassModel_V.3.0.xsd_.zip), retrieved 2026-11-08 KST.
- CAEX 3.0 corresponds to IEC 62424:2016; AutomationML Edition 2 documents declare `SuperiorStandardVersion` "AutomationML 2.10" (as in the same page's "Chapter 2 - Example Models 1.1.aml").
- Redistribution/license terms of the XSD were **not investigated/confirmed**, so the XSD is not redistributed. Only this note (URL, hashes) and the validation results are distributed.
- To validate yourself: download the zip from the URL above, unzip, put `CAEX_ClassModel_V.3.0.xsd` in this folder (or set `CAEX_XSD=/path/to/xsd`), `pip install lxml`, then `npm run validate:aml`. Without the XSD the script prints "NOT RUN" + these instructions and exits 2 (no report written).
