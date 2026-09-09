"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, UserRound } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { BrandMark } from "@/components/app/brand-logo";
import { PageLoader } from "@/components/app/loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function InstitutesPage() {
  const router = useRouter();
  const { user, memberships, loading } = useAuth();
  const { selectInstitute } = useTenant();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  if (loading) return <PageLoader />;
  if (!user) return null;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-muted/30 p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.12),transparent_55%)]"
      />
      <div className="relative w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-10 rounded-xl" />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Choose your institute</h1>
            <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
              <UserRound className="size-3.5" /> Signed in as {user.email}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {memberships.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                You are not a member of any institute yet. An institute admin will need to add you.
              </CardContent>
            </Card>
          )}
          {memberships.map((membership) => (
            <Card
              key={membership.instituteId}
              className="group cursor-pointer transition-shadow hover:border-primary/40 hover:shadow-md"
            >
              <button type="button" className="w-full text-left" onClick={() => selectInstitute(membership)}>
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Building2 className="size-4 shrink-0 text-muted-foreground" />
                      <CardTitle className="truncate">{membership.instituteName}</CardTitle>
                    </div>
                    <CardDescription className="mt-1.5 flex flex-wrap gap-1.5">
                      {membership.roles.map((r) => (
                        <Badge key={r} variant="secondary" className="font-medium">
                          {r.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </CardDescription>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
                    Continue
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </CardHeader>
              </button>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}