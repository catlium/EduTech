import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Award,
  BookOpen,
  Building2,
  CheckCircle2,
  ClipboardList,
  FileText,
  GraduationCap,
  HelpCircle,
  Layers,
  LineChart,
  PenLine,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Target,
  Upload,
  Users,
} from 'lucide-react';

import { LandingHeader } from '@/components/landing/landing-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const navLinks = [
  { href: '#overview', label: 'Platform' },
  { href: '#teachers', label: 'Teachers' },
  { href: '#students', label: 'Students' },
  { href: '#patterns', label: 'Paper Patterns' },
  { href: '#workflow', label: 'Workflow' },
  { href: '#institutes', label: 'Institutes' },
];

const DEMO_HREF = 'mailto:hello@catlium.dev?subject=Request%20a%20demo%20of%20CatLium%20EduTech';

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-3 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      {description && <p className="text-muted-foreground">{description}</p>}
    </div>
  );
}

function FeatureCard({
  Icon: IconComponent,
  title,
  description,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <Card className="h-full transition-shadow hover:shadow-sm">
      <CardContent className="flex flex-col gap-2.5 p-5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <IconComponent className="size-4.5" />
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function CheckItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
      <span className="text-sm text-muted-foreground">{children}</span>
    </li>
  );
}

export const metadata = {
  title: 'AI-assisted learning and examination management for educational institutes',
  description:
    'CatLium EduTech helps institutes run academics, learning content, question banks, custom paper patterns, assessments, and automatic evaluation on one tenant-isolated platform.',
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <LandingHeader links={navLinks} ctaHref={DEMO_HREF} ctaLabel="Request a Demo" />

      {/* Hero */}
      <section id="home" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.12),transparent_55%)]"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
          <div className="mx-auto max-w-3xl space-y-8 text-center">
            <Badge variant="secondary" className="gap-1.5 py-1.5">
              <Sparkles className="size-3.5 text-primary" />
              AI-assisted learning & examination management
            </Badge>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
              Run your institute&apos;s academics, learning, and examinations on one platform.
            </h1>
            <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
              Centralized academic management, AI-assisted learning content, a shared question bank,
              custom paper patterns, student practice, examinations, and automatic evaluation —
              built for multi-tenant educational institutes.
            </p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <a href={DEMO_HREF}>
                  Request a Demo <ArrowRight className="ml-1.5 size-4" />
                </a>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#overview">Explore Platform</a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your institute administrator provisions teacher and student accounts.
            </p>
          </div>
        </div>
      </section>

      {/* Product overview */}
      <section id="overview" className="border-t bg-muted/30 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Platform overview"
            title="One workspace for the whole institute"
            description="Every institute gets its own controlled academic environment — administrators, teachers, and students each see the tools their role needs."
          />
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            <Card className="text-center">
              <CardContent className="flex flex-col items-center gap-2 p-6">
                <Building2 className="size-6 text-primary" />
                <h3 className="text-sm font-semibold">Institute Admin</h3>
                <p className="text-sm text-muted-foreground">
                  Creates and manages teacher and student accounts for the institute.
                </p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="flex flex-col items-center gap-2 p-6">
                <Users className="size-6 text-primary" />
                <h3 className="text-sm font-semibold">Teachers + Students</h3>
                <p className="text-sm text-muted-foreground">
                  Teachers build academics, content, and assessments. Students learn, practice, and
                  take exams.
                </p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="flex flex-col items-center gap-2 p-6">
                <Layers className="size-6 text-primary" />
                <h3 className="text-sm font-semibold">Subjects · Learning · Assessments</h3>
                <p className="text-sm text-muted-foreground">
                  Structure, content, questions, patterns, and results stay organized per institute.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              Icon={BookOpen}
              title="Academic structure"
              description="Subjects, chapters, and topics keep every material and question organized."
            />
            <FeatureCard
              Icon={FileText}
              title="Materials & OCR"
              description="Upload syllabi and learning material; extract text from documents and images."
            />
            <FeatureCard
              Icon={Sparkles}
              title="AI learning content"
              description="Turn existing material into notes, summaries, and flashcards — teachers review and publish."
            />
            <FeatureCard
              Icon={HelpCircle}
              title="Question bank"
              description="MCQ, true/false, and fill-in-the-blank questions with difficulty and topic tracking."
            />
            <FeatureCard
              Icon={ScrollText}
              title="Custom paper patterns"
              description="Design examination blueprints: sections, question types, marks, and difficulty mix."
            />
            <FeatureCard
              Icon={ClipboardList}
              title="Assessment builder"
              description="Build assessments from approved questions, schedule, publish, and activate."
            />
            <FeatureCard
              Icon={Target}
              title="Student practice"
              description="Flashcard and question drills per topic with progress and review."
            />
            <FeatureCard
              Icon={LineChart}
              title="Automatic evaluation"
              description="Exams are auto-graded with scores and per-question feedback for students."
            />
          </div>
        </div>
      </section>

      {/* Teacher experience */}
      <section id="teachers" className="py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div className="space-y-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              For teachers
            </p>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              From syllabus to graded exam, without leaving the workspace
            </h2>
            <p className="text-muted-foreground">
              Teachers organize their subjects, prepare materials, build a question bank, design
              paper patterns, and publish assessments — all against real, approved data.
            </p>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              <CheckItem>Manage subjects, chapters, and topics</CheckItem>
              <CheckItem>Upload syllabi and learning material</CheckItem>
              <CheckItem>Extract text from documents & images</CheckItem>
              <CheckItem>Generate and review AI learning content</CheckItem>
              <CheckItem>Build a shared question bank with approvals</CheckItem>
              <CheckItem>Design custom paper patterns</CheckItem>
              <CheckItem>Publish schedules and activate assessments</CheckItem>
              <CheckItem>Review results after automatic grading</CheckItem>
            </ul>
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link href="/login">Open the workspace</Link>
              </Button>
            </div>
          </div>
          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Paper Pattern — Term Blueprint</p>
                <Badge>APPROVED</Badge>
              </div>
              {[
                { name: 'Section A — MCQ', detail: '10 questions · 1 mark' },
                { name: 'Section B — Fill in the Blank', detail: '5 questions · 2 marks' },
                { name: 'Section C — True / False', detail: '5 questions · 1 mark' },
              ].map((row) => (
                <div
                  key={row.name}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                >
                  <span className="text-sm font-medium">{row.name}</span>
                  <span className="text-xs text-muted-foreground">{row.detail}</span>
                </div>
              ))}
              <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                <span className="text-sm font-semibold">Total</span>
                <span className="text-sm font-semibold">20 questions · 25 marks · 45 min</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Student experience */}
      <section id="students" className="border-t bg-muted/30 py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <Card className="lg:order-1">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Exam attempt — End of Term Quiz</p>
                <Badge variant="secondary">IN_PROGRESS</Badge>
              </div>
              {[
                { q: '1', t: 'What is the solution of 2x + 3 = 7?' },
                { q: '2', t: 'The sum of interior angles of a triangle is 180°.' },
                { q: '3', t: 'Write 0.5 as a fraction in simplest form.' },
              ].map((row) => (
                <div key={row.q} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {row.q}
                  </span>
                  <span className="text-sm">{row.t}</span>
                </div>
              ))}
              <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                <span className="text-sm font-semibold">Automatic evaluation</span>
                <span className="text-sm font-semibold text-primary">Score 12 / 12</span>
              </div>
            </CardContent>
          </Card>
          <div className="space-y-5 lg:order-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              For students
            </p>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Learn, practice, and sit real examinations
            </h2>
            <p className="text-muted-foreground">
              Students get a learning dashboard with subjects, chapters, and topics, AI-prepared
              study notes and flashcards, focused practice drills, and exam attempts with automatic
              results.
            </p>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              <CheckItem>Personal learning dashboard</CheckItem>
              <CheckItem>Subject → chapter → topic navigation</CheckItem>
              <CheckItem>Study notes, summaries & concepts</CheckItem>
              <CheckItem>Flip-card flashcard drills</CheckItem>
              <CheckItem>Question practice with instant review</CheckItem>
              <CheckItem>Available assessments and attempts</CheckItem>
              <CheckItem>Auto-saved answers during exams</CheckItem>
              <CheckItem>Instant score + per-question feedback</CheckItem>
            </ul>
          </div>
        </div>
      </section>

      {/* Paper patterns */}
      <section id="patterns" className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Custom paper patterns"
            title="Design any paper, the way your board requires"
            description="Teachers construct the exact blueprint they need — sections, question types, mark distribution, difficulty mix, and topic coverage — and analyse a document to seed the structure automatically."
          />
          <div className="mx-auto mt-12 grid max-w-3xl gap-4 sm:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-3">
              {[
                { name: 'Section A', detail: '10 × MCQ' },
                { name: 'Section B', detail: '5 × Fill in the Blank' },
                { name: 'Section C', detail: '5 × True / False' },
              ].map((row) => (
                <div
                  key={row.name}
                  className="flex items-center justify-between rounded-xl border px-4 py-3"
                >
                  <span className="text-sm font-medium">{row.name}</span>
                  <span className="text-xs text-muted-foreground">{row.detail}</span>
                </div>
              ))}
            </div>
            <div className="hidden items-center justify-center sm:flex">
              <ArrowRight className="size-5 text-muted-foreground" />
            </div>
            <Card>
              <CardContent className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
                <span className="text-3xl font-semibold tracking-tight">
                  20 Questions · 20 Marks
                </span>
                <span className="text-sm text-muted-foreground">
                  With compulsory sections, optional sections, and difficulty targets
                </span>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* AI */}
      <section id="ai" className="border-t bg-muted/30 py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div className="space-y-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              AI-assisted learning
            </p>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              AI as an assistant, not a replacement
            </h2>
            <p className="text-muted-foreground">
              Turn existing educational material into structured learning resources with AI
              assistance — summaries, study notes, flashcards, and concept breakdowns — while
              keeping teachers in control of review and publishing.
            </p>
            <ul className="grid gap-2.5">
              <CheckItem>Generate content from your own syllabus and materials</CheckItem>
              <CheckItem>Review, edit, and approve before anything goes live</CheckItem>
              <CheckItem>Publish only after a teacher confirms it&apos;s accurate</CheckItem>
              <CheckItem>Ask AI for questions tied to your subjects and topics</CheckItem>
            </ul>
          </div>
          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Flashcard set — Study Notes</p>
                <Badge variant="secondary">ACTIVE</Badge>
              </div>
              {[
                { front: 'What is a balanced equation?', back: 'Both sides equal in quantity.' },
                { front: 'Speed vs velocity', back: 'Velocity includes direction.' },
              ].map((card, i) => (
                <div key={i} className="rounded-lg border px-3 py-2">
                  <p className="text-sm font-medium">{card.front}</p>
                  <p className="text-xs text-muted-foreground">→ {card.back}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Examination workflow */}
      <section id="workflow" className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Examination workflow"
            title="From blueprint to result in one flow"
            description="Every exam follows the same controlled pipeline inside the workspace."
          />
          <div className="mt-12 grid gap-3 sm:grid-cols-4">
            {[
              { icon: PenLine, step: 'Create', note: 'Blueprint & draft assessment' },
              { icon: Target, step: 'Configure', note: 'Sections, marks & schedule' },
              { icon: CheckCircle2, step: 'Review', note: 'Validate structure & approve' },
              { icon: Upload, step: 'Publish', note: 'Share with students' },
              { icon: GraduationCap, step: 'Attempt', note: 'Students answer online' },
              { icon: LineChart, step: 'Evaluate', note: 'Automatic grading' },
              { icon: Award, step: 'Result', note: 'Scores & feedback' },
            ].map((item) => (
              <Card key={item.step}>
                <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <item.icon className="size-4.5" />
                  </span>
                  <span className="text-sm font-semibold">{item.step}</span>
                  <span className="text-xs text-muted-foreground">{item.note}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Institute management / tenant model */}
      <section id="institutes" className="border-t bg-muted/30 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Institute management"
            title="Each institute gets its own controlled academic environment"
            description="CatLium EduTech is a multi-tenant platform. Your institute's accounts, subjects, content, and results stay scoped to your organization — an institute administrator manages who belongs and what roles they hold."
          />
          <div className="mx-auto mt-12 flex max-w-3xl flex-col items-center gap-3 text-center">
            <div className="flex w-full flex-col items-center gap-2">
              <Card className="w-full max-w-sm">
                <CardContent className="flex flex-col items-center gap-1 p-5">
                  <Building2 className="size-5 text-primary" />
                  <p className="text-sm font-semibold">Institute Admin</p>
                  <p className="text-xs text-muted-foreground">
                    Creates teacher & student accounts
                  </p>
                </CardContent>
              </Card>
              <ArrowRight className="size-4 text-muted-foreground" />
              <div className="grid w-full gap-3 sm:grid-cols-2">
                <Card>
                  <CardContent className="flex flex-col items-center gap-1 p-5">
                    <Users className="size-5 text-primary" />
                    <p className="text-sm font-semibold">Teachers + Students</p>
                    <p className="text-xs text-muted-foreground">No public self-registration</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="flex flex-col items-center gap-1 p-5">
                    <ShieldCheck className="size-5 text-primary" />
                    <p className="text-sm font-semibold">Tenant isolation</p>
                    <p className="text-xs text-muted-foreground">
                      Every user&apos;s data scoped to their institute
                    </p>
                  </CardContent>
                </Card>
              </div>
              <ArrowRight className="size-4 text-muted-foreground" />
              <Card className="w-full max-w-sm">
                <CardContent className="flex flex-col items-center gap-1 p-5">
                  <Layers className="size-5 text-primary" />
                  <p className="text-sm font-semibold">
                    Subjects · Learning · Assessments · Results
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="cta" className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Card className="overflow-hidden">
            <CardContent className="flex flex-col items-center gap-6 p-10 text-center sm:p-14">
              <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
                Ready to bring your institute&apos;s learning and assessment workflows together?
              </h2>
              <p className="max-w-xl text-muted-foreground">
                CatLium EduTech runs on each institute&apos;s own tenant — your administrator
                provisions teachers and students, and the whole academic cycle happens in one place.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button size="lg" asChild>
                  <a href={DEMO_HREF}>
                    Request a Demo <ArrowRight className="ml-1.5 size-4" />
                  </a>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/login">Sign in to your workspace</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-center sm:flex-row sm:px-6 sm:text-left">
          <div className="flex items-center gap-2.5">
            <GraduationCap className="size-5 text-primary" />
            <span className="text-sm font-semibold">CatLium EduTech</span>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-4">
            <a href="#overview" className="text-sm text-muted-foreground hover:text-foreground">
              Platform
            </a>
            <a href="#institutes" className="text-sm text-muted-foreground hover:text-foreground">
              Institutes
            </a>
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          </nav>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} CatLium EduTech
          </p>
        </div>
      </footer>
    </div>
  );
}
