# Test data factory pattern

A server-side Script Include that generates consistent test fixtures, invoked from `run_server_script` ATF steps. Reduces per-test boilerplate, centralises cleanup, and gives every test a predictable starting state.

This pattern is **complementary** — not a replacement — to the higher-level `record_insert` step type. Use it when:

- You create the same shape of record across many tests (incident with priority + caller, user with group membership, change request with approval chain).
- You want a single cleanup teardown that works whether the test succeeds or fails partway through.
- You want to encapsulate non-trivial setup logic (cascading inserts, default-value computation) instead of duplicating field-value blocks across step rows.

If your case just needs one or two `record_insert` steps, **don't reach for this pattern** — direct steps are simpler and more inspectable.

## The Script Include

Create a single `sys_script_include` named `ATFTestDataFactory`:

```javascript
var ATFTestDataFactory = Class.create();
ATFTestDataFactory.prototype = {

    initialize: function() {
        this.createdRecords = [];
    },

    // ---- Factories ----

    createTestIncident: function(options) {
        options = options || {};
        var gr = new GlideRecord('incident');
        gr.initialize();
        gr.short_description = options.short_description ||
            'ATF Test Incident ' + gs.generateGUID().substring(0, 8);
        gr.description = options.description || 'Created by ATF Test';
        gr.priority = options.priority || 3;
        gr.category = options.category || 'software';
        gr.caller_id = options.caller_id || gs.getUserID();
        var sysId = gr.insert();
        this.createdRecords.push({ table: 'incident', sys_id: sysId });
        return sysId;
    },

    createTestUser: function(options) {
        options = options || {};
        var username = options.user_name || 'atf_' + gs.generateGUID().substring(0, 8);
        var gr = new GlideRecord('sys_user');
        gr.initialize();
        gr.user_name = username;
        gr.first_name = options.first_name || 'ATF';
        gr.last_name = options.last_name || 'User';
        gr.email = options.email || username + '@test.example.com';
        gr.active = true;
        var sysId = gr.insert();
        this.createdRecords.push({ table: 'sys_user', sys_id: sysId });
        return sysId;
    },

    createTestGroup: function(options) {
        options = options || {};
        var gr = new GlideRecord('sys_user_group');
        gr.initialize();
        gr.name = options.name || 'ATF Group ' + gs.generateGUID().substring(0, 8);
        gr.active = true;
        var sysId = gr.insert();
        this.createdRecords.push({ table: 'sys_user_group', sys_id: sysId });
        return sysId;
    },

    // ---- Generic helpers ----

    /** Insert any record and ledger it for cleanup. */
    create: function(table, fields) {
        var gr = new GlideRecord(table);
        gr.initialize();
        for (var k in fields) gr.setValue(k, fields[k]);
        var sysId = gr.insert();
        if (sysId) this.createdRecords.push({ table: table, sys_id: sysId });
        return sysId;
    },

    /** Add an existing record to the cleanup ledger (e.g. one you found instead of created). */
    track: function(table, sysId) {
        this.createdRecords.push({ table: table, sys_id: sysId });
    },

    // ---- Teardown ----

    /**
     * Deletes ledgered records in reverse insertion order.
     * Continues on errors so one bad row doesn't leak the rest.
     * Returns the count successfully deleted.
     */
    cleanup: function() {
        var deleted = 0;
        for (var i = this.createdRecords.length - 1; i >= 0; i--) {
            var rec = this.createdRecords[i];
            try {
                var gr = new GlideRecord(rec.table);
                if (gr.get(rec.sys_id)) {
                    gr.deleteRecord();
                    deleted++;
                }
            } catch (e) {
                gs.warn('[ATFTestDataFactory] cleanup error on ' +
                    rec.table + ':' + rec.sys_id + ' — ' + e.message);
            }
        }
        this.createdRecords = [];
        return deleted;
    },

    type: 'ATFTestDataFactory'
};
```

Properties:

- `client_callable: false` (server-side only).
- `active: true`.
- Application: scoped or `global` per your test app's convention.

## Using the factory from an ATF step

A `run_server_script` step takes a `script` input. The factory needs to survive across steps within one test, so write its handle to ATF's step outputs and read it back in later steps.

### Setup step

In the Path B builder's JSON-spec format:

```json
{
  "type": "run_server_script",
  "script": "var factory = new ATFTestDataFactory();\noutputs.factory = factory;\noutputs.incident_sys_id = factory.createTestIncident({priority: 1, short_description: 'Critical Server Issue'});\noutputs.caller_sys_id = factory.createTestUser({first_name: 'Test', last_name: 'Caller'});"
}
```

With Fluent SDK:

```typescript
atf.server.runServerSideScript({
    $id: 'setup',
    script: `
        var factory = new ATFTestDataFactory();
        outputs.factory = factory;
        outputs.incident_sys_id = factory.createTestIncident({
            priority: 1,
            short_description: 'Critical Server Issue'
        });
        outputs.caller_sys_id = factory.createTestUser({
            first_name: 'Test',
            last_name: 'Caller'
        });
    `,
})
```

### Teardown step (always last)

```typescript
atf.server.runServerSideScript({
    $id: 'teardown',
    script: `
        // outputs.factory is the same instance from the setup step
        var deleted = outputs.factory.cleanup();
        gs.info('[ATF teardown] Deleted ' + deleted + ' fixture records');
    `,
})
```

ATF steps share an `outputs` map within a single test execution, so the factory instance round-trips. **It does NOT round-trip across tests** — each test starts with a fresh `outputs` map.

