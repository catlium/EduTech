"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { useAuth } from "@/lib/auth";
import { useTenant, canManage } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";

export function Forbidden({ role = "student" }: { role?: "student" | "teacher" }) {
  const { logout } = useAuth();
  const { institute } = useTenant();
  const params = useParams();
  const isTeacherInInstitute = canManage(institute);
  const backHref = isTeacherInInstitute ? "/dashboard" : "/student/dashboard";

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <EmptyState
        icon={<AlertTriangle className="size-5" />}
        title="No access"
        description={
          params && "attemptId" in params
            ? "You don't have access to this attempt — it belongs to another student."
            : "This area is only available to teachers and institute admins."
        }
      >
        <Button asChild size="sm">
          <Link href={backHref}>Back to dashboard</Link>
        </Button>
        {role === "student" && (
          <Button variant="ghost" size="sm" onClick={() => logout()}>
            Sign out
          </Button>
        )}
      </EmptyState>
    </main>
  );
}