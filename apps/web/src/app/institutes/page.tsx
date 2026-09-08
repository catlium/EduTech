"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function InstitutesPage() {
  const router = useRouter();
  const { user, memberships, loading } = useAuth();
  const { selectInstitute } = useTenant();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center">Loading...</div>;
  }
  if (!user) return null;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Choose your institute</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {user.email}
          </p>
        </div>
        <div className="space-y-3">
          {memberships.length === 0 && (
            <Card>
              <CardHeader>
                <CardDescription>
                  You are not a member of any institute yet.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
          {memberships.map((membership) => (
            <Card key={membership.instituteId} className="cursor-pointer transition-shadow hover:shadow-md">
              <button
                type="button"
                className="w-full text-left"
                onClick={() => selectInstitute(membership)}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{membership.instituteName}</CardTitle>
                    <Button variant="ghost" size="sm">
                      Continue
                    </Button>
                  </div>
                  <CardDescription>
                    {membership.roles.join(", ")}
                  </CardDescription>
                </CardHeader>
              </button>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}