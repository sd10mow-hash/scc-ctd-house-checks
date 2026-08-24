# SCC-CTD House Checks v1.4.1

GitHub-ready public PWA build.

## v1.4.1 changes
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
