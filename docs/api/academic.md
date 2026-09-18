# Academic API

Base URL: `/api/v1/academic`

The academic hierarchy is a three-level tenant-scoped structure:

```
Subject → Chapter → Topic
```

All endpoints require an authenticated session cookie (`access_token`) and the
`x-institute-id` header identifying the active institute. Reads are available to
any member of the institute; writes require the `INSTITUTE_ADMIN` or `TEACHER`
role.

Response wrapping follows the platform convention: a single resource is returned
as `{ subject }` / `{ chapter }` / `{ topic }`; collections as
`{ subjects }` / `{ chapters }` / `{ topics }`.

Errors follow the global format:

```json
{ "statusCode": 409, "message": "A subject with this slug already exists", "error": "Conflict" }
```

## Entities

All three entities share these fields: `id` (uuid), `name`, `slug` (unique within
the parent scope), `description` (nullable), `sortOrder` (int, default `0`),
`status` (`active` | `archived`), `createdAt`, `updatedAt`.

- **Subject** belongs to an institute: `instituteId`. Slug unique per institute.
- **Chapter** belongs to a subject: `subjectId`. Slug unique per subject.
- **Topic** belongs to a chapter: `chapterId`. Slug unique per chapter.

Deleting a parent cascades to its children (DB-level `ON DELETE CASCADE`).

Slugs must be kebab-case: `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`.

## Subjects

### List subjects

```
GET /academic/subjects
```

Returns all subjects of the active institute, ordered by `sortOrder`, then `name`.

Response: `{ "subjects": Subject[] }`

### Get subject

```
GET /academic/subjects/:subjectId
```

`404` if the subject does not exist in the active institute.

Response: `{ "subject": Subject }`

### Create subject

```
POST /academic/subjects
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `201`.

Body:

```json
{ "name": "Mathematics", "slug": "mathematics", "description": "Core math", "sortOrder": 1 }
```

`409` if the slug already exists in the institute.

Response: `{ "subject": Subject }`

### Update subject

```
PATCH /academic/subjects/:subjectId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. All fields optional.

```json
{ "name": "Advanced Mathematics", "status": "archived" }
```

`409` on slug collision. `404` if not found in the institute.

Response: `{ "subject": Subject }`

### Soft-delete subject (whole tree)

```
DELETE /academic/subjects/:subjectId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`.

Soft-deletes the subject **and its whole tree** — chapters, topics, questions,
materials, content items, and syllabi become `deletedAt`-stamped and are
hidden from all queries and scope resolution. This is **reversible**: restore
(`POST /academic/subjects/:subjectId/restore`) brings back the entire tree.

The `force` flag was removed; deletion no longer takes a query parameter.

Response: `204` on success.

Also bear in mind any question papers scoped to a General paper pattern remain
independent: they retain their data and are not deleted with the subject.

### List deleted subjects

```
GET /academic/subjects/deleted
```

Returns only subjects that are soft-deleted (`deletedAt` set), ordered by
`deletedAt` descending (most recently deleted first), for the active institute.

Response: `{ "subjects": Subject[] }`

### Restore subject (whole tree)

```
POST /academic/subjects/:subjectId/restore
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`.

Clears `deletedAt` on the subject and restores its whole tree (chapters,
topics, questions, materials, content items, syllabi) in one transaction.
`404` if the subject is not found or is not soft-deleted.

Response: `{ "restored": true }`

## Chapters

### List chapters of a subject

```
GET /academic/subjects/:subjectId/chapters
```

`404` if the subject is not in the active institute.

Response: `{ "chapters": Chapter[] }`

### Get chapter

```
GET /academic/chapters/:chapterId
```

`404` if the chapter is not in the active institute (scoped through its subject).

Response: `{ "chapter": Chapter }`

### Create chapter

```
POST /academic/subjects/:subjectId/chapters
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `201`. `404` if the subject is not
in the active institute. `409` if the slug already exists within the subject.

Body:

```json
{ "name": "Algebra", "slug": "algebra", "sortOrder": 1 }
```

Response: `{ "chapter": Chapter }`

### Update chapter

```
PATCH /academic/chapters/:chapterId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. All fields optional.

Response: `{ "chapter": Chapter }`

## Topics

### List topics of a chapter

```
GET /academic/chapters/:chapterId/topics
```

Response: `{ "topics": Topic[] }`

### Get topic

```
GET /academic/topics/:topicId
```

Response: `{ "topic": Topic }`

### Create topic

```
POST /academic/chapters/:chapterId/topics
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `201`. `409` if the slug already
exists within the chapter.

Body:

```json
{ "name": "Linear Equations", "slug": "linear-equations" }
```

Response: `{ "topic": Topic }`

### Update topic

```
PATCH /academic/topics/:topicId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. All fields optional.

Response: `{ "topic": Topic }`
