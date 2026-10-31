import { Heart, Minus, Plus } from 'lucide-react'
import { money } from '../../shared/lib/formatters.js'
import { categoryIcon } from '../../shared/lib/catalog.js'
import { categoryColor } from '../../shared/lib/catalog.js'

export function ProductCard({ product, quantity, onAdd, onRemove, delay }) {
  const Icon = categoryIcon(product.category)
  return <article className="product-card" style={{ animationDelay: `${delay}ms` }}>
    <div className={`product-visual ${categoryColor(product.category)}`}><div className="product-visual-orbit" /><div className="product-pack"><span className="pack-brand">APOTEK.ID</span><span className="pack-symbol"><Icon size={27} strokeWidth={1.6} /></span><span className="pack-caption">{product.category.split(' ')[0].toUpperCase()}</span></div>{product.requiresPrescription && <span className="rx-tag">Resep</span>}<button className="favorite-button" aria-label="Simpan produk" onClick={(e) => { e.currentTarget.classList.toggle('favorited') }}><Heart size={17} /></button></div>
    <div className="product-info"><div className="product-category">{product.category}</div><h3>{product.name}</h3><p className="product-unit">{product.sellUnit}</p><div className="product-bottom"><div><strong>{money(product.indicativePrice)}</strong><small>harga indikatif</small></div>{quantity ? <div className="quantity-stepper"><button onClick={onRemove} aria-label="Kurangi"><Minus size={15} /></button><b>{quantity}</b><button onClick={onAdd} aria-label="Tambah"><Plus size={15} /></button></div> : <button className="add-button" disabled={!product.available} onClick={onAdd}>{product.available ? <Plus size={19} /> : 'Habis'}</button>}</div></div>
  </article>
}