> ⚠ **Batching rule still applies.** Server-script steps are server-side — they're fine before/after a UI batch, but **not inside one**. A `run_server_script` step placed *between* `set_field_values` steps will destroy `g_form`. Put setup at the top, teardown at the bottom, and keep UI steps contiguous in the middle.

## Conditional skip pattern

If a test depends on a plugin being installed, a feature flag being on, or a particular data state existing, use a precheck step that signals skip:

```javascript
// Step 1: precheck
var plugin = new GlideRecord('v_plugin');
plugin.addQuery('id', 'com.snc.change_management');
plugin.addQuery('state', 'active');
plugin.query();

if (!plugin.hasNext()) {
    outputs.skip_test = true;
    outputs.skip_reason = 'Change Management plugin not active';
    // Mark this step as skipped — downstream steps still run, but flagged
    stepResult.setStatus('skipped');
    stepResult.setOutputMessage('Prerequisites not met: ' + outputs.skip_reason);
}
```

**Caveat — ATF doesn't have a real "skip test" affordance.** `stepResult.setStatus('skipped')` only marks **this step** as skipped — the test continues. Three workarounds depending on what you actually want:

| Want | Approach |
|---|---|
| Just record that the test was inapplicable, no later assertions run | Put the precheck early, set `outputs.skip_test = true`, and put `if (outputs.skip_test) return;` at the top of every subsequent server-script step. UI steps will still try to run though — break early by `stepResult.setStatus('skipped')` on each. |
| Fail the whole test loudly when prereq missing | Use `stepResult.setStatus('failed'); stepResult.setOutputMessage('Plugin not installed')` — the test reports red, you know exactly why |
| Skip dispatch entirely from outside ATF | Do the precheck in CI (before calling `/api/sn_cicd/testsuite/run`), skip the dispatch when prereq fails |

The last option is the cleanest — keep prereq logic outside the test runtime.

## Idempotency / orphan-data cleanup

ATF tests get cancelled mid-run sometimes (timeouts, runner failures). The factory's `createdRecords` ledger goes with the runtime, so if the teardown never executes, you leak. Two backstops:

### Backstop 1 — naming convention + scheduled cleanup

If every factory record uses a recognisable prefix (e.g. `ATF Test` in `short_description` for incidents, `atf_` in `user_name` for users), a daily scheduled job can sweep orphans older than 24 h:

```javascript
// scheduled job — daily
var tables = [
    { table: 'incident', field: 'short_description', prefix: 'ATF Test' },
    { table: 'sys_user', field: 'user_name', prefix: 'atf_' },
    { table: 'sys_user_group', field: 'name', prefix: 'ATF Group' },
];
var cutoff = gs.daysAgo(1);

tables.forEach(function(t) {
    var gr = new GlideRecord(t.table);
    gr.addQuery(t.field, 'STARTSWITH', t.prefix);
    gr.addQuery('sys_created_on', '<', cutoff);
    gr.query();
    var count = 0;
    while (gr.next()) { gr.deleteRecord(); count++; }
    if (count > 0) {
        gs.info('[ATF orphan sweep] Deleted ' + count + ' from ' + t.table);
    }
});
```

### Backstop 2 — run-marker scoping

Add a high-entropy marker to every factory-created record (e.g. a per-run UUID stamped into a description-style field) and store it on the test result. A teardown step (last in test) deletes everything matching the marker by query — closing the leak window even when the in-process ledger is lost.

## Relationship to test-layer seed frameworks

If your project also has a UI/E2E framework (Playwright, Cypress, WDIO, etc.) with its own seed fixtures backed by the ServiceNow Table API, the two seed surfaces share a mental model but live in different layers — they don't conflict, and they don't share ledgers:

| Layer | Where it runs | Scope | When to use |
|---|---|---|---|
| Test framework (TypeScript / JS / Python) | In CI runner, talking to the tenant via REST | Per UI/E2E test | UI/E2E tests that need ServiceNow records **before** driving the browser. Run-marker enforced. Teardown automatic at framework level. |
| ATF (server-side JS) | Inside the platform, in the test runner agent | Per ATF test | ATF tests that need fixtures inside the same platform execution context as the assertions |

The two surfaces complement each other. A typical hybrid: the framework-side seed creates a Customer record + a related case + a doc, drives the UI through assertions, then triggers an ATF test that uses **its own** factory to set up scratch records for in-platform assertions. Neither side ever sees the other's fixtures; both teardown independently.

If you're writing both, keep prefixes / markers distinct (`E2E_*` vs `ATF_*`) so the orphan-sweep backstops don't fight each other.

## When NOT to use this pattern

- **One-off test** with one or two records — direct `record_insert` steps are clearer.
- **Cross-test fixtures** — the factory's ledger is per-test. Shared fixtures belong in either a `setup_test_data` script (run once before the suite) or a `BeforeSuite` pattern via `sys_atf_test_suite_setup` (if your instance supports it). Don't try to make the factory persistent across tests.
- **Tests where the fixture *is* the thing under test** — if you're testing record-creation behaviour, use `record_insert` step explicitly. The factory abstracts away too much for that case.
- **Tests that mutate shared production-ish data** — never. Use a fresh seed every time.

## See also

- [`step-types-reference.md`](step-types-reference.md) — `run_server_script` inputs, `record_insert` for direct-step alternatives
- [`gotchas.md`](gotchas.md) — the UI-step batching rule (which applies when mixing factory calls with UI steps)
- [`api-cheatsheet.md`](api-cheatsheet.md) — Table API equivalents if you need to seed from outside ATF
