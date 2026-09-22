import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultPlanCode,
  filterInstitutes,
  formatDate,
  planName,
  type InstituteSummary,
  type PlatformPlan,
} from './platform-scope.ts';

const plans: PlatformPlan[] = [
  { id: 'p1', code: 'starter', name: 'Starter', description: 'Entry plan' },
  { id: 'p2', code: 'growth', name: 'Growth', description: 'Scale plan' },
  { id: 'p3', code: 'institute', name: 'Institute', description: 'Full plan' },
];

const institutes: InstituteSummary[] = [
  {
    id: 'a',
    name: 'Green Valley Academy',
    slug: 'green-valley-academy',
    status: 'active',
    deactivatedAt: null,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
  },
  {
    id: 'b',
    name: 'Blue Ridge School',
    slug: 'blue-ridge',
    status: 'deactivated',
    deactivatedAt: '2026-09-10T12:00:00.000Z',
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-09-10T12:00:00.000Z',
  },
];

test('filterInstitutes applies status and name/slug search', () => {
  assert.deepEqual(
    filterInstitutes(institutes, 'all', '').map((i) => i.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    filterInstitutes(institutes, 'active', '').map((i) => i.id),
    ['a'],
  );
  assert.deepEqual(
    filterInstitutes(institutes, 'deactivated', '').map((i) => i.id),
    ['b'],
  );
  assert.deepEqual(
    filterInstitutes(institutes, 'all', 'blue').map((i) => i.id),
    ['b'],
  );
  assert.deepEqual(
    filterInstitutes(institutes, 'all', 'academy').map((i) => i.id),
    ['a'],
  );
  assert.deepEqual(
    filterInstitutes(institutes, 'active', 'blue').map((i) => i.id),
    [],
  );
  assert.deepEqual(
    filterInstitutes(institutes, 'all', 'missing').map((i) => i.id),
    [],
  );
  assert.deepEqual(
    filterInstitutes(institutes, 'all', '  academy  ').map((i) => i.id),
    ['a'],
  );
});

test('defaultPlanCode prefers the fallback, then the first catalog plan', () => {
  assert.equal(defaultPlanCode(plans, 'starter'), 'starter');
  assert.equal(defaultPlanCode(plans, 'enterprise'), 'starter');
  const noStarter = plans.slice(1);
  assert.equal(defaultPlanCode(noStarter, 'starter'), 'growth');
  assert.equal(defaultPlanCode([], 'starter'), null);
});

test('planName maps a code to its human name', () => {
  assert.equal(planName(plans, 'growth'), 'Growth');
  assert.equal(planName(plans, 'unknown'), 'unknown');
  assert.equal(planName(plans, null), 'No plan');
  assert.equal(planName(plans, undefined), 'No plan');
});

test('formatDate renders dates and dashes for missing values', () => {
  assert.equal(formatDate(null), '—');
  assert.equal(formatDate(undefined), '—');
  assert.match(formatDate('2026-09-01T12:00:00.000Z'), /Sep 1, 2026/);
  const d = new Date('2026-09-01T12:00:00.000Z');
  assert.match(formatDate(d), /Sep 1, 2026/);
});
