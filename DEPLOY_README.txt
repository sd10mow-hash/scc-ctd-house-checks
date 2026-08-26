SCC-CTD HOUSE CHECKS v1.3.0 - TODAY BUILD

FASTEST PHONE TEST
1. Upload the CONTENTS of this folder to an HTTPS static host such as Netlify Drop.
2. Open the resulting https://... address in Safari on the iPhone.
3. Create the app PIN.
4. Enter a Report Text Cell Number during Setup. Use your own cell for testing.
5. Open Database -> Import Private Data and select SCC_CTD_House_Checks_PRIVATE_Starter_Data.json.
6. Verify Properties. Mark any colored/no-check houses with their House Color and turn OFF "House check required tonight".
7. Run checks.
8. Finish Run -> preview the COMPLETE report -> approve -> text/print/save/email -> Complete & Save to History.
9. Safari Share -> Add to Home Screen.

IMPORTANT
- Do NOT upload the private starter JSON to the public host.
- All configured houses appear on the final report.
- NOT REQUIRED is different from MISSING.
- History stores completed report snapshots.
- The encrypted database is internal to the browser/app on that phone.

STATUS LABEL FIX v1.3.0:
- CHECKS REQUIRED appears only when at least one required client is unresolved.
- COMPLETE appears when all required clients at that house are resolved.
- NOT REQUIRED TONIGHT remains for houses excluded from checks.

NON-HOME NOTE RULE v1.3.0:
- HOME resolves immediately; a note is optional.
- NOT HOME, SLEEP, or PASS requires a nightly note.
- Until that note is entered, the client remains unresolved and the house continues to show CHECKS REQUIRED.
- Report approval and run completion are blocked if a selected non-Home result is missing its note.
- Nightly notes appear on the final report.

PRIVACY + HISTORY v1.3.0:
- Client names display as 3 letters of first name + 3 letters of last name by default.
- Temporary Show All Names control reveals full names, then automatically re-hides after 45 seconds or when leaving/locking.
- 3x3 Client Search finds a client by the masked first3+last3 key and shows the property address/room.
- Final report preview and completed-history report display names masked by default.
- PNG report export always uses masked 3x3 names.
- History now has an unlimited month-by-month calendar. Dates containing reports are highlighted and clickable.


v1.6.12: central client registry (schema 26), secure new-client/deactivate workflow, and housing assignment by existing client search.

v1.6.13 BRANDING, COMPACT LISTS, MANUAL HOUSE ORDER, STABILITY FIXES
- Rebranded all in-app accent colors from the old placeholder teal to the actual Shawnee hand-mark green, so the app and its icon finally match.
- Client • Secure search is now two 3-character boxes (First 3 / Last 3) instead of one free-text field, matching the masked-name key exactly. Typing the third letter in the first box auto-advances to the second.
- Properties & Rosters list is now compact single-line rows instead of large stacked cards.
- New "↕ Order Houses" screen (reachable from Properties & Rosters and from tonight's active house-check list) lets you set the actual travel order by hand, using the same up/down arrows as Route Planner. This order now drives every house list in the app: tonight's checks, reports, and lock codes. Leaving it untouched keeps the previous automatic order (required-first, by street/number).
- Tonight's active house-check list is now compact rows too, with no edit or delete controls — ordering only, since houses can't be added/removed mid-run.
- Fixed a real bug: a property marked with a special situation (Open, Not Moved Yet, Out of Service, Can Not Bill For) would previously crash that screen outright. It now shows a small status badge instead.
- Fixed a rapid-tap race on PIN-gated destructive actions (delete property, add property, reactivate/deactivate client, lock final report) that could leave the button stuck unresponsive under fast repeated taps.

PHONE UPDATE: after uploading v1.6.13, reload the GitHub Pages URL in Safari. The header now reads v1.6.13 — if it doesn't, the new files haven't loaded yet.

v1.6.14 REAL SMART ROUTE + PER-HOUSE NAVIGATE
- Smart Route on the Order Houses screen is now live, not a placeholder. It groups houses by street and orders each group by house number, entirely on this phone — it never sends your house list to an outside service. You can still nudge any house up or down by hand afterward.
- Every house row — on Order Houses and on tonight's active checklist — now has a small 📍 button that opens driving directions to that one address directly, without going into Route Planner first.
- Confirmed the "Continue Inspection" step is not duplicate logic: an active inspection has always resumed through the calendar day by design (since v1.5.4), so a second one can't accidentally get started. The Order Houses button is one tap past that, same as reaching the checklist itself.
