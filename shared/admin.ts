import { z } from 'zod';
import {
  canConfigure,
  canManageUsers,
  canViewAdmin,
  effectiveMembership,
  type Hospital,
  type Membership,
  type Profile,
  type Role,
} from './domain.ts';

export const assignableRoles = [
  'super_user',
  'major_write',
  'major_read',
  'system_admin_write',
  'system_admin_read',
  'doctor',
  'nurse',
  'clerk',
] as const;
const id = z.string().regex(/^[\w-]{1,100}$/);
const name = z.string().trim().min(2).max(160);
const membership = z
  .object({
    hospitalId: id,
    role: z.enum(assignableRoles).exclude(['super_user']),
    departments: z
      .array(z.union([id, z.literal('*')]))
      .min(1)
      .max(100),
  })
  .strict();
const grants = { superUser: z.boolean().default(false), memberships: z.array(membership).max(50) };
const base = { id: z.string().uuid() };
export const adminOperationSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...base,
      type: z.literal('hospital'),
      data: z.object({ hospitalId: id, name, city: name, province: name, district: name }).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('department'),
      data: z
        .object({ hospitalId: id, departmentId: id, name, version: z.number().int().positive() })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('theatre'),
      data: z.object({ hospitalId: id, name, version: z.number().int().positive() }).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('user-create'),
      data: z.object({ name, email: z.email().trim().toLowerCase(), ...grants }).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('user-access'),
      data: z
        .object({
          email: z.email().trim().toLowerCase(),
          version: z.number().int().nonnegative(),
          ...grants,
          removeHospitalId: id.optional(),
        })
        .strict(),
    })
    .strict(),
]);
export type AdminOperation = z.infer<typeof adminOperationSchema>;
export type AdminResult = {
  id: string;
  acceptedAt: string;
  setupLink?: string;
  replayed?: boolean;
};
export type AdminUser = Pick<Profile, 'uid' | 'name' | 'email' | 'memberships'> & {
  version: number;
  superUser: boolean;
};
export type AdminWorkspace = { profile: Profile; hospitals: Hospital[]; users: AdminUser[] };
export const canAdmin = (p: Profile) =>
  p.active && (p.superUser || p.memberships.some((m) => canViewAdmin(m.role)));
export function allowedRoles(actor: Role): readonly Role[] {
  if (actor === 'super_user') return assignableRoles;
  if (actor === 'major_write') return assignableRoles.filter((r) => r !== 'super_user');
  if (actor === 'system_admin_write')
    return ['system_admin_write', 'system_admin_read', 'doctor', 'nurse', 'clerk'];
  if (actor === 'doctor' || actor === 'clinician') return ['doctor', 'nurse', 'clerk'];
  return [];
}
export function grantWithinScope(actor: Profile, grant: Membership, hospital: Hospital) {
  const source = effectiveMembership(actor, hospital);
  if (!source || !canManageUsers(source.role) || !allowedRoles(source.role).includes(grant.role))
    return false;
  if (!grant.departments.length || new Set(grant.departments).size !== grant.departments.length)
    return false;
  if (grant.departments.includes('*'))
    return (
      grant.departments.length === 1 &&
      ['major_write', 'major_read', 'system_admin_write', 'system_admin_read'].includes(
        grant.role,
      ) &&
      canConfigure(source.role) &&
      (actor.superUser ||
        actor.memberships.some((m) => m.hospitalId === hospital.id && m.departments.includes('*')))
    );
  // System admins always cover one entire hospital, including departments added later.
  if (grant.role.startsWith('system_admin')) return false;
  return grant.departments.every(
    (d) => source.departments.includes(d) && hospital.departments.some((x) => x.id === d),
  );
}
export function visibleMemberships(
  actor: Profile,
  target: Profile,
  hospitals: Hospital[],
): Membership[] {
  return hospitals.flatMap((h) => {
    const scope = effectiveMembership(actor, h),
      grant = effectiveMembership(target, h);
    if (!scope || !canViewAdmin(scope.role) || !grant) return [];
    const departments = grant.departments.filter((d) => scope.departments.includes(d));
    if (!departments.length && h.departments.length) return [];
    // Preserve all-department grants only when the viewer really sees the whole hospital.
    const raw = target.memberships.find((m) => m.hospitalId === h.id);
    return [
      {
        ...grant,
        departments:
          raw?.departments.includes('*') &&
          h.departments.every((d) => scope.departments.includes(d.id))
            ? ['*']
            : departments,
      },
    ];
  });
}
