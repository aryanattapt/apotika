import * as shared from '../../../../shared/api'
import { pool, transaction } from '../../../../infrastructure/database/client'
import { recordAudit as audit } from '../../../platform'
import type { AuthenticatedRouteContext } from '../../../../shared/http/route-context'
import { publicProduct } from '../../../catalog'
const { amount, apiError, body, json, requireRole, validUuid } = shared

export async function handleAdminRoutes({ request, url, path, method, requestId, user, currentUser }: AuthenticatedRouteContext): Promise<Response | null> {
  if(path==='/admin/products'&&method==='GET'){
    requireRole(currentUser,'admin','pharmacist')
    const result=await pool.query(`SELECT p.id,p.sku,p.name,p.description,p.category,p.sell_unit,p.requires_prescription,p.batch_tracking_required,p.status,
      COALESCE(MIN(i.unit_price),0) indicative_price,COALESCE(MAX(i.on_hand-i.reserved),0) available
      FROM products p LEFT JOIN (SELECT inventory.* FROM inventory JOIN pharmacies ON pharmacies.id=inventory.pharmacy_id WHERE pharmacies.status='active') i ON i.product_id=p.id
      GROUP BY p.id ORDER BY p.category,p.name`)
    return json({items:result.rows.map((r:any)=>({...publicProduct(r),status:r.status}))})
  }
  if(path==='/admin/pharmacies'&&method==='GET'){
    requireRole(currentUser,'admin','cs')
    const result=await pool.query(`SELECT id,name,address_text,city,postal_codes,status,license_reference,created_at
      FROM pharmacies ORDER BY created_at DESC`)
    return json({items:result.rows.map((p:any)=>({id:p.id,name:p.name,addressText:p.address_text,city:p.city,postalCodes:p.postal_codes,status:p.status,licenseReference:p.license_reference,createdAt:p.created_at}))})
  }
  if(path==='/admin/orders'&&method==='GET'){
    requireRole(currentUser,'admin','cs')
    const result=await pool.query(`SELECT o.id,o.status,o.fulfillment_method,o.total,o.created_at,o.expires_at,p.name customer_name,ph.name pharmacy_name
      FROM orders o JOIN users p ON p.id=o.customer_id JOIN pharmacies ph ON ph.id=o.pharmacy_id ORDER BY o.created_at DESC LIMIT 200`)
    return json({items:result.rows.map((r:any)=>({id:r.id,status:r.status,fulfillmentMethod:r.fulfillment_method,total:amount(r.total),createdAt:r.created_at,expiresAt:r.expires_at,customerName:r.customer_name,pharmacyName:r.pharmacy_name}))})
  }
  if(path==='/admin/cancellation-requests'&&method==='GET'){
    requireRole(currentUser,'admin','cs')
    const result=await pool.query(`SELECT cr.id,cr.order_id,cr.reason,cr.status,cr.created_at,o.status AS order_status,o.total,u.name AS customer_name,ph.name AS pharmacy_name
      FROM cancellation_requests cr JOIN orders o ON o.id=cr.order_id JOIN users u ON u.id=o.customer_id JOIN pharmacies ph ON ph.id=o.pharmacy_id
      WHERE cr.status='requested' ORDER BY cr.created_at`)
    return json({items:result.rows.map((r:any)=>({id:r.id,orderId:r.order_id,reason:r.reason,status:r.status,orderStatus:r.order_status,total:amount(r.total),customerName:r.customer_name,pharmacyName:r.pharmacy_name,createdAt:r.created_at}))})
  }
  if(path==='/admin/support-cases'&&method==='GET'){
    requireRole(currentUser,'admin','cs','finance')
    const result=await pool.query(`SELECT c.id,c.order_id,c.category,c.status,c.description,c.created_at,o.status AS order_status,u.name AS customer_name,ph.name AS pharmacy_name
      FROM support_cases c JOIN orders o ON o.id=c.order_id JOIN users u ON u.id=o.customer_id JOIN pharmacies ph ON ph.id=o.pharmacy_id
      WHERE c.status<>'closed' ORDER BY c.created_at`)
    return json({items:result.rows.map((r:any)=>({id:r.id,orderId:r.order_id,category:r.category,status:r.status,description:r.description,createdAt:r.created_at,orderStatus:r.order_status,customerName:r.customer_name,pharmacyName:r.pharmacy_name}))})
  }
  if(path==='/admin/products'&&method==='POST'){
    requireRole(currentUser,'pharmacist')
    const input=await body<any>(request)
    const sku=String(input.sku??'').trim().toUpperCase()
    const name=String(input.name??'').trim()
    const category=String(input.category??'').trim()
    const sellUnit=String(input.sellUnit??'').trim()
    if(!/^[A-Z0-9_-]{2,40}$/.test(sku)||name.length<2||name.length>160||category.length<2||category.length>80||sellUnit.length<2||sellUnit.length>100)apiError(400,'INVALID_PRODUCT','SKU, nama, kategori, dan satuan jual harus diisi dengan benar.')
    const saved=await transaction(async(client)=>{
      const result=await client.query(`INSERT INTO products(sku,name,description,category,sell_unit,requires_prescription,batch_tracking_required,special_handling,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'inactive') RETURNING id,sku,name,status`,[sku,name,String(input.description??'').slice(0,3000),category,sellUnit,input.requiresPrescription===true,input.batchTrackingRequired===true,input.specialHandling===true])
      await audit(client,currentUser.id,'product.created','product',result.rows[0].id,{})
      return result.rows[0]
    })
    return json(saved,201)
  }
  if(path==='/admin/inventory'&&method==='POST'){
    requireRole(currentUser,'admin')
    const input=await body<any>(request)
    const pharmacyId=String(input.pharmacyId??'')
    const productId=String(input.productId??'')
    const onHand=Number(input.onHand)
    const unitPrice=Number(input.unitPrice)
    if(!validUuid(pharmacyId)||!validUuid(productId)||!Number.isInteger(onHand)||onHand<0||!Number.isFinite(unitPrice)||unitPrice<0)apiError(400,'INVALID_INVENTORY','Apotek, produk, alokasi, dan harga harus valid.')
    const result=await transaction(async(client)=>{
      const pharmacy=await client.query('SELECT status FROM pharmacies WHERE id=$1 FOR UPDATE',[pharmacyId])
      const product=await client.query('SELECT id FROM products WHERE id=$1 FOR SHARE',[productId])
      if(!pharmacy.rowCount||!product.rowCount)apiError(404,'NOT_FOUND','Apotek atau produk tidak ditemukan.')
      const existing=await client.query('SELECT on_hand,reserved FROM inventory WHERE pharmacy_id=$1 AND product_id=$2 FOR UPDATE',[pharmacyId,productId])
      const oldOnHand=existing.rowCount?Number(existing.rows[0].on_hand):0
      const reserved=existing.rowCount?Number(existing.rows[0].reserved):0
      if(onHand<reserved)apiError(409,'RESERVATION_CONFLICT','Alokasi baru tidak boleh lebih rendah dari stok yang sudah direservasi.')
      await client.query(`INSERT INTO inventory(pharmacy_id,product_id,on_hand,reserved,unit_price,sales_blocked)
        VALUES($1,$2,$3,0,$4,false) ON CONFLICT(pharmacy_id,product_id) DO UPDATE SET on_hand=EXCLUDED.on_hand,unit_price=EXCLUDED.unit_price,sales_blocked=false,updated_at=now()`,[pharmacyId,productId,onHand,unitPrice.toFixed(2)])
      const delta=onHand-oldOnHand
      if(delta!==0)await client.query('INSERT INTO inventory_movements(pharmacy_id,product_id,delta_on_hand,reason,actor_id) VALUES($1,$2,$3,$4,$5)',[pharmacyId,productId,delta,String(input.reason??'Pengaturan alokasi daring').slice(0,500),currentUser.id])
      await audit(client,currentUser.id,'inventory.configured','product',productId,{pharmacyId,onHand,unitPrice:unitPrice.toFixed(2),reserved})
      return {pharmacyId,productId,onHand,reserved,available:onHand-reserved,unitPrice:unitPrice.toFixed(2)}
    })
    return json(result)
  }
  const adminProduct=path.match(/^\/admin\/products\/([0-9a-f-]+)$/i)
  if(adminProduct&&method==='PATCH'){
    requireRole(currentUser,'pharmacist')
    const input=await body<any>(request)
    const allowed=['name','description','category','sellUnit','requiresPrescription','batchTrackingRequired','specialHandling','status']
    if(Object.keys(input).some((key)=>!allowed.includes(key))) apiError(400,'INVALID_PRODUCT','Perubahan produk memuat field yang tidak didukung.')
    if(input.status!==undefined&&!['active','inactive'].includes(input.status))apiError(400,'INVALID_STATUS','Status produk tidak valid.')
    const saved=await transaction(async(client)=>{
      const r=await client.query(`UPDATE products SET name=COALESCE($2,name),description=COALESCE($3,description),category=COALESCE($4,category),
        sell_unit=COALESCE($5,sell_unit),requires_prescription=COALESCE($6,requires_prescription),batch_tracking_required=COALESCE($7,batch_tracking_required),special_handling=COALESCE($8,special_handling),
        status=COALESCE($9,status),updated_at=now() WHERE id=$1 RETURNING id,sku,name,status`,[adminProduct[1],input.name??null,input.description??null,input.category??null,input.sellUnit??null,input.requiresPrescription??null,input.batchTrackingRequired??null,input.specialHandling??null,input.status??null])
      if(!r.rowCount) apiError(404,'NOT_FOUND','Produk tidak ditemukan.')
      await audit(client,currentUser.id,'product.updated','product',r.rows[0].id,{})
      return r.rows[0]
    })
    return json(saved)
  }
  if(path==='/admin/pharmacies'&&method==='POST'){
    requireRole(currentUser,'admin')
    const input=await body<any>(request)
    const name=String(input.name??'').trim()
    const address=String(input.addressText??'').trim()
    const city=String(input.city??'').trim()
    const postalCodes=Array.isArray(input.postalCodes)?[...new Set(input.postalCodes.map((value:any)=>String(value).trim()))]:[]
    if(name.length<2||name.length>160||address.length<5||address.length>500||city.length<2||city.length>100||!postalCodes.length||postalCodes.some((code:string)=>!/^\d{4,10}$/.test(code)))apiError(400,'INVALID_PHARMACY','Nama, alamat, kota, dan kode pos layanan harus valid.')
    const saved=await transaction(async(client)=>{
      const r=await client.query(`INSERT INTO pharmacies(name,address_text,city,postal_codes,license_reference,status)
        VALUES($1,$2,$3,$4,$5,'pending') RETURNING id,name,status`,[name,address,city,postalCodes,String(input.licenseReference??'').trim().slice(0,160)||null])
      await audit(client,currentUser.id,'pharmacy.created','pharmacy',r.rows[0].id,{})
      return r.rows[0]
    })
    return json(saved,201)
  }
  const adminPharmacy=path.match(/^\/admin\/pharmacies\/([0-9a-f-]+)$/i)
  if(adminPharmacy&&method==='PATCH'){
    requireRole(currentUser,'admin')
    const input=await body<any>(request)
    if(!['pending','active','suspended'].includes(input.status)) apiError(400,'INVALID_STATUS','Status apotek tidak valid.')
    const saved=await transaction(async(client)=>{
      if(input.status==='active'){
        const readiness=await client.query(`SELECT p.license_reference,cardinality(p.postal_codes) AS postal_count,
          COUNT(DISTINCT i.product_id) AS inventory_count,COUNT(DISTINCT h.weekday) AS service_days
          FROM pharmacies p LEFT JOIN inventory i ON i.pharmacy_id=p.id LEFT JOIN pharmacy_service_hours h ON h.pharmacy_id=p.id AND h.service_type='prescription' AND h.active=true
          WHERE p.id=$1 GROUP BY p.id`,[adminPharmacy[1]])
        if(!readiness.rowCount)apiError(404,'NOT_FOUND','Apotek tidak ditemukan.')
        const gate=readiness.rows[0]
        if(!String(gate.license_reference??'').trim()||Number(gate.postal_count)<1||Number(gate.inventory_count)<1||Number(gate.service_days)<1)apiError(422,'PHARMACY_ONBOARDING_INCOMPLETE','Lengkapi referensi izin, wilayah layanan, alokasi stok daring, dan jam pemeriksaan resep sebelum aktivasi.')
      }
      const r=await client.query('UPDATE pharmacies SET status=$2 WHERE id=$1 RETURNING id,name,status',[adminPharmacy[1],input.status])
      if(!r.rowCount) apiError(404,'NOT_FOUND','Apotek tidak ditemukan.')
      await audit(client,currentUser.id,'pharmacy.status_changed','pharmacy',adminPharmacy[1],{status:input.status})
      return r.rows[0]
    })
    return json(saved)
  }


  return null
}
