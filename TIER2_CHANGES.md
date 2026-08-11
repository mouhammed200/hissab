# Hissab Tier 2: UAE Tax and Accounting Rules

Checked against official UAE sources on 10 August 2026. This is an implementation pass, not legal advice. The Arabic originals prevail where an English translation differs.

## Official sources

- [UAE Legislation: Federal Decree by Law No. 47 of 2022, Corporate Tax](https://uaelegislation.gov.ae/en/legislations/1582), active and updated 1 October 2025.
- [UAE Legislation: Federal Decree by Law No. 8 of 2017, VAT](https://uaelegislation.gov.ae/en/legislations/1227), active and updated 1 October 2025.
- [UAE Legislation: Cabinet Resolution No. 52 of 2017, VAT Executive Regulation](https://uaelegislation.gov.ae/en/legislations/1226), active and updated 12 August 2025.
- [FTA VAT legislation hub](https://tax.gov.ae/en/legislation/vat.aspx), including the 2025 VAT law amendments and Cabinet Decision No. 100 of 2024.
- [FTA Corporate Tax: Determination of Taxable Income guide](https://tax.gov.ae/DataFolder/Files/Pdf/2024/Determination%20of%20Taxable%20Income%20-%2031%2007%202024.pdf).
- [Ministry of Finance: Cabinet Decision No. 100 of 2023, Qualifying Income](https://mof.gov.ae/wp-content/uploads/2023/11/Cabinet-Decision-No.-100-of-2023-on-Determining-Qualifying-Income-for-the-Qualifying-Free-Zone-Person.pdf).
- [MoHRE: Federal Decree-Law No. 33 of 2021 and amendments](https://mohre.gov.ae/assets/download/8cd7cf08/Federal%20Decree-Law%20No.%2033%20of%202021%20Regarding%20the%20Regulation%20of%20Employment%20Relationship%20and%20its%20amendments.pdf.aspx).
- [MoHRE: Cabinet Resolution No. 96 of 2023, alternative end-of-service benefits](https://mohre.gov.ae/assets/download/c7ea6970/cabinet-resolution-no-96-of-2023-regarding-an-alternative-end-of-service-benefits-system-en.aspx).

## Fixed audit items

| Audit | Fix |
|:---|:---|
| M1 | VAT deadline now moves Saturday/Sunday deadlines to Monday. |
| M2 | Import purchases now go to Box 5; recoverable import VAT goes to Box 9 or Box 10 for reverse charge. |
| M3 | Carried-forward loss relief is capped at 75% of the relevant taxable income base. Result now exposes loss used and disallowed-by-cap amounts. |
| M4 | QFZP qualifying income is 0%; non-qualifying income is 9% without applying the ordinary AED 375,000 band. De minimis failure removes QFZP treatment for the period. |
| M5 | Monthly gratuity provision is based on the current service-year rate, not lifetime capped gratuity divided by total service. |
| M6 | Monthly gratuity accrues from month one; one year remains the settlement entitlement threshold. |
| M7 | Historical non-pegged FX rates no longer masquerade as CBUAE rates. Past-date conversion fails closed unless a date-specific official rate is supplied. Same-day third-party data is labelled FALLBACK. |
| M8 | Sale journal fallback now preserves the VAT credit and cannot silently produce DR != CR. |
| M9 | Purchase journal VAT lines now carry VAT category, rate and amount metadata. |
| M10 | Tier 1 already changed missing account mappings from silent filtering to an explicit error. |
| M12 | Depreciation uses date-only UTC-safe arithmetic, starts in the acquisition month, and caps the final period cleanly. |

## New bugs caught in this pass

1. **FX source mislabeling was worse than just stale rates.** A non-official `open.er-api.com` response was labelled `CBUAE`, and historical dates were ignored. Fixed by failing closed for past non-pegged rates without a supplied official rate, and labelling indicative same-day data `FALLBACK`.
2. **Corporate tax loss reporting was incomplete.** The old calculator deducted 100% of carried-forward losses and gave no visibility into the statutory cap. Fixed with 75% cap tracking.
3. **QFZP tax math applied the ordinary 0% band.** Fixed so qualifying income and non-qualifying income are handled separately.
4. **Gratuity mixed settlement entitlement with monthly accounting.** The one-year test zeroed monthly accrual for new hires, while the lifetime average understated current expense. Split the rules.
5. **Depreciation used `toISOString()` after local date construction.** That can shift UAE dates and the schedule skipped the acquisition month. Fixed.
6. **Arithmetic validation let NaN through.** Undefined discounts could turn the expected amount into NaN, which passed the comparison. Fixed with finite-number and negative-total checks.

## Scope note

The code still assumes straight-line depreciation and does not model every VAT adjustment, blocked-input category, customs declaration, or alternative end-of-service savings-scheme election. Those need explicit product fields before they can be calculated safely.
