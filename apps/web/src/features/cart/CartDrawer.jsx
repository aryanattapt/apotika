import React from 'react'
import { ArrowRight, Minus, Plus, ShoppingBag, X } from 'lucide-react'
import { money } from '../../shared/lib/formatters.js'
import { categoryIcon } from '../../shared/lib/catalog.js'
import { categoryColor } from '../../shared/lib/catalog.js'

export function CartDrawer({ cart, subtotal, onClose, onChange, onCheckout }) {
  return <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><aside className="drawer"><div className="drawer-head"><div><span className="section-kicker">BELANJAANMU</span><h2>Keranjang <span>({cart.reduce((s,i)=>s+i.quantity,0)})</span></h2></div><button className="close-button" onClick={onClose} aria-label="Tutup"><X /></button></div>
    {cart.length ? <><div className="cart-list">{cart.map((item) => <div className="cart-line" key={item.id}><div className={`cart-thumb ${categoryColor(item.category)}`}>{React.createElement(categoryIcon(item.category),{size:20})}</div><div className="cart-line-info"><strong>{item.name}</strong><small>{item.sellUnit}{item.requiresPrescription && ' · Wajib resep'}</small><b>{money(item.indicativePrice)}</b></div><div className="quantity-stepper"><button onClick={() => onChange(item,-1)}><Minus size={14}/></button><b>{item.quantity}</b><button onClick={() => onChange(item,1)}><Plus size={14}/></button></div></div>)}</div><div className="drawer-total"><div><span>Subtotal indikatif</span><strong>{money(subtotal)}</strong></div><small>Harga dan ketersediaan diperiksa kembali sebelum pesanan dibuat.</small><button className="button button-dark full-width" onClick={onCheckout}>Lanjut ke checkout <ArrowRight size={17}/></button></div></> : <div className="cart-empty"><span className="empty-bag"><ShoppingBag size={27}/></span><strong>Keranjangmu masih kosong</strong><p>Yuk, temukan kebutuhan sehatmu.</p><button className="button button-outline" onClick={onClose}>Jelajahi produk</button></div>}
  </aside></div>
}
