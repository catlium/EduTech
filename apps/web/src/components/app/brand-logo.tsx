import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600 text-white shadow-sm",
        className,
      )}
    >
      <GraduationCap className="size-4.5" />
    </span>
  );
}

export function BrandLogo({
  instituteName,
  className,
  href = "/dashboard",
}: {
  instituteName?: string;
  className?: string;
  href?: string;
}) {
  return (
    <Link href={href} className={cn("flex items-center gap-3", className)}>
      <BrandMark />
      <span className="grid flex-1 text-left leading-tight">
        <span className="truncate text-sm font-semibold tracking-tight">
          {instituteName ?? "CatLium EduTech"}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">Institute workspace</span>
      </span>
    </Link>
  );
}