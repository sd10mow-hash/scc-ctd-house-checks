# SCC-CTD House Checks v1.4.4

GitHub-ready public PWA build.

## v1.4.4 changes
- Per-client **Required / Not Required** field. Required clients without a result appear as `REQUIRED • NO RESULT`, not a vague `MISSING`.
- Property edit/remove is protected by the app PIN. Editing now scrolls directly to the editor.
- Required houses sort first; same-street houses sort by ascending house number.
- Route planner now has an address picker with OK/Cancel, selectable home base, manual move controls, and Auto Order by street/number progression.
- Two base locations are seeded: Home Office at 519 Court St and Transportation Division at 3977 Rhodes Avenue.
- Final report PNG is dynamically sized so the **entire report** and full Remarks lines are included in one image.
- Report/history names remain 3×3 masked by default.

Private client data is not included in this public package.


V1.4.1 CLIENT / SECURITY UPDATES
- Removing clients archives them into an Inactive Client Registry instead of deleting the record.
- Inactive clients can be reactivated into an OPEN bed.
- Client profiles include a Work Schedule field and can be opened during a house check.
- Only NOT HOME requires a nightly note. HOME, SLEEP, and PASS resolve without a required note.
- NOT HOME includes a one-tap "Note: Working" shortcut.
- Added PIN-protected Lock Codes screen with full-list print and Share / Message.
- iPhone uses the native Share sheet for Messages/contact selection because direct web contact picking is not supported by Safari.


V1.4.2 HOUSE-INSPECTION REQUIREMENT FIXES
- Fixed Edit Property from the house-inspection screen: it now asks for PIN, opens the property editor at the top, and scrolls to it.
- Property editor is rendered above the property cards while editing, so an Edit action is visually obvious.
- Adding a property now also requires PIN.
- Every client has an explicit Inspection REQUIRED / Inspection NOT REQUIRED field in the property/client record.
- NOT REQUIRED clients are visible during house inspection but have no Home / Not Home / Sleep / Pass controls and no nightly note field.
- NOT REQUIRED clients show DO NOT DISTURB • HOUSE CHECK NOT REQUIRED.
- Client Record shows the stored inspection requirement.
- One-time migration applies the original roster rule: green/gray highlighted clients become NOT REQUIRED; unhighlighted clients become REQUIRED.


V1.4.3 MASTER-SHEET / PROFILE / UPDATE PASS
- Final report preview and PNG now mirror the master run sheet: Date/Time, Driver, two side-by-side house columns, Rm / Client Name / Cell Phone / Home / Not / Sleep / Pass / Notes, original status legend, and original instruction block.
- Nightly remarks appear as their own Remarks line in the Notes column.
- Added dedicated Client Profiles navigation with 3x3 search, active/inactive records, work schedule, school schedule, important information, permanent note, and inspection requirement. Editing requires PIN.
- Property colors are no longer arbitrary. Property Situation controls the display color: Normal / Active, Open, Not moved yet, Out of Services, or Can not Bill for.
- Lock Codes now record the last change date and can be updated quickly from the PIN-protected code screen.
- Added hard cache-busted asset URLs, no-cache service-worker fetches, and a safe Refresh App Files button that clears only app caches/service workers and preserves encrypted IndexedDB data.


V1.4.4 ENCRYPTED WORK-EMAIL DATABASE TRANSFER
- Portable database transfer uses AES-256-GCM encrypted .sccbackup files.
- Transfer key uses PBKDF2-SHA256 with 240,000 iterations and a separate transfer password.
- Database export requires the app PIN again.
- The app accepts only recipient addresses ending in @shawneecounselingcenter.org before export proceeds.
- Plain JSON export is disabled from the normal UI.
- Import accepts encrypted .sccbackup files and asks for the transfer password, then saves the imported data into the recipient phone's encrypted local database under that user's own app PIN.
- iPhone limitation: after the PWA hands the encrypted attachment to Apple's share sheet, the web app cannot inspect or enforce the final Mail recipient selected there. The in-app work-domain validation occurs before export.
