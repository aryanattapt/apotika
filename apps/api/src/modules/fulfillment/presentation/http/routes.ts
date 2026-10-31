import * as shared from '../../../../shared/api'
import { pool, transaction } from '../../../../infrastructure/database/client'
import { recordAudit as audit } from '../../../platform'
import type { AuthenticatedRouteContext } from '../../../../shared/http/route-context'
import { canTransitionOrder, insertOrderStatusHistory } from '../../../orders'
import { parseDispensedLots } from '../../domain/dispensed-lots'
const { amount, apiError, body, hasRole, json, pharmacyScope, requireRole } = shared

export async function handleFulfillmentRoutes({ request, url, path, method, requestId, user, currentUser }: AuthenticatedRouteContext): Promise<Response | null> {
  const fulfillmentMatch = path.match(/^\/orders\/([0-9a-f-]+)\/fulfillment$/i)
  if (fulfillmentMatch && method === 'POST') {
    requireRole(currentUser,'pharmacist','pharmacy_staff')
    const input = await body<any>(request)
    const result = await transaction(async (client) => {
      const selected = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[fulfillmentMatch[1]])
      if (!selected.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
      const order=selected.rows[0]
      pharmacyScope(currentUser,order.pharmacy_id)
      if (input.command === 'start_processing') {
        if (!canTransitionOrder(order.status,'processing')) apiError(409,'INVALID_ORDER_STATE','Pesanan harus sudah dibayar sebelum diproses.')
        const paid=await client.query("SELECT 1 FROM payments WHERE order_id=$1 AND status='succeeded' AND received_amount=amount",[order.id])
        if (!paid.rowCount) apiError(409,'PAYMENT_NOT_CONFIRMED','Pembayaran belum terkonfirmasi penuh oleh penyedia.')
        await client.query("UPDATE orders SET status='processing',updated_at=now() WHERE id=$1",[order.id])
        await insertOrderStatusHistory(client,order.id,'paid','processing',currentUser.id)
      } else if (input.command === 'mark_ready') {
        if (!canTransitionOrder(order.status,'ready')) apiError(409,'INVALID_ORDER_STATE','Pesanan harus sedang diproses.')
        const checks=await client.query(`SELECT fc.id,fc.passed,fc.pharmacist_check FROM fulfillment_checks fc WHERE fc.order_id=$1 ORDER BY checked_at DESC LIMIT 1`,[order.id])
        if (!checks.rowCount || !checks.rows[0].passed) apiError(422,'FULFILLMENT_CHECK_REQUIRED','Pemeriksaan kesesuaian produk harus lulus sebelum pesanan siap.')
        const hasRx=await client.query('SELECT 1 FROM order_items WHERE order_id=$1 AND requires_prescription_snapshot=true LIMIT 1',[order.id])
        if (hasRx.rowCount && !checks.rows[0].pharmacist_check) apiError(403,'PHARMACIST_CHECK_REQUIRED','Pemeriksaan akhir pesanan resep harus dicatat apoteker.')
        const consumed=await client.query("SELECT * FROM stock_reservations WHERE order_id=$1 AND status='active' ORDER BY product_id FOR UPDATE",[order.id])
        for (const r of consumed.rows) {
          const update=await client.query('UPDATE inventory SET on_hand=on_hand-$3,reserved=reserved-$3,updated_at=now() WHERE pharmacy_id=$1 AND product_id=$2 AND on_hand >= $3 AND reserved >= $3',[r.pharmacy_id,r.product_id,r.quantity])
          if (!update.rowCount) apiError(409,'INVENTORY_MISMATCH','Alokasi daring tidak cocok. Pemenuhan dihentikan untuk rekonsiliasi.')
          await client.query("UPDATE stock_reservations SET status='consumed' WHERE id=$1",[r.id])
          await client.query("INSERT INTO inventory_movements(pharmacy_id,product_id,order_id,delta_on_hand,reason,actor_id) VALUES($1,$2,$3,$4,'fulfillment',$5)",[r.pharmacy_id,r.product_id,order.id,-Number(r.quantity),currentUser.id])
        }
        await client.query("UPDATE orders SET status='ready',updated_at=now() WHERE id=$1",[order.id])
        await insertOrderStatusHistory(client,order.id,'processing','ready',currentUser.id)
      } else if (input.command === 'confirm_pickup') {
        if (order.fulfillment_method !== 'pickup' || !canTransitionOrder(order.status,'completed')) apiError(409,'INVALID_ORDER_STATE','Hanya pesanan ambil di apotek yang siap dapat diselesaikan.')
        const proofReference=String(input.proofReference??'').trim()
        if (!input.pickupCode || String(input.pickupCode).toUpperCase() !== order.pickup_code || !proofReference || proofReference.length>200) apiError(422,'PICKUP_PROOF_REQUIRED','Kode pengambilan dan referensi bukti wajib cocok.')
        await client.query("UPDATE orders SET status='completed',updated_at=now() WHERE id=$1",[order.id])
        await client.query("INSERT INTO shipments(order_id,method,status,handover_reference) VALUES($1,'pickup','completed',$2) ON CONFLICT(order_id) DO UPDATE SET status='completed',handover_reference=EXCLUDED.handover_reference",[order.id,proofReference])
        await insertOrderStatusHistory(client,order.id,'ready','completed',currentUser.id,'pickup')
        input.proofReference=proofReference
      } else if (input.command === 'handover_to_courier') {
        apiError(503,'SHIPPING_PROVIDER_NOT_CONFIGURED','Penyedia pengiriman belum dikonfigurasi.')
      } else apiError(400,'INVALID_COMMAND','Perintah pemenuhan tidak dikenal.')
      await audit(client,currentUser.id,`fulfillment.${input.command}`,'order',order.id,input.command==='confirm_pickup'?{proofReference:input.proofReference}:{})
      return { orderId:order.id, status:input.command==='start_processing'?'processing':input.command==='mark_ready'?'ready':'completed' }
    })
    return json(result)
  }
  const checkMatch = path.match(/^\/orders\/([0-9a-f-]+)\/fulfillment-checks$/i)
  if (checkMatch && method === 'POST') {
    requireRole(currentUser,'pharmacist','pharmacy_staff')
    const input=await body<any>(request)
    const result=await transaction(async(client)=>{
      const order=await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[checkMatch[1]])
      if(!order.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
      pharmacyScope(currentUser,order.rows[0].pharmacy_id)
      if(!canTransitionOrder(order.rows[0].status,'ready')) apiError(409,'INVALID_ORDER_STATE','Pemeriksaan hanya tersedia saat penyiapan.')
      const items=await client.query('SELECT id,quantity FROM order_items WHERE order_id=$1',[checkMatch[1]])
      const supplied=Array.isArray(input.items)?input.items:[]
      if(supplied.length!==items.rows.length || items.rows.some((i:any)=>!supplied.some((s:any)=>s.orderItemId===i.id && Number(s.quantity)===Number(i.quantity)))) apiError(422,'ITEM_CHECK_INCOMPLETE','Periksa semua item dan jumlah yang dipesan.')
      const hasRx=await client.query('SELECT 1 FROM order_items WHERE order_id=$1 AND requires_prescription_snapshot=true',[checkMatch[1]])
      const pharmacistCheck=hasRole(currentUser,'pharmacist') && input.pharmacistCheck===true
      const passed=input.passed===true
      const checkNote=String(input.note??'').trim().slice(0,1000)
      if(!passed&&checkNote.length<3)apiError(422,'FULFILLMENT_NOTE_REQUIRED','Jelaskan kendala pemeriksaan sebelum mengeskalasikannya.')
      if(hasRx.rowCount && !pharmacistCheck && passed) apiError(403,'PHARMACIST_CHECK_REQUIRED','Pemeriksaan akhir untuk pesanan resep hanya dapat dicatat apoteker.')
      const batchItems=await client.query('SELECT id,quantity,batch_tracking_required_snapshot FROM order_items WHERE order_id=$1',[checkMatch[1]])
      const lotPlans:any[]=[]
      if(passed){
        for(const orderItem of batchItems.rows){
          if(!orderItem.batch_tracking_required_snapshot)continue
          const entry=supplied.find((item:any)=>item.orderItemId===orderItem.id)
          const parsedLots=parseDispensedLots(entry?.lots,Number(orderItem.quantity))
          if(!parsedLots.ok){
            if(parsedLots.reason==='required')apiError(422,'LOT_REQUIRED','Catat nomor batch dan tanggal kedaluwarsa untuk setiap produk yang memerlukan pelacakan.')
            if(parsedLots.reason==='quantity-mismatch')apiError(422,'LOT_QUANTITY_MISMATCH','Jumlah unit pada catatan batch harus sama dengan jumlah pesanan.')
            apiError(422,'LOT_INVALID','Nomor batch, tanggal kedaluwarsa, dan jumlah unit harus diisi dengan benar.')
          }
          for(const lot of parsedLots.lots){
            const expiry=await client.query('SELECT $1::date>=CURRENT_DATE AS valid',[lot.expiresOn])
            if(!expiry.rows[0].valid)apiError(422,'LOT_EXPIRED','Tanggal kedaluwarsa produk sudah lewat.')
            lotPlans.push({orderItemId:orderItem.id,...lot})
          }
        }
      }
      const inserted=await client.query(`INSERT INTO fulfillment_checks(order_id,actor_id,pharmacist_check,passed,note)
        VALUES($1,$2,$3,$4,$5) RETURNING id`,[checkMatch[1],currentUser.id,pharmacistCheck,passed,checkNote||null])
      for(const lot of lotPlans)await client.query('INSERT INTO dispensed_lots(fulfillment_check_id,order_item_id,lot_number,expires_on,quantity) VALUES($1,$2,$3,$4,$5)',[inserted.rows[0].id,lot.orderItemId,lot.lotNumber,lot.expiresOn,lot.quantity])
      if(!passed){
        const activeCase=await client.query("SELECT id FROM support_cases WHERE order_id=$1 AND category='fulfillment' AND status<>'closed' LIMIT 1",[checkMatch[1]])
        if(!activeCase.rowCount){
          const opened=await client.query("INSERT INTO support_cases(order_id,opened_by,category,description) VALUES($1,$2,'fulfillment',$3) RETURNING id",[checkMatch[1],currentUser.id,`Pemeriksaan pemenuhan gagal: ${checkNote}`])
          await audit(client,currentUser.id,'support.opened','support_case',opened.rows[0].id,{category:'fulfillment'})
        }
      }
      await audit(client,currentUser.id,'fulfillment.checked','order',checkMatch[1],{passed,pharmacistCheck})
      return {id:inserted.rows[0].id,passed,pharmacistCheck,escalated:!passed}
    })
    return json(result,201)
  }

  const shipmentMatch = path.match(/^\/orders\/([0-9a-f-]+)\/shipment-bookings$/i)
  if(shipmentMatch&&method==='POST'){
    requireRole(currentUser,'pharmacist','pharmacy_staff')
    const order=await pool.query('SELECT pharmacy_id,fulfillment_method,status FROM orders WHERE id=$1',[shipmentMatch[1]])
    if(!order.rowCount)apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
    pharmacyScope(currentUser,order.rows[0].pharmacy_id)
    if(order.rows[0].fulfillment_method!=='delivery'||order.rows[0].status!=='ready')apiError(409,'INVALID_ORDER_STATE','Hanya pesanan pengiriman yang siap dapat dibuatkan booking.')
    apiError(503,'SHIPPING_PROVIDER_NOT_CONFIGURED','Penyedia pengiriman belum dikonfigurasi.')
  }


  return null
}
