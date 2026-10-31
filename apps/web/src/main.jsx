import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, ArrowDownRight, ArrowLeft, ArrowRight, BadgeCheck, Check, ChevronDown, Clock3,
  FileHeart, FileText, Heart, HeartPulse, Leaf, LockKeyhole, LogIn, LogOut, MapPin, Menu,
  Minus, PackageCheck, Pill, Plus, Search, ShieldCheck, ShoppingBag, ShoppingCart, Stethoscope,
  Truck, UserRound, X,
} from 'lucide-react'
import './styles.css'

const api = async (path, { csrf, ...options } = {}) => {
  const headers = new Headers(options.headers || {})
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json')
  if (csrf && !['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase())) headers.set('x-csrf-token', csrf)
  const response = await fetch(`/api/v1${path}`, { credentials: 'include', ...options, headers })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(result.error?.message || 'Permintaan belum dapat diproses.'), { code: result.error?.code, status: response.status })
  return result.data
}

const money = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0))
const categoryIcon = (category) => category?.includes('Vitamin') ? HeartPulse : category?.includes('Alat') ? Activity : category?.includes('Pertolongan') ? FileHeart : Pill
const categoryColor = (category) => category?.includes('Vitamin') ? 'mint' : category?.includes('Alat') ? 'blue' : category?.includes('Pertolongan') ? 'peach' : 'lilac'
const statusLabel = {
  awaiting_prescription: 'Menunggu resep', awaiting_payment: 'Menunggu pembayaran', paid: 'Dibayar', processing: 'Disiapkan',
  ready: 'Siap diambil', in_delivery: 'Dalam pengiriman', completed: 'Selesai', cancelled: 'Dibatalkan', expired: 'Kedaluwarsa',
}

