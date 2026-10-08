
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json({limit:'2mb'}));

const PORT = process.env.PORT || 3333;
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';

function token(user){ return jwt.sign({uid:user.id,cid:user.companyId,role:user.role},JWT_SECRET,{expiresIn:'12h'}); }
async function auth(req,res,next){
  try{
    const raw=(req.headers.authorization||'').replace('Bearer ','');
    const p=jwt.verify(raw,JWT_SECRET); req.auth=p; next();
  }catch(e){res.status(401).json({error:'Não autenticado'});}
}
function roles(...allowed){return (req,res,next)=>allowed.includes(req.auth.role)?next():res.status(403).json({error:'Sem permissão'});}

app.get('/health',(req,res)=>res.json({ok:true,service:'nexus-gestao-api'}));

app.post('/api/auth/login',async(req,res)=>{
  const body=z.object({email:z.string().email(),password:z.string()}).parse(req.body);
  const user=await prisma.user.findFirst({where:{email:body.email,active:true}});
  if(!user || !(await bcrypt.compare(body.password,user.passwordHash))) return res.status(401).json({error:'Credenciais inválidas'});
  res.json({token:token(user),user:{id:user.id,name:user.name,email:user.email,role:user.role,companyId:user.companyId}});
});

app.post('/api/setup',async(req,res)=>{
  const body=z.object({company:z.object({name:z.string().min(2),document:z.string().optional(),email:z.string().optional(),phone:z.string().optional()}),admin:z.object({name:z.string().min(2),email:z.string().email(),password:z.string().min(8)})}).parse(req.body);
  const exists=await prisma.user.findFirst({where:{email:body.admin.email}});
  if(exists)return res.status(409).json({error:'E-mail já cadastrado'});
  const company=await prisma.company.create({data:{name:body.company.name,document:body.company.document,email:body.company.email,phone:body.company.phone}});
  const hash=await bcrypt.hash(body.admin.password,12);
  const user=await prisma.user.create({data:{companyId:company.id,name:body.admin.name,email:body.admin.email,passwordHash:hash,role:'ADMIN'}});
  res.status(201).json({companyId:company.id,userId:user.id});
});

app.get('/api/me',auth,async(req,res)=>{
  const user=await prisma.user.findUnique({where:{id:req.auth.uid},include:{company:true}});
  res.json({user:{id:user.id,name:user.name,email:user.email,role:user.role},company:user.company});
});

app.get('/api/dashboard',auth,async(req,res)=>{
  const cid=req.auth.cid;
  const [sales,products,finance]=await Promise.all([
    prisma.sale.findMany({where:{companyId:cid},select:{total:true}}),
    prisma.product.findMany({where:{companyId:cid},select:{stock:true,minStock:true}}),
    prisma.financeEntry.findMany({where:{companyId:cid},select:{type:true,value:true}})
  ]);
  const revenue=sales.reduce((a,s)=>a+Number(s.total),0);
  const entries=finance.filter(x=>x.type==='entrada').reduce((a,x)=>a+Number(x.value),0);
  const exits=finance.filter(x=>x.type==='saida').reduce((a,x)=>a+Number(x.value),0);
  res.json({revenue,entries,exits,balance:entries-exits,lowStock:products.filter(p=>p.stock<=p.minStock).length});
});

app.get('/api/products',auth,async(req,res)=>res.json(await prisma.product.findMany({where:{companyId:req.auth.cid},orderBy:{name:'asc'}})));
app.post('/api/products',auth,roles('ADMIN','GERENTE','ESTOQUE'),async(req,res)=>{
  const b=z.object({sku:z.string(),name:z.string(),category:z.string().optional(),cost:z.number(),price:z.number(),stock:z.number().int().default(0),minStock:z.number().int().default(0)}).parse(req.body);
  const p=await prisma.product.create({data:{...b,companyId:req.auth.cid}});
  await prisma.auditLog.create({data:{companyId:req.auth.cid,userId:req.auth.uid,action:'CREATE',entity:'Product',entityId:p.id}});
  res.status(201).json(p);
});
app.patch('/api/products/:id',auth,roles('ADMIN','GERENTE','ESTOQUE'),async(req,res)=>{
  const p=await prisma.product.update({where:{id:req.params.id},data:req.body});
  res.json(p);
});
app.delete('/api/products/:id',auth,roles('ADMIN','GERENTE'),async(req,res)=>{await prisma.product.delete({where:{id:req.params.id}});res.status(204).end()});

