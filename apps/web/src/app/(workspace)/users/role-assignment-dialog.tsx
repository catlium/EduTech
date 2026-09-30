'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { ApiError, api } from '@/lib/api';
import type { InstituteUser } from '@catlium/contracts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toggleRoleSelection, type AssignableRole } from '@/lib/roles-console';

interface RoleAssignmentDialogProps {
  member: InstituteUser | null;
  roles: readonly AssignableRole[];
  onClose: () => void;
  onSaved: (user: InstituteUser) => void;
}

/** Assigns a membership's complete role set.
 *
 *  `PUT /users/:userId/roles` REPLACES the set, so the dialog keeps its own draft
 *  seeded from the member's current roles and submits every role it holds. The
 *  saved set is not touched while editing, so Cancel is always a true no-op and a
 *  failed save leaves the draft intact for a retry.
 */
export function RoleAssignmentDialog({
  member,
  roles,
  onClose,
  onSaved,
}: RoleAssignmentDialogProps) {
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever the dialog is (re)opened for a member. Roles are resolved
  // from the list the page already fetched — a key with no match is simply not
  // tickable, never a crash.
  useEffect(() => {
    if (!member) return;
    setDraft(member.roles.flatMap((key) => roles.filter((r) => r.key === key).map((r) => r.id)));
    setError(null);
  }, [member, roles]);

  if (!member) return null;

  async function handleSave() {
    if (!member) return;
    setSaving(true);
    setError(null);
    try {
      const data = await api<{ user: InstituteUser }>(`/users/${member.id}/roles`, {
        method: 'PUT',
        body: { roleIds: draft },
      });
      onSaved(data.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Roles could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign roles</DialogTitle>
          <DialogDescription>
            {member.name} · {member.email}. Saving replaces every current role — untick a role to
            remove it.
          </DialogDescription>
        </DialogHeader>

        {member.roles.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Currently:{' '}
            {member.roles.map((key) => roles.find((r) => r.key === key)?.name ?? key).join(', ')}
          </p>
        )}

        {roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">This institute has no roles to assign.</p>
        ) : (
          <fieldset className="max-h-72 space-y-3 overflow-y-auto">
            {roles.map((role) => (
              <div key={role.id} className="flex items-start gap-3">
                <Checkbox
                  id={`role-${role.id}`}
                  className="mt-0.5"
                  disabled={saving}
                  checked={draft.includes(role.id)}
                  onCheckedChange={() =>
                    setDraft((current) => toggleRoleSelection(current, role.id))
                  }
                />
                <div className="grid gap-0.5">
                  <Label htmlFor={`role-${role.id}`} className="cursor-pointer">
                    {role.name}
                  </Label>
                  <code className="text-xs text-muted-foreground">{role.key}</code>
                </div>
              </div>
            ))}
          </fieldset>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || roles.length === 0}>
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />} Save roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
