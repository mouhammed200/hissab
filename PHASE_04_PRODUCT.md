# Phase 04 - Make the product honest

Completed:

- Removed unsupported PDF, budget, bank-upload, and VAT-filing actions from the Gemini response schema and prompt.
- Added a server-side honesty gate for legacy action payloads, returning a clear non-executable response instead of implying work happened.
- Kept transaction extraction and financial queries available through chat.
- Added fixed assets and related-party transactions to the Records view, with filters and Arabic labels.
- Added a Phase 04 product honesty test.

The command layer is intentionally not fake. Until a command has a real executor and audit path, chat does not advertise it.
