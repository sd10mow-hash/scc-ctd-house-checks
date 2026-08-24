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


v1.4.5: client Required/Not Required, PIN-gated property edits/deletes, ordered houses, route picker/base locations, full dynamic report image with Remarks lines.

PHONE UPDATE: after uploading v1.4.5, open https://sd10mow-hash.github.io/scc-ctd-house-checks/?build=1.4.3 directly in Safari. This build uses versioned assets and includes a safe Refresh App Files button.
