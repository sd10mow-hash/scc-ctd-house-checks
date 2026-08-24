# SCC-CTD House Checks v1.6.11

GitHub-ready public PWA build.

## v1.6.11 central client registry / housing assignment

- Schema 26 introduces a central encrypted client registry. Existing housed clients migrate automatically when the database unlocks.
- **CLIENT • SECURE** now owns client creation, profile editing, activation, and deactivation.
- New clients are created once as **ACTIVE • UNASSIGNED** before housing placement.
- **PROPERTIES** no longer creates client identities inside room rows. Open rooms use **Assign Client** with the same 3-letter narrowing behavior.
- Unassigning a client opens the room but keeps the client **ACTIVE • UNASSIGNED**. Housing never deactivates the person.
- Deactivation happens only from the secure client profile and opens any currently assigned room.
- Client profile edits sync to the assigned room used by inspections and reports.
- Secure Client entry requires PIN re-authentication.
- Existing inspections, reports, properties, rooms, route locations, and client history are preserved.


## v1.6.1 changes
- Rebuilt Route Planner as a clean three-button hub: **Create Route**, **Business Locations**, and **Saved Locations**.
- Create Route has **Client Homes**, **Route Locations**, **Insert Address**, **Smart Route**, **Save Route**, and **Load Route** controls.
- Client Homes uses the encrypted local property database, supports **Select All**, and returns to Create Route with **Apply**.
- Route rows stretch across the usable screen with aligned **up / down / remove** controls for fast phone ordering.
- Starting Point supports **Current Position** or any saved route location.
- Saved route configurations persist locally and can be loaded from inside Create Route.
- Navigation hands the finished order to Google Maps. Smart Route remains a local street/house-number organizer and never silently sends the house list to an external optimizer.
- Added private location-seed import support so route-only addresses can be loaded into the encrypted local database without publishing them in the GitHub app shell.

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
- The app accepts only recipient addresses ending in @shawneecounseling.org before export proceeds.
- Plain JSON export is disabled from the normal UI.
- Import accepts encrypted .sccbackup files and asks for the transfer password, then saves the imported data into the recipient phone's encrypted local database under that user's own app PIN.
- iPhone limitation: after the PWA hands the encrypted attachment to Apple's share sheet, the web app cannot inspect or enforce the final Mail recipient selected there. The in-app work-domain validation occurs before export.


V1.4.5 REPORTER IDENTITY / AUDIT LABEL
- Every phone now has a local user profile: full name, job title/role, and approved work email.
- New installations ask for that identity during first-time setup.
- Existing installations upgraded to v1.6.1 ask “Who is using this phone?” after the next successful PIN unlock.
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


V1.5.0 WORK EMAIL VALIDATION FIX
- Removed Safari/browser native `type=email` validation from SCC-CTD work-email fields.
- Work-email fields now use a normal text field with the email keyboard, so iPhone cannot reject a valid SCC address before the app sees it.
- The app now normalizes whitespace and case, then validates one definitive rule: the address must contain one @ and end EXACTLY in @shawneecounseling.org.
- Work Email and Confirm Work Email are compared after normalization.
- The correct approved domain is shown directly under the Work Email label.


V1.5.1 CLEAN MAIN SCREEN / MODULE SHELL
- After login, the app now opens to a dedicated Main Screen instead of automatically rendering Tonight below the menu.
- The Main Screen contains ONLY the module buttons, plus the persistent top Lock control.
- Module button order:
  Row 1: Tonight | Route | Client Search
  Row 2: Report | Lock Codes | History
  Row 3: Properties | Locations | Database
  Row 4: Settings
- Selecting a module removes the full button grid and opens only that module.
- Every module gets one navigation control: ← Main Screen.
- Returning to Main Screen clears temporary module state, temporary full-name reveals, and lock-code authorization.
- This build intentionally changes only the navigation shell. Individual modules are NOT declared repaired yet; they will be reviewed one at a time.


V1.5.2 SIX-DOOR MAIN SCREEN
- Main screen is now six large full-width module buttons centered in the usable phone viewport.
- Order: INSPECTIONS, REPORTS, ROUTE PLANNER, CLIENT • SECURE, PROPERTIES, SETTINGS.
- Each button has a visual icon and a subtle right chevron.
- Main menu stretches vertically to use the available screen without rendering module content underneath.
- Responsive height rules keep all six controls usable on shorter iPhone screens.
- Hidden/support functions remain available inside the existing code but are no longer exposed as main-screen buttons; module-by-module consolidation will follow.


V1.5.3 BRANDING + INSPECTIONS CALENDAR
- Replaced the old house artwork with the supplied Shawnee Counseling Center hand mark.
- Header now places the Shawnee mark directly beside the business name and Transportation identity.
- Home module labels are left-justified.
- Inspections now opens to an explorable monthly calendar.
- Current day is green. Dates containing completed reports are pink.
- If today also has a completed report, the green current-day cell carries a pink completion corner marker.
- Tapping today opens the current inspection worklist.
- Tapping a past date with one saved report requests the app PIN and opens the saved report.
- Completed reports are shown in a full-size scrollable/pinch-zoom viewer on iPhone.
- Historical report Print, Text, and Email actions require the app PIN.
- Completed runs return to the Inspections calendar and mark that date there instead of sending the user to a separate History screen.
- The existing app PIN is reused for report security; this build does not create a second report password.


