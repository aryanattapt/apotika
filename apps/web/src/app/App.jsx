import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Heart, HeartPulse, Leaf, LockKeyhole, PackageCheck, Search, ShieldCheck, Stethoscope, X } from 'lucide-react'
import { api } from '../shared/api/client.js'
import { Header } from '../components/layout/Header.jsx'
import { Benefit } from '../components/layout/Benefit.jsx'
import { ProductCard } from '../features/catalog/ProductCard.jsx'
import { CartDrawer } from '../features/cart/CartDrawer.jsx'
import { OrderHistory } from '../features/orders/OrderHistory.jsx'
import { AuthModal } from '../features/auth/AuthModal.jsx'
import { CheckoutModal } from '../features/checkout/CheckoutModal.jsx'
import { OrderModal } from '../features/orders/OrderModal.jsx'
import { PharmacyWorkspace } from '../features/pharmacy/PharmacyWorkspace.jsx'
import { AdminWorkspace } from '../features/admin/AdminWorkspace.jsx'
import { Footer } from '../components/layout/Footer.jsx'

export function App() {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('Semua produk')
  const [user, setUser] = useState(null)
  const [csrf, setCsrf] = useState('')
  const [cart, setCart] = useState(() => JSON.parse(localStorage.getItem('apotek-cart') || '[]'))
  const [panel, setPanel] = useState('')
  const [authMode, setAuthMode] = useState('login')
  const [toast, setToast] = useState('')
  const [activeOrder, setActiveOrder] = useState(null)
  const [loadingProducts, setLoadingProducts] = useState(true)
  const searchRef = useRef(null)
  const quantity = cart.reduce((sum, item) => sum + item.quantity, 0)
  const subtotal = cart.reduce((sum, item) => sum + Number(item.indicativePrice) * item.quantity, 0)
  const workspace = new URLSearchParams(location.search).get('workspace')

  const loadProducts = useCallback(async (q = query, c = category) => {
    setLoadingProducts(true)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('query', q.trim())
      if (c && c !== 'Semua produk') params.set('category', c)
      const result = await api(`/products?${params}`)
      setProducts(result.items)
      setCategories(result.categories)
    } catch (error) { setToast(error.message) } finally { setLoadingProducts(false) }
  }, [query, category])

  useEffect(() => {
    loadProducts()
    api('/auth/session').then((result) => {
      setUser(result.user)
      setCsrf(result.user?.csrfToken || '')
    }).catch(() => {})
    const verify = new URLSearchParams(location.search).get('verify')
    const reset = new URLSearchParams(location.search).get('reset')
    if (reset) { setAuthMode('reset'); setPanel('auth') }
    if (verify) {
      api('/auth/contact-verification', { method: 'POST', body: JSON.stringify({ token: verify }) })
        .then((result) => { setToast(result.message); history.replaceState({}, '', location.pathname) })
        .catch((error) => setToast(error.message))
    }
  }, [])

  useEffect(() => { localStorage.setItem('apotek-cart', JSON.stringify(cart)) }, [cart])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 4200)
    return () => clearTimeout(timer)
  }, [toast])

  const changeQuantity = (product, delta) => setCart((current) => {
    const found = current.find((item) => item.id === product.id)
    if (!found && delta > 0) return [...current, { ...product, quantity: 1 }]
    return current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + delta } : item).filter((item) => item.quantity > 0)
  })

  const openCheckout = () => {
    if (!user) { setAuthMode('login'); setPanel('auth'); return }
    setPanel('checkout')
  }

  const logOut = async () => {
    try { await api('/auth/logout', { method: 'POST', csrf }) } catch {}
    setUser(null); setCsrf(''); setToast('Anda telah keluar.')
  }

  const openWorkspace = (name) => {
    const next = new URL(location.href)
    next.searchParams.set('workspace', name)
    history.pushState({}, '', next)
    setPanel(name)
  }

  const returnToShop = () => {
    const next = new URL(location.href)
    next.searchParams.delete('workspace')
    history.pushState({}, '', next)
    setPanel('')
    setActiveOrder(null)
  }

  if (panel === 'auth') return <AuthModal mode={authMode} setMode={setAuthMode} onClose={() => setPanel('')} onAuthenticated={(person) => { setUser(person); setCsrf(person.csrfToken); setPanel(''); setToast(`Halo, ${person.name.split(' ')[0]}!`) }} onToast={setToast} />

  return (
    <div className="app-shell">
      <Header user={user} quantity={quantity} onCart={() => setPanel('cart')} onOrders={() => user ? setPanel('history') : (setAuthMode('login'),setPanel('auth'))} onLogin={() => { setAuthMode('login'); setPanel('auth') }} onLogout={logOut} onWorkspace={openWorkspace} workspace={workspace} onShop={returnToShop} />
      {workspace === 'pharmacy' ? <PharmacyWorkspace user={user} csrf={csrf} onLogin={() => { setAuthMode('login'); setPanel('auth') }} onBack={returnToShop} onToast={setToast} /> :
        workspace === 'admin' ? <AdminWorkspace user={user} csrf={csrf} onLogin={() => { setAuthMode('login'); setPanel('auth') }} onBack={returnToShop} onToast={setToast} /> : <>
          <main>
            <section className="hero wrap">
              <div className="hero-copy">
                <div className="eyebrow"><span className="eyebrow-dot" /> APOTEK PILIHAN, LEBIH DEKAT</div>
                <h1>Rawat diri dengan<br /><span>lebih mudah.</span></h1>
                <p>Temukan kebutuhan kesehatan dari apotek mitra. Praktis, jelas, dan ditemani apoteker.</p>
                <button className="button button-dark hero-button" onClick={() => searchRef.current?.focus()}>Cari kebutuhanmu <ArrowRight size={17} /></button>
                <div className="hero-proof"><div className="proof-avatars"><span>R</span><span>A</span><span>D</span></div><div><strong>Apoteker tepercaya</strong><small>Siap membantu setiap langkah</small></div><div className="proof-stars">★★★★★</div></div>
              </div>
              <div className="hero-art" aria-label="Ilustrasi apotek dan produk kesehatan">
                <div className="art-sun" /><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
                <div className="art-card art-card-left"><span className="art-tiny-icon"><ShieldCheck size={15} /></span><span>Dipercaya apoteker</span></div>
                <div className="art-pill-bottle"><div className="bottle-cap" /><div className="bottle-label"><span className="label-cross">+</span><small>DAILY<br />CARE</small></div></div>
                <div className="art-pill art-pill-a" /><div className="art-pill art-pill-b" />
                <div className="art-flower flower-a">✳</div><div className="art-flower flower-b">✳</div>
                <div className="art-card art-card-bottom"><span className="art-heart"><Heart size={16} fill="currentColor" /></span><span><strong>Jaga sehatmu</strong><small>mulai dari hari ini</small></span></div>
                <div className="art-leaf"><Leaf size={46} strokeWidth={1.3} /></div>
              </div>
            </section>
            <section className="search-wrap wrap">
              <div className="search-box"><Search size={19} /><input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadProducts(query, category)} placeholder="Cari obat, vitamin, dan kebutuhan kesehatan..." /><button aria-label="Cari" onClick={() => loadProducts(query, category)}><ArrowRight size={18} /></button></div>
              <div className="search-note"><LockKeyhole size={14} /> Resep diperiksa oleh apoteker sebelum pembayaran</div>
            </section>
            <section className="benefit-row wrap">
              <Benefit icon={ShieldCheck} title="Apotek tepercaya" copy="Mitra terverifikasi" />
              <Benefit icon={Stethoscope} title="Diperiksa apoteker" copy="Untuk produk resep" />
              <Benefit icon={PackageCheck} title="Status transparan" copy="Pantau setiap pesanan" />
              <Benefit icon={Heart} title="Peduli kesehatan" copy="Belanja lebih tenang" />
            </section>
            <section className="catalog wrap" id="catalog">
              <div className="section-heading"><div><span className="section-kicker">PILIHAN UNTUKMU</span><h2>Belanja kebutuhan sehat</h2><p>Harga indikatif. Total akhir ditinjau sebelum pesanan dibuat.</p></div><button className="text-link" onClick={() => { setCategory('Semua produk'); loadProducts(query, 'Semua produk') }}>Lihat semua <ArrowRight size={16} /></button></div>
              <div className="category-chips"><button className={category === 'Semua produk' ? 'chip active' : 'chip'} onClick={() => { setCategory('Semua produk'); loadProducts(query, 'Semua produk') }}>Semua produk</button>{categories.map((item) => <button className={category === item ? 'chip active' : 'chip'} key={item} onClick={() => { setCategory(item); loadProducts(query, item) }}>{item}</button>)}</div>
              {loadingProducts ? <div className="empty-state"><span className="loader" /> Memuat katalog...</div> : products.length ? <div className="product-grid">{products.map((product, index) => <ProductCard key={product.id} product={product} quantity={cart.find((item) => item.id === product.id)?.quantity || 0} onAdd={() => changeQuantity(product, 1)} onRemove={() => changeQuantity(product, -1)} delay={index * 40} />)}</div> : <div className="empty-state"><Search size={22} /><strong>Belum ada produk yang cocok</strong><span>Coba kata kunci atau kategori lain.</span><button className="button button-outline" onClick={() => { setQuery(''); setCategory('Semua produk'); loadProducts('', 'Semua produk') }}>Atur ulang pencarian</button></div>}
              <div className="catalog-footnote"><ShieldCheck size={15} /> Produk dengan label resep hanya dapat dibeli setelah ditinjau apoteker.</div>
            </section>
            <section className="support-banner wrap"><div className="support-icon"><HeartPulse size={23} /></div><div><span className="section-kicker">BUTUH BANTUAN?</span><h3>Kesehatanmu, prioritas kami.</h3><p>Apoteker dan tim bantuan siap membantumu memahami proses pemesanan.</p></div><button className="button button-dark" onClick={() => setToast('Silakan masuk untuk menghubungi tim bantuan.')}>Hubungi kami <ArrowRight size={16} /></button><div className="banner-deco">✳</div></section>
          </main>
          <Footer onPolicy={() => setToast('Kebijakan dan informasi operasional akan disediakan sebelum pilot.')} />
        </>}
      {panel === 'cart' && <CartDrawer cart={cart} subtotal={subtotal} onClose={() => setPanel('')} onChange={changeQuantity} onCheckout={openCheckout} />}
      {panel === 'checkout' && <CheckoutModal cart={cart} user={user} csrf={csrf} onClose={() => setPanel('')} onOrder={(order) => { setActiveOrder(order); setPanel('order'); setCart([]) }} onAuth={() => { setAuthMode('login'); setPanel('auth') }} onToast={setToast} />}
      {panel === 'order' && activeOrder && <OrderModal orderId={activeOrder.id} csrf={csrf} user={user} onClose={() => setPanel('')} onToast={setToast} />}
      {panel === 'history' && <OrderHistory csrf={csrf} onClose={() => setPanel('')} onOpen={(id) => { setActiveOrder({id});setPanel('order') }} onToast={setToast} />}
      {toast && <div className="toast" role="status"><span className="toast-mark"><Check size={15} /></span>{toast}<button onClick={() => setToast('')} aria-label="Tutup"><X size={16} /></button></div>}
    </div>
  )
}
