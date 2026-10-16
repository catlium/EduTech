import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as bcryptjs from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  users,
  authSessions,
  memberships,
  membershipRoles,
  rolePermissions,
  roles,
  institutes,
} from '@catlium/database';

import { RolesService } from './roles.service.ts';
import { RoleAssignmentService } from './role-assignment.service.ts';

// F5.7 self-escalation guards on the roles service.
//
// `deleteRole` gained an `actorRoleKeys` argument in F5.7: the actor may never
// delete a role they currently hold. `role_permissions` and `membership_roles`
// both cascade on role deletion, so deleting a role you hold would strip your
// own grants AND your own binding in one statement — a zero-grant membership
// with no self-repair, and for the last holder of a custom role, a way to make
// the institute's only delegable authority undeletable.
//
// `setRolePermissions` already carried the same rule (adding permissions to a
// role you hold is self-escalation); it is asserted here alongside so the two
// cannot drift apart.
//
// Requires TEST_DATABASE_URL; skips cleanly when unset.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

const hash = (pwd: string) => bcryptjs.hashSync(pwd, 4);

async function createUser(email: string) {
  const [user] = await db!
    .insert(users)
    .values({
      email,
      name: 'Self Escalation Tester',
      passwordHash: hash('wrong horse battery staple'),
    })
    .returning();
  return user!;
}

async function grantMembership(
  instituteId: string,
  userId: string,
  roleKeys: string[],
  roleIdFor: Record<string, string>,
) {
  const [membership] = await db!
    .insert(memberships)
    .values({ userId, instituteId, status: 'active' })
    .returning();
  for (const key of roleKeys) {
    await db!
      .insert(membershipRoles)
      .values({ membershipId: membership!.id, roleId: roleIdFor[key]! });
  }
  return membership!;
}

async function roleRow(roleId: string) {
  const [row] = await db!.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  return row;
}

async function grantCount(roleId: string) {
  const rows = await db!.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  return rows.length;
}

