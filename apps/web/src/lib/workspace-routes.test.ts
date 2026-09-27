import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WORKSPACE_ROUTES, workspaceRoute } from './workspace-routes.ts';

// F5.6: the route table decides page reachability, so the audited findings are
// pinned here — a regression test is cheaper than re-running the audit.
test('academic console is gated by academic-structure.read, not the admin role', () => {
  const gate = workspaceRoute('/institute/academic');
  assert.equal(gate?.key, 'academic-structure.read');
  assert.equal(gate?.role, null, 'no role is required on top of the permission');
});

test('academic console treats the structural reads as the page load, not the roster', () => {
  // The roster is `users.read` and admin-scoped; a 403 on it must not blank the
  // academic console for someone who legitimately holds academic-structure.read.
  assert.deepEqual(workspaceRoute('/institute/academic')?.load, [
    '/academic/academic-years',
    '/academic/classes',
    '/academic/divisions',
  ]);
});

test('the more specific academic prefix beats the /institute catch-all', () => {
  assert.equal(workspaceRoute('/institute/academic/years')?.key, 'academic-structure.read');
  assert.equal(workspaceRoute('/institute')?.key, 'users.read');
});

test('roster and users routes stay users.read + admin', () => {
  for (const path of ['/institute', '/users', '/users/abc']) {
    const gate = workspaceRoute(path);
    assert.equal(gate?.key, 'users.read', path);
    assert.equal(gate?.role, 'admin', path);
  }
});

test('teaching routes keep their role gate on top of the read key', () => {
  for (const [path, key] of [
    ['/subjects', 'subjects.read'],
    ['/materials', 'materials.read'],
    ['/content', 'content.read'],
    ['/questions', 'questions.read'],
    ['/assessments', 'assessments.read'],
    ['/question-papers', 'question-papers.read'],
    ['/paper-patterns', 'paper-patterns.read'],
    ['/syllabus', 'syllabus.read'],
    ['/jobs', 'jobs.read'],
  ] as const) {
    const gate = workspaceRoute(path);
    assert.equal(gate?.key, key, path);
    assert.equal(gate?.role, 'teacher', path);
  }
});

test('prefix matching is boundary-safe and every load path is non-empty', () => {
  assert.equal(workspaceRoute('/subjectsx'), undefined);
  assert.equal(workspaceRoute('/institute-of'), undefined);
  assert.equal(workspaceRoute('/dashboard'), undefined);
  for (const gate of WORKSPACE_ROUTES) {
    assert.ok(gate.load.length > 0, `${gate.prefix} declares no primary read`);
  }
});
