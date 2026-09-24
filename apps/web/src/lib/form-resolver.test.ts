import { test } from 'node:test';
import assert from 'node:assert/strict';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreateInstituteUserRequestSchema,
  type CreateInstituteUserRequest,
} from '@catlium/contracts';

// Regression for F2: @hookform/resolvers < 4 only recognized Zod v3 errors
// (`.errors`), so with the Zod v4 (`.issues`) schema the resolver REJECTED and
// form.handleSubmit never fired — invalid Add User submissions silently did
// nothing. The resolver must resolve to field errors instead.
const options = { fields: {}, shouldUseNativeValidation: false };

test('invalid Zod v4 Add User input resolves to field errors (no reject)', async () => {
  const resolver = zodResolver(CreateInstituteUserRequestSchema);
  const { errors } = await resolver(
    { email: 'not-an-email', name: '', password: 'short', role: 'TEACHER' },
    undefined,
    options,
  );
  const fields = Object.keys(errors as Record<string, unknown>).sort();
  assert.deepEqual(fields, ['email', 'name', 'password']);
});

test('valid Zod v4 Add User input resolves clean so submit proceeds', async () => {
  const resolver = zodResolver(CreateInstituteUserRequestSchema);
  const valid: CreateInstituteUserRequest = {
    email: 'ada@institute.edu',
    name: 'Ada Lovelace',
    password: 'longenough1',
    role: 'TEACHER',
  };
  const { errors, values } = await resolver(valid, undefined, options);
  assert.deepEqual(errors, {});
  assert.deepEqual(values, valid);
});