function App() {
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

function Header({ user, quantity, onCart, onOrders, onLogin, onLogout, onWorkspace, workspace, onShop }) {
  const roles = user?.roles?.map((item) => item.role) || []
  const canPharmacy = roles.includes('pharmacist') || roles.includes('pharmacy_staff')
  const canAdmin = roles.includes('admin') || roles.includes('cs') || roles.includes('finance') || roles.includes('pharmacist')
  return <header className="site-header"><div className="header-inner wrap"><a className="brand" href="/" onClick={(e) => { e.preventDefault(); onShop() }}><span className="brand-mark"><Plus size={20} strokeWidth={3} /></span><span>apotek<span className="brand-light">.id</span><small>SEHAT DIMULAI DARI SINI</small></span></a>
    <nav className="main-nav"><a href="#catalog" onClick={onShop}>Katalog</a><a href="#catalog" onClick={onShop}>Cara pesan</a><a href="#support" onClick={(e) => e.preventDefault()}>Bantuan</a></nav>
    <div className="header-actions">{user&&<button className="history-link" onClick={onOrders}>Pesanan</button>}{canPharmacy && <button className={workspace === 'pharmacy' ? 'workspace-link selected' : 'workspace-link'} onClick={() => onWorkspace('pharmacy')}>Panel apotek</button>}{canAdmin && <button className={workspace === 'admin' ? 'workspace-link selected' : 'workspace-link'} onClick={() => onWorkspace('admin')}>Admin</button>}{user ? <div className="account-menu"><span className="account-avatar">{user.name.slice(0,1).toUpperCase()}</span><span className="account-name">{user.name.split(' ')[0]}</span><button className="icon-button" aria-label="Keluar" onClick={onLogout}><LogOut size={17} /></button></div> : <button className="login-link" onClick={onLogin}>Masuk</button>}<button className="cart-button" onClick={onCart} aria-label={`Keranjang, ${quantity} item`}><ShoppingBag size={19} /><span>Keranjang</span>{quantity > 0 && <b>{quantity}</b>}</button></div>
  </div></header>
}

function Benefit({ icon: Icon, title, copy }) { return <div className="benefit"><span className="benefit-icon"><Icon size={18} /></span><span><strong>{title}</strong><small>{copy}</small></span></div> }

function ProductCard({ product, quantity, onAdd, onRemove, delay }) {
  const Icon = categoryIcon(product.category)
  return <article className="product-card" style={{ animationDelay: `${delay}ms` }}>
    <div className={`product-visual ${categoryColor(product.category)}`}><div className="product-visual-orbit" /><div className="product-pack"><span className="pack-brand">APOTEK.ID</span><span className="pack-symbol"><Icon size={27} strokeWidth={1.6} /></span><span className="pack-caption">{product.category.split(' ')[0].toUpperCase()}</span></div>{product.requiresPrescription && <span className="rx-tag">Resep</span>}<button className="favorite-button" aria-label="Simpan produk" onClick={(e) => { e.currentTarget.classList.toggle('favorited') }}><Heart size={17} /></button></div>
    <div className="product-info"><div className="product-category">{product.category}</div><h3>{product.name}</h3><p className="product-unit">{product.sellUnit}</p><div className="product-bottom"><div><strong>{money(product.indicativePrice)}</strong><small>harga indikatif</small></div>{quantity ? <div className="quantity-stepper"><button onClick={onRemove} aria-label="Kurangi"><Minus size={15} /></button><b>{quantity}</b><button onClick={onAdd} aria-label="Tambah"><Plus size={15} /></button></div> : <button className="add-button" disabled={!product.available} onClick={onAdd}>{product.available ? <Plus size={19} /> : 'Habis'}</button>}</div></div>
  </article>
}

function CartDrawer({ cart, subtotal, onClose, onChange, onCheckout }) {
  return <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><aside className="drawer"><div className="drawer-head"><div><span className="section-kicker">BELANJAANMU</span><h2>Keranjang <span>({cart.reduce((s,i)=>s+i.quantity,0)})</span></h2></div><button className="close-button" onClick={onClose} aria-label="Tutup"><X /></button></div>
    {cart.length ? <><div className="cart-list">{cart.map((item) => <div className="cart-line" key={item.id}><div className={`cart-thumb ${categoryColor(item.category)}`}>{React.createElement(categoryIcon(item.category),{size:20})}</div><div className="cart-line-info"><strong>{item.name}</strong><small>{item.sellUnit}{item.requiresPrescription && ' · Wajib resep'}</small><b>{money(item.indicativePrice)}</b></div><div className="quantity-stepper"><button onClick={() => onChange(item,-1)}><Minus size={14}/></button><b>{item.quantity}</b><button onClick={() => onChange(item,1)}><Plus size={14}/></button></div></div>)}</div><div className="drawer-total"><div><span>Subtotal indikatif</span><strong>{money(subtotal)}</strong></div><small>Harga dan ketersediaan diperiksa kembali sebelum pesanan dibuat.</small><button className="button button-dark full-width" onClick={onCheckout}>Lanjut ke checkout <ArrowRight size={17}/></button></div></> : <div className="cart-empty"><span className="empty-bag"><ShoppingBag size={27}/></span><strong>Keranjangmu masih kosong</strong><p>Yuk, temukan kebutuhan sehatmu.</p><button className="button button-outline" onClick={onClose}>Jelajahi produk</button></div>}
  </aside></div>
}

function OrderHistory({csrf,onClose,onOpen,onToast}){
  const [orders,setOrders]=useState([])
  const [loading,setLoading]=useState(true)
  useEffect(()=>{api('/orders').then((result)=>setOrders(result.items)).catch((error)=>onToast(error.message)).finally(()=>setLoading(false))},[])
  return <div className="overlay" onMouseDown={(e)=>e.target===e.currentTarget&&onClose()}><section className="modal history-modal"><div className="modal-head"><div><span className="section-kicker">PANTAU TRANSAKSI</span><h2>Pesananmu</h2></div><button className="close-button" onClick={onClose}><X/></button></div>{loading?<div className="empty-state"><span className="loader"/>Memuat riwayat...</div>:orders.length?<div className="history-list">{orders.map((order)=><button className="history-row" key={order.id} onClick={()=>onOpen(order.id)}><span className="history-symbol"><PackageCheck size={18}/></span><span className="history-copy"><strong>Pesanan #{order.id.slice(0,8).toUpperCase()}</strong><small>{new Date(order.createdAt).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})} · {order.fulfillmentMethod==='pickup'?'Ambil di apotek':'Pengiriman'}</small></span><span className="history-end"><span className={`status-pill status-${order.status}`}>{statusLabel[order.status]||order.status}</span><b>{money(order.total)}</b></span><ArrowRight size={15}/></button>)}</div>:<div className="empty-state"><span className="empty-icon"><ShoppingBag size={20}/></span><strong>Belum ada pesanan</strong><span>Pesanan yang kamu buat akan muncul di sini.</span></div>}</section></div>
}

function AuthModal({ mode, setMode, onClose, onAuthenticated, onToast }) {
  const [values, setValues] = useState({ name:'',contact:'',password:'',phone:'' })
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [devUrl,setDevUrl]=useState('')
  const [mfaRequired,setMfaRequired]=useState(false)
  const [mfaCode,setMfaCode]=useState('')
  const [noticeSuccess,setNoticeSuccess]=useState(false)
  useEffect(()=>{if(new URLSearchParams(location.search).has('reset'))setMode('reset')},[])
  const update=(key,value)=>setValues((current)=>({...current,[key]:value}))
  const submit=async(e)=>{
    e.preventDefault();setBusy(true);setError('');setNoticeSuccess(false)
    try{
      if(mode==='register'){
        const email=values.contact.includes('@')?values.contact:undefined
        const phone=values.phone||(!email?values.contact:undefined)
        const result=await api('/auth/register',{method:'POST',body:JSON.stringify({name:values.name,email,phone,password:values.password})})
        setDevUrl(result.verificationUrl||'');setError(result.message);setNoticeSuccess(true)
      }else if(mode==='forgot'){
        const result=await api('/auth/password-reset',{method:'POST',body:JSON.stringify({contact:values.contact})})
        setDevUrl(result.resetUrl||'');setError(result.message);setNoticeSuccess(true)
      }else if(mode==='reset'){
        const token=new URLSearchParams(location.search).get('reset')
        if(!token) throw new Error('Tautan pemulihan tidak valid.')
        const result=await api('/auth/password-reset',{method:'POST',body:JSON.stringify({token,newPassword:values.password})})
        setError(result.message);setNoticeSuccess(true);setMode('login');history.replaceState({},'',location.pathname)
      }else{
        const result=await api('/auth/login',{method:'POST',body:JSON.stringify({contact:values.contact,password:values.password,mfaCode})})
        onAuthenticated(result.user)
      }
    }catch(err){if(err.code==='MFA_REQUIRED')setMfaRequired(true);setError(err.message)}finally{setBusy(false)}
  }
  const title=mode==='register'?'Buat akun baru':mode==='forgot'?'Lupa kata sandi?':mode==='reset'?'Buat kata sandi baru':'Selamat datang kembali'
  return <div className="overlay auth-overlay" onMouseDown={(e)=>e.target===e.currentTarget&&onClose()}><section className="auth-card"><button className="close-button auth-close" onClick={onClose}><X/></button><div className="auth-brand"><span className="brand-mark"><Plus size={20}/></span></div><div className="eyebrow centered">APOTEK DIGITAL</div><h2>{title}</h2><p className="auth-subtitle">{mode==='register'?'Daftar untuk mulai berbelanja dan memantau pesananmu.':'Masuk untuk melanjutkan perjalanan sehatmu.'}</p>
    <form onSubmit={submit} className="auth-form">{mode==='register'&&<label>Nama lengkap<input required value={values.name} onChange={(e)=>update('name',e.target.value)} placeholder="Nama sesuai identitas" minLength="2" /></label>}<label>{mode==='register'?'Email atau nomor telepon':'Email atau nomor telepon'}<input required type="text" autoComplete="username" value={values.contact} onChange={(e)=>update('contact',e.target.value)} placeholder="nama@email.com" /></label>{mode==='register'&&!values.contact.includes('@')&&<label>Nomor telepon<input value={values.phone} onChange={(e)=>update('phone',e.target.value)} placeholder="+62 812 ..." /></label>}{mode!=='forgot'&&<label>Kata sandi<input required type="password" minLength="12" autoComplete={mode==='register'?'new-password':'current-password'} value={values.password} onChange={(e)=>update('password',e.target.value)} placeholder="Minimal 12 karakter" /></label>}{mode==='login'&&mfaRequired&&<label>Kode autentikator<input required inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={(e)=>setMfaCode(e.target.value)} placeholder="6 digit atau kode pemulihan" /></label>}{mode==='login'&&<button type="button" className="forgot-link" onClick={()=>{setError('');setMode('forgot')}}>Lupa kata sandi?</button>}{error&&<div className={noticeSuccess?'form-success':'form-error'}>{error}{devUrl&&<a href={devUrl}>Buka tautan</a>}</div>}<button className="button button-dark full-width" disabled={busy}>{busy?'Mohon tunggu...':mode==='register'?'Buat akun':mode==='forgot'?'Kirim petunjuk':mode==='reset'?'Simpan kata sandi':'Masuk'} <ArrowRight size={17}/></button></form>
    {mode==='login'?<p className="auth-switch">Belum punya akun? <button onClick={()=>{setError('');setDevUrl('');setMode('register')}}>Daftar sekarang</button></p>:mode==='register'?<p className="auth-switch">Sudah punya akun? <button onClick={()=>{setError('');setDevUrl('');setMode('login')}}>Masuk</button></p>:<p className="auth-switch"><button onClick={()=>setMode('login')}>Kembali ke halaman masuk</button></p>}
    <div className="auth-privacy"><LockKeyhole size={13}/> Data kesehatanmu hanya dapat diakses sesuai kewenangan.</div>
  </section></div>
}

function CheckoutModal({ cart, user, csrf, onClose, onOrder, onAuth, onToast }) {
  const [method,setMethod]=useState('pickup')
  const [addresses,setAddresses]=useState([])
  const [addressId,setAddressId]=useState('')
  const [newAddress,setNewAddress]=useState(false)
  const [address,setAddress]=useState({recipientName:user?.name||'',phone:user?.phone||'',addressText:'',city:'Jakarta Selatan',postalCode:''})
  const [quote,setQuote]=useState(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [accepted,setAccepted]=useState(false)
  useEffect(()=>{if(user) api('/addresses').then((r)=>{setAddresses(r.items);if(r.items[0])setAddressId(r.items[0].id)}).catch(()=>{})},[user])
  const saveAddress=async()=>{
    const result=await api('/addresses',{method:'POST',csrf,body:JSON.stringify(address)})
    setAddresses((old)=>[result,...old]);setAddressId(result.id);setNewAddress(false);return result.id
  }
  const createQuote=async(e)=>{
    e.preventDefault();setLoading(true);setError('')
    try{
      let selected=addressId
      if(method==='delivery'&&newAddress) selected=await saveAddress()
      const result=await api('/checkout/quote',{method:'POST',csrf,body:JSON.stringify({items:cart.map((i)=>({productId:i.id,quantity:i.quantity})),fulfillmentMethod:method,addressId:method==='delivery'?selected:undefined})})
      setQuote(result);setAccepted(false)
    }catch(err){setError(err.message)}finally{setLoading(false)}
  }
  const createOrder=async()=>{
    setLoading(true);setError('')
    try{
      const result=await api('/orders',{method:'POST',csrf,headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({quoteId:quote.quoteId})})
      onOrder(result)
    }catch(err){setError(err.message);if(err.code==='QUOTE_CHANGED'||err.code==='STOCK_UNAVAILABLE'){setQuote(null);setAccepted(false)}}finally{setLoading(false)}
  }
  const prescription=cart.some((item)=>item.requiresPrescription)
  const change=(key,value)=>setAddress((old)=>({...old,[key]:value}))
  return <div className="overlay" onMouseDown={(e)=>e.target===e.currentTarget&&onClose()}><section className="modal checkout-modal"><div className="modal-head"><div><span className="section-kicker">SATU LANGKAH LAGI</span><h2>Konfirmasi pesanan</h2></div><button className="close-button" onClick={onClose}><X/></button></div><div className="checkout-progress"><span className="progress-active"><i>1</i> Pemenuhan</span><b/><span className={quote?'progress-active':''}><i>2</i> Tinjau & pesan</span></div>
    {!user?.contactVerified&&<div className="notice notice-warm"><ShieldCheck size={18}/><span>Verifikasi kontak diperlukan sebelum checkout. <button onClick={onAuth}>Masuk atau buat akun</button></span></div>}
    {!quote?<form onSubmit={createQuote} className="checkout-body"><div className="fulfillment-toggle"><button type="button" className={method==='pickup'?'fulfillment-option active':'fulfillment-option'} onClick={()=>setMethod('pickup')}><MapPin size={18}/><span><strong>Ambil di apotek</strong><small>Ongkir Rp0, ambil saat siap</small></span><span className="radio-dot"/></button><button type="button" className={method==='delivery'?'fulfillment-option active':'fulfillment-option'} onClick={()=>setMethod('delivery')}><Truck size={18}/><span><strong>Antar ke alamat</strong><small>Untuk area layanan apotek</small></span><span className="radio-dot"/></button></div>{method==='delivery'&&<div className="notice notice-warm"><Truck size={18}/><span>Pengiriman belum aktif. Penyedia kurir dan tarif area perlu dikonfigurasi terlebih dahulu. Pilih ambil di apotek untuk melanjutkan.</span></div>}
      {method==='delivery'&&<div className="address-section">{addresses.length>0&&!newAddress&&<label>Alamat pengiriman<select value={addressId} onChange={(e)=>setAddressId(e.target.value)}>{addresses.map((a)=><option key={a.id} value={a.id}>{a.recipientName} · {a.addressText}, {a.city}</option>)}</select></label>}<button type="button" className="text-link add-address" onClick={()=>setNewAddress((v)=>!v)}>{newAddress?'Pilih alamat tersimpan':'+ Tambah alamat baru'}</button>{newAddress||!addresses.length?<div className="address-grid"><label>Nama penerima<input required value={address.recipientName} onChange={(e)=>change('recipientName',e.target.value)} /></label><label>Nomor telepon<input required value={address.phone} onChange={(e)=>change('phone',e.target.value)} /></label><label className="wide-field">Alamat lengkap<input required value={address.addressText} onChange={(e)=>change('addressText',e.target.value)} placeholder="Nama jalan, nomor, patokan" /></label><label>Kota<input required value={address.city} onChange={(e)=>change('city',e.target.value)} /></label><label>Kode pos<input required value={address.postalCode} onChange={(e)=>change('postalCode',e.target.value)} /></label></div>:null}</div>}
      {prescription&&<div className="notice notice-purple"><FileHeart size={18}/><span>Keranjang berisi produk resep. Apoteker akan memeriksa dokumen sebelum pembayaran tersedia.</span></div>}
      <div className="checkout-items"><div className="checkout-items-head"><strong>Ringkasan belanja</strong><span>{cart.reduce((s,i)=>s+i.quantity,0)} produk</span></div>{cart.map((item)=><div className="checkout-item" key={item.id}><span>{item.name} <small>× {item.quantity}</small>{item.requiresPrescription&&<em>Resep</em>}</span><b>{money(Number(item.indicativePrice)*item.quantity)}</b></div>)}</div>
      {error&&<div className="form-error">{error}</div>}<button className="button button-dark full-width" disabled={loading||!user?.contactVerified||!cart.length||method==='delivery'}>{loading?'Memeriksa apotek...':method==='delivery'?'Pengiriman belum tersedia':'Lihat rincian biaya'} <ArrowRight size={17}/></button><p className="fine-print">Belum ada stok yang direservasi. Rincian harga akhir perlu kamu setujui.</p>
    </form>:<div className="checkout-body quote-review"><div className="pharmacy-card"><span className="pharmacy-pin"><MapPin size={17}/></span><div><small>APOTEK YANG MEMENUHI PESANAN</small><strong>{quote.pharmacy.name}</strong><span>{quote.pharmacy.address}</span></div><BadgeCheck size={18} className="verified-icon"/></div><div className="cost-breakdown">{[['Subtotal',quote.totals.subtotal],['Diskon','0.00'],['Ongkos kirim',quote.totals.shippingFee],['Biaya layanan',quote.totals.serviceFee]].map(([label,value])=><div key={label}><span>{label}</span><b>{money(value)}</b></div>)}<div className="cost-total"><strong>Total</strong><strong>{money(quote.totals.total)}</strong></div></div>{quote.needsPrescription&&<div className="notice notice-purple"><Clock3 size={18}/><span>Jam pemeriksaan resep: {quote.prescriptionHours.map((h)=>`${['Min','Sen','Sel','Rab','Kam','Jum','Sab'][h.weekday]} ${h.opensAt.slice(0,5)}–${h.closesAt.slice(0,5)}`).join(' · ')} ({quote.prescriptionHours[0]?.timezone}). Reservasi berlangsung {quote.reservationMinutes} menit.</span></div>}<label className="consent-row"><input type="checkbox" checked={accepted} onChange={(e)=>setAccepted(e.target.checked)}/><span>Saya telah meninjau harga dan biaya. Saya memahami bahwa jumlah akan direservasi selama {quote.reservationMinutes} menit setelah pesanan dibuat.</span></label>{error&&<div className="form-error">{error}</div>}<button className="button button-dark full-width" disabled={!accepted||loading} onClick={createOrder}>{loading?'Membuat pesanan...':'Buat pesanan'} <ArrowRight size={17}/></button><button className="button button-quiet full-width" onClick={()=>{setQuote(null);setError('')}}>Kembali ubah pemenuhan</button><p className="fine-print">Quote berlaku sampai {new Date(quote.expiresAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}. Harga dan stok diperiksa lagi saat pesanan dibuat.</p></div>}
  </section></div>
}

function OrderModal({orderId,csrf,user,onClose,onToast}){
  const [order,setOrder]=useState(null)
  const [loading,setLoading]=useState(true)
  const [file,setFile]=useState(null)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [prescriptionMessages,setPrescriptionMessages]=useState([])
  const [clarificationReply,setClarificationReply]=useState('')
  const [cancelReason,setCancelReason]=useState('')
  const [cancelRequested,setCancelRequested]=useState(false)
  const refresh=()=>Promise.all([api(`/orders/${orderId}`),api(`/orders/${orderId}/prescription-messages`)]).then(([details,messages])=>{setOrder(details);setPrescriptionMessages(messages.items)}).catch((e)=>onToast(e.message)).finally(()=>setLoading(false))
  useEffect(()=>{refresh()},[])
  const upload=async()=>{
    if(!file)return
    const form=new FormData();form.append('file',file)
    setBusy(true)
    try{await api(`/orders/${orderId}/prescriptions`,{method:'POST',csrf,body:form});setFile(null);await refresh();onToast('Resep berhasil diunggah. Apoteker akan meninjaunya.')}
    catch(e){onToast(e.message)}finally{setBusy(false)}
  }
  const openCase=async()=>{
    if(!message.trim())return
    setBusy(true)
    try{await api(`/orders/${orderId}/support-cases`,{method:'POST',csrf,body:JSON.stringify({category:'order_help',description:message})});setMessage('');onToast('Permintaan bantuan telah dicatat.')}
    catch(e){onToast(e.message)}finally{setBusy(false)}
  }
  const replyToPharmacist=async()=>{
    if(!clarificationReply.trim())return
    setBusy(true)
    try{await api(`/orders/${orderId}/prescription-messages`,{method:'POST',csrf,body:JSON.stringify({message:clarificationReply})});setClarificationReply('');await refresh();onToast('Jawaban klarifikasi terkirim. Apoteker akan meninjaunya kembali.')}
    catch(e){onToast(e.message)}finally{setBusy(false)}
  }
  const requestCancellation=async()=>{
    if(!cancelReason.trim())return
    setBusy(true)
    try{await api(`/orders/${orderId}/cancellation-requests`,{method:'POST',csrf,body:JSON.stringify({reason:cancelReason})});setCancelRequested(true);setCancelReason('');onToast('Permintaan pembatalan tercatat dan menunggu keputusan petugas.')}
    catch(e){onToast(e.message)}finally{setBusy(false)}
  }
  if(loading)return <div className="overlay"><section className="modal order-modal"><div className="empty-state"><span className="loader"/>Memuat pesanan...</div></section></div>
  if(!order)return null
  const statusIndex=['awaiting_prescription','awaiting_payment','paid','processing','ready','in_delivery','completed'].indexOf(order.status)
  return <div className="overlay" onMouseDown={(e)=>e.target===e.currentTarget&&onClose()}><section className="modal order-modal"><div className="modal-head"><div><span className="section-kicker">PESANAN KAMU</span><h2>Pesanan #{order.id.slice(0,8).toUpperCase()}</h2></div><button className="close-button" onClick={onClose}><X/></button></div><div className="order-success"><span className="success-ring"><Check size={23}/></span><div><strong>{order.status==='awaiting_prescription'?'Pesanan dibuat, selanjutnya unggah resep':statusLabel[order.status]}</strong><span>Apotek {order.pharmacyName} · {new Date(order.createdAt).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})}</span></div></div><div className="order-timeline">{['Pesanan dibuat','Resep ditinjau','Pembayaran','Penyiapan','Selesai'].map((step,index)=><div className={index<=Math.max(statusIndex,0)?'timeline-step done':'timeline-step'} key={step}><i>{index<Math.max(statusIndex,0)?<Check size={12}/>:index+1}</i><span>{step}</span></div>)}</div><div className="order-detail-items">{order.items.map((item)=><div className="checkout-item" key={item.id}><span>{item.name} <small>× {item.quantity} {item.sellUnit}</small>{item.requiresPrescription&&<em>Resep</em>}</span><b>{money(item.lineTotal)}</b></div>)}</div><div className="cost-total order-total"><strong>Total</strong><strong>{money(order.totals.total)}</strong></div>{order.fulfillmentMethod==='pickup'&&<div className="pickup-code"><MapPin size={17}/><span>Kode pengambilan</span><strong>{order.pickupCode}</strong><small>Tunjukkan kode ini saat mengambil di apotek.</small></div>}
    {order.status==='awaiting_prescription'&&order.prescriptions?.some((p)=>p.status==='clarification')&&<div className="clarification-panel"><div className="clarification-title"><FileHeart size={18}/><strong>Apoteker meminta klarifikasi</strong></div>{prescriptionMessages.filter((item)=>item.type==='clarification_request'||item.type==='customer_response').map((item)=><div className={item.type==='customer_response'?'clarification-message customer':'clarification-message'} key={item.id}><small>{item.type==='customer_response'?'Jawabanmu':'Catatan apoteker'}</small><p>{item.body}</p></div>)}<label>Jawaban klarifikasi<textarea value={clarificationReply} onChange={(e)=>setClarificationReply(e.target.value)} rows="2" maxLength="2000" placeholder="Tulis jawaban untuk apoteker"/></label><button className="button button-outline full-width" disabled={!clarificationReply.trim()||busy} onClick={replyToPharmacist}>Kirim jawaban</button><small>Jawabanmu tidak otomatis menyetujui resep. Apoteker akan membuat keputusan baru.</small></div>}
    {order.status==='awaiting_prescription'&&<div className="upload-box"><div><FileText size={20}/><span><strong>Unggah resep</strong><small>Foto jelas atau PDF · maks. 8 MB</small></span></div><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e)=>setFile(e.target.files?.[0])}/><button className="button button-dark full-width" disabled={!file||busy} onClick={upload}>{busy?'Mengunggah...':'Kirim ke apoteker'} <ArrowRight size={16}/></button>{order.prescriptions?.map((p)=><small key={p.id} className="uploaded-status">Dokumen {p.revision} · {p.status==='pending'?'Menunggu pemeriksaan':p.status}</small>)}</div>}
    {order.status==='awaiting_payment'&&<div className="notice notice-warm"><Clock3 size={18}/><span>Persyaratan resep terpenuhi. Integrasi pembayaran belum dikonfigurasi untuk lingkungan ini.</span></div>}
    {['awaiting_prescription','awaiting_payment','paid','processing','ready'].includes(order.status)&&<div className="cancel-section">{cancelRequested?<div className="notice notice-warm"><Clock3 size={17}/><span>Permintaan pembatalan menunggu keputusan petugas.</span></div>:<><button className="cancel-link" onClick={()=>setCancelReason((old)=>old?'':' ') }>Ajukan pembatalan</button>{cancelReason!==''&&<><label>Alasan pembatalan<textarea value={cancelReason.trimStart()} onChange={(e)=>setCancelReason(e.target.value)} rows="2" maxLength="500" placeholder="Jelaskan alasanmu"/></label><button className="button button-outline full-width" disabled={cancelReason.trim().length<3||busy} onClick={requestCancellation}>Kirim permintaan pembatalan</button></>}</>}</div>}
    <div className="order-help"><label>Butuh bantuan terkait pesanan ini?<textarea value={message} onChange={(e)=>setMessage(e.target.value)} placeholder="Ceritakan kendalamu" rows="2" maxLength="2000"/></label><button className="button button-outline full-width" disabled={!message.trim()||busy} onClick={openCase}>Kirim permintaan bantuan</button></div>
  </section></div>
}

function PharmacyWorkspace({user,csrf,onLogin,onBack,onToast}){
  const [orders,setOrders]=useState([])
  const [inventory,setInventory]=useState([])
  const [selected,setSelected]=useState(null)
  const [adjustment,setAdjustment]=useState(null)
  const [delta,setDelta]=useState('')
  const [adjustmentReason,setAdjustmentReason]=useState('')
  const [loading,setLoading]=useState(false)
  const [reason,setReason]=useState('')
  const [fulfillmentOutcome,setFulfillmentOutcome]=useState('')
  const [fulfillmentNote,setFulfillmentNote]=useState('')
  const [lotEntries,setLotEntries]=useState({})
  const [pickupCode,setPickupCode]=useState('')
  const [proofReference,setProofReference]=useState('')
  const canAccess=user?.roles?.some((r)=>['pharmacist','pharmacy_staff'].includes(r.role))
  const isPharmacist=user?.roles?.some((r)=>r.role==='pharmacist')
  const reload=async()=>{
    if(!user)return
    setLoading(true)
    try{const[o,i]=await Promise.all([api('/orders'),api('/pharmacy/inventory')]);setOrders(o.items);setInventory(i.items)}
    catch(e){onToast(e.message)}finally{setLoading(false)}
  }
  useEffect(()=>{reload()},[user?.id])
  if(!user)return <WorkspaceGate title="Panel apotek" onLogin={onLogin} onBack={onBack}/>
  if(!canAccess)return <WorkspaceDenied title="Panel apotek" onBack={onBack}/>
  const detail=async(id)=>{
    try{const order=await api(`/orders/${id}`);setSelected(order);setFulfillmentOutcome('');setFulfillmentNote('');setLotEntries(Object.fromEntries(order.items.filter((item)=>item.batchTrackingRequired).map((item)=>[item.id,{lots:[{lotNumber:'',expiresOn:'',quantity:item.quantity}]}])));setPickupCode('');setProofReference('')}
    catch(e){onToast(e.message)}
  }
  const review=async(prescription,decision,order)=>{
    if(!prescription){onToast('Pelanggan belum mengunggah resep.');return}
    try{await api(`/prescriptions/${prescription.id}/reviews`,{method:'POST',csrf,body:JSON.stringify({decision,expectedReviewVersion:order.reviewVersion??0,orderItemIds:order.items.filter((i)=>i.requiresPrescription).map((i)=>i.id),reason})});setReason('');onToast('Keputusan apoteker tersimpan.');await reload();await detail(order.id)}
    catch(e){onToast(e.message)}
  }
  const startProcessing=async(order)=>{
    try{await api(`/orders/${order.id}/fulfillment`,{method:'POST',csrf,body:JSON.stringify({command:'start_processing'})});onToast('Pesanan mulai disiapkan.');await reload();await detail(order.id)}
    catch(e){onToast(e.message)}
  }
  const recordChecks=async(order)=>{
    try{
      const passed=fulfillmentOutcome==='passed'
      await api(`/orders/${order.id}/fulfillment-checks`,{method:'POST',csrf,body:JSON.stringify({passed,pharmacistCheck:isPharmacist&&passed,items:order.items.map((item)=>({orderItemId:item.id,quantity:item.quantity,lots:passed&&item.batchTrackingRequired?(lotEntries[item.id]?.lots||[]).map((lot)=>({...lot,quantity:Number(lot.quantity)})):[]})),note:passed?'Pemeriksaan produk, jumlah, kondisi, dan kedaluwarsa selesai.':fulfillmentNote})})
      onToast(passed?'Pemeriksaan akhir lulus dan tersimpan.':'Kendala tercatat dan kasus operasional dibuka untuk CS.');await reload();await detail(order.id)
    }catch(e){onToast(e.message)}
  }
  const markReady=async(order)=>{
    try{await api(`/orders/${order.id}/fulfillment`,{method:'POST',csrf,body:JSON.stringify({command:'mark_ready'})});onToast('Pesanan siap diserahkan.');await reload();await detail(order.id)}
    catch(e){onToast(e.message)}
  }
  const confirmPickup=async(order)=>{
    try{await api(`/orders/${order.id}/fulfillment`,{method:'POST',csrf,body:JSON.stringify({command:'confirm_pickup',pickupCode,proofReference})});onToast('Pengambilan pesanan tercatat.');await reload();await detail(order.id)}
    catch(e){onToast(e.message)}
  }
  const saveAdjustment=async(event)=>{
    event.preventDefault()
    try{await api('/pharmacy/inventory-adjustments',{method:'POST',csrf,body:JSON.stringify({pharmacyId:adjustment.pharmacyId,productId:adjustment.productId,delta:Number(delta),reason:adjustmentReason})});setAdjustment(null);setDelta('');setAdjustmentReason('');onToast('Alokasi stok daring diperbarui.');await reload()}
    catch(e){onToast(e.message)}
  }
  const updateLot=(itemId,index,field,value)=>setLotEntries((old)=>({...old,[itemId]:{lots:(old[itemId]?.lots||[]).map((lot,i)=>i===index?{...lot,[field]:value}:lot)}}))
  const addLot=(item)=>setLotEntries((old)=>{const lots=(old[item.id]?.lots||[]).map((lot)=>({...lot}));const first=lots[0];if(first&&Number(first.quantity)>1)first.quantity=Number(first.quantity)-1;lots.push({lotNumber:'',expiresOn:'',quantity:1});return {...old,[item.id]:{lots}}})
  const removeLot=(itemId,index)=>setLotEntries((old)=>({...old,[itemId]:{lots:(old[itemId]?.lots||[]).filter((_,i)=>i!==index)}}))
  const lotDataComplete=selected?.items.filter((item)=>item.batchTrackingRequired).every((item)=>{
    const lots=lotEntries[item.id]?.lots||[]
    return lots.length>0&&lots.every((lot)=>lot.lotNumber.trim()&&lot.expiresOn&&Number.isInteger(Number(lot.quantity))&&Number(lot.quantity)>0)&&lots.reduce((sum,lot)=>sum+Number(lot.quantity||0),0)===Number(item.quantity)
  })??true
  const canMarkReady=selected?.fulfillmentCheck?.passed===true&&(!selected.items.some((item)=>item.requiresPrescription)||selected.fulfillmentCheck.pharmacistCheck===true)
  const canRecordChecks=Boolean(fulfillmentOutcome)&&(fulfillmentOutcome==='passed'?lotDataComplete:fulfillmentNote.trim().length>=3)
  return <main className="workspace wrap">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Kembali ke katalog</button>
    <div className="workspace-heading"><div><span className="section-kicker">PORTAL MITRA</span><h1>Ruang kerja apotek</h1><p>Kelola antrean resep, siapkan pesanan, dan pantau alokasi stok daring.</p></div><div className="workspace-heading-icon"><Stethoscope size={28}/></div></div>
    <div className="workspace-metrics"><Metric label="Antrean resep" value={orders.filter(o=>o.status==='awaiting_prescription').length} icon={FileHeart}/><Metric label="Perlu disiapkan" value={orders.filter(o=>o.status==='paid').length} icon={PackageCheck}/><Metric label="Produk tersedia" value={inventory.filter(i=>i.available>0).length} icon={ShoppingBag}/><Metric label="Pesanan hari ini" value={orders.filter(o=>new Date(o.createdAt).toDateString()===new Date().toDateString()).length} icon={Activity}/></div>
    <div className="workspace-columns">
      <section className="workspace-panel"><div className="panel-title"><div><h2>Antrean pesanan</h2><p>Pesanan sesuai penugasan apotekmu.</p></div><button className="icon-button" onClick={reload}><Activity size={17}/></button></div>{loading?<div className="empty-state"><span className="loader"/></div>:orders.length?<div className="pharmacy-orders">{orders.map((order)=><button key={order.id} className="pharmacy-order-row" onClick={()=>detail(order.id)}><span className="order-row-icon"><PackageCheck size={18}/></span><span className="pharmacy-order-info"><strong>#{order.id.slice(0,8).toUpperCase()}</strong><small>{order.fulfillmentMethod==='pickup'?'Ambil di apotek':'Pengiriman'} · {new Date(order.createdAt).toLocaleDateString('id-ID')}</small></span><span className={`status-pill status-${order.status}`}>{statusLabel[order.status]||order.status}</span><ChevronDown size={16}/></button>)}</div>:<div className="empty-state compact"><span className="empty-icon"><Check size={20}/></span><strong>Belum ada pesanan</strong><span>Pesanan baru akan muncul di sini.</span></div>}</section>
      <section className="workspace-panel"><div className="panel-title"><div><h2>Alokasi stok daring</h2><p>Terpisah dari stok kasir toko.</p></div><button className="text-link" onClick={()=>onToast('Perubahan stok dicatat dengan alasan dan tidak dapat melewati reservasi aktif.')}>Aturan stok <ArrowRight size={14}/></button></div><div className="inventory-list">{inventory.slice(0,8).map((item)=><div className="inventory-row" key={`${item.pharmacyId}-${item.productId}`}><span><strong>{item.name}</strong><small>{item.sellUnit} · {money(item.unitPrice)}</small></span><span className={item.available?'stock-count':'stock-count out'}>{item.available}<small>tersedia</small></span><button className="stock-edit-button" onClick={()=>{setAdjustment(item);setDelta('');setAdjustmentReason('')}}>Koreksi</button></div>)}</div></section>
    </div>
    {adjustment&&<div className="overlay" onMouseDown={(e)=>e.target===e.currentTarget&&setAdjustment(null)}><section className="modal adjustment-modal"><div className="modal-head"><div><span className="section-kicker">ALOKASI DARING</span><h2>Koreksi stok</h2></div><button className="close-button" onClick={()=>setAdjustment(null)}><X/></button></div><div className="adjustment-product"><strong>{adjustment.name}</strong><small>{adjustment.sellUnit} · tersedia {adjustment.available} · terreservasi {adjustment.reserved}</small></div><form className="auth-form" onSubmit={saveAdjustment}><label>Perubahan jumlah unit<input required type="number" step="1" value={delta} onChange={(e)=>setDelta(e.target.value)} placeholder="Gunakan angka positif atau negatif"/></label><label>Alasan koreksi<input required minLength="3" maxLength="500" value={adjustmentReason} onChange={(e)=>setAdjustmentReason(e.target.value)} placeholder="Hasil pemeriksaan stok fisik"/></label><button className="button button-dark full-width" disabled={!delta||Number(delta)===0}>Simpan koreksi stok <ArrowRight size={16}/></button></form></section></div>}
    {selected&&<div className="overlay" onMouseDown={(e)=>e.target===e.currentTarget&&setSelected(null)}><section className="modal order-modal"><div className="modal-head"><div><span className="section-kicker">DETAIL PESANAN</span><h2>#{selected.id.slice(0,8).toUpperCase()}</h2></div><button className="close-button" onClick={()=>setSelected(null)}><X/></button></div><div className="order-success"><span className="success-ring"><PackageCheck size={22}/></span><div><strong>{statusLabel[selected.status]}</strong><span>{selected.pharmacyName} · {selected.fulfillmentMethod==='pickup'?'Ambil di apotek':'Pengiriman'}</span></div></div><div className="order-detail-items">{selected.items.map((item)=><div className="checkout-item" key={item.id}><span>{item.name}<small>× {item.quantity} {item.sellUnit}</small>{item.requiresPrescription&&<em>Resep</em>}</span><b>{money(item.lineTotal)}</b></div>)}</div>{selected.prescriptions?.map((prescription)=><div className="prescription-review-card" key={prescription.id}><div><FileHeart size={19}/><span><strong>Dokumen resep · revisi {prescription.revision}</strong><small>Status: {prescription.status}</small></span></div><a className="text-link" href={`/api/v1/prescriptions/${prescription.id}/file`} target="_blank" rel="noreferrer">Buka berkas <ArrowRight size={14}/></a></div>)}{selected.status==='awaiting_prescription'&&selected.prescriptions?.length>0&&isPharmacist&&<div className="review-action"><label>Catatan untuk pelanggan<input value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="Opsional untuk persetujuan, wajib untuk klarifikasi"/></label><div className="review-buttons"><button className="button button-outline" onClick={()=>review(selected.prescriptions[0],'clarification',selected)}>Minta klarifikasi</button><button className="button button-danger" onClick={()=>review(selected.prescriptions[0],'rejected',selected)}>Tolak resep</button><button className="button button-dark" onClick={()=>review(selected.prescriptions[0],'approved',selected)}>Setujui</button></div><small>Keputusan resep hanya tersedia untuk akun apoteker.</small></div>}{selected.status==='paid'&&<button className="button button-dark full-width" onClick={()=>startProcessing(selected)}>Mulai penyiapan <ArrowRight size={16}/></button>}{selected.status==='processing'&&<div className="review-action">{selected.fulfillmentCheck&&<div className={`fulfillment-result ${selected.fulfillmentCheck.passed?'passed':'failed'}`}><strong>Pemeriksaan terakhir: {selected.fulfillmentCheck.passed?'Lulus':'Ada kendala'}</strong>{selected.fulfillmentCheck.note&&<small>{selected.fulfillmentCheck.note}</small>}</div>}<label>Hasil pemeriksaan<select value={fulfillmentOutcome} onChange={(e)=>setFulfillmentOutcome(e.target.value)}><option value="">Pilih hasil pemeriksaan</option><option value="passed">Lulus</option><option value="failed">Ada kendala</option></select></label>{fulfillmentOutcome==='failed'&&<label>Jelaskan kendala<textarea className="fulfillment-note" value={fulfillmentNote} onChange={(e)=>setFulfillmentNote(e.target.value)} rows="3" maxLength="1000" placeholder="Produk tidak sesuai, stok fisik tidak cocok, atau kendala lainnya"/></label>}{selected.items.some((item)=>item.batchTrackingRequired)&&fulfillmentOutcome==='passed'&&<div className="batch-check-list"><strong>Catatan lot dan kedaluwarsa</strong>{selected.items.filter((item)=>item.batchTrackingRequired).map((item)=><fieldset className="batch-item" key={item.id}><legend>{item.name} · {item.quantity} {item.sellUnit}</legend>{(lotEntries[item.id]?.lots||[]).map((lot,index)=><div className="batch-lot-row" key={`${item.id}-${index}`}><label>Nomor lot<input maxLength="120" value={lot.lotNumber} onChange={(e)=>updateLot(item.id,index,'lotNumber',e.target.value)} placeholder="Nomor pada kemasan"/></label><label>Kedaluwarsa<input type="date" value={lot.expiresOn} onChange={(e)=>updateLot(item.id,index,'expiresOn',e.target.value)}/></label><label>Jumlah unit<input type="number" min="1" max={item.quantity} step="1" value={lot.quantity} onChange={(e)=>updateLot(item.id,index,'quantity',e.target.value)}/></label><button type="button" className="icon-button" disabled={(lotEntries[item.id]?.lots||[]).length<2} title="Hapus lot" onClick={()=>removeLot(item.id,index)}><Minus size={15}/></button></div>)}<button type="button" className="text-link batch-add" disabled={(lotEntries[item.id]?.lots||[]).reduce((sum,lot)=>sum+Number(lot.quantity||0),0)>=Number(item.quantity)} onClick={()=>addLot(item)}><Plus size={14}/> Tambah lot</button></fieldset>)}</div>}{fulfillmentOutcome==='passed'&&<small>Untuk pesanan resep, pemeriksaan akhir hanya dapat dicatat apoteker.</small>}<button className="button button-outline full-width" disabled={!canRecordChecks} onClick={()=>recordChecks(selected)}>Catat pemeriksaan akhir</button><button className="button button-dark full-width" disabled={!canMarkReady} onClick={()=>markReady(selected)}>Tandai siap <ArrowRight size={16}/></button><small>Stok akan dikonsumsi saat pesanan ditandai siap.</small></div>}{selected.status==='ready'&&selected.fulfillmentMethod==='pickup'&&<div className="review-action"><label>Kode pengambilan dari pelanggan<input value={pickupCode} onChange={(e)=>setPickupCode(e.target.value)} placeholder="6 karakter"/></label><label>Referensi bukti serah terima<input value={proofReference} onChange={(e)=>setProofReference(e.target.value)} placeholder="Nomor bukti atau catatan SOP"/></label><button className="button button-dark full-width" disabled={!pickupCode||!proofReference} onClick={()=>confirmPickup(selected)}>Konfirmasi pengambilan</button></div>}</section></div>}
  </main>
}

function AdminWorkspace({user,csrf,onLogin,onBack,onToast}){
  const [orders,setOrders]=useState([])
  const [products,setProducts]=useState([])
  const [pharmacies,setPharmacies]=useState([])
  const [inventory,setInventory]=useState([])
  const [cancellations,setCancellations]=useState([])
  const [supportCases,setSupportCases]=useState([])
  const [loading,setLoading]=useState(false)
  const [tab,setTab]=useState(()=>user?.roles?.some((r)=>r.role==='pharmacist')&&!user.roles.some((r)=>['admin','cs'].includes(r.role))?'products':'orders')
  const [showProductForm,setShowProductForm]=useState(false)
  const [stockProduct,setStockProduct]=useState(null)
  const [productDraft,setProductDraft]=useState({sku:'',name:'',description:'',category:'',sellUnit:'',requiresPrescription:false,batchTrackingRequired:false,specialHandling:false})
  const [stockDraft,setStockDraft]=useState({pharmacyId:'',onHand:0,unitPrice:'',reason:''})
  const canAccess=user?.roles?.some((r)=>['admin','cs','pharmacist'].includes(r.role))
  const isAdmin=user?.roles?.some((r)=>r.role==='admin')
  const isPharmacist=user?.roles?.some((r)=>r.role==='pharmacist')
  const canOperate=user?.roles?.some((r)=>['admin','cs'].includes(r.role))
  const canViewCases=user?.roles?.some((r)=>['admin','cs','finance'].includes(r.role))
  const reload=async()=>{
    if(!user)return
    setLoading(true)
    try{
      const [orderResult,productResult,pharmacyResult,cancellationResult,caseResult,inventoryResult]=await Promise.all([
        canOperate?api('/admin/orders'):Promise.resolve({items:[]}),
        isAdmin||isPharmacist?api('/admin/products'):api('/products'),
        canOperate?api('/admin/pharmacies'):Promise.resolve({items:[]}),
        canOperate?api('/admin/cancellation-requests'):Promise.resolve({items:[]}),
        canViewCases?api('/admin/support-cases'):Promise.resolve({items:[]}),
        isAdmin?api('/pharmacy/inventory'):Promise.resolve({items:[]}),
      ])
      setOrders(orderResult.items);setProducts(productResult.items);setPharmacies(pharmacyResult.items);setCancellations(cancellationResult.items);setSupportCases(caseResult.items);setInventory(inventoryResult.items)
    }catch(e){onToast(e.message)}finally{setLoading(false)}
  }
  useEffect(()=>{reload()},[user?.id])
  if(!user)return <WorkspaceGate title="Panel operasional" onLogin={onLogin} onBack={onBack}/>
  if(!canAccess)return <WorkspaceDenied title="Panel operasional" onBack={onBack}/>
  const setProductStatus=async(product,status)=>{
    try{await api(`/admin/products/${product.id}`,{method:'PATCH',csrf,body:JSON.stringify({status})});onToast(`${product.name} ${status==='active'?'diaktifkan':'dinonaktifkan'}.`);reload()}
    catch(e){onToast(e.message)}
  }
  const createProduct=async(event)=>{
    event.preventDefault()
    try{
      await api('/admin/products',{method:'POST',csrf,body:JSON.stringify(productDraft)})
      setProductDraft({sku:'',name:'',description:'',category:'',sellUnit:'',requiresPrescription:false,batchTrackingRequired:false,specialHandling:false})
      setShowProductForm(false);onToast('Produk dibuat dalam status nonaktif. Atur stok sebelum mengaktifkannya.');await reload()
    }catch(e){onToast(e.message)}
  }
  const openStockEditor=(product)=>{
    const activePharmacy=pharmacies.find((pharmacy)=>pharmacy.status==='active'&&inventory.some((item)=>item.productId===product.id&&item.pharmacyId===pharmacy.id))||pharmacies.find((pharmacy)=>pharmacy.status==='active')
    const existing=inventory.find((item)=>item.productId===product.id&&item.pharmacyId===activePharmacy?.id)
    setStockProduct(product);setStockDraft({pharmacyId:activePharmacy?.id||'',onHand:existing?.onHand??0,unitPrice:existing?.unitPrice??product.indicativePrice??'0.00',reason:''})
  }
  const changeStockPharmacy=(pharmacyId)=>{
    const existing=inventory.find((item)=>item.productId===stockProduct?.id&&item.pharmacyId===pharmacyId)
    setStockDraft((old)=>({...old,pharmacyId,onHand:existing?.onHand??0,unitPrice:existing?.unitPrice??stockProduct?.indicativePrice??'0.00'}))
  }
  const saveStock=async(event)=>{
    event.preventDefault()
    try{
      await api('/admin/inventory',{method:'POST',csrf,body:JSON.stringify({...stockDraft,productId:stockProduct.id,onHand:Number(stockDraft.onHand),unitPrice:Number(stockDraft.unitPrice)})})
      setStockProduct(null);onToast('Alokasi dan harga stok daring diperbarui.');await reload()
    }catch(e){onToast(e.message)}
  }
  const setPharmacyStatus=async(pharmacy,status)=>{
    try{await api(`/admin/pharmacies/${pharmacy.id}`,{method:'PATCH',csrf,body:JSON.stringify({status})});onToast(`${pharmacy.name}: status diperbarui.`);reload()}
    catch(e){onToast(e.message)}
  }
  const decideCancellation=async(request,decision)=>{
    try{await api(`/cancellation-requests/${request.id}/decision`,{method:'POST',csrf,body:JSON.stringify({decision,reason:decision==='approved'?'Disetujui tim operasional':'Ditolak tim operasional'})});onToast(`Permintaan pembatalan ${decision==='approved'?'disetujui':'ditolak'}.`);reload()}
    catch(e){onToast(e.message)}
  }
  const closeSupportCase=async(item)=>{
    try{await api(`/support-cases/${item.id}`,{method:'PATCH',csrf,body:JSON.stringify({status:'closed'})});onToast('Kasus bantuan ditutup.');reload()}
    catch(e){onToast(e.message)}
  }
  return <main className="workspace wrap">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Kembali ke katalog</button>
    <div className="workspace-heading"><div><span className="section-kicker">OPERASIONAL</span><h1>Panel pengelola</h1><p>Pantau transaksi, katalog, dan status apotek mitra.</p></div><div className="workspace-heading-icon admin-icon"><Activity size={27}/></div></div>
    <div className="workspace-metrics"><Metric label="Total pesanan" value={orders.length} icon={ShoppingBag}/><Metric label="Menunggu resep" value={orders.filter(o=>o.status==='awaiting_prescription').length} icon={FileHeart}/><Metric label="Dalam proses" value={orders.filter(o=>['paid','processing','ready','in_delivery'].includes(o.status)).length} icon={Clock3}/><Metric label="Apotek mitra" value={pharmacies.length} icon={MapPin}/></div>
    <section className="workspace-panel admin-panel">
      <div className="panel-title"><div><h2>Ringkasan operasional</h2><p>Data seperlunya untuk tim layanan dan pengelola.</p></div><div className="tab-switch"><button className={tab==='orders'?'active':''} onClick={()=>setTab('orders')}>Pesanan</button><button className={tab==='products'?'active':''} onClick={()=>setTab('products')}>Katalog</button><button className={tab==='pharmacies'?'active':''} onClick={()=>setTab('pharmacies')}>Apotek</button><button className="icon-button" onClick={reload}><Activity size={17}/></button></div></div>
    {loading?<div className="empty-state"><span className="loader"/></div>:tab==='orders'?<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Pesanan</th><th>Pelanggan</th><th>Apotek</th><th>Status</th><th>Total</th><th>Dibuat</th></tr></thead><tbody>{orders.map((order)=><tr key={order.id}><td className="table-id">#{order.id.slice(0,8).toUpperCase()}</td><td>{order.customerName}</td><td>{order.pharmacyName}</td><td><span className={`status-pill status-${order.status}`}>{statusLabel[order.status]}</span></td><td>{money(order.total)}</td><td>{new Date(order.createdAt).toLocaleDateString('id-ID')}</td></tr>)}</tbody></table>{!orders.length&&<div className="empty-state compact"><span>Belum ada pesanan.</span></div>}</div>:tab==='products'?<div className="admin-catalog"><div className="catalog-toolbar"><div><strong>Produk dan alokasi stok daring</strong><small>Produk baru nonaktif sampai data stok dan harga tersedia.</small></div>{isPharmacist&&<button className="button button-dark button-small" onClick={()=>setShowProductForm((v)=>!v)}>{showProductForm?'Tutup form':'Tambah produk'} <Plus size={14}/></button>}</div>{showProductForm&&<form className="admin-form" onSubmit={createProduct}><label>SKU<input required maxLength="40" value={productDraft.sku} onChange={(e)=>setProductDraft((old)=>({...old,sku:e.target.value.toUpperCase()}))} placeholder="OTC-008"/></label><label>Nama produk<input required maxLength="160" value={productDraft.name} onChange={(e)=>setProductDraft((old)=>({...old,name:e.target.value}))} placeholder="Nama sesuai kemasan"/></label><label>Kategori<input required maxLength="80" value={productDraft.category} onChange={(e)=>setProductDraft((old)=>({...old,category:e.target.value}))} placeholder="Vitamin & suplemen"/></label><label>Satuan jual<input required maxLength="100" value={productDraft.sellUnit} onChange={(e)=>setProductDraft((old)=>({...old,sellUnit:e.target.value}))} placeholder="kotak isi 10 tablet"/></label><label className="form-wide">Keterangan<textarea maxLength="3000" value={productDraft.description} onChange={(e)=>setProductDraft((old)=>({...old,description:e.target.value}))} rows="2"/></label><label className="checkbox-field"><input type="checkbox" checked={productDraft.requiresPrescription} onChange={(e)=>setProductDraft((old)=>({...old,requiresPrescription:e.target.checked}))}/> Wajib resep</label><label className="checkbox-field"><input type="checkbox" checked={productDraft.batchTrackingRequired} onChange={(e)=>setProductDraft((old)=>({...old,batchTrackingRequired:e.target.checked}))}/> Catat lot & kedaluwarsa saat penyiapan</label><label className="checkbox-field"><input type="checkbox" checked={productDraft.specialHandling} onChange={(e)=>setProductDraft((old)=>({...old,specialHandling:e.target.checked}))}/> Penanganan khusus</label><button className="button button-dark form-wide">Buat produk nonaktif</button></form>}{stockProduct&&<form className="inventory-editor" onSubmit={saveStock}><div className="inventory-editor-head"><strong>Stok dan harga · {stockProduct.name}</strong><button type="button" className="icon-button" onClick={()=>setStockProduct(null)}><X size={16}/></button></div><label>Apotek aktif<select required value={stockDraft.pharmacyId} onChange={(e)=>changeStockPharmacy(e.target.value)}>{pharmacies.filter((pharmacy)=>pharmacy.status==='active').map((pharmacy)=><option key={pharmacy.id} value={pharmacy.id}>{pharmacy.name}</option>)}</select></label><div className="admin-form"><label>Alokasi stok daring<input required type="number" min="0" step="1" value={stockDraft.onHand} onChange={(e)=>setStockDraft((old)=>({...old,onHand:e.target.value}))}/></label><label>Harga satuan (Rp)<input required type="number" min="0" step="0.01" value={stockDraft.unitPrice} onChange={(e)=>setStockDraft((old)=>({...old,unitPrice:e.target.value}))}/></label><label className="form-wide">Alasan perubahan<input value={stockDraft.reason} onChange={(e)=>setStockDraft((old)=>({...old,reason:e.target.value}))} placeholder="Pembaruan alokasi daring"/></label></div><button className="button button-dark button-small">Simpan alokasi dan harga</button></form>}<div className="admin-product-list">{products.map((product)=><div className="admin-product-row" key={product.id}><span className={`admin-product-icon ${categoryColor(product.category)}`}>{React.createElement(categoryIcon(product.category),{size:18})}</span><span className="admin-product-info"><strong>{product.name}</strong><small>{product.sku} · {product.category}{product.requiresPrescription?' · Wajib resep':''}{product.batchTrackingRequired?' · Catat lot':''} · {product.status==='active'?'Aktif':'Nonaktif'}</small></span><b>{money(product.indicativePrice)}</b><span className={product.available?'availability available':'availability'}>{product.available?'Tersedia':'Habis'}</span>{isAdmin&&<button className="button button-small button-outline" onClick={()=>openStockEditor(product)}>Stok & harga</button>}{isPharmacist&&<button className={product.status==='inactive'?'button button-small button-outline':'button button-small button-quiet'} disabled={product.status==='inactive'&&!product.available} title={product.status==='inactive'&&!product.available?'Atur stok dan harga sebelum mengaktifkan':''} onClick={()=>setProductStatus(product,product.status==='inactive'?'active':'inactive')}>{product.status==='inactive'?'Aktifkan':'Nonaktifkan'}</button>}</div>)}</div></div>:<div className="admin-product-list">{pharmacies.map((pharmacy)=><div className="admin-product-row pharmacy-admin-row" key={pharmacy.id}><span className="admin-product-icon mint"><MapPin size={18}/></span><span className="admin-product-info"><strong>{pharmacy.name}</strong><small>{pharmacy.addressText}, {pharmacy.city} · Kode pos: {pharmacy.postalCodes.join(', ')||'belum ditentukan'}</small></span><span className={`status-pill status-${pharmacy.status}`}>{pharmacy.status==='active'?'Aktif':pharmacy.status==='pending'?'Menunggu pemeriksaan':'Ditangguhkan'}</span>{isAdmin&&<button className="button button-small button-outline" onClick={()=>setPharmacyStatus(pharmacy,pharmacy.status==='active'?'suspended':'active')}>{pharmacy.status==='active'?'Tangguhkan':'Aktifkan'}</button>}</div>)}</div>}
    </section>
    {tab==='pharmacies'&&isAdmin&&<PharmacyCreateForm csrf={csrf} onCreated={()=>{onToast('Apotek dibuat dengan status menunggu pemeriksaan.');reload()}} onError={onToast}/>}
    {cancellations.length>0&&<section className="workspace-panel cancellation-panel"><div className="panel-title"><div><h2>Permintaan pembatalan</h2><p>Periksa status pesanan sebelum membuat keputusan.</p></div><span className="cancel-count">{cancellations.length}</span></div>{cancellations.map((request)=><div className="cancellation-row" key={request.id}><span className="admin-product-icon peach"><X size={17}/></span><span className="admin-product-info"><strong>#{request.orderId.slice(0,8).toUpperCase()} · {request.customerName}</strong><small>{request.reason} · {request.pharmacyName} · Status: {statusLabel[request.orderStatus]}</small></span><b>{money(request.total)}</b><button className="button button-small button-outline" onClick={()=>decideCancellation(request,'rejected')}>Tolak</button><button className="button button-small button-dark" onClick={()=>decideCancellation(request,'approved')}>Setujui</button></div>)}</section>}
    {supportCases.length>0&&<section className="workspace-panel cancellation-panel"><div className="panel-title"><div><h2>Kasus bantuan</h2><p>Keluhan dan kendala operasional yang masih terbuka.</p></div><span className="cancel-count">{supportCases.length}</span></div>{supportCases.map((item)=><div className="cancellation-row" key={item.id}><span className="admin-product-icon blue"><FileText size={17}/></span><span className="admin-product-info"><strong>#{item.orderId.slice(0,8).toUpperCase()} · {item.customerName} · {item.category}</strong><small>{item.description} · {item.pharmacyName} · Pesanan {statusLabel[item.orderStatus]}</small></span><button className="button button-small button-outline" onClick={()=>closeSupportCase(item)}>Tutup kasus</button></div>)}</section>}
    <div className="admin-note"><LockKeyhole size={16}/><span>Admin tidak dapat membuka dokumen resep atau memberi keputusan klinis. Aktivasi apotek dan perubahan katalog dicatat.</span></div>
  </main>
}

function PharmacyCreateForm({csrf,onCreated,onError}){
  const [draft,setDraft]=useState({name:'',addressText:'',city:'',postalCodes:'',licenseReference:''})
  const [busy,setBusy]=useState(false)
  const submit=async(event)=>{
    event.preventDefault();setBusy(true)
    try{
      await api('/admin/pharmacies',{method:'POST',csrf,body:JSON.stringify({...draft,postalCodes:draft.postalCodes.split(',').map((code)=>code.trim()).filter(Boolean)})})
      setDraft({name:'',addressText:'',city:'',postalCodes:'',licenseReference:''});onCreated()
    }catch(error){onError(error.message)}finally{setBusy(false)}
  }
  return <section className="workspace-panel pharmacy-create"><div><span className="section-kicker">ONBOARDING MITRA</span><h2>Tambah apotek</h2><p>Apotek baru berstatus menunggu pemeriksaan sampai tim menyetujui kesiapan operasional.</p></div><form className="admin-form" onSubmit={submit}><label>Nama apotek<input required maxLength="160" value={draft.name} onChange={(e)=>setDraft((old)=>({...old,name:e.target.value}))}/></label><label>Kota<input required maxLength="100" value={draft.city} onChange={(e)=>setDraft((old)=>({...old,city:e.target.value}))}/></label><label className="form-wide">Alamat<input required maxLength="500" value={draft.addressText} onChange={(e)=>setDraft((old)=>({...old,addressText:e.target.value}))}/></label><label>Kode pos layanan<input required value={draft.postalCodes} onChange={(e)=>setDraft((old)=>({...old,postalCodes:e.target.value}))} placeholder="12190, 12210"/></label><label>Referensi izin<input value={draft.licenseReference} onChange={(e)=>setDraft((old)=>({...old,licenseReference:e.target.value}))} placeholder="Diisi sesuai pemeriksaan onboarding"/></label><button className="button button-dark form-wide" disabled={busy}>{busy?'Menyimpan...':'Simpan sebagai menunggu pemeriksaan'}</button></form></section>
}

function Metric({label,value,icon:Icon}){return <div className="metric-card"><span className="metric-icon"><Icon size={18}/></span><strong>{value}</strong><small>{label}</small></div>}
function WorkspaceGate({title,onLogin,onBack}){return <main className="workspace wrap"><button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Kembali ke katalog</button><div className="workspace-blocked"><span className="blocked-icon"><LockKeyhole size={25}/></span><h2>Masuk untuk membuka {title.toLowerCase()}</h2><p>Gunakan akun yang telah ditugaskan oleh pengelola apotek.</p><button className="button button-dark" onClick={onLogin}>Masuk <LogIn size={16}/></button></div></main>}
function WorkspaceDenied({title,onBack}){return <main className="workspace wrap"><button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Kembali ke katalog</button><div className="workspace-blocked"><span className="blocked-icon"><ShieldCheck size={25}/></span><h2>Akses {title.toLowerCase()} dibatasi</h2><p>Akun ini belum memiliki penugasan untuk area kerja tersebut.</p><button className="button button-outline" onClick={onBack}>Kembali ke katalog</button></div></main>}

function Footer({onPolicy}){return <footer className="site-footer"><div className="footer-main wrap"><div><a className="brand footer-brand" href="/"><span className="brand-mark"><Plus size={20}/></span><span>apotek<span className="brand-light">.id</span><small>SEHAT DIMULAI DARI SINI</small></span></a><p>Teman praktis untuk kebutuhan kesehatanmu, bersama apotek mitra dan apoteker.</p></div><div className="footer-links"><strong>Jelajahi</strong><a href="#catalog">Katalog produk</a><a href="#catalog">Cara pemesanan</a><button onClick={onPolicy}>Kebijakan privasi</button></div><div className="footer-links"><strong>Informasi</strong><button onClick={onPolicy}>Tentang Apotek Digital</button><button onClick={onPolicy}>Bantuan & dukungan</button><button onClick={onPolicy}>Syarat layanan</button></div><div className="footer-side"><span className="footer-badge"><ShieldCheck size={18}/></span><span><strong>Belanja lebih tenang</strong><small>Keputusan resep tetap pada apoteker berwenang.</small></span></div></div><div className="footer-bottom wrap"><span>© {new Date().getFullYear()} Apotek Digital. Informasi produk mengikuti kemasan dan arahan tenaga kesehatan.</span><span>Belum untuk penggunaan darurat.</span></div></footer>}

createRoot(document.getElementById('root')).render(<App />)
