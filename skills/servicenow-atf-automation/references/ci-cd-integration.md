# CI/CD integration

How to dispatch ATF test suites from Jenkins, GitHub Actions, and Azure DevOps Pipelines via ServiceNow's `/api/sn_cicd/*` endpoints — plus the **runner-type ceiling you must understand before wiring this up**.

## ⚠ Read this first — the runner-type ceiling

`POST /api/sn_cicd/testsuite/run` **requires a `scheduled` runner type to be online and available.** If the only ATF Test Runner agent online is a `type=manual` one (a normal logged-in `/atf_test_runner.do` browser session), the endpoint accepts the dispatch and then **Cancels** with `status_detail: "A scheduled client test runner that satisfies these client constraints is not available"`.

**This bites every dev team the first time.** Symptoms:

```
POST /api/sn_cicd/testsuite/run → 200 OK, returns progress URL
GET progress URL → status_detail: "A scheduled client test runner …"
                   status: 4 (Canceled)
```

**Two ways to deal with it:**

1. **Provision a scheduled runner** — bring a dedicated `type=scheduled` Test Runner agent online on the instance (or use the cloud runner if your instance has the entitlement: `useCloudRunner: true`). This is the right answer for prod CI/CD, but it requires platform admin work.
2. **Use the manual-runner dispatch path** — call this skill's Path B `action:"run"` endpoint instead (`scripts/run_test.sh`). It auto-discovers the freshest online manual runner agent on the tenant and dispatches via the same internal flow the in-platform "Run Test" button uses. **No scheduled runner needed**, no platform admin work.

For dev / local iteration / PoC, **prefer Path B `action:"run"`**. For prod CI/CD, **prefer a scheduled runner + `/api/sn_cicd/testsuite/run`** because it's the supported, parallel-safe path.

Both options are covered below.

## Endpoints (refresher)

Reproduced here for convenience. Full curl recipes (including the gotcha-fixing `^EQ` warning, namespace `now`, and Path B variants) live in [`api-cheatsheet.md`](api-cheatsheet.md).

| Endpoint | Purpose | Requires |
|---|---|---|
| `POST /api/sn_cicd/testsuite/run` | Trigger a test suite | scheduled runner online |
| `GET  /api/sn_cicd/progress/<id>` | Poll status (`Pending` / `Running` / `Successful` / `Failed` / `Canceled`) | — |
| `GET  /api/sn_cicd/testsuite/results/<id>` | Final results (pass/fail counts, per-test sys_ids) | — |
| `POST /api/now/atf_builder/create` with `action:"run"` | Trigger via manual runner (Path B) | the Scripted REST builder this skill ships (`bootstrap_builder.sh`) |

For per-step output, query `sys_atf_test_result_step` after the run completes (see `api-cheatsheet.md` § "Reading results").

> **Path B endpoint naming:** this skill installs the builder at `/api/now/atf_builder/create` by default. If your project's `bootstrap_builder.sh` was customised to use a different path (e.g. `/api/now/<prefix>_atf_builder/create` for namespacing), substitute it in the examples below.

## Pattern A — scheduled runner via `/api/sn_cicd/testsuite/run`

### Jenkins (Groovy declarative pipeline)

