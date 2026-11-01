import { LogOut, Plus, ShoppingBag } from 'lucide-react'

export function Header({ user, quantity, onCart, onOrders, onLogin, onLogout, onWorkspace, workspace, onShop }) {
  const roles = user?.roles?.map((item) => item.role) || []
  const canPharmacy = roles.includes('pharmacist') || roles.includes('pharmacy_staff')
  const canAdmin = roles.includes('admin') || roles.includes('cs') || roles.includes('finance') || roles.includes('pharmacist')
  return <header className="site-header"><div className="header-inner wrap"><a className="brand" href="/" onClick={(e) => { e.preventDefault(); onShop() }}><span className="brand-mark"><Plus size={20} strokeWidth={3} /></span><span>Farma<span className="brand-light">GO</span><small>SEHAT DIMULAI DARI SINI</small></span></a>
    <nav className="main-nav"><a href="#catalog" onClick={onShop}>Katalog</a><a href="#catalog" onClick={onShop}>Cara pesan</a><a href="#support" onClick={(e) => e.preventDefault()}>Bantuan</a></nav>
    <div className="header-actions">{user&&<button className="history-link" onClick={onOrders}>Pesanan</button>}{canPharmacy && <button className={workspace === 'pharmacy' ? 'workspace-link selected' : 'workspace-link'} onClick={() => onWorkspace('pharmacy')}>Panel apotek</button>}{canAdmin && <button className={workspace === 'admin' ? 'workspace-link selected' : 'workspace-link'} onClick={() => onWorkspace('admin')}>Admin</button>}{user ? <div className="account-menu"><span className="account-avatar">{user.name.slice(0,1).toUpperCase()}</span><span className="account-name">{user.name.split(' ')[0]}</span><button className="icon-button" aria-label="Keluar" onClick={onLogout}><LogOut size={17} /></button></div> : <button className="login-link" onClick={onLogin}>Masuk</button>}<button className="cart-button" onClick={onCart} aria-label={`Keranjang, ${quantity} item`}><ShoppingBag size={19} /><span>Keranjang</span>{quantity > 0 && <b>{quantity}</b>}</button></div>
  </div></header>
}
