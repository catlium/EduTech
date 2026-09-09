"use client";

import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";

import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function InstituteSwitcher() {
  const { memberships } = useAuth();
  const { institute, selectInstitute } = useTenant();

  if (!institute) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 w-full justify-between gap-2 px-2 font-normal"
          aria-label="Switch institute"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
              <Building2 className="size-3" />
            </span>
            <span className="truncate text-sm font-medium">{institute.instituteName}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Switch institute
        </DropdownMenuLabel>
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.instituteId}
            onClick={() => selectInstitute(m)}
            disabled={m.instituteId === institute.instituteId}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{m.instituteName}</span>
            </span>
            {m.instituteId === institute.instituteId && (
              <Check className="size-3.5 shrink-0 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/institutes">
            <Plus className="mr-2 size-3.5" /> Browse all institutes
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}