test(
  'F5.7 roles self-escalation: a role can neither be deleted nor re-permissioned by its own holder',
  { skip: testDbUrl ? false : 'TEST_DATABASE_URL not set' },
  async (t) => {
    const suffix = randomUUID().slice(0, 8);
    const svc = new RolesService(db as unknown as Database);
    const assigner = new RoleAssignmentService(db as unknown as Database);

    const [instA] = await db!
      .insert(institutes)
      .values({ name: `Esc A ${suffix}`, slug: `esc-a-${suffix}` })
      .returning();
    const [instB] = await db!
      .insert(institutes)
      .values({ name: `Esc B ${suffix}`, slug: `esc-b-${suffix}` })
      .returning();

    const holder = await createUser(`esc-holder-${suffix}@example.test`);
    const peer = await createUser(`esc-peer-${suffix}@example.test`);
    const admin = await createUser(`esc-admin-${suffix}@example.test`);

    const builtIns = await db!
      .select()
      .from(roles)
      .where(inArray(roles.key, ['INSTITUTE_ADMIN', 'TEACHER', 'STUDENT']));
    const roleIdFor = Object.fromEntries(builtIns.map((r) => [r.key, r.id]));

    const holderMembership = await grantMembership(instA!.id, holder!.id, ['TEACHER'], roleIdFor);
    await grantMembership(instA!.id, peer!.id, ['TEACHER'], roleIdFor);
    await grantMembership(instA!.id, admin!.id, ['INSTITUTE_ADMIN'], roleIdFor);
    const adminMembership = await db!
      .select()
      .from(memberships)
      .where(eq(memberships.userId, admin!.id))
      .limit(1);
    const bMembership = await grantMembership(instB!.id, peer!.id, ['INSTITUTE_ADMIN'], roleIdFor);

    t.after(async () => {
      if (!db) return;
      const emails = [
        `esc-holder-${suffix}@example.test`,
        `esc-peer-${suffix}@example.test`,
        `esc-admin-${suffix}@example.test`,
      ];
      const userIds = (
        await db.select({ id: users.id }).from(users).where(inArray(users.email, emails))
      ).map((r) => r.id!);
      if (userIds.length > 0) {
        const membershipIds = (
          await db
            .select({ id: memberships.id })
            .from(memberships)
            .where(inArray(memberships.userId, userIds))
        ).map((r) => r.id!);
        await db
          .delete(membershipRoles)
          .where(inArray(membershipRoles.membershipId, membershipIds));
        await db.delete(memberships).where(inArray(memberships.userId, userIds));
        await db.delete(authSessions).where(inArray(authSessions.userId, userIds));
        await db.delete(users).where(inArray(users.email, emails));
      }
      // Any role a test failed to clean up still carries this run's key prefix.
      const orphans = await db
        .select({ id: roles.id })
        .from(roles)
        .where(
          inArray(roles.key, [
            `esc_${suffix}_holder`,
            `esc_${suffix}_adminheld`,
            `esc_${suffix}_adminheld2`,
            `esc_${suffix}_widen`,
            `esc_${suffix}_private`,
            `esc_${suffix}_plat`,
          ]),
        );
      if (orphans.length > 0) {
        await db.delete(rolePermissions).where(
          inArray(
            rolePermissions.roleId,
            orphans.map((r) => r.id),
          ),
        );
        await db.delete(membershipRoles).where(
          inArray(
            membershipRoles.roleId,
            orphans.map((r) => r.id),
          ),
        );
        await db.delete(roles).where(
          inArray(
            roles.id,
            orphans.map((r) => r.id),
          ),
        );
      }
      await db
        .delete(institutes)
        .where(inArray(institutes.slug, [`esc-a-${suffix}`, `esc-b-${suffix}`]));
      void holderMembership;
      void bMembership;
    });

    await t.test(
      'a role the actor holds cannot be deleted, and the row SURVIVES intact',
      async () => {
        const key = `esc_${suffix}_holder`;
        const created = await svc.createRole(instA!.id, {
          key,
          name: 'Escalation Holder',
          description: undefined,
          permissionKeys: ['content.read'],
        });
        await assigner.assign(holderMembership!.id, created.id);

        const before = await roleRow(created.id);
        const grantsBefore = await grantCount(created.id);
        assert.equal(before?.key, key);
        assert.ok(grantsBefore > 0, 'the role carries at least one grant before the attempt');

        // actorRoleKeys holds it → refused.
        await assert.rejects(
          svc.deleteRole(instA!.id, created.id, [key]),
          /cannot delete a role you hold/,
        );
        // A holder naming itself by a DIFFERENT CASE is still a holder.
        await assert.rejects(
          svc.deleteRole(instA!.id, created.id, [key.toUpperCase()]),
          /cannot delete a role you hold/,
        );
        // And a non-holder holding it in any position of their own key list is refused.
        await assert.rejects(
          svc.deleteRole(instA!.id, created.id, ['TEACHER', key, 'STUDENT']),
          /cannot delete a role you hold/,
        );

        // Nothing was cascaded: the role, its grants and the membership binding survive.
        assert.ok(await roleRow(created.id), 'the refused delete must leave the role row in place');
        assert.equal(await grantCount(created.id), grantsBefore, 'grants must be untouched');
        const stillBound = await db!
          .select()
          .from(membershipRoles)
          .where(eq(membershipRoles.membershipId, holderMembership!.id));
        assert.ok(
          stillBound.some((r) => r.roleId === created.id),
          'the refused delete must leave the membership binding in place',
        );

        // A peer who does NOT hold it may delete it, and then it is really gone.
        await svc.deleteRole(instA!.id, created.id, ['TEACHER']);
        assert.equal(
          await roleRow(created.id),
          undefined,
          'a permitted delete must remove the row',
        );
        assert.equal(await grantCount(created.id), 0, 'grants must cascade on a permitted delete');
      },
    );

    await t.test(
      'an INSTITUTE_ADMIN is refused only when they actually hold the custom role',
      async () => {
        const key = `esc_${suffix}_adminheld`;
        const created = await svc.createRole(instA!.id, {
          key,
          name: 'Admin Holds This',
          description: undefined,
          permissionKeys: ['content.read'],
        });
        // Not assigned to anyone: 'INSTITUTE_ADMIN' alone must be enough to delete.
        await svc.deleteRole(instA!.id, created.id, ['INSTITUTE_ADMIN']);
        assert.equal(await roleRow(created.id), undefined);

        // Once it IS in the admin's key list, the guard fires for them too — the
        // check is key-based, not admin-based, so a custom admin is covered.
        const second = await svc.createRole(instA!.id, {
          key: `esc_${suffix}_adminheld2`,
          name: 'Admin Holds This Too',
          description: undefined,
          permissionKeys: ['content.read'],
        });
        await assigner.assign(adminMembership[0]!.id, second.id);
        await assert.rejects(
          svc.deleteRole(instA!.id, second.id, ['INSTITUTE_ADMIN', second.key]),
          /cannot delete a role you hold/,
        );
      },
    );

    await t.test(
      'the system-role immutability check fires BEFORE the self-hold check',
      async () => {
        // An INSTITUTE_ADMIN deleting TEACHER must report immutability, never
        // "you hold it" — the ordering is asserted through the message, so a
        // future reorder that reports the wrong reason fails here.
        await assert.rejects(
          svc.deleteRole(instA!.id, roleIdFor.TEACHER!, ['TEACHER']),
          /System roles cannot be deleted/,
        );
        await assert.rejects(
          svc.deleteRole(instA!.id, roleIdFor.TEACHER!, ['INSTITUTE_ADMIN']),
          /System roles cannot be deleted/,
        );
      },
    );

    await t.test('setRolePermissions refuses to widen a role the actor holds', async () => {
      const key = `esc_${suffix}_widen`;
      const created = await svc.createRole(instA!.id, {
        key,
        name: 'Widening Target',
        description: undefined,
        permissionKeys: ['content.read'],
      });
      await assigner.assign(holderMembership!.id, created.id);
      const grantsBefore = await grantCount(created.id);

      await assert.rejects(
        svc.setRolePermissions(instA!.id, created.id, ['roles.manage'], [key]),
        /cannot change permissions of a role you hold/,
      );
      assert.equal(
        await grantCount(created.id),
        grantsBefore,
        'the refused write must leave grants untouched',
      );
      const after = await svc.getRole(instA!.id, created.id);
      assert.deepEqual(
        after.permissionKeys,
        ['content.read'],
        'no escalation key may be added by a holder',
      );

      // A non-holder may still widen it — the guard is about self-escalation, not
      // about forbidding delegation.
      const widened = await svc.setRolePermissions(
        instA!.id,
        created.id,
        ['roles.manage'],
        ['INSTITUTE_ADMIN'],
      );
      assert.deepEqual(widened.permissionKeys, ['roles.manage']);
      await svc.deleteRole(instA!.id, created.id, ['INSTITUTE_ADMIN']);
    });

    await t.test(
      'a foreign institute can neither see nor delete another institute role',
      async () => {
        const key = `esc_${suffix}_private`;
        const created = await svc.createRole(instA!.id, {
          key,
          name: 'Institute A Private',
          description: undefined,
          permissionKeys: ['content.read'],
        });
        // B cannot even read it → NotFound, never Forbidden (no existence leak).
        await assert.rejects(svc.getRole(instB!.id, created.id), /Role not found/);
        await assert.rejects(svc.deleteRole(instB!.id, created.id, [key]), /Role not found/);
        assert.ok(await roleRow(created.id), 'the cross-institute delete must not have touched it');
        await svc.deleteRole(instA!.id, created.id, ['INSTITUTE_ADMIN']);
      },
    );

    await t.test('createRole still refuses platform keys and reserved built-in keys', async () => {
      await assert.rejects(
        svc.createRole(instA!.id, {
          key: `esc_${suffix}_plat`,
          name: 'Platform',
          description: undefined,
          permissionKeys: ['institutes.read'],
        }),
        /Unsupported or platform permission keys/,
      );
      await assert.rejects(
        svc.createRole(instA!.id, {
          key: 'INSTITUTE_ADMIN',
          name: 'Reserved',
          description: undefined,
          permissionKeys: ['roles.read'],
        }),
        /reserved for a built-in role/,
      );
    });
  },
);
