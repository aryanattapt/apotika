import * as shared from '../../../../shared/api'
import { pool, transaction } from '../../../../infrastructure/database/client'
import { recordAudit as audit } from '../../../platform'
import type { AuthenticatedRouteContext } from '../../../../shared/http/route-context'
import { canTransitionOrder, insertOrderStatusHistory } from '../../../orders'
const { apiError, body, hasRole, json, pharmacyScope, requireRole, validUuid } = shared

export async function handleSupportRoutes({ request, url, path, method, requestId, user, currentUser }: AuthenticatedRouteContext): Promise<Response | null> {
  const cancellationMatch=path.match(/^\/orders\/([0-9a-f-]+)\/cancellation-requests$/i)
  if(cancellationMatch&&method==='POST'){
    const input=await body<any>(request)
    const reason=String(input.reason??'').trim()
    if(reason.length<3||reason.length>500) apiError(400,'INVALID_REASON','Alasan pembatalan wajib diisi.')
    const result=await transaction(async(client)=>{
      const order=await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[cancellationMatch[1]])
      if(!order.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
      if(order.rows[0].customer_id!==currentUser.id&&!hasRole(currentUser,'cs','admin')) apiError(403,'FORBIDDEN','Tidak dapat meminta pembatalan pesanan ini.')
      if(!['awaiting_prescription','awaiting_payment','paid','processing','ready'].includes(order.rows[0].status)) apiError(409,'CANCELLATION_NOT_ALLOWED','Pesanan sudah diserahkan atau berakhir. Buat kasus bantuan.')
      const existing=await client.query("SELECT id,status FROM cancellation_requests WHERE order_id=$1 AND status='requested'",[cancellationMatch[1]])
      if(existing.rowCount)return existing.rows[0]
      const saved=await client.query("INSERT INTO cancellation_requests(order_id,requested_by,reason) VALUES($1,$2,$3) RETURNING id,status",[cancellationMatch[1],currentUser.id,reason])
      await audit(client,currentUser.id,'cancellation.requested','order',cancellationMatch[1],{requestId:saved.rows[0].id})
      return saved.rows[0]
    })
    return json(result,201)
  }
  const cancellationDecision=path.match(/^\/cancellation-requests\/([0-9a-f-]+)\/decision$/i)
  if(cancellationDecision&&method==='POST'){
    requireRole(currentUser,'cs','admin')
    const input=await body<any>(request)
    const result=await transaction(async(client)=>{
      const req=await client.query('SELECT cr.*,o.status AS order_status,o.pharmacy_id FROM cancellation_requests cr JOIN orders o ON o.id=cr.order_id WHERE cr.id=$1 FOR UPDATE OF cr,o',[cancellationDecision[1]])
      if(!req.rowCount) apiError(404,'NOT_FOUND','Permintaan pembatalan tidak ditemukan.')
      if(req.rows[0].status!=='requested') apiError(409,'ALREADY_DECIDED','Permintaan pembatalan sudah diputuskan.')
      const approve=input.decision==='approved'
      if(!approve&&input.decision!=='rejected') apiError(400,'INVALID_DECISION','Keputusan tidak valid.')
      if(approve&&!canTransitionOrder(req.rows[0].order_status,'cancelled')) apiError(409,'CANCELLATION_NOT_ALLOWED','Pesanan sudah diserahkan atau berakhir.')
      const next=approve?'approved':'rejected'
      await client.query('UPDATE cancellation_requests SET status=$2,decided_by=$3,decision_reason=$4,decided_at=now() WHERE id=$1',[cancellationDecision[1],next,currentUser.id,String(input.reason??'').slice(0,500)||null])
      if(approve){
        const orderId=req.rows[0].order_id
        const active=await client.query("SELECT * FROM stock_reservations WHERE order_id=$1 AND status='active' FOR UPDATE",[orderId])
        for(const r of active.rows){
          await client.query("UPDATE stock_reservations SET status='released' WHERE id=$1",[r.id])
          await client.query('UPDATE inventory SET reserved=reserved-$3,updated_at=now() WHERE pharmacy_id=$1 AND product_id=$2',[r.pharmacy_id,r.product_id,r.quantity])
        }
        await client.query("UPDATE orders SET status='cancelled',updated_at=now() WHERE id=$1",[orderId])
        await insertOrderStatusHistory(client,orderId,req.rows[0].order_status,'cancelled',currentUser.id,'Pembatalan disetujui')
        if(['paid','processing','ready'].includes(req.rows[0].order_status)) await client.query("INSERT INTO support_cases(order_id,opened_by,category,description) SELECT $1,$2,'refund','Pembatalan disetujui; proses refund perlu ditangani finance.'",[orderId,currentUser.id])
      }
      await audit(client,currentUser.id,'cancellation.decided','cancellation_request',cancellationDecision[1],{decision:next})
      return {id:cancellationDecision[1],status:next}
    })
    return json(result)
  }

  const casesMatch=path.match(/^\/orders\/([0-9a-f-]+)\/support-cases$/i)
  if(casesMatch&&method==='GET'){
    const order=await pool.query('SELECT customer_id,pharmacy_id FROM orders WHERE id=$1',[casesMatch[1]])
    if(!order.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
    if(order.rows[0].customer_id!==currentUser.id&&!hasRole(currentUser,'cs','finance','admin')) pharmacyScope(currentUser,order.rows[0].pharmacy_id)
    const result=await pool.query('SELECT id,category,status,description,created_at,updated_at FROM support_cases WHERE order_id=$1 ORDER BY created_at DESC',[casesMatch[1]])
    return json({items:result.rows})
  }
  if(casesMatch&&method==='POST'){
    const input=await body<any>(request)
    const description=String(input.description??'').trim()
    const category=String(input.category??'other').slice(0,50)
    if(description.length<4||description.length>2000) apiError(400,'INVALID_CASE','Jelaskan kendala dengan singkat.')
    const saved=await transaction(async(client)=>{
      const order=await client.query('SELECT customer_id FROM orders WHERE id=$1',[casesMatch[1]])
      if(!order.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
      if(order.rows[0].customer_id!==currentUser.id&&!hasRole(currentUser,'cs','finance','admin')) apiError(403,'FORBIDDEN','Tidak dapat membuka kasus untuk pesanan ini.')
      const result=await client.query('INSERT INTO support_cases(order_id,opened_by,category,description) VALUES($1,$2,$3,$4) RETURNING id,status,created_at',[casesMatch[1],currentUser.id,category,description])
      await audit(client,currentUser.id,'support.opened','support_case',result.rows[0].id,{orderId:casesMatch[1]})
      return result.rows[0]
    })
    return json(saved,201)
  }
  const caseMatch=path.match(/^\/support-cases\/([0-9a-f-]+)$/i)
  if(caseMatch&&method==='PATCH'){
    requireRole(currentUser,'cs','finance','admin')
    const input=await body<any>(request)
    if(!['open','in_progress','closed'].includes(input.status)) apiError(400,'INVALID_STATUS','Status kasus tidak valid.')
    const assignedTo=input.assignedTo&&validUuid(String(input.assignedTo))?String(input.assignedTo):currentUser.id
    const saved=await transaction(async(client)=>{
      const assignee=await client.query("SELECT 1 FROM user_roles WHERE user_id=$1 AND role IN ('admin','cs','finance') LIMIT 1",[assignedTo])
      if(!assignee.rowCount)apiError(400,'INVALID_ASSIGNEE','Penanggung jawab harus akun operasional.')
      const result=await client.query('UPDATE support_cases SET status=$2,assigned_to=$3,updated_at=now() WHERE id=$1 RETURNING id,status,updated_at',[caseMatch[1],input.status,assignedTo])
      if(!result.rowCount) apiError(404,'NOT_FOUND','Kasus bantuan tidak ditemukan.')
      await audit(client,currentUser.id,'support.updated','support_case',caseMatch[1],{status:input.status,assignedTo})
      return result.rows[0]
    })
    return json(saved)
  }


  return null
}
