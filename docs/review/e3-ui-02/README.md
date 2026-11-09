# UI-02 browser review evidence

This evidence comes from the V3 frontend connected to a real Express V3 app and a fresh SQLite memory database. All identities, phone numbers and applications are fictional.

Run from the repository root with Node 24 and an installed Chromium browser.

```powershell
$env:CHROME_BIN = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node tests/browser/v3-recruiting.mjs <output-directory>
```

The script generates random credentials at runtime and starts the API and Vite on loopback. It uses a separate temporary Chrome profile. Credentials and JWT values are omitted from the generated results.

## Verified interactions

- Two same-name positions remain separate. Actual API creation, details, editing, close, reopen and soft archive are exercised.
- Actual application creation and profile editing preserve position ID. The fixture also creates same-name applications under different positions through the HTTP API.
- An operation-level 403 is injected before the API handler in the disposable Express fixture. The frontend rereads actual HR identity and retains the session. Actual database role revocation subsequently makes the protected API reject requests and returns the frontend to login.
- A competing HTTP writer changes a position. The original browser draft receives 409, retains its input, reads the current server version and resubmits only after explicit confirmation.
- A fixture drops the response after the real creation transaction commits. Replaying the original request creates exactly one application and one creation event.
- Identity revalidation temporarily returns 503. The mounted form and draft survive and sensitive controls remain disabled until recovery.
- A second uncertain write is followed by explicit logout and login as another HR. The previous editor does not reappear. The already committed application remains singular.
- SQL pagination returns 20 records then 2 records. Delayed old filters do not overwrite the newer result or another route after unmount.
- True empty, filtered empty, loading, failure and read retry are exercised. The 390px list has container scrolling without page horizontal overflow.
- Browser network records contain zero V2 API requests.

The expected socket-hang-up diagnostics are caused by deliberate lost-response injection.

## Environment and screenshots

Chrome 156.0.8078.81 in desktop headless mode, DPR 1. Desktop viewport is 1440 by 900. The mobile layout screenshot uses a 390 by 844 viewport. Screenshots capture full page content, so exported image heights can exceed the viewport.

[Positions](positions.png), [applications](applications.png), [read-only application detail](application-detail.png), [mobile list](applications-mobile.png).

[Operation 403](operation-403.png), [409 with retained draft and current server values](conflict-409.png), [identity outage](draft-offline.png), [uncertain write](uncertain-write.png).

[True empty](positions-empty.png), [filtered empty](applications-filtered-empty.png), [read error](applications-error.png), [loading](applications-loading.png), [second page](applications-page-2.png).

The machine-readable assertions are in [results.json](results.json).

## Review boundaries

The position filter uses a stable numeric ID. Department search uses the existing keyword contract. Global metric cards are deferred because the position list contract provides filtered page totals rather than all design-level dashboard metrics. Application detail is the approved read-only scope, with ordinary profile editing available separately. Interview, feedback, advancement, closure and Offer actions remain unavailable.

The draft survives temporary failures while mounted. Explicit confirmed navigation, logout or refresh can discard it. An unresolved write warns that the server may already have saved it and advises checking existing records before creating again. Drafts and command keys are not transferred to another account.

Actual mobile hardware, complete AC acceptance and design-side visual approval remain pending.
