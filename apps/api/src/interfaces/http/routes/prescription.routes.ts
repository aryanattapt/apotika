import { randomUUID } from 'node:crypto'
import { mkdir, unlink } from 'node:fs/promises'
import { extname, join } from 'node:path'
import * as shared from '../../../shared/api'
import { pool, transaction } from '../../../infrastructure/database/client'
import type { AuthenticatedRouteContext } from './route-context'
const { UPLOAD_MAX_BYTES, addHistory, apiError, audit, body, csvSafeName, getOrder, hasRole, hash, json, limit, money, pharmacyScope, requireRole, validUuid } = shared

export async function handlePrescriptionRoutes({ request, url, path, method, requestId, user, currentUser }: AuthenticatedRouteContext): Promise<Response | null> {
  const uploadMatch = path.match(/^\/orders\/([0-9a-f-]+)\/prescriptions$/i)
  if (uploadMatch && method === 'POST') {
    limit(request, 'prescription-upload', 10)
    const orderId = uploadMatch[1]
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) apiError(400,'FILE_REQUIRED','Pilih foto atau PDF resep terlebih dahulu.')
    if (file.size < 1 || file.size > UPLOAD_MAX_BYTES) apiError(413,'FILE_TOO_LARGE','Ukuran berkas melebihi batas yang diizinkan.')
    const ext = extname(csvSafeName(file.name)).toLowerCase()
    const mimeAllowed = new Map([['image/jpeg','.jpg'],['image/png','.png'],['application/pdf','.pdf']])
    if (!mimeAllowed.has(file.type) || !['.jpg','.jpeg','.png','.pdf'].includes(ext)) apiError(400,'FILE_TYPE_NOT_ALLOWED','Format yang didukung: JPG, PNG, atau PDF.')
    const data = Buffer.from(await file.arrayBuffer())
    const detected = ext === '.pdf' ? data.subarray(0,5).toString() === '%PDF-' : ext === '.png' ? data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : data.subarray(0,3).equals(Buffer.from([255,216,255]))
    if (!detected) apiError(400,'INVALID_FILE','Isi berkas tidak sesuai dengan formatnya.')
    let savedFile: string | null = null
    try {
      const saved = await transaction(async (client) => {
        const orderResult = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[orderId])
        if (!orderResult.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
        const order = orderResult.rows[0]
        if (order.customer_id !== currentUser.id) apiError(403,'FORBIDDEN','Pesanan ini bukan milik Anda.')
        if (order.status !== 'awaiting_prescription') apiError(409,'REVIEW_LOCKED','Unggahan resep hanya dapat diubah sebelum tagihan dibuat.')
        const objectKey = `${orderId}/${randomUUID()}${mimeAllowed.get(file.type)}`
        const filePath = join(process.cwd(),'storage','prescriptions',objectKey)
        await mkdir(join(process.cwd(),'storage','prescriptions',orderId),{recursive:true})
        savedFile = filePath
        await Bun.write(filePath,data)
        const revision = Number(order.document_revision)+1
        const inserted = await client.query(`INSERT INTO prescriptions(order_id,uploaded_by,object_key,original_filename,mime_type,document_revision,document_sha256,status)
          VALUES($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING id,created_at`,[orderId,currentUser.id,objectKey,csvSafeName(file.name),file.type,revision,hash(data)])
        await client.query('UPDATE orders SET document_revision=$2,review_version=review_version+1,updated_at=now() WHERE id=$1',[orderId,revision])
        await audit(client,currentUser.id,'prescription.uploaded','prescription',inserted.rows[0].id,{revision})
        return { id:inserted.rows[0].id,revision,uploadedAt:inserted.rows[0].created_at }
      })
      return json(saved,201)
    } catch (error) {
      if (savedFile) await unlink(savedFile).catch(()=>{})
      throw error
    }
  }

  const fileMatch = path.match(/^\/prescriptions\/([0-9a-f-]+)\/file$/i)
  if (fileMatch && method === 'GET') {
    const result = await pool.query(`SELECT p.*,o.customer_id,o.pharmacy_id FROM prescriptions p JOIN orders o ON o.id=p.order_id WHERE p.id=$1`,[fileMatch[1]])
    if (!result.rowCount) apiError(404,'NOT_FOUND','Berkas tidak ditemukan.')
    const prescription = result.rows[0]
    if (prescription.customer_id !== currentUser.id) {
      if (!hasRole(currentUser,'pharmacist')) apiError(403,'FORBIDDEN','Akses berkas tidak diizinkan.')
      pharmacyScope(currentUser,prescription.pharmacy_id)
    }
    const filePath = join(process.cwd(),'storage','prescriptions',prescription.object_key)
    const file = Bun.file(filePath)
    if (!(await file.exists())) apiError(404,'FILE_MISSING','Berkas tidak tersedia.')
    await pool.query("INSERT INTO audit_log(actor_id,action,resource_type,resource_id,metadata) VALUES($1,'prescription.viewed','prescription',$2,'{}')",[currentUser.id,prescription.id])
    return new Response(file,{headers:{'content-type':prescription.mime_type,'content-disposition':'inline','cache-control':'private, no-store','x-content-type-options':'nosniff'}})
  }

  const reviewMatch = path.match(/^\/prescriptions\/([0-9a-f-]+)\/reviews$/i)
  if (reviewMatch && method === 'POST') {
    requireRole(currentUser,'pharmacist')
    const input = await body<any>(request)
    if (!['approved','clarification','rejected'].includes(input.decision)) apiError(400,'INVALID_DECISION','Keputusan tidak valid.')
    if(['clarification','rejected'].includes(input.decision)&&String(input.reason??'').trim().length<3)apiError(422,'REVIEW_REASON_REQUIRED','Catatan diperlukan untuk klarifikasi atau penolakan resep.')
    const result = await transaction(async (client) => {
      const selected = await client.query(`SELECT p.*,o.id AS order_id,o.pharmacy_id,o.status AS order_status,o.document_revision AS current_document_revision,o.review_version,o.expires_at
        FROM prescriptions p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 FOR UPDATE OF o,p`,[reviewMatch[1]])
      if (!selected.rowCount) apiError(404,'NOT_FOUND','Dokumen resep tidak ditemukan.')
      const p = selected.rows[0]
      pharmacyScope(currentUser,p.pharmacy_id)
      if (p.order_status !== 'awaiting_prescription' || Number(p.document_revision) !== Number(p.current_document_revision)) apiError(409,'REVIEW_LOCKED','Pemeriksaan resep sudah dikunci atau ada revisi dokumen baru.')
      if (Number(input.expectedReviewVersion) !== Number(p.review_version)) apiError(409,'REVIEW_CONFLICT','Resep sudah ditinjau oleh petugas lain. Muat ulang antrean.')
      if (new Date(p.expires_at).getTime() <= Date.now()) apiError(409,'ORDER_EXPIRED','Reservasi pesanan sudah berakhir.')
      const orderItems = await client.query('SELECT id,requires_prescription_snapshot FROM order_items WHERE order_id=$1',[p.order_id])
      const requiredIds = orderItems.rows.filter((i:any)=>i.requires_prescription_snapshot).map((i:any)=>i.id)
      const reviewedIds = [...new Set((input.orderItemIds ?? []).map(String))]
      if (!reviewedIds.length || reviewedIds.some((id:string)=>!requiredIds.includes(id))) apiError(400,'INVALID_REVIEW_ITEMS','Pilih item resep pada pesanan ini.')
      if (input.decision === 'approved' && requiredIds.some((id:string)=>!reviewedIds.includes(id))) apiError(422,'REVIEW_INCOMPLETE','Persetujuan harus mencakup seluruh item wajib resep.')
      const sequence = Number(p.review_version)+1
      const review = await client.query(`INSERT INTO prescription_reviews(prescription_id,pharmacist_id,document_revision,review_sequence,decision,reason)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[p.id,currentUser.id,p.document_revision,sequence,input.decision,String(input.reason ?? '').trim() || null])
      for (const itemId of reviewedIds) await client.query('INSERT INTO review_items(review_id,order_item_id) VALUES($1,$2)',[review.rows[0].id,itemId])
      await client.query('UPDATE prescriptions SET status=$2 WHERE id=$1',[p.id,input.decision])
      if(input.decision==='clarification')await client.query("INSERT INTO prescription_messages(order_id,author_id,message_type,body) VALUES($1,$2,'clarification_request',$3)",[p.order_id,currentUser.id,String(input.reason).trim()])
      await client.query('UPDATE orders SET review_version=$2,updated_at=now() WHERE id=$1',[p.order_id,sequence])
      let status = p.order_status
      if (input.decision === 'rejected') {
        await client.query("UPDATE orders SET status='cancelled',updated_at=now() WHERE id=$1",[p.order_id])
        const active=await client.query("SELECT * FROM stock_reservations WHERE order_id=$1 AND status='active' FOR UPDATE",[p.order_id])
        for(const reservation of active.rows){
          await client.query("UPDATE stock_reservations SET status='released' WHERE id=$1",[reservation.id])
          await client.query('UPDATE inventory SET reserved=reserved-$3 WHERE pharmacy_id=$1 AND product_id=$2',[reservation.pharmacy_id,reservation.product_id,reservation.quantity])
        }
        await addHistory(client,p.order_id,p.order_status,'cancelled',currentUser.id,'Resep ditolak oleh apoteker')
        status='cancelled'
      } else if (input.decision === 'approved') {
        const latest = await client.query(`SELECT oi.id,rv.decision,rv.document_revision FROM order_items oi
          LEFT JOIN LATERAL (SELECT pr.decision,pr.document_revision FROM review_items ri JOIN prescription_reviews pr ON pr.id=ri.review_id
            JOIN prescriptions ps ON ps.id=pr.prescription_id WHERE ri.order_item_id=oi.id AND ps.order_id=$1
            ORDER BY pr.review_sequence DESC LIMIT 1) rv ON true
          WHERE oi.order_id=$1 AND oi.requires_prescription_snapshot=true`,[p.order_id])
        if (latest.rows.length === requiredIds.length && latest.rows.every((row:any)=>row.decision==='approved' && Number(row.document_revision)===Number(p.document_revision)) && new Date(p.expires_at).getTime()>Date.now()) {
          await client.query("UPDATE orders SET status='awaiting_payment',updated_at=now() WHERE id=$1",[p.order_id])
          await addHistory(client,p.order_id,'awaiting_prescription','awaiting_payment',currentUser.id,'Seluruh item wajib resep disetujui')
          status='awaiting_payment'
        }
      }
      await audit(client,currentUser.id,'prescription.reviewed','prescription',p.id,{decision:input.decision,revision:p.document_revision,sequence})
      return { prescriptionId:p.id,decision:input.decision,reviewVersion:sequence,orderStatus:status }
    })
    return json(result)
  }

  const messagesMatch = path.match(/^\/orders\/([0-9a-f-]+)\/prescription-messages$/i)
  if (messagesMatch && method === 'GET') {
    const order = await pool.query('SELECT customer_id,pharmacy_id FROM orders WHERE id=$1',[messagesMatch[1]])
    if (!order.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
    if (order.rows[0].customer_id !== currentUser.id) { requireRole(currentUser,'pharmacist'); pharmacyScope(currentUser,order.rows[0].pharmacy_id) }
    const result = await pool.query('SELECT id,author_id,message_type,body,created_at FROM prescription_messages WHERE order_id=$1 ORDER BY created_at',[messagesMatch[1]])
    return json({items:result.rows.map((m:any)=>({id:m.id,authorId:m.author_id,type:m.message_type,body:m.body,createdAt:m.created_at}))})
  }
  if (messagesMatch && method === 'POST') {
    const order = await pool.query('SELECT customer_id,pharmacy_id,status FROM orders WHERE id=$1',[messagesMatch[1]])
    if (!order.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
    const isCustomer = order.rows[0].customer_id === currentUser.id
    if (!isCustomer) { requireRole(currentUser,'pharmacist'); pharmacyScope(currentUser,order.rows[0].pharmacy_id) }
    const input = await body<any>(request)
    const message = String(input.message ?? '').trim()
    if (!message || message.length > 2000) apiError(400,'INVALID_MESSAGE','Pesan klarifikasi wajib diisi dan maksimal 2.000 karakter.')
    const type = isCustomer ? 'customer_response' : 'clarification_request'
    if(isCustomer){
      if(order.rows[0].status!=='awaiting_prescription')apiError(409,'REVIEW_LOCKED','Klarifikasi hanya dapat dijawab sebelum pembayaran.')
      const open=await pool.query("SELECT 1 FROM prescriptions WHERE order_id=$1 AND status='clarification' LIMIT 1",[messagesMatch[1]])
      if(!open.rowCount)apiError(409,'NO_OPEN_CLARIFICATION','Belum ada permintaan klarifikasi yang perlu dijawab.')
    }
    const result = await pool.query('INSERT INTO prescription_messages(order_id,author_id,message_type,body) VALUES($1,$2,$3,$4) RETURNING id,created_at',[messagesMatch[1],currentUser.id,type,message])
    return json({id:result.rows[0].id,type,createdAt:result.rows[0].created_at},201)
  }


  return null
}