```groovy
pipeline {
  agent any

  environment {
    SN_INSTANCE = 'https://your-instance.service-now.com'
    SN_CREDENTIALS = credentials('servicenow-api')   // username + password
  }

  parameters {
    string(name: 'TEST_SUITE_ID', description: 'sys_atf_test_suite sys_id to run')
  }

  stages {
    stage('Run ATF Tests') {
      steps {
        script {
          def response = httpRequest(
            url: "${SN_INSTANCE}/api/sn_cicd/testsuite/run",
            httpMode: 'POST',
            authentication: 'servicenow-api',
            contentType: 'APPLICATION_JSON',
            requestBody: """{
              "test_suite_sys_id": "${params.TEST_SUITE_ID}",
              "browser_name": "Chrome"
            }"""
          )
          def result = readJSON text: response.content
          env.RESULT_ID = result.result.sys_id
          echo "Dispatched. progress sys_id = ${env.RESULT_ID}"
        }
      }
    }

    stage('Wait for Results') {
      steps {
        script {
          // status_label values: "Pending" | "Running" | "Successful" | "Failed" | "Canceled"
          def status = 'Pending'
          timeout(time: 30, unit: 'MINUTES') {
            while (status in ['Pending', 'Running']) {
              sleep 30
              def response = httpRequest(
                url: "${SN_INSTANCE}/api/sn_cicd/progress/${env.RESULT_ID}",
                authentication: 'servicenow-api'
              )
              def progress = readJSON text: response.content
              status = progress.result.status_label
              echo "ATF status: ${status} (${progress.result.percent_complete}%)"

              // ⚠ Catch the runner-type ceiling early
              if (status == 'Canceled' &&
                  progress.result.status_detail?.contains('scheduled client test runner')) {
                error """
                  ATF suite Canceled at dispatch: no scheduled runner available.
                  Either provision a scheduled runner, or switch this stage to
                  the Path B action:"run" endpoint (manual-runner dispatch).
                  See references/ci-cd-integration.md § Runner-type ceiling.
                """
              }
            }
          }
        }
      }
    }

    stage('Evaluate Results') {
      steps {
        script {
          def response = httpRequest(
            url: "${SN_INSTANCE}/api/sn_cicd/testsuite/results/${env.RESULT_ID}",
            authentication: 'servicenow-api'
          )
          def results = readJSON text: response.content
          def pass = results.result.pass_count ?: 0
          def fail = results.result.fail_count ?: 0
          echo "ATF results: ${pass} passed, ${fail} failed"
          if (fail > 0 || results.result.status_label == 'Failed') {
            error "ATF tests failed: ${fail} failure(s)"
          }
        }
      }
    }
  }
}
```

### GitHub Actions

```yaml
name: ServiceNow ATF Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  atf-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 45

    steps:
      - name: Dispatch ATF Test Suite
        id: run-tests
        run: |
          RESPONSE=$(curl -fsS -X POST \
            -u "${{ secrets.SN_USERNAME }}:${{ secrets.SN_PASSWORD }}" \
            -H "Content-Type: application/json" \
            -d '{"test_suite_sys_id":"${{ vars.ATF_SUITE_ID }}","browser_name":"Chrome"}' \
            "${{ vars.SN_INSTANCE }}/api/sn_cicd/testsuite/run")
          RESULT_ID=$(echo "$RESPONSE" | jq -r '.result.sys_id')
          [ "$RESULT_ID" = "null" ] && { echo "Dispatch failed: $RESPONSE"; exit 1; }
          echo "result_id=$RESULT_ID" >> "$GITHUB_OUTPUT"

      - name: Wait for Completion
        run: |
          STATUS="Pending"
          while [ "$STATUS" = "Pending" ] || [ "$STATUS" = "Running" ]; do
            sleep 30
            RESPONSE=$(curl -fsS \
              -u "${{ secrets.SN_USERNAME }}:${{ secrets.SN_PASSWORD }}" \
              "${{ vars.SN_INSTANCE }}/api/sn_cicd/progress/${{ steps.run-tests.outputs.result_id }}")
            STATUS=$(echo "$RESPONSE" | jq -r '.result.status_label')
            PCT=$(echo "$RESPONSE" | jq -r '.result.percent_complete')
            echo "ATF status: $STATUS ($PCT%)"
            # Catch the runner-type ceiling early
            DETAIL=$(echo "$RESPONSE" | jq -r '.result.status_detail // ""')
            if [ "$STATUS" = "Canceled" ] && echo "$DETAIL" | grep -q 'scheduled client test runner'; then
              echo "::error::No scheduled runner available — see references/ci-cd-integration.md"
              exit 1
            fi
          done

      - name: Evaluate Results
        run: |
          RESPONSE=$(curl -fsS \
            -u "${{ secrets.SN_USERNAME }}:${{ secrets.SN_PASSWORD }}" \
            "${{ vars.SN_INSTANCE }}/api/sn_cicd/testsuite/results/${{ steps.run-tests.outputs.result_id }}")
          STATUS=$(echo "$RESPONSE" | jq -r '.result.status_label')
          PASS=$(echo "$RESPONSE" | jq -r '.result.pass_count // 0')
          FAIL=$(echo "$RESPONSE" | jq -r '.result.fail_count // 0')
          echo "Results: $PASS passed, $FAIL failed"
          if [ "$STATUS" != "Successful" ] || [ "$FAIL" -gt 0 ]; then
            echo "::error::ATF tests failed ($FAIL failure(s))"
            exit 1
          fi
```

