import * as shared from '../../../../shared/api'
import { pool, transaction } from '../../../../infrastructure/database/client'
import type { AuthenticatedRouteContext } from '../../../../shared/http/route-context'
import { canRequestRefund } from '../../domain/refund-policy'
const { amount, apiError, body, json, requireRole } = shared

export async function handlePaymentRoutes({ request, url, path, method, requestId, user, currentUser }: AuthenticatedRouteContext): Promise<Response | null> {
  const paymentMatch = path.match(/^\/orders\/([0-9a-f-]+)\/payments$/i)
  if (paymentMatch && method === 'POST') {
    const order = await pool.query('SELECT customer_id,status,expires_at FROM orders WHERE id=$1',[paymentMatch[1]])
    if (!order.rowCount || order.rows[0].customer_id !== currentUser.id) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
    if (!['awaiting_payment'].includes(order.rows[0].status) || new Date(order.rows[0].expires_at).getTime() <= Date.now()) apiError(409,'INVALID_ORDER_STATE','Pesanan belum memenuhi syarat untuk tagihan.')
    apiError(503,'PAYMENT_PROVIDER_NOT_CONFIGURED','Penyedia pembayaran belum dipilih dan dikonfigurasi. Pesanan tetap aman; hubungi operasional untuk menyiapkan integrasi.')
  }
  const paymentWebhook = path.match(/^\/webhooks\/payment\/([a-z0-9_-]+)$/i)
  if (paymentWebhook && method === 'POST') apiError(503,'PAYMENT_PROVIDER_NOT_CONFIGURED','Adapter pembayaran belum dikonfigurasi.')
  const refundMatch=path.match(/^\/payments\/([0-9a-f-]+)\/refunds$/i)
  if(refundMatch&&method==='POST'){
    requireRole(currentUser,'finance','admin')
    const input=await body<any>(request)
    const refundAmount=Number(input.amount)
    const reason=String(input.reason??'').trim()
    if(!Number.isFinite(refundAmount)||refundAmount<=0||reason.length<3||reason.length>500)apiError(400,'INVALID_REFUND','Nominal dan alasan refund diperlukan.')
    const payment=await pool.query('SELECT id,status,received_amount FROM payments WHERE id=$1',[refundMatch[1]])
    if(!payment.rowCount)apiError(404,'NOT_FOUND','Pembayaran tidak ditemukan.')
    if(!['succeeded','late'].includes(payment.rows[0].status)||payment.rows[0].received_amount==null)apiError(409,'PAYMENT_NOT_RECEIVED','Dana terverifikasi belum tersedia untuk refund.')
    const requested=await pool.query("SELECT COALESCE(SUM(amount),0) amount FROM refunds WHERE payment_id=$1 AND status IN ('requested','processing','succeeded')",[refundMatch[1]])
    if(!canRequestRefund({receivedAmount:payment.rows[0].received_amount,alreadyRequestedAmount:requested.rows[0].amount,requestedAmount:refundAmount}))apiError(409,'REFUND_LIMIT_EXCEEDED','Nominal refund melebihi dana yang diterima.')
    apiError(503,'PAYMENT_PROVIDER_NOT_CONFIGURED','Adapter refund belum dikonfigurasi. Permintaan belum dikirim dan dana belum berubah.')
  }
  const shippingWebhook = path.match(/^\/webhooks\/shipping\/([a-z0-9_-]+)$/i)
  if (shippingWebhook && method === 'POST') apiError(503,'SHIPPING_PROVIDER_NOT_CONFIGURED','Adapter pengiriman belum dikonfigurasi.')


  return null
}
