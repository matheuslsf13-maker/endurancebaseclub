import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Caminhos RELATIVOS de proposito: o mesmo build funciona na raiz de um
// dominio proprio e tambem em subpasta (o endereco do GitHub Pages).
const versao = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')

export default defineConfig({
  base: './',
  plugins: [react()],
  define: { __VERSAO__: JSON.stringify(versao) },
})
