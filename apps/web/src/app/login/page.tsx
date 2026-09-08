"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoginRequestSchema, type LoginRequest } from "@catlium/contracts";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginRequest) {
    setSubmitting(true);
    try {
      await api("/auth/login", { method: "POST", body: values });
      await refresh();
      toast.success("Welcome back");
      router.replace("/dashboard");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Login failed";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">CatLium EduTech</h1>
          <p className="text-sm text-muted-foreground">Sign in to your account</p>
        </div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="you@institute.edu" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </Form>
        <p className="text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link href="/register" className="font-medium underline underline-offset-4">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}