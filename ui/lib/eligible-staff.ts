// appointments#281 — who performs a service, the rule every professional picker of the module
// shares: the agenda's create form and sheet (appointments#272/#279) and the series view.
//
// The read is the one the server judges with (`staff.services.eligible_for_service`, staff#9:
// `resolve_booking` / `resolve_professional`). The query itself stays a LITERAL in each component
// (ADR-0127: the interop contract finds it by static analysis): the component hands the call in.

/** A professional eligible for a service, with her own length for it when she has one. */
export interface EligibleProfessional {
  staff_id: string;
  custom_duration?: number | null;
}

function rows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === 'object' && Array.isArray((r as { rows?: T[] }).rows)) {
    return (r as { rows: T[] }).rows;
  }
  return [];
}

/** Reads who performs each service ONCE; a failed read is asked again on the next call, never
 *  remembered as the answer. */
export function eligibleReader(read: (serviceId: string) => Promise<unknown>): (serviceId: string) => Promise<EligibleProfessional[]> {
  const byService = new Map<string, Promise<EligibleProfessional[]>>();
  return (serviceId) => {
    let found = byService.get(serviceId);
    if (!found) {
      found = read(serviceId).then((r) => rows<EligibleProfessional>(r));
      byService.set(serviceId, found);
      found.catch(() => byService.delete(serviceId));
    }
    return found;
  };
}

/** The ids a picker narrows to. `null` = the whole team: a service without declared competencies
 *  has not been narrowed by the hub, and the server accepts anyone for it. */
export function eligibleIds(eligible: EligibleProfessional[]): string[] | null {
  return eligible.length ? eligible.map((p) => String(p.staff_id)) : null;
}

/** The team members a picker offers for `ids` (see `eligibleIds`), in the team's order. */
export function offeredStaff<T extends { id: string }>(team: T[], ids: string[] | null): T[] {
  return ids ? team.filter((m) => ids.includes(m.id)) : team;
}
