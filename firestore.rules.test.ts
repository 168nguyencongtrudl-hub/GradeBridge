/**
 * Phase 0 TDD Security Test Specification for firestore.rules
 * Verifies that all 12 "Dirty Dozen" adversarial payloads return PERMISSION_DENIED.
 */

export interface DirtyPayloadTestCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  auth: {
    uid: string;
    email: string;
    email_verified: boolean;
  } | null;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyPayloadTestCase[] = [
  {
    id: 1,
    name: 'Unverified Email Spoof on Bootstrapped Admin',
    collectionPath: '/workspaces/CAMBRIDGE-2026',
    operation: 'get',
    auth: { uid: 'spoof-uid', email: '168nguyencongtru.dl@gmail.com', email_verified: false },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 2,
    name: 'Identity Spoofing on Workspace Create',
    collectionPath: '/workspaces/CAMBRIDGE-2026',
    operation: 'create',
    auth: { uid: 'user-1', email: 'teacher@example.com', email_verified: true },
    payload: { ownerId: 'user-2', sessionCode: 'CAMBRIDGE-2026' },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 3,
    name: 'Shadow Ghost Field on ExamProfile',
    collectionPath: '/workspaces/CAMBRIDGE-2026/profiles/prof-1',
    operation: 'create',
    auth: { uid: 'user-1', email: 'teacher@example.com', email_verified: true },
    payload: { id: 'prof-1', workspaceId: 'CAMBRIDGE-2026', ownerId: 'user-1', ghostAdmin: true },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 4,
    name: 'Path Variable ID Poisoning',
    collectionPath: '/workspaces/CAMBRIDGE-2026/tasks/invalid$id!',
    operation: 'create',
    auth: { uid: 'user-1', email: 'teacher@example.com', email_verified: true },
    payload: { id: 'invalid$id!' },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 5,
    name: 'Client Timestamp Forgery',
    collectionPath: '/workspaces/CAMBRIDGE-2026/results/res-1',
    operation: 'create',
    auth: { uid: 'user-1', email: 'teacher@example.com', email_verified: true },
    payload: { id: 'res-1', createdAt: '1999-01-01T00:00:00Z' },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 6,
    name: 'Immortal Field Mutation (ownerId)',
    collectionPath: '/workspaces/CAMBRIDGE-2026',
    operation: 'update',
    auth: { uid: 'user-1', email: 'teacher@example.com', email_verified: true },
    payload: { ownerId: 'hijacked-uid' },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 7,
    name: 'Orphaned Subcollection Write',
    collectionPath: '/workspaces/MISSING-ROOM/tasks/task-1',
    operation: 'create',
    auth: { uid: 'user-1', email: 'teacher@example.com', email_verified: true },
    payload: { id: 'task-1', workspaceId: 'MISSING-ROOM', ownerId: 'user-1' },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 8,
    name: 'Terminal State Bypass on Completed SmartTask',
    collectionPath: '/workspaces/CAMBRIDGE-2026/tasks/task-done',
    operation: 'update',
    auth: { uid: 'user-1', email: 'teacher@example.com', email_verified: true },
    payload: { title: 'Mutating completed task as non-admin' },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 9,
    name: 'Unbounded Array DoW Attack on ExamProfile.parts',
    collectionPath: '/workspaces/CAMBRIDGE-2026/profiles/prof-1',
    operation: 'create',
    auth: { uid: 'user-1', email: 'teacher@example.com', email_verified: true },
    payload: { parts: new Array(35).fill({}) },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 10,
    name: 'Array Element Type Poisoning on SmartTask.subtasks',
    collectionPath: '/workspaces/CAMBRIDGE-2026/tasks/task-1',
    operation: 'create',
    auth: { uid: 'user-1', email: 'teacher@example.com', email_verified: true },
    payload: { subtasks: [12345] },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 11,
    name: 'Cross-Tenant List Scraping on StudentResults',
    collectionPath: '/workspaces/CAMBRIDGE-2026/results',
    operation: 'list',
    auth: { uid: 'intruder-uid', email: 'intruder@example.com', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED'
  },
  {
    id: 12,
    name: 'Self-Assigned Admin Escalation',
    collectionPath: '/admins/intruder-uid',
    operation: 'create',
    auth: { uid: 'intruder-uid', email: 'intruder@example.com', email_verified: true },
    payload: { ownerId: 'intruder-uid' },
    expectedOutcome: 'PERMISSION_DENIED'
  }
];
