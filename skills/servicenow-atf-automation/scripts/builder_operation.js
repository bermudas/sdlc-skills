/**
 * builder_operation.js — server-side operation script for the
 * atf_builder Scripted REST API.
 *
 * This is the script that gets uploaded into a sys_ws_operation record
 * by bootstrap_builder.sh. It runs inside the ServiceNow JS engine, so
 * GlideRecord writes to sys_atf_step.inputs.<element> work normally —
 * the public Table API's glide_var filter does not apply here.
 *
 * Input: JSON spec on POST body — { name, description?, active?, steps: [...] }
 * Output: JSON — { test_sys_id, steps_created: [...], errors: [...] }
 *
 * Add new step types to STEP_CONFIGS below. Use scripts/discover_steps.sh
 * to find sys_ids for step types that aren't yet mapped.
 */
(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {
    var spec = request.body && request.body.data;

    // -------- action: "run" — dispatch an existing test to a runner --------
    // Body: { action: "run", testSysId: "<id>", runnerSessionId: "<session>",
    //         useCloudRunner?: bool, isPausingEnabled?: bool, performanceRun?: bool }
    // The manual browser runner registers in sys_atf_agent with type=manual.
    // /api/sn_cicd/testsuite/run only dispatches to type=scheduled runners,
    // so this endpoint exists to target a logged-in manual runner by session_id.
    if (spec && spec.action === 'run') {
        var testSysId = spec.testSysId;
        var sessionId = spec.runnerSessionId;
        if (!testSysId || !sessionId) {
            response.setStatus(400);
            response.setBody({error: 'run requires {testSysId, runnerSessionId}'});
            return;
        }
        // Verify the test exists
        var t = new GlideRecord('sys_atf_test');
        if (!t.get(testSysId)) {
            response.setStatus(404);
            response.setBody({error: 'Test not found: ' + testSysId});
            return;
        }
        // Verify the runner is online for the given session
        var agent = new GlideRecord('sys_atf_agent');
        agent.addQuery('session_id', sessionId);
        agent.addQuery('status', 'online');
        agent.setLimit(1);
        agent.query();
        if (!agent.next()) {
            response.setStatus(409);
            response.setBody({
                error: 'No online runner found for session_id: ' + sessionId,
                hint: 'Open /atf_test_runner.do in a browser to start a manual runner.'
            });
            return;
        }
        // Dispatch — same call chain that TestExecutorAjax.runUserTest uses
        try {
            var tracker = new sn_atf.ExecuteUserTest()
                .setIsPerformance(!!spec.performanceRun)
                .setCapturePageData(testSysId, !!spec.capturePageData)
                .setRetrieveComponentsStep(testSysId, spec.retrieveComponentsStep || '')
                .setTestRecordSysId(testSysId)
                .setTestRunnerSessionId(sessionId)
                .setPausingEnabled(!!spec.isPausingEnabled, false)
                .setUseCloudRunner(!!spec.useCloudRunner)
                .start();
            response.setStatus(202);
            response.setBody({
                dispatched: true,
                test_sys_id: testSysId,
                test_name: t.name.toString(),
                runner_session_id: sessionId,
                runner_agent_sys_id: agent.sys_id.toString(),
                runner_browser: agent.browser_name.toString() + ' ' + agent.browser_version.toString(),
                execution_tracker_sys_id: tracker ? tracker.toString() : null
            });
        } catch (e) {
            response.setStatus(500);
            response.setBody({error: 'Dispatch failed: ' + e.message, stack: e.stack || ''});
        }
        return;
    }
    // -------- end action:"run" --------

    // -------- action: "read_step" — dump a single step's full inputs --------
    // Body: { action: "read_step", stepSysId: "<id>" }
    // Returns the glide_var inputs (which Table API hides) plus all top-level
    // columns. Useful for reverse-engineering OOTB tests as templates.
    if (spec && spec.action === 'read_step') {
        if (!spec.stepSysId) {
            response.setStatus(400);
            response.setBody({error: 'read_step requires {stepSysId}'});
            return;
        }
        var s = new GlideRecord('sys_atf_step');
        if (!s.get(spec.stepSysId)) {
            response.setStatus(404);
            response.setBody({error: 'Step not found: ' + spec.stepSysId});
            return;
        }
        var out = {
            sys_id: s.getUniqueValue(),
            test: s.test.toString(),
            step_config: s.step_config.toString(),
            step_config_name: s.step_config.name.toString(),
            order: s.order.toString(),
            description: s.description.toString(),
            mugshots_cache_json: s.mugshots_cache_json + '',
            inputs: {}
        };
        // Iterate glide_var inputs
        var keys = s.inputs.getElements ? s.inputs.getElements() : null;
        if (keys) {
            // glide_var getElements returns an iterator of elements
            for (var i = 0; i < keys.length; i++) {
                var el = keys[i];
                var name = el.getName ? el.getName() : ('' + el);
                out.inputs[name] = s.inputs[name] + '';
            }
        } else {
            // Fallback: try common ATF input names
            var common = ['component','component_values','function_to_call','action_parameters',
                          'hidden_parent_macroponent','returns','hidden_function_description',
                          'text','assert_type','workspace_page_url','user','table','field_values',
                          'enforce_security'];
            for (var j = 0; j < common.length; j++) {
                try {
                    var v = s.inputs[common[j]];
                    if (v !== undefined && v !== null && (v + '') !== '') {
                        out.inputs[common[j]] = v + '';
                    }
                } catch (e) {}
            }
        }
        response.setStatus(200);
        response.setBody(out);
        return;
    }

    // -------- action: "update" — replace an existing test's steps in place --------
    // Body: {action:"update", testSysId, steps:[...], name?, description?, active?, failOnServerError?}
    // Deletes all existing sys_atf_step rows for the test, then inserts new ones
    // from the spec. The test's own sys_id stays stable so whitelists, run history,
    // and external references survive across iterations.
    var isUpdate = spec && spec.action === 'update';

    if (!spec || !Array.isArray(spec.steps) || (!isUpdate && !spec.name) || (isUpdate && !spec.testSysId)) {
        response.setStatus(400);
        response.setBody({
            error: 'Body must be {name: string, description?: string, active?: boolean, ' +
                   'failOnServerError?: boolean, steps: Array<{type: string, ...params}>} ' +
                   'OR {action: "update", testSysId, steps: [...], name?, description?, ...} ' +
                   'OR {action: "run", testSysId, runnerSessionId}'
        });
        return;
    }

    var testId;
    var test;
    if (isUpdate) {
        // Locate the existing test
        test = new GlideRecord('sys_atf_test');
        if (!test.get(spec.testSysId)) {
            response.setStatus(404);
            response.setBody({error: 'Test not found: ' + spec.testSysId});
            return;
        }
        testId = test.getUniqueValue();
        // Allow caller to update test metadata as part of the same call
        if (spec.name !== undefined)        test.name = spec.name;
        if (spec.description !== undefined) test.description = spec.description;
        if (spec.active !== undefined)      test.active = spec.active !== false;
        if (spec.failOnServerError !== undefined) test.fail_on_server_error = spec.failOnServerError !== false;
        test.update();
        // Delete existing steps so the spec is the source of truth
        var oldSteps = new GlideRecord('sys_atf_step');
        oldSteps.addQuery('test', testId);
        oldSteps.query();
        var deleted = 0;
        while (oldSteps.next()) { oldSteps.deleteRecord(); deleted++; }
        // Stash deleted count for the response
        spec._deletedStepCount = deleted;
    } else {
        // 1. Create the parent sys_atf_test record
        test = new GlideRecord('sys_atf_test');
        test.initialize();
        test.name = spec.name;
        test.description = spec.description || '';
        test.active = spec.active !== false;
        test.fail_on_server_error = spec.failOnServerError !== false;
        testId = test.insert();
        if (!testId) {
            response.setStatus(500);
            response.setBody({
                error: 'Failed to insert sys_atf_test',
                details: test.getLastErrorMessage()
            });
            return;
        }
    }

    // Step type → step_config sys_id mapping.
    // Comprehensive catalogue — every OOTB ATF step type, harvested from
    // the sys_atf_step_creator UI page (which lists what ATF actually
    // supports). Stable across instances that ship the ATF baseline.
    //
    // Step types marked ⚠ require Test-Designer-recorded UI components in
    // sys_atf_ui_component. They accept JSON only after a human has used
    // Test Designer's "Record" mode once on the target page — the captured
    // components materialise and can then be referenced by these steps.
    // Everything else works from JSON without recording.
    //
    // The list of recording-required step configs is named in the platform
    // UI (sys_atf_step_creator) as `customUIStepConfigIds` — those five
    // plus the Configurable Workspace `Test Page` are the only ones with
    // a recording prerequisite.
    var STEP_CONFIGS = {
        // ─────────────────── Server (general scaffolding + assertions) ───────────────────
        'impersonate':              '071ee5b253331200040729cac2dc348d',  // user
        'log':                      '58ab71985f30220012b44adb7f46661e',  // log (string)
        'record_query':             '2d82e3c7531400109e02ddeeff7b12a7',  // table, field_values, assert_type
        'record_validation':        '1f39a288df60220062fe6c7a4df2639d',  // table, record_id, field_values
        'record_insert':            '14872288df60220062fe6c7a4df26319',  // table, field_values
        'record_update':            '17a72288df60220062fe6c7a4df26397',  // table, record_id, field_values
        'record_delete':            '8df72288df60220062fe6c7a4df2636d',  // table, record_id
        'run_server_script':        '41de4a935332120028bc29cac2dc349a',  // script
        'create_user':              'd9bc5f21ff6033008d3f5d9ad53bf12d',  // creates + impersonates
        'add_attach_to_record':     '52c6cdb3b710330044026848ee11a91d',  // server-side attach to existing record
        'set_output_variables':     '26302752a33012100df567d1361e61ef',  // for reusable tests
        'search_catalog_item':      '96103fdfc3e0320076173b0ac3d3ae57',  // catalog search
        'checkout_shopping_cart':   '9a351369536303000a51ddeeff7b125b',  // checkout
        'replay_request_item':      '7f49ec32532022008aaec57906dc3473',  // replay a req_item

        // ─────────────────── Email ───────────────────
        'validate_outbound_email':              '32911152c3833300eaac11fe81d3ae82',
        'validate_outbound_email_from_flow':    '0d09dae4c3033300eaac11fe81d3ae1a',
        'validate_outbound_email_from_notif':   'a5600fa0c3033300eaac11fe81d3ae6a',
        'generate_inbound_email':               'e0e6f84ac3523300eaac11fe81d3ae03',
        'generate_inbound_reply_email':         'b4549a71c3623300eaac11fe81d3ae15',
        'generate_random_string':               '263313e4c3123300eaac11fe81d3aef9',

        // ─────────────────── Form (classic + Workspace via Form UI) ───────────────────
        // Set Field Values / Submit a Form / Click a UI Action all support a
        // `form_ui` input that selects standard platform UI vs workspace UI.
        // After open_workspace, use these with form_ui='service_operations_workspace'.
        'open_new_form':            '05317cd10b10220050192f15d6673af8',
        'open_existing':            '5f2e0e535332120028bc29cac2dc34d3',
        'set_field_values':         'fcae4a935332120028bc29cac2dc340e',
        'submit_form':              'be8e0a935332120028bc29cac2dc34e4',
        'click_ui_action':          '0f4a128297202200abe4bb7503ac4af0',
        'click_declarative_action': '49e34cbe433131106580a9bb1cb8f25c',
        'click_modal_button':       '22aed143dfe0220062fe6c7a4df2639d',
        'field_values_validation':  '1b97cd31872022008182c9ded0e3ece5',
        'field_state_validation':   '1dfece935332120028bc29cac2dc3478',
        'ui_action_visibility':     'd8fdf5e10b1022009cfdc71437673adc',
        'declarative_action_visibility': 'c52ed987437131106580a9bb1cb8f2b8',
        'add_attach_to_form':       '6932ee40b760330044026848ee11a960',

        // ─────────────────── Service Portal (legacy SP framework) ───────────────────
        'open_form_sp':             'ca58a941e7020300b2888f49c2f6a95e',
        'set_field_values_sp':      'ba49e51de7420300b2888f49c2f6a93c',
        'submit_form_sp':           'f410c93423220300ab65ff5e17bf651e',
        'click_ui_action_sp':       '86ec986123630300ab65ff5e17bf65a5',
        'field_values_validation_sp': 'd72d0556e7020300b2888f49c2f6a916',
        'field_state_validation_sp':  'af1e769223220300ab65ff5e17bf6580',
        'ui_action_visibility_sp':    '02b5128223230300ab65ff5e17bf658e',
        'add_attach_to_form_sp':    '5415748677120010e46abe41a910616a',

        // ─────────────────── Custom UI (Now Experience / UIB pages, Workspace embedded) ───────────────────
        // These two use string inputs only — usable from JSON:
        'open_service_portal_page': 'fc7e65d577332300e46abe41a9106106',  // portal_id, page_id, query_params
        'assert_text_on_page':      '475e0de3d732130089fca2285e610361',  // text, assert_type
        // ⚠ The following four require Test Designer Recording to capture component IDs:
        'click_component':           'def25c4b73730300c79260bdfaf6a700',  // ⚠ recorded component
        'set_component_values':      'e5dd168473330300c79260bdfaf6a794',  // ⚠ recorded component_values
        'component_state_validation': '38907e937322130007d738682bf6a742', // ⚠ recorded component
        'component_value_validation': 'b4758c7453370300c792ddeeff7b128d', // ⚠ recorded component_values

        // ─────────────────── Configurable Workspace (Agent Workspace) ───────────────────
        'open_workspace':           'b74ae80243700210285ffa73cbb8f2d2',  // workspace_page_url
        'test_page':                '33bb3cb343810210285ffa73cbb8f245',  // ⚠ recorded component

        // ─────────────────── Application Navigator (classic UI16/Polaris nav) ───────────────────
        'navigate_to_module':       'c832fc4073720300c79260bdfaf6a7a0',
        'module_visibility':        'f7cfc1973702030064a52f3c8e41f1d3',
        'app_menu_visibility':      '6228cf753752030064a52f3c8e41f1a8',

        // ─────────────────── List and Related List ───────────────────
        'apply_list_filter':        'a69843f2531332007e7829cac2dc34d7',
        'click_list_ui_action':     'c5f44934532332007e7829cac2dc342e',
        'open_record_in_list':      '0200ac2fe72003005c85cd19d2f6a942',
        'validate_record_in_list':  '7bdce31387400300709861fb97cb0b5a',
        'related_list_visibility':  '8b84e5e837b1030064a52f3c8e41f170',
        'validate_list_ui_action':  '012105620fe2330091d0f00c97767ec4',

        // ─────────────────── REST (assert against the instance's own scripted REST APIs) ───────────────────
        'rest_send':                'e00571a10b3222000b7da95e93673a8f',  // generic REST send
        'rest_send_explorer':       'ab3746b23b132200fc26229c93efc419',  // REST API Explorer flavour
        'rest_assert_status':       '2f4fa7309f132200ef4afa7dc67fcf0f',
        'rest_assert_status_name':  '49213f709f132200ef4afa7dc67fcfd0',
        'rest_assert_response_time':'8afa37419f132200ef4afa7dc67fcf7f',
        'rest_assert_header':       'ccd64c519f132200ef4afa7dc67fcf6a',
        'rest_assert_json_valid':   'f100f7079f132200ef4afa7dc67fcf42',
        'rest_assert_xml_valid':    'f530dcd59f132200ef4afa7dc67fcf03',
        'rest_assert_json_element': 'afc114199f132200ef4afa7dc67fcf64',
        'rest_assert_xml_element':  '7b403b079f132200ef4afa7dc67fcf8c',
        'rest_assert_payload':      'd53e40d59f132200ef4afa7dc67fcfc7',

        // ─────────────────── Service Catalog (classic) ───────────────────
        'open_catalog_item':        '2516c0e1c332220076173b0ac3d3ae39',
        'open_record_producer':     '77409f72c300320076173b0ac3d3ae19',
        'set_variable_values':      '323ca6e1c3b2220076173b0ac3d3aec1',
        'set_catalog_item_quantity':'d5d9e7e7c3d7220076173b0ac3d3ae0b',
        'validate_variable_values': '5a36c681c37e220076173b0ac3d3aecf',
        'variable_state_validation':'33f637e8c3ba220076173b0ac3d3aee1',
        'validate_price':           '70a083b0c323220076173b0ac3d3aee8',
        'add_to_cart':              '550270f2c310320076173b0ac3d3aeec',
        'order_catalog_item':       'c930b4b2c310320076173b0ac3d3aeec',
        'submit_record_producer':   'ed59d8e5c332220076173b0ac3d3ae6a',

        // ─────────────────── Service Catalog in Service Portal (SP-flavour) ───────────────────
        'open_catalog_item_sp':     'e81f02dc73e703008e6b0d573cf6a76f',
        'open_record_producer_sp':  '775638f29f3203002899d4b4232e70e5',
        'open_order_guide_sp':      'aced8452731b13008e6b0d573cf6a783',
        'set_variable_values_sp':   '2e4229b48703030070870cf888cb0b5c',
        'set_catalog_item_quantity_sp':'697ce2d87323030076860d573cf6a708',
        'validate_variable_values_sp':'2c8882759f1303002528d4b4232e708a',
        'variable_state_validation_sp':'1ebb17799f1303002528d4b4232e70c0',
        'validate_price_sp':        '095c4877732b03008e6b0d573cf6a717',
        'add_to_cart_sp':           '00696ee073330300688e0d573cf6a71a',
        'add_order_guide_to_cart_sp':'559099f287131300b179480688cb0b1a',
        'order_catalog_item_sp':    'c0fede515f23030076861f9f2f7313db',
        'submit_order_guide_sp':    '6ad01e9387131300b179480688cb0b8f',
        'submit_record_producer_sp':'7c69d2788743030070870cf888cb0b5f',
        'navigate_order_guide_sp':  '0ae5f9f2739713008e6b0d573cf6a718',
        'review_item_order_guide_sp':'2098710873631300688e0d573cf6a7d7',
        'review_order_guide_summary_sp':'1df5d27073a71300688e0d573cf6a751',
        'validate_order_guide_items_sp':'d7c0d0ef5f9b1300688e1f9f2f7313b7',
        'add_row_multi_row_sp':     'c7d557d673002300688e0d573cf6a74f',
        'save_row_multi_row_sp':    'adf6884273902300688e0d573cf6a72a',

        // ─────────────────── Reporting + Responsive Dashboards ───────────────────
        'report_visibility':                'e6b32c570b10230083332dc3b6673a14',
        'dashboard_visibility':             '60a41086b31023003e5362ff86a8dc28',
        'dashboard_sharing':                'd4df4ce30b13130083332dc3b6673a29'
    };

    // Subset that requires Test-Designer-recorded UI components.
    // Exposed in the response for debugging / docs.
    var RECORDING_REQUIRED = {
        'click_component':            true,
        'set_component_values':       true,
        'component_state_validation': true,
        'component_value_validation': true,
        'test_page':                  true
    };

    // 2. Create each step
    var createdSteps = [];
    var errors = [];

    for (var i = 0; i < spec.steps.length; i++) {
        var s = spec.steps[i];
        var configId = STEP_CONFIGS[s.type];

        if (!configId) {
            errors.push({
                step_index: i,
                error: 'Unknown step type: "' + s.type + '". Add it to STEP_CONFIGS in ' +
                       'builder_operation.js, or run discover_steps.sh to find its sys_id.'
            });
            continue;
        }

        var step = new GlideRecord('sys_atf_step');
        step.initialize();
        step.test = testId;
        step.step_config = configId;
        step.order = (i + 1) * 100;
        step.active = s.active !== false;

        var stepId = step.insert();
        if (!stepId) {
            errors.push({
                step_index: i,
                error: 'sys_atf_step insert failed',
                details: step.getLastErrorMessage()
            });
            continue;
        }

        // Refetch the step to get a fresh handle with the dynamic-column accessor
        step.get(stepId);

        // The pivotal pattern (taken from OOTB AddTestTemplateAjax):
        //   step.inputs[<element_name>] = <value>
        // assigns into the glide_var dynamic columns. Public Table API can't do this;
        // server-side GlideRecord can. That's the entire reason this Scripted REST
        // API exists.
        //
        // Special key: `_cols` writes directly to top-level columns on sys_atf_step
        // (e.g., mugshots_cache_json, snapshot, description). Use this for Custom
        // UI steps that need an inline mugshot cache.
        for (var key in s) {
            if (key === 'type' || key === 'active' || key === '_cols') continue;
            try {
                step.inputs[key] = s[key];
            } catch (e) {
                errors.push({
                    step_index: i,
                    key: key,
                    error: 'Failed to set inputs.' + key + ': ' + e.message
                });
            }
        }
        if (s._cols && typeof s._cols === 'object') {
            for (var col in s._cols) {
                try {
                    var val = s._cols[col];
                    // Auto-stringify objects so callers can pass JSON literals.
                    if (val !== null && typeof val === 'object') val = JSON.stringify(val);
                    // For json-typed columns (notably mugshots_cache_json), setValue
                    // round-trips through the type-converter and drops the content.
                    // Direct property assignment writes the raw string straight to
                    // the column buffer, matching what Test Designer UI does.
                    step[col] = val;
                } catch (e2) {
                    errors.push({
                        step_index: i,
                        col: col,
                        error: 'Failed to set column ' + col + ': ' + e2.message
                    });
                }
            }
        }
        step.update();

        createdSteps.push({
            order: step.order.toString(),
            sys_id: stepId,
            type: s.type,
            step_config_name: step.step_config.name.toString(),
            description: step.description.toString()
        });
    }

    // 3. Respond — 201 (create) / 200 (update), 207 (Multi-Status) if any step had issues
    var okStatus = isUpdate ? 200 : 201;
    response.setStatus(errors.length > 0 ? 207 : okStatus);
    response.setBody({
        test_sys_id: testId,
        test_name: (test.name + ''),
        mode: isUpdate ? 'update' : 'create',
        steps_replaced: isUpdate ? (spec._deletedStepCount || 0) : 0,
        steps_created: createdSteps,
        errors: errors
    });
})(request, response);
