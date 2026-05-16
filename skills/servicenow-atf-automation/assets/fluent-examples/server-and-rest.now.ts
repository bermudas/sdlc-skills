import { Test } from '@servicenow/sdk/core'

/**
 * Pattern: pure server-side ATF — create a record, exercise it via REST,
 * assert the response, validate persistence. No UI steps ⇒ no batching
 * concern, no g_form, no runner-flake on form rendering. The safest, most
 * robust ATF shape; prefer it whenever the thing under test is a
 * business-rule / API / data outcome rather than form UX.
 *
 * Shape adapted from ServiceNow/sdk-examples test-atf-sample
 * (atf-record-rest.now.ts) + the proven recordValidation outcome check.
 *
 * Fluent rule: every value below is a STRING LITERAL (no concat / template /
 * computed) — the build is a static AST parser.
 */
export default Test(
    {
        $id: Now.ID['server-and-rest-example'],
        name: 'Example — server + REST (no UI)',
        description: 'Insert an incident, GET it back via Table REST API, assert payload + status, then server-side validate the persisted record.',
        active: true,
        failOnServerError: false,
    },
    (atf) => {
        // (Optional) run under a specific user's ACLs.
        atf.server.impersonate({ $id: 'imp', user: '<sys_user sys_id>' })

        const created = atf.server.recordInsert({
            $id: 'insert',
            table: 'incident',
            assert: 'record_successfully_inserted',
            enforceSecurity: true,
            fieldValues: { short_description: 'ATF REST example' },
        })

        atf.rest.sendRestRequest({
            $id: 'rest_get',
            basicAuthentication: '',                 // select/create a basic-auth profile on the instance
            body: '',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            method: 'get',
            path: "/api/now/v2/table/incident/{{step['insert'].record_id}}",
            queryParameters: {},
        })
        atf.rest.assertStatusCode({ $id: 'rest_status', operation: 'equals', statusCode: 200 })
        atf.rest.assertResponseJSONPayloadIsValid({ $id: 'rest_json_valid' })
        atf.rest.assertJsonResponsePayloadElement({
            $id: 'rest_payload',
            elementName: '/result/short_description',
            elementValue: 'ATF REST example',
            operation: 'equals',
        })

        atf.server.recordValidation({
            $id: 'validate',
            table: 'incident',
            recordId: created.record_id,
            fieldValues: 'short_description=ATF REST example^EQ',
            enforceSecurity: true,
            assert: 'record_validated',
        })
    }
)
