import { randomBytes, createHash } from 'node:crypto'
import { pool } from '../../infrastructure/database/client'
import { createTotpSecret, encryptMfaSecret } from '../../infrastructure/security/mfa'

const [name, email, role, pharmacyId] = process.argv.slice(2)
const allowed = ['admin', 'cs', 'finance', 'pharmacist', 'pharmacy_staff']
if (!name || !email || !role || !allowed.includes(role)) {
  console.error('Pakai: bun run provision:user -- "Nama" email@contoh.id admin|cs|finance|pharmacist|pharmacy_staff [pharmacy-uuid]')
  process.exit(1)
}
if (['pharmacist', 'pharmacy_staff'].includes(role) && !pharmacyId) {
  console.error('Akun apotek harus diberi UUID apotek yang sudah terdaftar.')
  process.exit(1)
}
function readHidden(label:string){
  return new Promise<string>((resolve,reject)=>{
    const input=process.stdin
    if(!input.isTTY||typeof input.setRawMode!=='function'){reject(new Error('Jalankan provisioning pada terminal interaktif.'));return}
    const chars:string[]=[]
    process.stdout.write(label)
    input.setRawMode(true);input.resume()
    const done=(value?:string,error?:Error)=>{
      input.setRawMode(false);input.pause();input.off('data',onData);process.stdout.write('\n')
      if(error)reject(error);else resolve(value??'')
    }
    const onData=(chunk:Buffer)=>{
      for(const char of chunk.toString('utf8')){
        if(char==='\u0003'){done(undefined,new Error('Provisioning dibatalkan.'));return}
        if(char==='\r'||char==='\n'){done(chars.join(''));return}
        if(char==='\u007f'||char==='\b'){if(chars.length){chars.pop();process.stdout.write('\b \b')}continue}
        if(char.charCodeAt(0)>=32){chars.push(char);process.stdout.write('*')}
      }
    }
    input.on('data',onData)
  })
}
const password = await readHidden('Kata sandi awal (minimal 14 karakter): ')
if (password.length < 14 || password.length > 128) {
  console.error('Kata sandi awal harus berisi 14–128 karakter.')
  process.exit(1)
}

try {
  const totpSecret=createTotpSecret()
  const recoveryCodes=Array.from({length:8},()=>randomBytes(12).toString('hex').toUpperCase())
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const user = await client.query(`INSERT INTO users(name,email,password_hash,mfa_secret_encrypted,mfa_enabled,email_verified_at)
      VALUES($1,lower($2),$3,$4,true,now()) RETURNING id`, [name.trim(), email.trim(), await Bun.password.hash(password),encryptMfaSecret(totpSecret)])
    await client.query('INSERT INTO user_roles(user_id,role,pharmacy_id) VALUES($1,$2,$3)', [user.rows[0].id, role, pharmacyId || null])
    for(const code of recoveryCodes) await client.query('INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)',[user.rows[0].id,createHash('sha256').update(code).digest('hex')])
    await client.query("INSERT INTO audit_log(action,resource_type,resource_id,metadata) VALUES('user.provisioned','user',$1,$2)",[user.rows[0].id,{role,pharmacyId:pharmacyId??null}])
    await client.query('COMMIT')
    const label=encodeURIComponent(`${email.trim()}`)
    const issuer=encodeURIComponent('Apotek Digital')
    console.info(`Akun ${role} berhasil dibuat dengan ID ${user.rows[0].id}.`)
    console.info(`Tambahkan akun ini di aplikasi autentikator: otpauth://totp/${issuer}:${label}?secret=${totpSecret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`)
    console.info(`Kode pemulihan sekali pakai (simpan aman): ${recoveryCodes.join(' ')}`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
} finally {
  await pool.end()
}
