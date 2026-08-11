# Hissab Tier 3: UX, i18n, integrations, and new bug catches

## Fixed audit items

- **L1**: Free Zone switch is now a single accessible button, so label + child click cannot toggle twice.
- **L2**: Starter suggestion cards are real buttons and send their text into chat.
- **L3/L4**: Related-party cards now show flat Gemini fields, amount, transaction type, and arms-length status. The existing nested shape remains supported.
- **L5**: Speech recognition separates final and interim transcripts instead of appending every interim fragment.
- **L7**: Uploads now send the actual file bytes as Gemini inline data, with a 6 MB limit. The old implementation sent only the filename.
- **L9**: A null workspace now renders an actionable error state instead of a blank screen.
- **L10**: Panel border uses logical `border-s`, which works in RTL.
- **L11/L12**: Exchange-rate cron now persists daily snapshots, requires `CRON_SECRET`, and fails closed when the secret is missing.
- **L14**: Locale rendering remains server-stable while the browser preference is loaded; document language/direction updates after hydration.

## New bugs caught and fixed

1. **The cron had nowhere to save rates.** `exchange_rates` did not exist in the schema. Added migration `002_exchange_rates.sql` and a server-only service-role client for the scheduled job.
2. **The cron claimed third-party rates were CBUAE rates.** Tier 2 corrected the FX source label; Tier 3 also removes the misleading cron response wording.
3. **Inline uploads were discarded.** Camera/PDF uploads now reach Gemini as `inlineData`, with server-side size validation.
4. **Settings saved `is_free_zone` but not the QFZP flag.** This was a data-model trap: the UI toggle was presented as enough to activate Free Zone tax treatment. The UI now stays labelled only as Free Zone; QFZP remains an explicit database field until a proper tax-settings control is added.
5. **The app mixed physical-direction classes with RTL.** Fixed the panel's hardcoded left border; chat still has visual border classes where direction is intentional and does not affect layout.
6. **Cron authorization was optional by omission.** A missing env var previously made the endpoint public. It now returns 401.

## Files

Changed: `MessageList.tsx`, `ChatPane.tsx`, `InputBar.tsx`, `RecordCard.tsx`, `SettingsModal.tsx`, `Panel.tsx`, `AppShell.tsx`, `client.ts`, `api/gemini/route.ts`, `api/cron/exchange-rates/route.ts`.

Added: `src/lib/supabase/admin.ts`, `supabase/migrations/002_exchange_rates.sql`.

The foundation SQL also includes the exchange-rate table for fresh installs. Existing Supabase projects should run migration 002.

## Required deployment setting

Set `SUPABASE_SERVICE_ROLE_KEY` server-side for the rate cron. Never expose it as a `NEXT_PUBLIC_*` variable. Also set `CRON_SECRET` and configure the scheduler to send `Authorization: Bearer <CRON_SECRET>`.

Run `npm run build` after extracting. I could validate structure here, but this sandbox does not contain `node_modules` or a TypeScript compiler.
