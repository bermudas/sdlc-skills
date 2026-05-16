import { Test } from '@servicenow/sdk/core'

/**
 * Pattern: drive a CLASSIC-UI form through field changes with REAL ATF
 * assertions (Field State / Field Value Validation) for each expected
 * result — no Log-step placeholders for assertions.
 *
 * This template encodes the two rules that cost real debug cycles
 * (see ../../references/fluent-sdk.md §6, §7):
 *
 *  §6 BATCHING — server steps (log / record* / impersonate) must NOT appear
 *      between UI steps; they end the UI batch and destroy g_form
 *      ("g_form is not defined"). The UI block below is ONE contiguous run;
 *      all server steps are batched strictly BEFORE and AFTER it.
 *
 *  §7 CALIBRATION — field mandatory/readonly/visible states are usually
 *      driven by OTHER fields (a classification/type dropdown flips half the
 *      form). Assert state AFTER the change that causes it, in order. Do NOT
 *      guess states: run it, read the failure ("Expected field 'x' to be
 *      visible but it was not"), correct, repeat. Asserting state before the
 *      triggering change is the #1 authoring bug.
 *
 * Fluent rule: every value is a STRING LITERAL (static AST parser).
 * Replace <PLACEHOLDERS>; use classic `formUI: 'standard_ui'` (workspace
 * formUI hits ATF_INTENT_GENERATOR timeout for field-state asserts).
 *
 * If setFieldValue throws on a reactive form ("Cannot read properties of
 * undefined (reading 'message')") from a benign async-GlideAjax onChange,
 * whitelist that specific error (warning) per-test — see fluent-sdk.md §7 —
 * the outcome assertions below still prove correctness (not defect-masking):
 *   ./scripts/whitelist_error.sh <test_sys_id> "<benign error substring>" warning
 */
export default Test(
    {
        $id: Now.ID['real-steps-form-example'],
        name: 'Example — real-steps classic form',
        description: 'Open a classic form, drive a driver field, assert resulting field-state with real Field State / Field Value Validation, submit, then server-side validate the persisted record. Mirror your TMS steps 1:1.',
        active: true,
        failOnServerError: false,
    },
    (atf) => {
        // ════ SERVER BATCH (front): precondition + any pre-state validation ════
        atf.server.log({ $id: 'pre', log: 'PRECONDITION + step traceability goes HERE (before the UI batch), never between UI steps' })
        atf.server.impersonate({ $id: 'imp', user: '<sys_user sys_id>' })
        atf.server.recordValidation({
            $id: 'pre_validate',
            table: '<parent_table>',
            recordId: '<parent record sys_id>',
            fieldValues: 'sys_id=<parent record sys_id>^EQ',
            enforceSecurity: true,
            assert: 'record_validated',
        })

        // ════ UI BATCH (contiguous — ZERO server.* steps until after submit) ════
        atf.form.openNewForm({ $id: 'open', table: '<table>', view: '', formUI: 'standard_ui' })

        // Expected-at-open: assert the TRUE open state (calibrate — don't guess).
        atf.form.fieldStateValidation({
            $id: 'state_open',
            table: '<table>',
            formUI: 'standard_ui',
            mandatory: [],
            notMandatory: ['<driver_field>'],
            readOnly: [],
            notReadOnly: ['<driver_field>'],
            visible: ['<driver_field>'],
            notVisible: [],
        })

        // Drive the field that flips the form (classification/type/etc).
        atf.form.setFieldValue({ $id: 'set_driver', table: '<table>', formUI: 'standard_ui', fieldValues: { '<driver_field>': '<value-A>' } })
        // Fill dependent fields.
        atf.form.setFieldValue({ $id: 'set_fields', table: '<table>', formUI: 'standard_ui', fieldValues: { '<field1>': '<v1>', '<field2>': '<v2>' } })
        // Now assert the state the change CAUSED (after the trigger, in order).
        atf.form.fieldStateValidation({
            $id: 'state_after',
            table: '<table>',
            formUI: 'standard_ui',
            mandatory: ['<field1>', '<field2>'],
            notMandatory: [],
            readOnly: [],
            notReadOnly: [],
            visible: ['<field1>', '<field2>'],
            notVisible: [],
        })
        // A driver value that auto-populates another field → assert the value.
        atf.form.setFieldValue({ $id: 'set_driver_b', table: '<table>', formUI: 'standard_ui', fieldValues: { '<driver_field>': '<value-B>' } })
        atf.form.fieldValueValidation({ $id: 'value_after', table: '<table>', formUI: 'standard_ui', conditions: '<auto_field>=<expected sys_id/value>^EQ' })

        // Final fill + save.
        atf.form.setFieldValue({ $id: 'set_final', table: '<table>', formUI: 'standard_ui', fieldValues: { '<driver_field>': '<value-A>', '<field1>': '<v1>', '<field2>': '<v2>' } })
        const created = atf.form.submitForm({ $id: 'submit', formUI: 'standard_ui', assert: 'form_submitted_to_server' })

        // ════ SERVER BATCH (end): persistence + related-record validation ════
        atf.server.recordValidation({
            $id: 'post_validate',
            table: '<table>',
            recordId: created.record_id,
            fieldValues: '<field1>=<v1>^<field2>=<v2>^EQ',
            enforceSecurity: true,
            assert: 'record_validated',
        })
        atf.server.log({ $id: 'done', log: 'DONE — all TMS steps + expecteds mapped 1:1 to real assertions' })
    }
)
