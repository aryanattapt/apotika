import { localServiceTime } from '../domain/service-hours'

type Queryable = { query: (...args: any[]) => Promise<any> }

/** Adapter that answers the pharmacy availability policy from PostgreSQL schedules. */
export async function prescriptionServiceOpen(client: Queryable, pharmacyId: string, instant = new Date()) {
  const schedules = await client.query(`SELECT weekday, opens_at::text, closes_at::text, timezone FROM pharmacy_service_hours
    WHERE pharmacy_id=$1 AND service_type='prescription' AND active=true`, [pharmacyId])
  for (const schedule of schedules.rows) {
    const local = localServiceTime(schedule.timezone, instant)
    if (!local) continue
    const exceptions = await client.query(`SELECT closed,opens_at::text,closes_at::text FROM pharmacy_service_exceptions
      WHERE pharmacy_id=$1 AND service_type='prescription' AND local_date=$2`, [pharmacyId, local.date])
    const exception = exceptions.rows[0]
    if (exception?.closed) continue
    const opensAt = exception?.opens_at ?? schedule.opens_at
    const closesAt = exception?.closes_at ?? schedule.closes_at
    const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
    if (Number(schedule.weekday) === local.weekday && local.minute >= toMinutes(opensAt) && local.minute < toMinutes(closesAt)) return true
  }
  return false
}