app.get('/api/customers',auth,async(req,res)=>res.json(await prisma.customer.findMany({where:{companyId:req.auth.cid},orderBy:{name:'asc'}})));
app.post('/api/customers',auth,async(req,res)=>res.status(201).json(await prisma.customer.create({data:{...req.body,companyId:req.auth.cid}})));
app.get('/api/suppliers',auth,async(req,res)=>res.json(await prisma.supplier.findMany({where:{companyId:req.auth.cid},orderBy:{name:'asc'}})));
app.post('/api/suppliers',auth,async(req,res)=>res.status(201).json(await prisma.supplier.create({data:{...req.body,companyId:req.auth.cid}})));

app.get('/api/finance',auth,async(req,res)=>res.json(await prisma.financeEntry.findMany({where:{companyId:req.auth.cid},orderBy:{createdAt:'desc'}})));
app.post('/api/finance',auth,roles('ADMIN','GERENTE','FINANCEIRO'),async(req,res)=>res.status(201).json(await prisma.financeEntry.create({data:{...req.body,companyId:req.auth.cid,value:Number(req.body.value)}})));

app.get('/api/sales',auth,async(req,res)=>res.json(await prisma.sale.findMany({where:{companyId:req.auth.cid},include:{items:true,customer:true},orderBy:{createdAt:'desc'}})));

app.post('/api/sales',auth,async(req,res)=>{
  const b=z.object({customerId:z.string().optional(),payment:z.string(),items:z.array(z.object({productId:z.string(),qty:z.number().int().positive(),unitPrice:z.number().positive()}))}).parse(req.body);
  const result=await prisma.$transaction(async(tx)=>{
    let total=0;
    for(const item of b.items){
      const p=await tx.product.findFirst({where:{id:item.productId,companyId:req.auth.cid}});
      if(!p) throw new Error('Produto inválido');
      if(p.stock<item.qty) throw new Error(`Estoque insuficiente: ${p.name}`);
      total+=item.qty*item.unitPrice;
    }
    const sale=await tx.sale.create({data:{companyId:req.auth.cid,customerId:b.customerId,payment:b.payment,total,items:{create:b.items}}});
    for(const item of b.items){
      await tx.product.update({where:{id:item.productId},data:{stock:{decrement:item.qty}}});
      await tx.stockMovement.create({data:{companyId:req.auth.cid,productId:item.productId,type:'saida',qty:item.qty,reason:`Venda ${sale.id}`}});
    }
    await tx.financeEntry.create({data:{companyId:req.auth.cid,type:'entrada',category:'Venda',description:`Venda ${sale.id}`,value:total,paidAt:new Date()}});
    return sale;
  });
  await prisma.auditLog.create({data:{companyId:req.auth.cid,userId:req.auth.uid,action:'CREATE',entity:'Sale',entityId:result.id}});
  res.status(201).json(result);
});


app.get('/api/purchases',auth,async(req,res)=>{
  res.json(await prisma.purchase.findMany({where:{companyId:req.auth.cid},include:{supplier:true,items:{include:{product:true}}},orderBy:{createdAt:'desc'}}));
});
app.post('/api/purchases',auth,roles('ADMIN','GERENTE','ESTOQUE'),async(req,res)=>{
  const b=z.object({supplierId:z.string().optional(),items:z.array(z.object({productId:z.string(),qty:z.number().int().positive(),unitCost:z.number().nonnegative()}))}).parse(req.body);
  const purchase=await prisma.$transaction(async(tx)=>{
    let total=0;
    for(const i of b.items){
      const p=await tx.product.findFirst({where:{id:i.productId,companyId:req.auth.cid}});
      if(!p) throw new Error('Produto inválido');
      total+=i.qty*i.unitCost;
    }
    const po=await tx.purchase.create({data:{companyId:req.auth.cid,supplierId:b.supplierId,total,items:{create:b.items}}});
    for(const i of b.items){
      await tx.product.update({where:{id:i.productId},data:{stock:{increment:i.qty},cost:i.unitCost}});
      await tx.stockMovement.create({data:{companyId:req.auth.cid,productId:i.productId,type:'entrada',qty:i.qty,reason:`Compra ${po.id}`}});
    }
    await tx.financeEntry.create({data:{companyId:req.auth.cid,type:'saida',category:'Compra',description:`Compra ${po.id}`,value:total,paidAt:new Date()}});
    return po;
  });
  res.status(201).json(purchase);
});

app.get('/api/users',auth,roles('ADMIN'),async(req,res)=>res.json(await prisma.user.findMany({where:{companyId:req.auth.cid},select:{id:true,name:true,email:true,role:true,active:true,createdAt:true}})));

app.get('/api/audit',auth,roles('ADMIN'),async(req,res)=>res.json(await prisma.auditLog.findMany({where:{companyId:req.auth.cid},orderBy:{createdAt:'desc'},take:200})));

app.listen(PORT,()=>console.log(`Nexus Gestão API em http://localhost:${PORT}`));