V1.5.4 DATE-DRIVEN INSPECTIONS
- Every calendar day is now selectable, including blank past and future dates.
- Selecting a date opens a date-detail screen rather than immediately opening a report.
- Every date can carry one encrypted Day Note. Calendar dates with a note show a small amber dot.
- Completed reports remain pink on the calendar. Today remains green. An active inspection receives a teal active marker.
- A new nightly inspection can ONLY be started from today's calendar detail.
- Start button is date-explicit: “Begin Inspection • <date>”.
- Starting an inspection creates an explicit inspectionDate/runDate so a run is not silently created on login.
- While a run is active, today's date detail shows “INSPECTION IN PROGRESS”, Continue Inspection, and View Current Report.
- Current Report is a live read-only preview and is not treated as a completed historical report.
- The house worklist and individual-house screens now return through the previous inspection level.
- Completed reports are attached to the inspection date, even if completion occurs after midnight.
- Completed reports still require the app PIN to open, print, text, or email.
- Top-level Reports no longer shows a ghost blank report before a nightly inspection has been started.


V1.5.5 INSPECTION FEEDBACK + CLEAN RESET SUPPORT
- “Normal / Active” is replaced by “No Special Status” in property management and is hidden from ordinary inspection cards.
- House progress keeps the horizontal progress bar and adds a true circular progress ring.
- The percentage number is centered inside the ring.
- The ring fills as completion increases and turns bright green at 100%.
- Today's date-detail action is “Start Inspections • <date>”.
- Added encrypted operational-reset backup support.
- An operational reset clears only current inspection state, completed/test report history, and calendar Day Notes.
- Operational reset preserves properties, clients, room assignments, door codes, locations, routing data, local authorized-user identity, and device PIN.


V1.5.6 CLEAN SETTINGS HUB
- Settings now opens to a blank hub containing only five large controls:
  User Profile, Release Database, Load Database, Save, Restart App.
- User Profile opens its own clean profile form.
- Release Database opens its own encrypted database-release interface.
- Load Database opens a dedicated large file picker and now exposes the encrypted .sccbackup importer from Settings.
- This fixes the navigation dead-end created when Database was removed from the main screen.
- The previously emailed Clean Inspection State .sccbackup is compatible with v1.6.1.
- Load Database accepts the .sccbackup extension plus broad iPhone file-picker MIME fallbacks.
- Successful imports return to Settings; errors remain visible instead of silently failing.
- Save explicitly writes the current encrypted state to this device.
- Restart App saves first and reloads the app; it does not erase the database.


V1.5.7 STRICT FINAL REPORT WORKFLOW
- Final report processing is hard-blocked while ANY required client field is unresolved.
- NOT HOME without its required note counts as unresolved, so it also blocks final processing.
- There is no alternate Reports-module path that can bypass this gate.
- Once unresolved reaches zero, the active Inspection screen offers Preview Final Report.
- Final Preview is view-only and pinch-zoomable on iPhone.
- Exiting Preview records the exact inspection-state signature that was reviewed.
- If any inspection data changes after Preview, Lock Final Report disappears until the updated report is previewed again.
- Lock Final Report requires the app PIN.
- Locking creates the immutable historical snapshot, ends the active inspection, and opens the locked report.
- Locked historical reports retain PIN-protected Print, Text, and Email actions.
- Calendar dates containing a locked final report retain the pink report identity and now receive a soft blue halo around the entire day cell.


V1.5.8 HOUSE COMPLETION + IMAGE REPORT CLEANUP
- Removed Show Full Names from the active house-listing screen.
- Houses with zero mandatory client checks now display COMPLETE and a bright green 100% progress ring.
- Zero-required houses are intentionally treated as complete by the final-report gate; their appearance now matches that logic.
- Individual zero-required house headers also display COMPLETE.
- Removed Cell Phone from the final report on-screen layout.
- Removed Cell Phone from the generated PNG layout.
- Rebalanced the report grid so Client Name and Notes receive the recovered space.
- Report delivery is now image-first: Text and Email use the actual PNG file through the system share sheet.
- The app no longer silently falls back to a text-only SMS/email when file sharing is unavailable.
- When attachment sharing is unavailable, the actual PNG is saved and the user is explicitly told to attach that image.


V1.5.9 FULL-NAME FINAL REPORT + SPECIAL NOTES
- Active inspection house screens now display full client names by default.
- Removed the Show/Hide Full Names control from the active house inspection screen.
- Final report preview, locked historical report, printed report, shared PNG, text-share PNG, and email-share PNG all use full client names.
- Final report output no longer depends on the temporary masked-name privacy toggle.
- Permanent client profile notes are moved out of the per-client inspection-row Notes column and summarized at the bottom-right under SPECIAL NOTES.
- SPECIAL NOTES fields are: Client full name | House | Special Note.
- Nightly inspection remarks remain in the individual client's Notes cell.
- Special Notes area expands vertically when more notes exist.
- PNG generation uses the same full-name and Special Notes rules as the on-screen/print final report.


V1.6.1 FINALIZED-DAY LOCK + VEHICLE LOGS PLACEHOLDER
- Main-screen REPORTS button is replaced by VEHICLE LOGS • UNDER CONST.
- Vehicle Logs is moved to the button immediately above Settings.
- Vehicle Logs currently opens a clean under-construction placeholder so the slot is reserved without pretending unfinished functionality exists.
- Once a locked/completed report exists for today's inspection date, Start Inspections is no longer shown.
- beginInspectionForToday also enforces the finalized-date rule internally, so the block cannot be bypassed by stale UI.
- Today's finalized date shows NIGHTLY INSPECTION FINALIZED and a Revisit Final Report button.
- Revisit Final Report opens the most recently locked report for that date using the existing PIN-protected historical-report viewer.
- Existing report entries are relabeled Revisit Report.
- Multiple legacy/test reports remain viewable, but a third inspection cannot be started for that finalized date.
