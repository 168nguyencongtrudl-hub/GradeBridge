# Security Specification — Cambridge Grader & Smart Tasks (Phase 0 TDD)

## 1. Data Invariants

1. **Master Gate & Relational Ownership**:
   - Every `/workspaces/{workspaceId}` document has an immutable `ownerId` matching `request.auth.uid` at creation (`request.auth.token.email_verified == true`).
   - Every subcollection document (`profiles`, `results`, `tasks`, `teachers`) under `/workspaces/{workspaceId}` MUST verify that the parent `/workspaces/{workspaceId}` exists and that its `ownerId` matches `request.auth.uid` (or `isAdmin()`).
2. **Strict Schema & Anti-Update-Gap**:
   - Every create and update operation calls `isValid[Entity](incoming())` enforcing `hasAll(...)`, `hasOnly(...)`, strict types, `.size()` bounds, and regex ID patterns (`^[a-zA-Z0-9_\-]+$`).
3. **Temporal & Identity Immutability**:
   - `createdAt == request.time` on create; `createdAt == existing().createdAt` and `updatedAt == request.time` on update.
   - `ownerId`, `workspaceId`, and `id` are immutable across updates.
4. **Terminal State Lock**:
   - On `/workspaces/{workspaceId}/tasks/{taskId}`, once `existing().status == 'done'`, updates are blocked unless `isAdmin()`.
5. **Query Enforcer**:
   - Every `allow list` rule enforces `resource.data.ownerId == request.auth.uid || isAdmin()` without calling `get()` or `exists()`.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 (Unverified Email Spoof)**: Attempt write with `email == "168nguyencongtru.dl@gmail.com"` and `email_verified == false` -> `PERMISSION_DENIED`.
2. **Payload 2 (Identity Spoofing on Workspace Create)**: Create `/workspaces/CAMBRIDGE-2026` with `ownerId: "attacker-uid"` != `request.auth.uid` -> `PERMISSION_DENIED`.
3. **Payload 3 (Shadow Ghost Field on Profile)**: Create `/workspaces/CAMBRIDGE-2026/profiles/p1` with extra key `"isSuperAdmin": true` -> `PERMISSION_DENIED`.
4. **Payload 4 (Path Variable ID Poisoning)**: Create `/workspaces/CAMBRIDGE-2026/tasks/bad$id!with spaces` -> `PERMISSION_DENIED`.
5. **Payload 5 (Client Timestamp Forgery)**: Create `/workspaces/CAMBRIDGE-2026/results/r1` with `createdAt` in the past (`!= request.time`) -> `PERMISSION_DENIED`.
6. **Payload 6 (Immortal Field Mutation)**: Update `/workspaces/CAMBRIDGE-2026` changing `ownerId` or `createdAt` -> `PERMISSION_DENIED`.
7. **Payload 7 (Orphaned Subcollection Write)**: Create `/workspaces/NON_EXISTENT/tasks/t1` where parent workspace does not exist -> `PERMISSION_DENIED`.
8. **Payload 8 (Terminal State Bypass)**: Update `/workspaces/CAMBRIDGE-2026/tasks/t1` as non-admin when `existing().status == 'done'` -> `PERMISSION_DENIED`.
9. **Payload 9 (Unbounded Array DoW Attack)**: Create `/workspaces/CAMBRIDGE-2026/profiles/p1` with `parts` array containing 35 elements (`> 30`) -> `PERMISSION_DENIED`.
10. **Payload 10 (Array Element Type Poisoning)**: Create `/workspaces/CAMBRIDGE-2026/tasks/t1` with `subtasks: [12345]` (non-map first element) -> `PERMISSION_DENIED`.
11. **Payload 11 (Cross-Tenant List Scraping)**: List `/workspaces/CAMBRIDGE-2026/results` where `resource.data.ownerId != request.auth.uid` as non-admin -> `PERMISSION_DENIED`.
12. **Payload 12 (Self-Assigned Admin Escalation)**: Non-admin user attempts to create `/admins/{uid}` -> `PERMISSION_DENIED`.
