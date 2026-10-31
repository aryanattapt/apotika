import { useEffect, useState } from 'react'
import { ArrowRight, PackageCheck, ShoppingBag, X } from 'lucide-react'
import { api } from '../../shared/api/client.js'
import { money } from '../../shared/lib/formatters.js'
import { statusLabel } from '../../shared/lib/formatters.js'

export function OrderHistory({csrf,onClose,onOpen,onToast}){
  const [orders,setOrders]=useState([])
  const [loading,setLoading]=useState(true)
  useEffect(()=>{api('/orders').then((result)=>setOrders(result.items)).catch((error)=>onToast(error.message)).finally(()=>setLoading(false))},[])
  return <div className="overlay" onMouseDown={(e)=>e.target===e.currentTarget&&onClose()}><section className="modal history-modal"><div className="modal-head"><div><span className="section-kicker">PANTAU TRANSAKSI</span><h2>Pesananmu</h2></div><button className="close-button" onClick={onClose}><X/></button></div>{loading?<div className="empty-state"><span className="loader"/>Memuat riwayat...</div>:orders.length?<div className="history-list">{orders.map((order)=><button className="history-row" key={order.id} onClick={()=>onOpen(order.id)}><span className="history-symbol"><PackageCheck size={18}/></span><span className="history-copy"><strong>Pesanan #{order.id.slice(0,8).toUpperCase()}</strong><small>{new Date(order.createdAt).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})} · {order.fulfillmentMethod==='pickup'?'Ambil di apotek':'Pengiriman'}</small></span><span className="history-end"><span className={`status-pill status-${order.status}`}>{statusLabel[order.status]||order.status}</span><b>{money(order.total)}</b></span><ArrowRight size={15}/></button>)}</div>:<div className="empty-state"><span className="empty-icon"><ShoppingBag size={20}/></span><strong>Belum ada pesanan</strong><span>Pesanan yang kamu buat akan muncul di sini.</span></div>}</section></div>
}
