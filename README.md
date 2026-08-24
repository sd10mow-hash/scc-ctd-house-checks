# SCC-CTD House Checks v1.4.9

GitHub-ready public PWA build.

## v1.4.9 changes
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


V1.4.5 REPORTER IDENTITY / AUDIT LABEL
- Every phone now has a local user profile: full name, job title/role, and approved work email.
- New installations ask for that identity during first-time setup.
- Existing installations upgraded to v1.4.9 ask “Who is using this phone?” after the next successful PIN unlock.
- Final report header now prints REPORTED BY: <name> instead of DRIVER.
- Historical reports remain backward-compatible with older driverName snapshots.
- Encrypted database transfers intentionally do NOT transfer the sender's local user identity to the recipient phone.
- Import preserves the recipient phone's own name, role, work email, report-text number, and local PIN.
- The same numeric PIN may exist on two phones because PINs are local encryption credentials, not centralized user accounts.


V1.4.6 UNIFIED CLIENT SEARCH
- Removed the separate Client Profiles navigation item.
- 3×3 Client Search is now the single client lookup and profile hub.
- Search includes active and inactive client records.
- Each result has View Client and Edit Client.
- Edit Client requires the app PIN and includes name, phone, inspection requirement, work schedule, school schedule, important information, and permanent profile note.
- Active client results can jump directly to Open House.


V1.4.7 QUICK LOCK
- Added a persistent 🔒 Lock button to the top/front of the app.
- Quick Lock saves current state, clears the in-memory encryption key and decrypted state, hides temporary names/codes, and immediately returns to the PIN screen.
- This is separate from the automatic inactivity lock and makes intentional logout/lock much faster on a phone.


V1.4.8 IPHONE PROFILE-SCREEN SCROLL FIX
- Fixed the “Who is using this phone?” screen being clipped on iPhone.
- PIN/profile overlays now scroll vertically and respect iPhone safe areas.
- The profile dialog resizes against the iOS visual viewport when the keyboard opens.
- Focusing Name / Role / Work Email automatically scrolls that field into view.
- Reporter-profile fields use a single-column mobile layout and 16px inputs to avoid Safari zoom/clipping.


V1.4.9 AUTHORIZED USER / EMAIL FIX
- Corrected the approved work-email domain to @shawneecounseling.org.
- Removed the job title / position requirement from user setup and Settings.
- Authorized User setup now asks for:
  1) Authorized User Name
  2) Authorized User Cell Number
  3) Work Email
  4) Confirm Work Email
- Work Email and Confirm Work Email must match.
- Authorized User Name is the value printed as REPORTED BY on the final report.
- Existing installations are asked to confirm the corrected authorized-user information after upgrade.
- The authorized user's name, cell, email, and PIN remain local to that phone and are not overwritten by imported shared databases.
