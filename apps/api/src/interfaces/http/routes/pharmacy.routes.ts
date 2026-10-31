import * as shared from '../../../shared/api'
import { pool, transaction } from '../../../infrastructure/database/client'
import type { AuthenticatedRouteContext } from './route-context'
const { addHistory, amount, apiError, audit, body, hasRole, json, localServiceTime, pharmacyScope, requireRole, validClock, validLocalDate, validTimezone, validUuid } = shared

export async function handlePharmacyRoutes({ request, url, path, method, requestId, user, currentUser }: AuthenticatedRouteContext): Promise<Response | null> {
  if(path==='/pharmacy/inventory'&&method==='GET'){
    requireRole(currentUser,'admin','pharmacist','pharmacy_staff')
    const pharmacyIds=currentUser.roles.filter((r)=>r.pharmacyId&&['pharmacist','pharmacy_staff'].includes(r.role)).map((r)=>r.pharmacyId)
    const r=await pool.query(`SELECT i.pharmacy_id,p.id product_id,p.sku,p.name,p.sell_unit,p.requires_prescription,i.on_hand,i.reserved,i.unit_price,i.sales_blocked
      FROM inventory i JOIN products p ON p.id=i.product_id WHERE ($1::uuid[] IS NULL OR i.pharmacy_id=ANY($1::uuid[])) ORDER BY p.name`,[hasRole(currentUser,'admin')?null:pharmacyIds])
    return json({items:r.rows.map((i:any)=>({pharmacyId:i.pharmacy_id,productId:i.product_id,sku:i.sku,name:i.name,sellUnit:i.sell_unit,requiresPrescription:i.requires_prescription,onHand:i.on_hand,reserved:i.reserved,available:Number(i.on_hand)-Number(i.reserved),unitPrice:amount(i.unit_price),salesBlocked:i.sales_blocked}))})
  }
  if(path==='/pharmacy/inventory-adjustments'&&method==='POST'){
    requireRole(currentUser,'admin','pharmacist','pharmacy_staff')
    const input=await body<any>(request)
    if(!validUuid(String(input.pharmacyId))||!validUuid(String(input.productId))||!Number.isInteger(Number(input.delta))||!String(input.reason??'').trim()) apiError(400,'INVALID_ADJUSTMENT','Produk, jumlah perubahan, dan alasan diperlukan.')
    pharmacyScope(currentUser,input.pharmacyId)
    const result=await transaction(async(client)=>{
      const row=await client.query('SELECT * FROM inventory WHERE pharmacy_id=$1 AND product_id=$2 FOR UPDATE',[input.pharmacyId,input.productId])
      if(!row.rowCount) apiError(404,'NOT_FOUND','Alokasi produk tidak ditemukan.')
      const next=Number(row.rows[0].on_hand)+Number(input.delta)
      if(next<Number(row.rows[0].reserved)) apiError(409,'RESERVATION_CONFLICT','Stok tidak dapat dikurangi di bawah jumlah yang sudah direservasi.')
      await client.query('UPDATE inventory SET on_hand=$3,sales_blocked=false,updated_at=now() WHERE pharmacy_id=$1 AND product_id=$2',[input.pharmacyId,input.productId,next])
      await client.query('INSERT INTO inventory_movements(pharmacy_id,product_id,delta_on_hand,reason,actor_id) VALUES($1,$2,$3,$4,$5)',[input.pharmacyId,input.productId,input.delta,String(input.reason).slice(0,500),currentUser.id])
      await audit(client,currentUser.id,'inventory.adjusted','product',input.productId,{delta:input.delta,pharmacyId:input.pharmacyId})
      return {onHand:next,reserved:Number(row.rows[0].reserved)}
    })
    return json(result)
  }
  const hoursMatch=path.match(/^\/pharmacies\/([0-9a-f-]+)\/service-hours$/i)
  if(hoursMatch&&method==='PATCH'){
    requireRole(currentUser,'admin','pharmacist')
    pharmacyScope(currentUser,hoursMatch[1])
    const input=await body<any>(request)
    if(!Array.isArray(input.hours)) apiError(400,'INVALID_HOURS','Jadwal layanan tidak valid.')
    const weekdays = new Set<number>()
    for(const item of input.hours){
      if(!item||typeof item!=='object')apiError(400,'INVALID_HOURS','Jadwal layanan tidak valid.')
      const timezone=item.timezone??'Asia/Jakarta'
      if(!Number.isInteger(item.weekday)||item.weekday<0||item.weekday>6||weekdays.has(item.weekday)||!validClock(item.opensAt)||!validClock(item.closesAt)||item.closesAt<=item.opensAt||!validTimezone(timezone)) apiError(400,'INVALID_HOURS','Jadwal layanan tidak valid.')
      weekdays.add(item.weekday)
    }
    const exceptions=Array.isArray(input.exceptions)?input.exceptions:[]
    for(const item of exceptions){
      if(!item||typeof item!=='object')apiError(400,'INVALID_HOURS','Pengecualian jam layanan tidak valid.')
      if(!validLocalDate(item.localDate)||typeof item.closed!=='boolean'||(!item.closed&&(!validClock(item.opensAt)||!validClock(item.closesAt)||item.closesAt<=item.opensAt)))apiError(400,'INVALID_HOURS','Pengecualian jam layanan tidak valid.')
    }
    await transaction(async(client)=>{
      await client.query("DELETE FROM pharmacy_service_hours WHERE pharmacy_id=$1 AND service_type='prescription'",[hoursMatch[1]])
      for(const item of input.hours) await client.query(`INSERT INTO pharmacy_service_hours(pharmacy_id,service_type,weekday,opens_at,closes_at,timezone,active)
        VALUES($1,'prescription',$2,$3,$4,$5,$6)`,[hoursMatch[1],item.weekday,item.opensAt,item.closesAt,item.timezone??'Asia/Jakarta',item.active!==false])
      for(const item of exceptions) await client.query(`INSERT INTO pharmacy_service_exceptions(pharmacy_id,service_type,local_date,closed,opens_at,closes_at,reason)
        VALUES($1,'prescription',$2,$3,$4,$5,$6) ON CONFLICT(pharmacy_id,service_type,local_date) DO UPDATE SET closed=EXCLUDED.closed,opens_at=EXCLUDED.opens_at,closes_at=EXCLUDED.closes_at,reason=EXCLUDED.reason`,[hoursMatch[1],item.localDate,item.closed,item.closed?null:item.opensAt,item.closed?null:item.closesAt,String(item.reason??'').slice(0,200)||null])
      await audit(client,currentUser.id,'pharmacy.service_hours_changed','pharmacy',hoursMatch[1],{})
    })
    return json({updated:true})
  }

  return null
}
