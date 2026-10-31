import { ArrowLeft, ShieldCheck } from 'lucide-react'

export function WorkspaceDenied({title,onBack}){return <main className="workspace wrap"><button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Kembali ke katalog</button><div className="workspace-blocked"><span className="blocked-icon"><ShieldCheck size={25}/></span><h2>Akses {title.toLowerCase()} dibatasi</h2><p>Akun ini belum memiliki penugasan untuk area kerja tersebut.</p><button className="button button-outline" onClick={onBack}>Kembali ke katalog</button></div></main>}
