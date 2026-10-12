# File storage warning

The job list shows usage of attached photos and crew document files to office and administrator accounts. Administrators also see usage in General settings and can set the warning threshold from 1% to 99%. The implementation default is 80%; it is an operational setting, not a threshold or extra charge stated in the quotation. Existing installations receive this default without a database migration.

Usage is the sum of photo and crew document file sizes currently recorded in the database, using the same 10 GB quota as upload validation. It does not represent total R2 bucket usage, backup storage, billing, or support for additional attachment formats. The warning does not change the quota or purchase capacity.

Usage refreshes when the job list or General settings is opened, and after saving General settings. It is not an email, push notification, or background monitoring service. If usage cannot be read, the job list remains usable and displays a retry message. Only administrators may change the threshold; field and unauthenticated users cannot read the system usage endpoint.

The operator should review usage during the regular office check. When the warning appears, record the date and usage, notify the designated company contact through the agreed channel, and provide any proposed capacity cost for approval before purchase. This operating process still needs an assigned owner and delivery evidence before handover can claim that advance notices are being delivered. No automatic messages or billing actions are implemented.

Tests: RD19 checks access control, validation and unchanged quota; RD20 checks byte-level threshold boundaries and recovery using isolated synthetic size metadata. `test:e2e:onboarding` checks the first-run guide, field help, settings persistence, and warning/error presentation. Large usage states in the UI test are explicitly mocked; no large production uploads are performed.
