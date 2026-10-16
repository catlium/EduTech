// Route → read permission (Phase J) + the API reads that constitute the page's
// own load. Keys come straight from the backend catalogue; `manage` implies
// `read`. `role` is any role the page still requires ON TOP of the key — null
// means the permission alone decides (F5.6).
//
// F5.6/H-1+H-2: `/institute/academic` no longer demands INSTITUTE_ADMIN. The
// backend `GET /academic/academic-years|classes|divisions` routes ask for
// `academic-structure.read`, so a custom role holding that key reaches the
// console; the teacher roster the same page also loads stays `users.read` and is
// enforced per fetch, not by the route — which is why `/users` is NOT one of the
// academic console's primary reads and a 403 on it must not blank the page.
export interface RouteGate {
  prefix: string;
  key: string;
  role: 'teacher' | 'admin' | null;
  load: readonly string[];
}

export const WORKSPACE_ROUTES: readonly RouteGate[] = [
  // Placed before /institute so the more specific prefix wins the match.
  {
    prefix: '/institute/academic',
    key: 'academic-structure.read',
    role: null,
    load: ['/academic/academic-years', '/academic/classes', '/academic/divisions'],
  },
  // Teaching workspace: still role-split (canManage), then the resource read key
  // so hidden/deep-linked surfaces meet the same decision the API applies.
  { prefix: '/subjects', key: 'subjects.read', role: 'teacher', load: ['/academic/subjects'] },
  { prefix: '/materials', key: 'materials.read', role: 'teacher', load: ['/materials'] },
  { prefix: '/content', key: 'content.read', role: 'teacher', load: ['/content'] },
  { prefix: '/questions', key: 'questions.read', role: 'teacher', load: ['/questions'] },
  { prefix: '/assessments', key: 'assessments.read', role: 'teacher', load: ['/assessments'] },
  {
    prefix: '/question-papers',
    key: 'question-papers.read',
    role: 'teacher',
    load: ['/question-papers'],
  },
  {
    prefix: '/paper-patterns',
    key: 'paper-patterns.read',
    role: 'teacher',
    load: ['/paper-patterns'],
  },
  { prefix: '/syllabus', key: 'syllabus.read', role: 'teacher', load: ['/syllabus'] },
  { prefix: '/jobs', key: 'jobs.read', role: 'teacher', load: ['/jobs'] },
  // F5.8/X-7: practice is a self-scoped surface on the SHARED nav — STUDENT and
  // TEACHER both hold all three practice keys, so `role: null` lets the key alone
  // decide. Without an entry here the layout gated nothing and /practice was
  // reachable by anyone with any institute membership.
  { prefix: '/practice', key: 'practice.read', role: null, load: ['/practice/sessions'] },
  // Institute console: the roster itself is `users.read` and stays admin-gated.
  { prefix: '/institute', key: 'users.read', role: 'admin', load: ['/users'] },
  { prefix: '/users', key: 'users.read', role: 'admin', load: ['/users'] },
  // ocr-workers.* is platform-plane (D3/§15): no institute membership can hold
  // it, so the route is unreachable here by design (Super Admin UI is Phase K+).
  { prefix: '/ocr/workers', key: 'ocr-workers.read', role: 'admin', load: ['/ocr/workers'] },
];

/** Longest-prefix match, on `/` boundaries only, so `/subjectsx` never matches. */
export function workspaceRoute(pathname: string): RouteGate | undefined {
  return WORKSPACE_ROUTES.find(
    (entry) => pathname === entry.prefix || pathname.startsWith(entry.prefix + '/'),
  );
}
