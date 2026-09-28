# Produção: como o EnduranceBaseClub está publicado e como mantê-lo

## Endereços

| O quê | Onde |
|---|---|
| App (organização, cronometristas e público) | https://endurance-base-club.vercel.app |
| Login da organização | https://endurance-base-club.vercel.app/#/entrar |
| Resultados públicos | https://endurance-base-club.vercel.app/#/ |
| Código | https://github.com/matheuslsf13-maker/endurancebaseclub (branch `main`) |
| Hospedagem do site | Vercel, time **Matheus Proj**, projeto **endurance-base-club** |
| Banco de dados e login | Supabase, projeto **ENDURANCE BASE CLUB** (`wlishmznbhhcqzncdxnq`, us-east-1, Postgres 17) |

O link de cada cronometrista (`#/c/<código>`) e o endereço público de cada evento (`#/p/<endereço>`) aparecem dentro do app, na aba **Cronometragem** e na aba **Geral** do evento.

## Como uma atualização chega ao ar

A Vercel está ligada ao GitHub:

- **Tudo o que entra na `main` é publicado sozinho** em produção, em cerca de 1 minuto.
- Qualquer outra branch gera uma **pré-visualização** com endereço próprio. Ela fica protegida por login na Vercel.
- **Para voltar uma versão:** no painel da Vercel, abra o projeto, vá em **Deployments**, escolha uma publicação anterior e clique em **Promote to Production**.

O app usa só o endereço e a chave **publicável** do Supabase, que estão em `.env.production`. Essa chave é pública por natureza. Não há segredo nenhum no site.

**Durante uma prova, publique só se for indispensável.** O celular do cronometrista nunca recarrega sozinho por causa de uma versão nova (Ruling 26): ela só entra quando o app for aberto de novo. O painel e as páginas públicas mostram "Nova versão disponível · Atualizar".

## Banco de dados

O app fala com o banco **somente por funções** (RPC). As tabelas têm RLS ligado e nenhuma política, então ninguém lê ou grava tabela diretamente:

- as funções `tk_*` (cronometristas) e `pub_*` (público) conferem o código do link por dentro;
- as funções `admin_*` conferem a organizadora por dentro.

### Migrations

Os arquivos ficam em `supabase/migrations/`. Em produção foram aplicados de `ebc_0001_schema` a `ebc_0007_fk_indexes` em 28/09/2026, `ebc_0008_podium_overall` (pódio geral sem divisão) e `ebc_0009_time_source_priority` (fonte do tempo: mediana ou média + cronometrista prioritário) em seguida. Para uma mudança nova:

1. Crie `supabase/migrations/<próximo número>_<nome>.sql`. Se ela criar funções novas, repita no fim o bloco de permissões da `0006`.
2. Rode localmente, no WSL: `bash scripts/test-sql.sh` e `npm run test:integration`.
3. Aplique em produção pelo **SQL Editor** do Supabase, ou pelo MCP do Supabase (`apply_migration`).
4. Rode os testes de `supabase/tests/` em produção, cada arquivo entre `begin;` e `rollback;` e precedido de `00_helpers.sql`. Assim nada fica gravado.

### Avisos esperados no painel do Supabase (Advisors)

- **RLS Enabled No Policy**, nas 11 tabelas: é o desenho do app, porque o acesso é só por funções.
- **Public / Signed-In Users Can Execute SECURITY DEFINER Function**:
  - são as funções públicas `tk_*`/`pub_*` e as de organização `admin_*`;
  - cada uma faz a própria checagem;
  - o teste `supabase/tests/60_security.sql` garante que só elas podem ser chamadas.
- **Unused Index**: normal enquanto o banco tiver poucos dados.

## Contas da organização

- A conta **dona** é `matheuslsf13@gmail.com`. Ela foi criada com `bootstrap_owner`, e o primeiro login obriga a trocar a senha.
- Outras organizadoras são criadas pela dona em **Configurações** no app. Cada uma também troca a senha no primeiro login.
- O **cadastro público está desligado**, em Authentication, "Allow new users to sign up". Mantenha assim.

### Esqueceu a senha?

O Supabase gratuito só envia e-mails para membros do time. Para redefinir a senha de uma organizadora, use o **SQL Editor**:

1. Troque `NOVA_SENHA` (mínimo de 8 caracteres) e o e-mail no comando abaixo.
2. Rode o comando. O próximo login vai pedir uma senha nova.
3. Apague a consulta do SQL Editor depois.

```sql
update auth.users set encrypted_password = extensions.crypt('NOVA_SENHA', extensions.gen_salt('bf', 10)), updated_at = now()
 where email = 'email@da.organizadora';
update public.organizers set must_change_password = true where email = 'email@da.organizadora';
```

## Cuidados com o plano gratuito

- **O Supabase gratuito pausa o projeto depois de cerca de 1 semana sem uso.**
  - Na semana da prova, entre no painel e confira que o projeto está **ativo**.
  - Se estiver pausado, clique em **Restore**. Leva alguns minutos.
  - Com o projeto pausado, o app mostra "sem conexão com o servidor".
- A Vercel gratuita atende com folga um evento de clube.

## Projeto antigo

O Supabase do app antigo (`ljwcqnrjsmcgqqxsgfaf`) não é usado pelo app novo. Ele pode ser pausado ou apagado pelo painel do Supabase quando você quiser.

## Checklist antes de cada evento

1. O Supabase está **ativo** (não pausado) e o app abre em https://endurance-base-club.vercel.app.
2. O evento, as provas, as largadas, as categorias e os pódios estão conferidos na aba **Provas**. As inscrições e os números de peito estão na aba **Inscrições**.
3. **Teste de 10 minutos em um Android e um iPhone reais**, com o link do cronometrista, em um evento de teste:
   - o MARCAR mantém o teclado aberto;
   - tocar numa linha de "Em prova" marca uma vez só;
   - a tela não apaga;
   - no modo avião, as marcações ficam guardadas e sobem sozinhas quando a internet volta.
4. Cada voluntário abre o link **no navegador do próprio celular** e cadastra o nome antes da largada. Se preferir, adiciona à tela inicial.
5. Se o link for trocado ou desativado no meio da prova, os celulares continuam marcando e guardam tudo. Peça que abram o link novo **na mesma aba ou no mesmo navegador**.
6. Durante a prova, acompanhe as abas **Cronometragem** e **Revisão**. Depois da última chegada, resolva as pendências e **finalize** cada prova. Só então os resultados ficam oficiais.
7. Exporte a planilha (**Resultados → Exportar planilha**) para a conferência.
