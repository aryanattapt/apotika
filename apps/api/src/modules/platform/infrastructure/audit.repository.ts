type Queryable = { query: (...args: any[]) => Promise<any> }

export async function insertAuditEvent(
  client: Queryable,
  actorId: string | null,
  action: string,
  type: string,
  id: string | null,
  metadata: Record<string, unknown> = {},
) {
  await client.query(
    'INSERT INTO audit_log(actor_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)',
    [actorId, action, type, id, metadata],
  )
}
