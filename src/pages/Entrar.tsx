import { useState } from 'react'
import { Modal } from '../components/ui'
import { useStore } from '../lib/store'

/** Login do organizador. Quem so acompanha nao precisa disto. */
export default function Entrar({ onFechar }: { onFechar: () => void }) {
  const { entrar } = useStore()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, setIndo] = useState(false)

  async function ir() {
    setIndo(true)
    setErro(null)
    try {
      await entrar(email.trim(), senha)
      onFechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setIndo(false)
    }
  }

  return (
    <Modal titulo="Entrar como organizador" onFechar={onFechar}>
      <label className="campo">
        <span>E-mail</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </label>
      <label className="campo">
        <span>Senha</span>
        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void ir() }}
        />
      </label>
      {erro && <div className="aviso perigo">{erro}</div>}
      <button className="btn bloco" disabled={indo || !email || !senha} onClick={() => void ir()}>
        {indo ? 'Entrando…' : 'Entrar'}
      </button>
      <p className="mini muted" style={{ marginTop: 10, marginBottom: 0 }}>
        O login é criado no painel do Supabase, em Authentication → Users. Quem
        vai ajudar a cronometrar não precisa de login: recebe o link do evento.
      </p>
    </Modal>
  )
}
