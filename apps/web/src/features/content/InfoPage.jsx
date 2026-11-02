import { ArrowLeft, ArrowRight, FileText, HeartPulse, HelpCircle, LockKeyhole, MapPin, PackageCheck, ShieldCheck, ShoppingBag, Stethoscope } from 'lucide-react'
import { infoPages, relatedInfoPages } from './content.js'

const icons = { FileText, HeartPulse, HelpCircle, LockKeyhole, MapPin, PackageCheck, ShieldCheck, ShoppingBag, Stethoscope }

export function InfoPage({ page, onBack, onNavigate }) {
  const content = infoPages[page] || infoPages.about
  const HeroIcon = content.draft ? FileText : HeartPulse
  return <main className="info-page">
    <div className="wrap">
      <button className="info-back" onClick={onBack}><ArrowLeft size={16}/> Kembali ke katalog</button>
      <section className="info-hero">
        <span className="info-hero-icon"><HeroIcon size={24}/></span>
        <span className="section-kicker">{content.label}</span>
        <h1>{content.title}</h1><p>{content.intro}</p>
      </section>
      {content.draft && <aside className="info-draft-note"><ShieldCheck size={19}/><p><strong>Informasi draf</strong><br/>Kebijakan final masih menunggu validasi product owner dan peninjauan legal. Jangan masukkan data pribadi atau resep nyata pada lingkungan pengembangan.</p></aside>}
      <div className="info-layout">
        <section className="info-sections" aria-label={content.label}>
          {content.sections.map((section) => { const SectionIcon = icons[section.icon] || HelpCircle; return <article className="info-card" key={section.title}><span className="info-card-icon"><SectionIcon size={18}/></span><div><h2>{section.title}</h2><p>{section.body}</p></div></article> })}
          {content.notice && <aside className="info-inline-note"><HelpCircle size={17}/><p>{content.notice}</p></aside>}
        </section>
        <aside className="info-nav-card"><strong>Informasi lainnya</strong><p>Pilih topik yang ingin kamu baca.</p>{relatedInfoPages.filter(([id]) => id !== page).map(([id,label]) => <button key={id} onClick={() => onNavigate(id)}>{label}<ArrowRight size={14}/></button>)}</aside>
      </div>
    </div>
  </main>
}
