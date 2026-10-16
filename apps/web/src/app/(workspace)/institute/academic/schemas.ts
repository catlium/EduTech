import { z } from 'zod';

const name = z.string().trim().min(1, 'Name is required').max(255);
const sortOrder = z
  .string()
  .regex(/^\d*$/, 'Must be a whole number')
  .optional();
const status = z.enum(['active', 'archived']);

export const namedStructureSchema = z.object({ name, sortOrder, status });
export type NamedStructureValues = z.infer<typeof namedStructureSchema>;
export type NamedStructureInput = {
  name: string;
  sortOrder?: number;
  status?: 'active' | 'archived';
};

/** Empty-string sortOrder sends `undefined` to the backend (DB default 0). */
export function intOrUndefined(value: string | undefined): number | undefined {
  return value === '' || value === undefined ? undefined : Number(value);
}

export const divisionCreateSchema = z.object({
  name,
  sortOrder,
  academicYearId: z.string().uuid('Select an academic year'),
  classId: z.string().uuid('Select a class'),
});
export type DivisionCreateValues = z.infer<typeof divisionCreateSchema>;

export const divisionEditSchema = z.object({ name, sortOrder });
export type DivisionEditValues = z.infer<typeof divisionEditSchema>;