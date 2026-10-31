type Queryable = { query: (...args: any[]) => Promise<any> }

export async function insertOrderStatusHistory(client: Queryable, orderId: string, from: string | null, to: string, actorId: string | null, reason: string | null = null) {
  await client.query(
    'INSERT INTO order_status_history(order_id,from_status,to_status,actor_id,reason) VALUES($1,$2,$3,$4,$5)',
    [orderId, from, to, actorId, reason],
  )
}
