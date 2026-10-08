# Nexus Gestão — SaaS ERP

## O que foi preparado

- API Node.js + Express
- PostgreSQL
- Prisma ORM
- Autenticação JWT
- Senhas com bcrypt
- Multiempresa (companyId em todas as entidades operacionais)
- Perfis: ADMIN, GERENTE, VENDEDOR, FINANCEIRO, ESTOQUE
- Produtos e estoque
- Clientes e fornecedores
- PDV/vendas com baixa transacional do estoque
- Financeiro
- Dashboard
- Auditoria
- Docker Compose
- Frontend mínimo para testar a API

## Rodar localmente

Requisitos: Docker e Node.js 22+.

1. Copie `backend/.env.example` para `backend/.env`.
2. Suba o PostgreSQL:
   `docker compose up -d db`
3. Instale dependências:
   `cd backend && npm install`
4. Gere o Prisma:
   `npx prisma generate`
5. Crie/aplique o banco:
   `npx prisma migrate dev --name init`
6. Inicie:
   `npm run dev`
7. Abra `frontend/index.html`.

## Primeiro acesso

Use `/api/setup` uma única vez para criar a empresa e o administrador. Exemplo de JSON:

{
  "company":{"name":"Minha Empresa","document":"00000000000100"},
  "admin":{"name":"Administrador","email":"admin@empresa.com","password":"uma-senha-com-8-ou-mais"}
}

Depois use `/api/auth/login`.

## Produção — itens obrigatórios antes de vender o sistema

- HTTPS e domínio
- Segredo JWT forte via secret manager
- PostgreSQL gerenciado
- Backups automáticos + teste de restauração
- Rate limiting/WAF
- Logs centralizados e monitoramento
- Política LGPD, retenção e exclusão de dados
- Recuperação de senha e 2FA
- Integração fiscal com certificado e provedor autorizado
- NFC-e/NF-e conforme estado e regime tributário
- Integrações de pagamento
- Storage de documentos/XML/PDF
- Filas para emissão fiscal e webhooks
- Testes automatizados e CI/CD
- Rotina de conciliação financeira
- Controle de permissões por endpoint

## Frontend completo
A pasta `frontend` agora contém uma SPA responsiva com Dashboard, PDV, Vendas, Compras, Produtos, Estoque, Clientes, Fornecedores, Financeiro, Relatórios, Usuários e Configurações, consumindo a API.