### Azure DevOps Pipelines

```yaml
# azure-pipelines-atf.yml
trigger:
  branches:
    include: [main]

pool:
  vmImage: ubuntu-latest

variables:
  - group: servicenow-atf            # contains SN_INSTANCE, SN_USERNAME, SN_PASSWORD
  - name: TEST_SUITE_ID
    value: $(ATF_SUITE_ID)

steps:
  - bash: |
      set -euo pipefail
      RESPONSE=$(curl -fsS -X POST \
        -u "$(SN_USERNAME):$(SN_PASSWORD)" \
        -H "Content-Type: application/json" \
        -d "{\"test_suite_sys_id\":\"$(TEST_SUITE_ID)\",\"browser_name\":\"Chrome\"}" \
        "$(SN_INSTANCE)/api/sn_cicd/testsuite/run")
      RESULT_ID=$(echo "$RESPONSE" | jq -r '.result.sys_id')
      [ "$RESULT_ID" = "null" ] && { echo "Dispatch failed: $RESPONSE"; exit 1; }
      echo "##vso[task.setvariable variable=ATF_RESULT_ID]$RESULT_ID"
      echo "Dispatched ATF suite, progress sys_id = $RESULT_ID"
    displayName: Dispatch ATF Test Suite

  - bash: |
      set -euo pipefail
      STATUS="Pending"
      while [ "$STATUS" = "Pending" ] || [ "$STATUS" = "Running" ]; do
        sleep 30
        RESPONSE=$(curl -fsS \
          -u "$(SN_USERNAME):$(SN_PASSWORD)" \
          "$(SN_INSTANCE)/api/sn_cicd/progress/$(ATF_RESULT_ID)")
        STATUS=$(echo "$RESPONSE" | jq -r '.result.status_label')
        PCT=$(echo "$RESPONSE" | jq -r '.result.percent_complete')
        echo "ATF status: $STATUS ($PCT%)"
        DETAIL=$(echo "$RESPONSE" | jq -r '.result.status_detail // ""')
        if [ "$STATUS" = "Canceled" ] && echo "$DETAIL" | grep -q 'scheduled client test runner'; then
          echo "##vso[task.logissue type=error]No scheduled runner — see references/ci-cd-integration.md"
          exit 1
        fi
      done
    displayName: Wait for Completion
    timeoutInMinutes: 45

  - bash: |
      set -euo pipefail
      RESPONSE=$(curl -fsS \
        -u "$(SN_USERNAME):$(SN_PASSWORD)" \
        "$(SN_INSTANCE)/api/sn_cicd/testsuite/results/$(ATF_RESULT_ID)")
      STATUS=$(echo "$RESPONSE" | jq -r '.result.status_label')
      PASS=$(echo "$RESPONSE" | jq -r '.result.pass_count // 0')
      FAIL=$(echo "$RESPONSE" | jq -r '.result.fail_count // 0')
      echo "Results: $PASS passed, $FAIL failed"
      if [ "$STATUS" != "Successful" ] || [ "$FAIL" -gt 0 ]; then
        echo "##vso[task.logissue type=error]ATF tests failed ($FAIL failures)"
        exit 1
      fi
    displayName: Evaluate Results
```

## Pattern B — manual runner via Path B `action:"run"`

Use this when you don't have a scheduled runner (dev / PoC / local iteration). Requires the Scripted REST builder this skill ships (`scripts/bootstrap_builder.sh` — one-time, idempotent).

The skill already provides a one-shot script: **`scripts/run_test.sh <test_sys_id>`** — auto-discovers the freshest online manual runner, dispatches via `action:"run"`, polls, prints per-step results. You can wrap it in any CI runner.

### GitHub Actions (manual-runner pattern)

