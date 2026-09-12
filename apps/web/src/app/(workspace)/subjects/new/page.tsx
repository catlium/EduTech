"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { useTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CreateSubjectRequest } from "@catlium/contracts";
import { CreateSubjectRequestSchema } from "@catlium/contracts";

export default function NewSubjectPage() {
  const router = useRouter();
  const { institute } = useTenant();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<CreateSubjectRequest>({
    resolver: zodResolver(CreateSubjectRequestSchema),
    defaultValues: { name: "", slug: "", description: "" },
  });

  const name = form.watch("name");

  useEffect(() => {
    if (name && !form.formState.dirtyFields.slug) {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      form.setValue("slug", slug, { shouldValidate: true });
    }
  }, [name, form]);

  async function onSubmit(values: CreateSubjectRequest) {
    if (!institute) return;
    setSubmitting(true);
    try {
      const { subject } = await api<{ subject: { id: string } }>("/academic/subjects", {
        method: "POST",
        body: values,
      });
      toast.success("Subject created");
      router.replace(`/subjects/${subject.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to create subject");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="New Subject"
        description="Create a new subject to organize your curriculum."
      />
      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Mathematics" {...field} />
                    </FormControl>
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
                      <Input placeholder="mathematics" {...field} />
                    </FormControl>
                    <FormDescription>
                      Auto-generated from name. Lowercase alphanumeric + hyphens.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Optional description"
                        className="resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="ghost" onClick={() => router.back()}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating..." : "Create Subject"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
