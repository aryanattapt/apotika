import { ArrowLeft, LockKeyhole, LogIn } from 'lucide-react'

export function WorkspaceGate({title,onLogin,onBack}){return <main className="workspace wrap"><button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Kembali ke katalog</button><div className="workspace-blocked"><span className="blocked-icon"><LockKeyhole size={25}/></span><h2>Masuk untuk membuka {title.toLowerCase()}</h2><p>Gunakan akun yang telah ditugaskan oleh pengelola apotek.</p><button className="button button-dark" onClick={onLogin}>Masuk <LogIn size={16}/></button></div></main>}