```yaml
jobs:
  atf-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4

      - name: Configure ServiceNow credentials
        run: |
          cat > .env <<EOF
          SN_ATF_INSTANCE=${{ vars.SN_INSTANCE }}
          SN_ATF_USER=${{ secrets.SN_USERNAME }}
          SN_ATF_PASSWORD=${{ secrets.SN_PASSWORD }}
          EOF

      - name: Run ATF test via Path B manual runner
        run: |
          ./skills/servicenow-atf-automation/scripts/run_test.sh \
            ${{ vars.ATF_TEST_SYS_ID }}
```

`run_test.sh` exits non-zero on test failure, so the step fails the build naturally. No JSON parsing in CI YAML — the script does it.

### Azure DevOps (manual-runner pattern)

```yaml
- task: Bash@3
  displayName: Run ATF test via Path B manual runner
  env:
    SN_ATF_INSTANCE: $(SN_INSTANCE)
    SN_ATF_USER: $(SN_USERNAME)
    SN_ATF_PASSWORD: $(SN_PASSWORD)
  inputs:
    targetType: inline
    script: |
      ./skills/servicenow-atf-automation/scripts/run_test.sh \
        $(ATF_TEST_SYS_ID)
```

`_env.sh` walks parents looking for `.env`; setting the three `SN_ATF_*` shell env vars overrides it (per `_env.sh` lookup-order rules), so no file write is needed in CI.

> **Path adjustment.** The examples above assume the skill lives at `./skills/servicenow-atf-automation/`. If your project mounts it elsewhere (e.g. `.claude/skills/servicenow-atf-automation/` for Claude Code installs, or a different path under another host), adjust the script paths accordingly.

## Cross-cutting concerns

### Timeouts

ATF suites can run a long time (UI suites with browser steps especially). Set the outer CI timeout to **2× the longest expected suite duration**, not 1×. The polling loop sleep should be 30 s — shorter wastes API calls, longer adds tail latency.

### Result artifacts

After completion, fetch and upload as build artifacts:

| Artifact | How to fetch | Where |
|---|---|---|
| Suite summary JSON | `GET /api/sn_cicd/testsuite/results/<id>` | Save as `atf-suite.json` |
| Per-test status | `sys_atf_test_result?suite_result=<id>` | Save as `atf-tests.json` |
| Per-step output | `sys_atf_test_result_step?parent=<test_result_sys_id>` | Save as `atf-steps.json` |
| Screenshots (UI tests) | `sys_attachment?table_sys_id=<test_result_sys_id>` | Download via `/api/now/attachment/<id>/file` |

A small `jq` script can produce a JUnit XML from `atf-suite.json` for native test-result rendering in Jenkins / ADO / GitHub. **Not shipped in this skill — write per-project to your liking.**

### Parallel suites

`/api/sn_cicd/testsuite/run` is parallel-safe — multiple in-flight dispatches just need multiple scheduled runners online (one suite per runner). Path B manual runner is **not** parallel-safe by default — it dispatches against the single most-recently-checked-in manual runner. If you need parallel via Path B, you'd need to coordinate multiple browser sessions / runner agents; usually easier to go the scheduled-runner route at that scale.

### Browser version pinning

The `browser_name` / `browser_version` fields on `/api/sn_cicd/testsuite/run` are advisory — they don't auto-provision a runner with that browser; they just constrain runner-selection to one that has it. If your scheduled runner is Chrome-only, asking for `firefox` will Cancel. Confirm runner capabilities in `sys_atf_agent.browser_versions` before pinning in CI.

### Secrets

`SN_USERNAME` / `SN_PASSWORD` should live in the CI's secret store (GitHub Secrets, ADO Variable Groups marked secret, Jenkins Credentials). Never in `.env` files committed to git. For production CI, prefer **OAuth** over Basic — the skill's `roles-and-access.md` covers the setup, but the API endpoints accept both auth modes.

## See also

- [`api-cheatsheet.md`](api-cheatsheet.md) — full endpoint reference including the `^EQ` encoded-query gotcha
- [`gotchas.md`](gotchas.md) — the runner-type ceiling in more detail, plus other production traps
- [`roles-and-access.md`](roles-and-access.md) — OAuth setup for CI
- [`fluent-sdk.md`](fluent-sdk.md) — the `now-sdk install --auth <alias>` pattern (CI use of the SDK)
