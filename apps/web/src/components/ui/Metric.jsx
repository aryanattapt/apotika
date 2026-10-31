export function Metric({label,value,icon:Icon}){return <div className="metric-card"><span className="metric-icon"><Icon size={18}/></span><strong>{value}</strong><small>{label}</small></div>}
