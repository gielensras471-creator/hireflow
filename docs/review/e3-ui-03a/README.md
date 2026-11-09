# E3-UI-03A review evidence

This branch adds interview activities to the V3 application detail and replaces the interview placeholder with a real V3 list.

## Reproduce

From the repository root, using Node 24 and installed Google Chrome:

```powershell
$env:CHROME_BIN = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node tests/browser/v3-interviews.mjs <output-directory>
```

The script starts a separate Express V3 app, SQLite memory database, Vite server and temporary headless Chrome profile on loopback. Passwords and JWT secrets are generated at runtime and omitted from evidence. No persistent business database is used. All names and records are fictional.

The API fixture uses a fixed synthetic Shanghai business clock on 2030-01-01. Reminder reads are checked at 13:59:59, 14:00:00 and 14:00:01 against a 14:00 appointment. Each read asserts scheduled remains scheduled. The fixture creates eligible stages and one closed application through actual accepted APIs, for test preparation only.

For the interview-version conflict branch, another real HTTP writer first reschedules the interview. The isolated wrapper then aligns only the submitted application version to current, while retaining the stale interview version. The unchanged real backend rejects that request with INTERVIEW_VERSION_CONFLICT. Application-version conflict is exercised independently without that alignment.

A wrapper drops one schedule response after its transaction commits. Repeating the original browser intent must leave exactly two sequential interviews for that application, including the earlier cancelled one, and exactly two scheduled events. The socket-hang-up log from this case is expected.

The operation-level 403 and temporary identity/list 503 responses are injected in the disposable wrapper. Database role revocation is also exercised and must return the UI to login. Backend domain rules and schema are unchanged.

## Actual results

- Global SQL pagination 20/3 and supported status/application filters.
- Active first- and second-interview booking, screening/closed UI blocking, actual parallel-booking HTTP rejection.
- Shanghai input, reschedule, explicit completion without stage advancement, nonempty cancellation reason, cancellation and sequential rebooking.
- Application and interview version conflicts preserve the draft and require explicit new-intent confirmation.
- Lost schedule response replays the same key and content without duplicate activity or events.
- Delayed filter results and unmounted readers cannot overwrite the current result.
- Temporary identity failure preserves the editor. Operation-level 403 preserves a valid HR session, while role revocation exits safely.
- Explicit logout and login as a different HR remove the previous editor without sending its draft.
- Current and historical interview rounds are labelled separately after a real fixture advancement.
- 390px whole-page horizontal overflow is absent. The table scrolls in its container.
- Zero V2 API requests during the browser workflow.

The standard test suite passes 163 tests. Four new UI tests cover booking eligibility, query scope, invalid dates and timezone-independent input under UTC, America/New_York and Asia/Tokyo. Four additional actual error-adapter cases cover interview messages. Existing V2, service and API tests remain included.

The existing UI-02 Chromium script was separately rerun and passed. TypeScript, build, Prettier and git diff --check passed. Lint retains the pre-existing Dashboard attribute-order warning. Git may report LF-to-CRLF conversion warnings.

## Screenshots

Desktop viewport is 1440 by 900, mobile is 390 by 844, DPR 1. Full-page capture can produce taller PNGs. The exact Chromium version and asserted workflow results are in [results.json](results.json).

- [Interview list](interviews-desktop.png) and [mobile list](interviews-mobile.png).
- [Empty list](interviews-empty.png) and [error/retry](interviews-error.png).
- [Application-linked interview](application-interview.png) and [historical round](historical-round.png).
- [Booking form](schedule-form.png), [reschedule](reschedule-form.png), [completion confirmation](complete-confirmation.png), [completed](completed.png).
- [Cancellation reason](cancel-reason.png), [cancelled](cancelled.png), [read-only due reminder](due-reminder.png).
- [Application-version conflict](application-version-conflict.png), [interview-version conflict](interview-version-conflict.png), [uncertain schedule](uncertain-schedule.png).

## Scope and remaining validation

The approved UI-02 profile editor and independent lifecycle fields are preserved. Profile editing and interview editing are mutually gated, and successful interview writes reload the application authority/version. V3 router and error copy have small integration changes. Generic request, idempotency and draft infrastructure are reused.

Global filters use stable numeric application and position IDs plus the supported round and status fields. The detail layout retains the UI-02 read-only skeleton with the interview region beneath it. Date display uses scheduledLocal from the server and labels Asia/Shanghai. The record list supports explicit refresh and a 30-second visible-page read refresh when no editor is open.

Interview scheduling is entered from application detail. Feedback, advancement, closure, Offer, full history, Dashboard, account editing and production rollout remain separate tasks.

The browser and unit evidence supports specific behaviors related to AC-04/09/21/22/36. Formal AC acceptance, real mobile hardware and independent design-side approval remain pending.

## FIX-01 editor opening and read-failure boundaries

The two editors share a synchronous lease owned by one operation. The lease is acquired before the opening HTTP requests, checked again after awaiting them, and released only by its owner. Closing waits for editor unmount before releasing the lease, preserving the other editor's draft protection. Route, component lifetime, session generation and ready identity are checked before mounting. Tests also prove an old lease cannot release a newer lease.

Interview reload invalidates freshness and clears the old application authority immediately. Actions require a fully successful current application/interview read and ready identity. Opening an editor rereads and checks actual application/meeting eligibility, including existing scheduled appointments.

The Chromium fixture holds an application-detail response until the test explicitly releases it. Both opening directions reject the opposite editor immediately. Single valid forms retain drafts and reject cancelled navigation. Navigating away while opening prevents late editor resurrection. A rejected opening releases its lease. An existing scheduled application's refresh is then forced to fail: no enabled booking action or editor appears. Successful reload restores the existing appointment and its valid reschedule action.

[Interview editor owns the gate](interview-open-exclusive.png), [profile editor owns the gate](profile-open-exclusive.png), [failed refresh disables booking](failed-refresh-blocked.png), [serial-run assertions](fix01-results.json).

The final UI-03A script passed without intervention when run serially, and the original UI-02 browser regression passed. A concurrent fixture run encountered a transient Vite dynamic-import startup problem. Final evidence uses the independent serial run. Browser polling deadlines now use performance.now so the fixture's fixed Date.now cannot prevent timeout reporting.

Quality gates passed: 165 Node tests, type checking, lint, build, changed-file Prettier and git diff --check. Only the existing Dashboard attribute-order warning remains. Existing dropped-response cases still generate expected socket-hang-up diagnostics.
