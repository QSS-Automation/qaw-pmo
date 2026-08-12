import { useQuery } from '@tanstack/react-query'
import { getMyPermissions } from '../api'

/**
 * The current logged-in resource's own can_view/can_edit for every feature
 * in the Permissions page's matrix, keyed by feature_key (e.g.
 * "budget.utilization"). Powers frontend gating for dashboard sections that
 * have no dedicated backend endpoint to enforce this server-side — unlike
 * Plan & Actual / Schedule, which are enforced directly in the backend via
 * can_view_plan_actual / can_view_schedule (see app/auth.py).
 *
 * Not logged in, or a role with no seeded row, both correctly resolve to
 * closed (false/false) via the backend's own fail-closed behavior — this
 * hook doesn't need its own separate fallback logic for that.
 */
export function useMyPermissions() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-permissions'],
    queryFn: getMyPermissions,
    staleTime: 60_000,
  })

  const canView = (featureKey: string): boolean => data?.[featureKey]?.can_view ?? false
  const canEdit = (featureKey: string): boolean => data?.[featureKey]?.can_edit ?? false

  return { permissions: data, isLoading, canView, canEdit }
}
