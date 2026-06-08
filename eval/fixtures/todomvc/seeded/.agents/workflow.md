# Workflow — TodoMVC fixture

- **Base branch:** main; feature branches per case.
- **Pipeline (test-automation):** analyst → AFS gate → implementer → fresh-session reviewer → merge.
- **Merge gate:** reviewer APPROVED + the test runs green before merge; back-write the TMS.
- **Tests ship separately** from app changes.
