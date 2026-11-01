import { Plus, ShieldCheck } from 'lucide-react'

export function Footer({onNavigate, onCatalog}) {
  const goTo = (page) => (event) => { event.preventDefault(); onNavigate(page) }
  const goToCatalog = (event) => { event.preventDefault(); onCatalog() }
  return <footer className="site-footer">
    <div className="footer-main wrap">
      <div>
        <a className="brand footer-brand" href="/" onClick={goToCatalog}><span className="brand-mark"><Plus size={20}/></span><span>Farma<span className="brand-light">GO</span><small>SEHAT DIMULAI DARI SINI</small></span></a>
        <p>Teman praktis untuk kebutuhan kesehatanmu, bersama apotek mitra dan apoteker.</p>
      </div>
      <div className="footer-links"><strong>Jelajahi</strong><a href="#catalog" onClick={goToCatalog}>Katalog produk</a><a href="?page=how-to-order" onClick={goTo('how-to-order')}>Cara pemesanan</a><a href="?page=privacy" onClick={goTo('privacy')}>Kebijakan privasi</a></div>
      <div className="footer-links"><strong>Informasi</strong><a href="?page=about" onClick={goTo('about')}>Tentang FarmaGO</a><a href="?page=support" onClick={goTo('support')}>Bantuan & dukungan</a><a href="?page=terms" onClick={goTo('terms')}>Syarat layanan</a></div>
      <div className="footer-side"><span className="footer-badge"><ShieldCheck size={18}/></span><span><strong>Belanja lebih tenang</strong><small>Keputusan resep tetap pada apoteker berwenang.</small></span></div>
    </div>
    <div className="footer-bottom wrap"><span>© {new Date().getFullYear()} FarmaGO. Informasi produk mengikuti kemasan dan arahan tenaga kesehatan.</span><span>Belum untuk penggunaan darurat.</span></div>
  </footer>
}
