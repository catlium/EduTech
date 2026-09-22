'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { api, ApiError } from '@/lib/api';
import { defaultPlanCode, type InstituteDetail, type PlatformPlan } from '@/lib/platform-scope';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const formSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255),
  slug: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v), {
      message: 'slug must be kebab-case (lowercase, hyphens)',
    }),
  planCode: z.string().min(1, 'Choose a plan'),
  adminEmail: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: 'Enter a valid email or leave it empty',
    }),
  adminName: z.string().trim().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function CreateInstituteDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (detail: InstituteDetail) => void;
}) {
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', slug: '', planCode: '', adminEmail: '', adminName: '' },
  });

  useEffect(() => {
    if (!open) return;
    let active = true;
    setPlansLoading(true);
    api<PlatformPlan[]>('/platform/plans')
      .then((catalog) => {
        if (!active) return;
        setPlans(catalog);
        const fallback = defaultPlanCode(catalog);
        if (fallback) form.setValue('planCode', fallback, { shouldValidate: true });
      })
      .catch((error) => {
        if (!active) return;
        toast.error(error instanceof ApiError ? error.message : 'Failed to load plans');
      })
      .finally(() => {
        if (active) setPlansLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const detail = await api<InstituteDetail>('/platform/institutes', {
        method: 'POST',
        body: {
          name: values.name,
          ...(values.slug ? { slug: values.slug } : {}),
          planCode: values.planCode,
          ...(values.adminEmail
            ? {
                primaryAdmin: {
                  email: values.adminEmail,
                  ...(values.adminName ? { name: values.adminName } : {}),
                },
              }
            : {}),
        },
      });
      toast.success(`Institute "${detail.name}" created`);
      form.reset();
      onOpenChange(false);
      onCreated(detail);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to create institute');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create institute</DialogTitle>
          <DialogDescription>
            Provision a tenant shell with its subscription and an optional primary admin — exactly
            what the platform provision API accepts.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Green Valley Academy" {...field} />
                  </FormControl>
                  <FormDescription>The institute&apos;s display name.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug</FormLabel>
                  <FormControl>
                    <Input placeholder="green-valley-academy" {...field} />
                  </FormControl>
                  <FormDescription>
                    URL-safe identifier, globally unique. Leave empty to derive a kebab-case slug
                    from the name.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="planCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Plan</FormLabel>
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                    disabled={plansLoading || plans.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={plansLoading ? 'Loading plans…' : 'Choose a plan'}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {plans.map((plan) => (
                        <SelectItem key={plan.code} value={plan.code}>
                          {plan.name} — {plan.description}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Subscription attached at provision; switched later from the console.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="adminEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary admin email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="admin@institute.edu" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="adminName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary admin name</FormLabel>
                      <FormControl>
                        <Input placeholder="Alex Morgan" {...field} />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Required when the email is new — creates an account claimed via password
                        reset.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                {submitting ? 'Creating…' : 'Create institute'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
