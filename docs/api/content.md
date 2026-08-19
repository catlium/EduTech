# Content API

Base URL: `/api/v1/content`

The content API manages the generic content domain: a `content_items` row
holds metadata, and every meaningful change creates a new immutable row in
`content_versions`. A content item therefore always points at its current
version and keeps full history.

All endpoints require an authenticated session cookie (`access_token`) and the
`x-institute-id` header. Reads are available to any member of the institute;
writes require the `INSTITUTE_ADMIN` or `TEACHER` role.

Response wrapping follows the platform convention: `{ content }`,
`{ contents }`, `{ versions }`, `{ version }`.

Errors follow the global format:

```json
{ "statusCode": 404, "message": "Content not found", "error": "Not Found" }
```

## Entities

### Content item

```json
{
  "id": "uuid",
  "instituteId": "uuid",
  "subjectId": "uuid | null",
  "chapterId": "uuid | null",
  "topicId": "uuid | null",
  "type": "NOTE | FLASHCARD_SET | CORNELL_NOTE",
  "title": "string",
  "status": "DRAFT | ACTIVE | ARCHIVED",
  "source": "MANUAL | AI_GENERATED | OCR_EXTRACTED | IMPORTED",
  "currentVersion": 1,
  "createdBy": "uuid",
  "updatedBy": "uuid | null",
  "createdAt": "iso8601",
  "updatedAt": "iso8601"
}
```

**Academic attachment:** exactly one of `subjectId`, `chapterId`, `topicId`
must be set. The database enforces this with a CHECK constraint. A content item
is never duplicated or inherited; aggregation across the hierarchy is done via
queries.

### Content version

```json
{
  "id": "uuid",
  "contentId": "uuid",
  "version": 1,
  "payload": {},
  "renderedHtml": "string | null",
  "aiContext": "{} | null",
  "sourceReference": "{} | null",
  "changeType": "CREATION | EDIT | REGENERATION | CORRECTION",
  "changeReason": "string | null",
  "createdBy": "uuid",
  "createdAt": "iso8601"
}
```

`payload` is the **canonical structured JSON** representation of the study
content and is validated against a type-specific schema on create and update.
`renderedHtml` (if provided) is optional derived/rendering output — never the
source of truth.

### Payload contracts

`payload` must match the schema for the content item's `type`. A payload for
one type is rejected for another. The Zod schemas in `@catlium/contracts`
(`NotePayloadSchema`, `FlashcardSetPayloadSchema`,
`CornellNotePayloadSchema`) are canonical.

#### NOTE

```json
{
  "title": "optional",
  "blocks": [
    { "id": "b1", "type": "heading", "content": "..." },
    { "id": "b2", "type": "paragraph", "content": "..." },
    { "id": "b3", "type": "list", "items": ["...", "..."] }
  ]
}
```

`blocks` requires at least one block. Block `type` is one of `heading`,
`paragraph`, `list` and is extensible for future block types.

#### FLASHCARD_SET

```json
{
  "title": "optional",
  "description": "optional",
  "cards": [
    { "id": "c1", "front": "...", "back": "..." }
  ]
}
```

`cards` requires at least one card. Each card has an `id`, `front`, and `back`.

#### CORNELL_NOTE

```json
{
  "title": "optional",
  "sections": [
    { "id": "s1", "cue": "...", "notes": "..." }
  ],
  "summary": "optional"
}
```

`sections` requires at least one section; each has an `id`, `cue`, and `notes`.
`summary` is optional.

## Current version strategy

The current version is tracked on `content_items.current_version` as an integer
(the monotonic version number). `content_versions` rows are append-only (never
deleted), so the pointer cannot dangle. This avoids a circular foreign key
between `content_items` and `content_versions`.

## Create content

```
POST /content
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `201`. Creates the content item
with its first version (`current_version = 1`, `changeType: CREATION`).

Body:

```json
{
  "title": "Algebra — Linear Equations",
  "type": "NOTE",
  "source": "MANUAL",
  "topicId": "uuid",
  "payload": { "blocks": [{ "type": "paragraph", "text": "..." }] },
  "changeReason": "Initial version"
}
```

`400` if zero or more than one academic scope is provided, if the payload is
not an object, or if the payload does not match the schema for the given
`type` (e.g. a flashcard payload submitted with `type: "NOTE"`). `404` if the
referenced academic scope is not in the active institute.

Response: `{ "content": ContentItem + currentVersion }`

## List content

```
GET /content?type=NOTE&status=ACTIVE&subjectId=uuid&chapterId=uuid&topicId=uuid
```

All query parameters are optional. When present they are applied as filters.
Lists are ordered by `updatedAt` descending. Returns metadata only (no version
payloads).

Response: `{ "contents": ContentItem[] }`

## Get content (with current version)

```
GET /content/:contentId
```

Returns the content item plus its current version as the `current` object.
`404` if not in the active institute.

Response: `{ "content": ContentItem + currentVersion }`

## Update content (creates a new version)

```
PATCH /content/:contentId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Appends a new version rather than
overwriting the previous one. The new version number is
`current_version + 1`; the pointer advances. Concurrent updates are serialized
via a row lock on the content item, and the unique `(content_id, version)`
constraint is the backstop — two simultaneous updates cannot produce the same
version number.

Body:

```json
{
  "payload": { "blocks": [{ "type": "paragraph", "text": "corrected" }] },
  "changeType": "CORRECTION",
  "changeReason": "Fix arithmetic error"
}
```

`changeType` defaults to `EDIT`. The new `payload` must match the schema for
the item's `type` (the type is fixed at creation and cannot change). `400` if
the payload is not an object or fails the type-specific schema. `404` if not
found.

Response: `{ "content": ContentItem + currentVersion }`

## Version history

```
GET /content/:contentId/versions
```

Returns all versions for the item ordered by `version` descending (newest
first).

Response: `{ "versions": ContentVersion[] }`

## Get specific version

```
GET /content/:contentId/versions/:version
```

`404` if the item or version does not exist.

Response: `{ "version": ContentVersion }`

## Archive content

```
POST /content/:contentId/archive
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Sets status to `ARCHIVED`. Does not create
a new version.

Response: `{ "content": ContentItem }`

## Activate content

```
POST /content/:contentId/activate
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Sets status to `ACTIVE` (e.g. publish a
DRAFT or restore an archived item). Does not create a new version.

Response: `{ "content": ContentItem }`
