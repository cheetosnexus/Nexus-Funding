// netlify/functions/api.mjs
// Single entry point for ALL /api/* routes
// Netlify redirects /api/* → /.netlify/functions/api/:splat

import { PrismaClient }  from '@prisma/client'
import bcrypt            from 'bcryptjs'
import jwt               from 'jsonwebtoken'
import { v4 as uuidv4 }  from 'uuid'
import Stripe            from 'stripe'
import { execSync }      from 'child_process'

// ── Database URL ───────────────────────────────────────────────
// Netlify DB injects NETLIFY_DATABASE_URL automatically.
// Prisma reads DATABASE_URL, so we map it here.
const DB_URL = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL
if (DB_URL) process.env.DATABASE_URL = DB_URL

// ── Bootstrap: create tables + seed on first cold start ───────
// Uses `prisma db push` — no migration files needed.
// Idempotent: safe to run every cold start, only creates
// tables that don't exist yet.
let _bootstrapped = false
async function bootstrap(prisma) {
  if (_bootstrapped) return
  _bootstrapped = true
  try {
    console.log('[bootstrap] Running prisma db push...')
    execSync('npx prisma db push --accept-data-loss --skip-generate', {
      env: { ...process.env, DATABASE_URL: process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL },
      stdio: 'pipe',
      timeout: 60000,
    })
    console.log('[bootstrap] Tables ready.')
    await seedDatabase(prisma)
  } catch (e) {
    console.error('[bootstrap] Error:', e.message || e)
    _bootstrapped = false
  }
}

async function seedDatabase(prisma) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@nexusfunding.com'
    const adminPass  = process.env.ADMIN_PASSWORD || 'Admin@Nexus2024'

    const existing = await prisma.user.findUnique({ where: { email: adminEmail } })
    if (!existing) {
      await prisma.user.create({ data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPass, 12),
        firstName: 'Platform', lastName: 'Admin',
        role: 'SUPER_ADMIN', status: 'ACTIVE',
        emailVerified: true, affiliateCode: 'NXADMIN',
      }})
      console.log('Admin user seeded.')
    }

    const challenges = [
      { name:'Starter 10K',   accountSize:10000,   price:99,   phase:2, profitTarget1:8,  profitTarget2:5,    maxDailyLoss:5, maxTotalDrawdown:10, minTradingDays:5,  maxTradingDays:30,  profitSplit:80, leverage:100, instruments:['FOREX','CRYPTO','INDICES','COMMODITIES'], isActive:true, isPopular:false, sortOrder:1 },
      { name:'Standard 25K',  accountSize:25000,   price:199,  phase:2, profitTarget1:8,  profitTarget2:5,    maxDailyLoss:5, maxTotalDrawdown:10, minTradingDays:5,  maxTradingDays:30,  profitSplit:80, leverage:100, instruments:['FOREX','CRYPTO','INDICES','COMMODITIES'], isActive:true, isPopular:true,  sortOrder:2 },
      { name:'Standard 50K',  accountSize:50000,   price:349,  phase:2, profitTarget1:8,  profitTarget2:5,    maxDailyLoss:5, maxTotalDrawdown:10, minTradingDays:5,  maxTradingDays:30,  profitSplit:80, leverage:100, instruments:['FOREX','CRYPTO','INDICES','COMMODITIES'], isActive:true, isPopular:false, sortOrder:3 },
      { name:'Standard 100K', accountSize:100000,  price:599,  phase:2, profitTarget1:8,  profitTarget2:5,    maxDailyLoss:5, maxTotalDrawdown:10, minTradingDays:5,  maxTradingDays:30,  profitSplit:80, leverage:100, instruments:['FOREX','CRYPTO','INDICES','COMMODITIES'], isActive:true, isPopular:false, sortOrder:4 },
      { name:'Standard 200K', accountSize:200000,  price:1099, phase:2, profitTarget1:8,  profitTarget2:5,    maxDailyLoss:5, maxTotalDrawdown:10, minTradingDays:5,  maxTradingDays:30,  profitSplit:85, leverage:100, instruments:['FOREX','CRYPTO','INDICES','COMMODITIES'], isActive:true, isPopular:false, sortOrder:5 },
      { name:'Express 25K',   accountSize:25000,   price:279,  phase:1, profitTarget1:10, profitTarget2:null, maxDailyLoss:5, maxTotalDrawdown:10, minTradingDays:3,  maxTradingDays:14,  profitSplit:75, leverage:100, instruments:['FOREX','INDICES'],                        isActive:true, isPopular:false, sortOrder:10 },
      { name:'Express 50K',   accountSize:50000,   price:499,  phase:1, profitTarget1:10, profitTarget2:null, maxDailyLoss:5, maxTotalDrawdown:10, minTradingDays:3,  maxTradingDays:14,  profitSplit:75, leverage:100, instruments:['FOREX','INDICES'],                        isActive:true, isPopular:false, sortOrder:11 },
    ]
    for (const c of challenges) {
      const exists = await prisma.challengeTemplate.findFirst({ where: { name: c.name } })
      if (!exists) await prisma.challengeTemplate.create({ data: c })
    }
    console.log('Challenges seeded.')
  } catch (e) {
    console.error('Seed error (non-fatal):', e.message)
  }
}

// ── Prisma singleton ──────────────────────────────────────────
let _prisma
function getPrisma() {
  if (!_prisma) _prisma = new PrismaClient()
  return _prisma
}

// ── Helpers ───────────────────────────────────────────────────
const JWT_SECRET         = process.env.JWT_SECRET         || 'dev_secret_change_in_prod'
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev_refresh_change_in_prod'

function signAccess(userId, email, role, sessionToken) {
  return jwt.sign({ userId, email, role, sessionToken }, JWT_SECRET, { expiresIn: '15m' })
}
function signRefresh(userId, sessionToken) {
  return jwt.sign({ userId, sessionToken }, JWT_REFRESH_SECRET, { expiresIn: '7d' })
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.URL || '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    },
    body: JSON.stringify(body),
  }
}

function ok(body)        { return json(200, body) }
function created(body)   { return json(201, body) }
function badReq(msg)     { return json(400, { error: msg }) }
function unauth(msg)     { return json(401, { error: msg || 'Authentication required' }) }
function forbidden(msg)  { return json(403, { error: msg || 'Forbidden' }) }
function notFound(msg)   { return json(404, { error: msg || 'Not found' }) }
function conflict(msg)   { return json(409, { error: msg }) }
function serverErr(msg)  { return json(500, { error: msg || 'Internal server error' }) }

async function authenticate(event) {
  const header = event.headers?.authorization || event.headers?.Authorization
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7)
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    const prisma = getPrisma()
    const session = await prisma.session.findUnique({ where: { token: decoded.sessionToken } })
    if (!session || session.expiresAt < new Date()) return null
    return decoded
  } catch { return null }
}

function body(event) {
  try { return typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {}) }
  catch { return {} }
}

// ── Price feed (simulated — swap for real provider in prod) ───
const BASE_PRICES = {
  EURUSD:1.0856, GBPUSD:1.2673, USDJPY:149.84, USDCHF:0.8987,
  AUDUSD:0.6543, USDCAD:1.3621, NZDUSD:0.5987, EURGBP:0.8567,
  EURJPY:164.82, GBPJPY:190.15, BTCUSD:67450, ETHUSD:3210,
  XAUUSD:2341.2, XAGUSD:27.84, US30:39150, US500:5180, US100:18230, USOIL:78.4,
}
function livePrice(symbol) {
  const base = BASE_PRICES[symbol] || 1
  const vol  = symbol.includes('BTC')||symbol.includes('ETH') ? 0.002
    : ['US30','US500','US100'].includes(symbol) ? 0.0003 : 0.00005
  return parseFloat((base + (Math.random()-0.5)*2*base*vol).toFixed(
    symbol.includes('JPY') ? 3 : ['BTCUSD','US30','US500','US100'].includes(symbol) ? 2 : 5
  ))
}

function calcProfit(type, lots, open, close, symbol) {
  const isJPY    = symbol.includes('JPY')
  const isCrypto = symbol.includes('BTC') || symbol.includes('ETH')
  const isIndex  = ['US30','US500','US100','DE40','UK100'].includes(symbol)
  const isGold   = symbol === 'XAUUSD'
  let pips
  if (isJPY)                          pips = type==='BUY' ? (close-open)*100 : (open-close)*100
  else if (isCrypto||isIndex||isGold) pips = type==='BUY' ? (close-open) : (open-close)
  else                                pips = type==='BUY' ? (close-open)*10000 : (open-close)*10000
  const pipVal = (isCrypto||isIndex||isGold) ? lots : lots*10
  return parseFloat((pips*pipVal).toFixed(2))
}

async function checkRules(accountId) {
  const prisma = getPrisma()
  const account = await prisma.tradingAccount.findUnique({
    where: { id: accountId }, include: { challenge: true },
  })
  if (!account || account.status !== 'ACTIVE') return

  const { challenge } = account
  const balance = account.balance
  const dailyLossPct = account.dailyStartBalance > 0
    ? ((account.dailyStartBalance - balance) / account.dailyStartBalance) * 100 : 0
  const drawdownPct = account.peakBalance > 0
    ? ((account.peakBalance - balance) / account.peakBalance) * 100 : 0

  if (dailyLossPct >= challenge.maxDailyLoss) {
    await prisma.tradingAccount.update({ where:{ id:accountId }, data:{ status:'FAILED', failReason:`Daily loss ${dailyLossPct.toFixed(2)}% exceeded ${challenge.maxDailyLoss}%` } })
    await prisma.notification.create({ data:{ userId:account.userId, type:'CHALLENGE', title:'⚠️ Account Failed', message:`Daily loss limit breached: ${dailyLossPct.toFixed(2)}%`, metadata:{ accountId } } })
    return
  }
  if (drawdownPct >= challenge.maxTotalDrawdown) {
    await prisma.tradingAccount.update({ where:{ id:accountId }, data:{ status:'FAILED', failReason:`Drawdown ${drawdownPct.toFixed(2)}% exceeded ${challenge.maxTotalDrawdown}%` } })
    await prisma.notification.create({ data:{ userId:account.userId, type:'CHALLENGE', title:'⚠️ Account Failed', message:`Max drawdown breached: ${drawdownPct.toFixed(2)}%`, metadata:{ accountId } } })
    return
  }

  const profitPct = ((balance - account.startBalance) / account.startBalance) * 100
  const target    = account.phase === 'CHALLENGE_2' ? challenge.profitTarget2 : challenge.profitTarget1
  if (target && profitPct >= target && account.tradingDays >= challenge.minTradingDays) {
    const isFinal = account.phase === 'CHALLENGE_2' || !challenge.profitTarget2
    if (isFinal) {
      await prisma.tradingAccount.update({ where:{ id:accountId }, data:{ status:'PASSED', phase:'FUNDED', completedAt:new Date() } })
      await prisma.notification.create({ data:{ userId:account.userId, type:'CHALLENGE', title:'🎉 You are now Funded!', message:'Congratulations! You passed the challenge and received a funded account.', metadata:{ accountId } } })
    } else {
      await prisma.tradingAccount.update({ where:{ id:accountId }, data:{ phase:'CHALLENGE_2', startBalance:balance, peakBalance:balance, tradingDays:0, dailyStartBalance:balance } })
      await prisma.notification.create({ data:{ userId:account.userId, type:'CHALLENGE', title:'✅ Phase 1 Passed!', message:'Phase 2 has started. Keep it up!', metadata:{ accountId } } })
    }
  }
}

// ══════════════════════════════════════════════════════════════
//  MAIN HANDLER
// ══════════════════════════════════════════════════════════════
export const handler = async (event) => {
  // OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode:204, headers:{ 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'Content-Type,Authorization', 'Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS' }, body:'' }
  }

  const prisma = getPrisma()

  // Run migrations + seed on first cold start
  await bootstrap(prisma)

  const method   = event.httpMethod
  const rawPath  = event.path.replace('/.netlify/functions/api', '').replace('/api', '') || '/'
  const segments = rawPath.split('/').filter(Boolean)

  try {
    // ── Health ─────────────────────────────────────────────
    if (rawPath === '/health' || rawPath === '') {
      return ok({ status:'ok', timestamp:new Date().toISOString() })
    }

    // ═══════════════════════════════════════════════════════
    //  AUTH routes
    // ═══════════════════════════════════════════════════════
    if (segments[0] === 'auth') {
      const sub = segments[1]

      // POST /auth/register
      if (method==='POST' && sub==='register') {
        const { email, password, firstName, lastName, phone, country, referralCode } = body(event)
        if (!email || !password || !firstName || !lastName) return badReq('Missing required fields')
        if (password.length < 8) return badReq('Password must be at least 8 characters')

        const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
        if (exists) return conflict('Email already registered')

        const passwordHash    = await bcrypt.hash(password, 12)
        const emailVerifyToken = uuidv4()
        const affiliateCode   = 'NX' + Math.random().toString(36).substring(2,8).toUpperCase()

        const user = await prisma.user.create({
          data: { email:email.toLowerCase(), passwordHash, firstName, lastName, phone:phone||null, country:country||null, emailVerifyToken, emailVerifyExpiry:new Date(Date.now()+24*60*60*1000), affiliateCode, status:'PENDING' },
        })

        if (referralCode) {
          const referrer = await prisma.user.findFirst({ where: { affiliateCode:referralCode, status:'ACTIVE' } })
          if (referrer) await prisma.affiliateRef.create({ data: { referrerId:referrer.id, referredId:user.id } })
        }

        // NOTE: email sending skipped if SMTP not configured
        // In production add nodemailer here

        return created({ message: 'Account created. Check your email to verify.' })
      }

      // GET /auth/verify-email/:token
      if (method==='GET' && sub==='verify-email' && segments[2]) {
        const user = await prisma.user.findFirst({ where:{ emailVerifyToken:segments[2], emailVerifyExpiry:{ gt:new Date() } } })
        if (!user) return badReq('Invalid or expired verification link')
        await prisma.user.update({ where:{ id:user.id }, data:{ emailVerified:true, emailVerifyToken:null, emailVerifyExpiry:null, status:'ACTIVE' } })
        return ok({ message: 'Email verified. You can now log in.' })
      }

      // POST /auth/login
      if (method==='POST' && sub==='login') {
        const { email, password } = body(event)
        if (!email || !password) return badReq('Email and password required')
        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
        if (!user || !(await bcrypt.compare(password, user.passwordHash))) return unauth('Invalid email or password')
        if (user.status === 'BANNED') return forbidden('Account suspended. Contact support.')
        if (!user.emailVerified) return forbidden('Please verify your email before logging in.')

        const sessionToken = uuidv4()
        await prisma.session.create({ data: { userId:user.id, token:sessionToken, ipAddress:event.headers?.['x-forwarded-for']||null, userAgent:event.headers?.['user-agent']||null, expiresAt:new Date(Date.now()+7*24*60*60*1000) } })

        return ok({
          accessToken:  signAccess(user.id, user.email, user.role, sessionToken),
          refreshToken: signRefresh(user.id, sessionToken),
          user: { id:user.id, email:user.email, firstName:user.firstName, lastName:user.lastName, role:user.role, affiliateCode:user.affiliateCode },
        })
      }

      // POST /auth/refresh
      if (method==='POST' && sub==='refresh') {
        const { refreshToken } = body(event)
        if (!refreshToken) return unauth('No refresh token')
        try {
          const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET)
          const session = await prisma.session.findUnique({ where:{ token:decoded.sessionToken }, include:{ user:true } })
          if (!session || session.expiresAt < new Date()) return unauth('Session expired')
          return ok({ accessToken: signAccess(session.user.id, session.user.email, session.user.role, decoded.sessionToken) })
        } catch { return unauth('Invalid refresh token') }
      }

      // POST /auth/logout
      if (method==='POST' && sub==='logout') {
        const auth = await authenticate(event)
        if (auth) await prisma.session.deleteMany({ where:{ token:auth.sessionToken } })
        return ok({ message: 'Logged out' })
      }

      // GET /auth/me
      if (method==='GET' && sub==='me') {
        const auth = await authenticate(event)
        if (!auth) return unauth()
        const user = await prisma.user.findUnique({ where:{ id:auth.userId }, select:{ id:true, email:true, firstName:true, lastName:true, phone:true, country:true, role:true, status:true, emailVerified:true, affiliateCode:true, createdAt:true } })
        return user ? ok(user) : notFound('User not found')
      }

      // POST /auth/forgot-password
      if (method==='POST' && sub==='forgot-password') {
        const { email } = body(event)
        const user = await prisma.user.findUnique({ where:{ email:email?.toLowerCase() } })
        if (user) {
          const token = uuidv4()
          await prisma.user.update({ where:{ id:user.id }, data:{ passwordResetToken:token, passwordResetExpiry:new Date(Date.now()+60*60*1000) } })
          // TODO: send email with token
        }
        return ok({ message: 'If that email exists, a reset link was sent.' })
      }

      // POST /auth/reset-password
      if (method==='POST' && sub==='reset-password') {
        const { token, password } = body(event)
        if (!token || !password || password.length < 8) return badReq('Invalid request')
        const user = await prisma.user.findFirst({ where:{ passwordResetToken:token, passwordResetExpiry:{ gt:new Date() } } })
        if (!user) return badReq('Invalid or expired reset link')
        await prisma.user.update({ where:{ id:user.id }, data:{ passwordHash:await bcrypt.hash(password,12), passwordResetToken:null, passwordResetExpiry:null } })
        await prisma.session.deleteMany({ where:{ userId:user.id } })
        return ok({ message: 'Password reset. Please log in.' })
      }
    }

    // ═══════════════════════════════════════════════════════
    //  USER routes
    // ═══════════════════════════════════════════════════════
    if (segments[0] === 'user') {
      const auth = await authenticate(event)
      if (!auth) return unauth()
      const sub = segments[1]

      if (method==='GET' && sub==='dashboard-stats') {
        const accounts = await prisma.tradingAccount.findMany({ where:{ userId:auth.userId, paymentStatus:'PAID' } })
        const active   = accounts.filter(a => a.status==='ACTIVE')
        const totalBalance = active.reduce((s,a) => s+a.balance, 0)
        const totalStart   = active.reduce((s,a) => s+a.startBalance, 0)
        const today = new Date(); today.setUTCHours(0,0,0,0)
        const todayTrades = await prisma.order.findMany({ where:{ userId:auth.userId, status:'CLOSED', closedAt:{ gte:today } }, select:{ profit:true } })
        const todayPnL = todayTrades.reduce((s,t) => s+(t.profit||0), 0)
        return ok({
          totalBalance, totalStart,
          totalProfitPct: totalStart>0 ? ((totalBalance-totalStart)/totalStart)*100 : 0,
          todayPnL, todayPnLPct: totalStart>0 ? (todayPnL/totalStart)*100 : 0,
          passedChallenges: accounts.filter(a => a.status==='PASSED'||a.phase==='FUNDED').length,
          failedChallenges: accounts.filter(a => a.status==='FAILED').length,
          fundedAccounts:   accounts.filter(a => a.phase==='FUNDED').length,
          totalAccounts:    accounts.length,
        })
      }

      if (method==='PATCH' && sub==='profile') {
        const { firstName, lastName, phone, country } = body(event)
        const user = await prisma.user.update({ where:{ id:auth.userId }, data:{ firstName, lastName, phone:phone||null, country:country||null }, select:{ id:true, email:true, firstName:true, lastName:true, phone:true, country:true, role:true, affiliateCode:true } })
        return ok(user)
      }

      if (method==='POST' && sub==='change-password') {
        const { currentPassword, newPassword } = body(event)
        if (!newPassword || newPassword.length < 8) return badReq('New password too short')
        const user = await prisma.user.findUnique({ where:{ id:auth.userId } })
        if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) return badReq('Current password incorrect')
        await prisma.user.update({ where:{ id:auth.userId }, data:{ passwordHash: await bcrypt.hash(newPassword,12) } })
        await prisma.session.deleteMany({ where:{ userId:auth.userId } })
        return ok({ message: 'Password changed.' })
      }

      if (method==='GET' && sub==='kyc') {
        return ok(await prisma.kycDocument.findMany({ where:{ userId:auth.userId }, orderBy:{ submittedAt:'desc' } }))
      }
      if (method==='POST' && sub==='kyc') {
        const { type, fileUrl } = body(event)
        if (!type || !fileUrl) return badReq('type and fileUrl required')
        return created(await prisma.kycDocument.create({ data:{ userId:auth.userId, type, fileUrl } }))
      }

      if (method==='GET' && sub==='unread-count') {
        const count = await prisma.notification.count({ where:{ userId:auth.userId, read:false } })
        return ok({ count })
      }
    }

    // ═══════════════════════════════════════════════════════
    //  CHALLENGES (public)
    // ═══════════════════════════════════════════════════════
    if (segments[0] === 'challenges') {
      if (method==='GET' && !segments[1]) {
        return ok(await prisma.challengeTemplate.findMany({ where:{ isActive:true }, orderBy:[{ sortOrder:'asc' },{ accountSize:'asc' }] }))
      }
      if (method==='GET' && segments[1]) {
        const c = await prisma.challengeTemplate.findUnique({ where:{ id:segments[1], isActive:true } })
        return c ? ok(c) : notFound()
      }
    }

    // ═══════════════════════════════════════════════════════
    //  ACCOUNTS
    // ═══════════════════════════════════════════════════════
    if (segments[0] === 'accounts') {
      const auth = await authenticate(event)
      if (!auth) return unauth()
      const params = event.queryStringParameters || {}

      if (method==='GET' && !segments[1]) {
        const where = { userId:auth.userId, paymentStatus:'PAID' }
        if (params.phase)  where.phase  = params.phase
        if (params.status) where.status = params.status
        return ok(await prisma.tradingAccount.findMany({ where, include:{ challenge:true }, orderBy:{ createdAt:'desc' } }))
      }
      if (method==='GET' && segments[1]) {
        const a = await prisma.tradingAccount.findFirst({ where:{ id:segments[1], userId:auth.userId }, include:{ challenge:true, ruleBreaches:{ orderBy:{ occurredAt:'desc' }, take:10 } } })
        return a ? ok(a) : notFound()
      }
    }

    // ═══════════════════════════════════════════════════════
    //  TRADING
    // ═══════════════════════════════════════════════════════
    if (segments[0] === 'trading') {
      const auth = await authenticate(event)
      if (!auth) return unauth()
      const sub = segments[1]
      const params = event.queryStringParameters || {}

      // GET /trading/market/symbols
      if (method==='GET' && sub==='market' && segments[2]==='symbols') {
        return ok([
          { symbol:'EURUSD', name:'Euro / US Dollar',    category:'Forex' },
          { symbol:'GBPUSD', name:'British Pound / USD',  category:'Forex' },
          { symbol:'USDJPY', name:'USD / Japanese Yen',   category:'Forex' },
          { symbol:'USDCHF', name:'USD / Swiss Franc',    category:'Forex' },
          { symbol:'AUDUSD', name:'Australian Dollar / USD', category:'Forex' },
          { symbol:'USDCAD', name:'USD / Canadian Dollar', category:'Forex' },
          { symbol:'NZDUSD', name:'NZD / USD',            category:'Forex' },
          { symbol:'EURGBP', name:'Euro / GBP',           category:'Forex' },
          { symbol:'EURJPY', name:'Euro / JPY',           category:'Forex' },
          { symbol:'GBPJPY', name:'GBP / JPY',            category:'Forex' },
          { symbol:'BTCUSD', name:'Bitcoin / USD',        category:'Crypto' },
          { symbol:'ETHUSD', name:'Ethereum / USD',       category:'Crypto' },
          { symbol:'XAUUSD', name:'Gold / USD',           category:'Commodities' },
          { symbol:'XAGUSD', name:'Silver / USD',         category:'Commodities' },
          { symbol:'US30',   name:'Dow Jones 30',         category:'Indices' },
          { symbol:'US500',  name:'S&P 500',              category:'Indices' },
          { symbol:'US100',  name:'NASDAQ 100',           category:'Indices' },
          { symbol:'USOIL',  name:'US Crude Oil',         category:'Commodities' },
        ])
      }

      // GET /trading/market/price/:symbol
      if (method==='GET' && sub==='market' && segments[2]==='price' && segments[3]) {
        const sym = segments[3].toUpperCase()
        return ok({ symbol:sym, price:livePrice(sym), timestamp:Date.now() })
      }

      // GET /trading/market/prices (all prices at once)
      if (method==='GET' && sub==='market' && segments[2]==='prices') {
        const prices = {}
        Object.keys(BASE_PRICES).forEach(s => { prices[s] = { bid:livePrice(s) } })
        return ok(prices)
      }

      // POST /trading/order
      if (method==='POST' && sub==='order') {
        const { accountId, symbol, type, lots, stopLoss, takeProfit } = body(event)
        if (!accountId||!symbol||!type||!lots) return badReq('Missing fields')
        if (!['BUY','SELL'].includes(type)) return badReq('type must be BUY or SELL')
        if (lots <= 0 || lots > 50) return badReq('lots must be between 0.01 and 50')

        const account = await prisma.tradingAccount.findFirst({ where:{ id:accountId, userId:auth.userId, status:'ACTIVE', paymentStatus:'PAID' }, include:{ challenge:true } })
        if (!account) return notFound('Active account not found')

        const price      = livePrice(symbol)
        const commission = parseFloat((lots * 3.5).toFixed(2))

        const order = await prisma.order.create({ data:{ accountId, userId:auth.userId, symbol, type, lots, openPrice:price, stopLoss:stopLoss||null, takeProfit:takeProfit||null, commission, status:'OPEN' } })
        await prisma.tradingAccount.update({ where:{ id:accountId }, data:{ equity:{ decrement:commission } } })

        // update trading day counter
        const today = new Date(); today.setUTCHours(0,0,0,0)
        const lastDay = account.lastTradingDay ? new Date(account.lastTradingDay) : null
        if (lastDay) lastDay.setUTCHours(0,0,0,0)
        if (!lastDay || lastDay.getTime() !== today.getTime()) {
          await prisma.tradingAccount.update({ where:{ id:accountId }, data:{ tradingDays:{ increment:1 }, lastTradingDay:new Date(), dailyStartBalance:account.balance, dailyLoss:0 } })
        }

        return created(order)
      }

      // POST /trading/order/:id/close
      if (method==='POST' && sub==='order' && segments[2] && segments[3]==='close') {
        const order = await prisma.order.findFirst({ where:{ id:segments[2], userId:auth.userId, status:'OPEN' }, include:{ account:{ include:{ challenge:true } } } })
        if (!order) return notFound('Open order not found')

        const closePrice = livePrice(order.symbol)
        const profit     = calcProfit(order.type, order.lots, order.openPrice, closePrice, order.symbol)
        const net        = parseFloat((profit - order.commission).toFixed(2))

        const [closedOrder] = await prisma.$transaction([
          prisma.order.update({ where:{ id:order.id }, data:{ status:'CLOSED', closePrice, profit:net, closedAt:new Date(), closeReason:'MANUAL' } }),
          prisma.tradingAccount.update({ where:{ id:order.accountId }, data:{ balance:{ increment:net }, equity:{ increment:net }, totalProfit:{ increment:net }, peakBalance:{ set:Math.max(order.account.peakBalance, order.account.balance+net) } } }),
        ])

        await checkRules(order.accountId)
        return ok(closedOrder)
      }

      // PATCH /trading/order/:id  (modify SL/TP)
      if (method==='PATCH' && sub==='order' && segments[2]) {
        const order = await prisma.order.findFirst({ where:{ id:segments[2], userId:auth.userId, status:'OPEN' } })
        if (!order) return notFound('Order not found')
        const { stopLoss, takeProfit } = body(event)
        return ok(await prisma.order.update({ where:{ id:segments[2] }, data:{ stopLoss:stopLoss??null, takeProfit:takeProfit??null } }))
      }

      // GET /trading/orders/open
      if (method==='GET' && sub==='orders' && segments[2]==='open') {
        return ok(await prisma.order.findMany({ where:{ userId:auth.userId, accountId:params.accountId||undefined, status:'OPEN' }, orderBy:{ openedAt:'desc' } }))
      }

      // GET /trading/orders/history
      if (method==='GET' && sub==='orders' && segments[2]==='history') {
        const page  = Math.max(1, parseInt(params.page||'1'))
        const limit = Math.min(100, parseInt(params.limit||'50'))
        const skip  = (page-1)*limit
        const where = { userId:auth.userId, status:'CLOSED', accountId:params.accountId||undefined }
        const [orders, total] = await Promise.all([
          prisma.order.findMany({ where, orderBy:{ closedAt:'desc' }, skip, take:limit }),
          prisma.order.count({ where }),
        ])
        return ok({ orders, total, page, pages:Math.ceil(total/limit) })
      }

      // GET /trading/stats/:accountId
      if (method==='GET' && sub==='stats' && segments[2]) {
        const account = await prisma.tradingAccount.findFirst({ where:{ id:segments[2], userId:auth.userId }, include:{ challenge:true } })
        if (!account) return notFound()
        const closed = await prisma.order.findMany({ where:{ accountId:account.id, status:'CLOSED' }, select:{ profit:true } })
        const wins   = closed.filter(o => (o.profit||0) > 0)
        const losses = closed.filter(o => (o.profit||0) <= 0)
        const totalPnL = closed.reduce((s,o) => s+(o.profit||0), 0)
        const avgWin   = wins.length   > 0 ? wins.reduce((s,o) => s+(o.profit||0), 0)/wins.length : 0
        const avgLoss  = losses.length > 0 ? Math.abs(losses.reduce((s,o) => s+(o.profit||0), 0)/losses.length) : 0
        const drawdown = account.peakBalance > 0 ? ((account.peakBalance-account.balance)/account.peakBalance)*100 : 0
        const dailyDD  = account.dailyStartBalance > 0 ? ((account.dailyStartBalance-account.balance)/account.dailyStartBalance)*100 : 0
        const profitPct = ((account.balance-account.startBalance)/account.startBalance)*100
        const target    = account.phase==='CHALLENGE_2' ? account.challenge.profitTarget2 : account.challenge.profitTarget1
        return ok({ account, stats:{ totalTrades:closed.length, wins:wins.length, losses:losses.length, winRate:closed.length>0?(wins.length/closed.length)*100:0, totalPnL, avgWin, avgLoss, profitFactor:avgLoss>0?avgWin/avgLoss:0, drawdown, dailyDrawdown:dailyDD, profitPct, profitTarget:target||0, profitProgress:target?Math.min((profitPct/target)*100,100):0, maxDailyLoss:account.challenge.maxDailyLoss, maxTotalDrawdown:account.challenge.maxTotalDrawdown } })
      }
    }

    // ═══════════════════════════════════════════════════════
    //  PAYMENTS
    // ═══════════════════════════════════════════════════════
    if (segments[0] === 'payments') {
      const sub = segments[1]

      // POST /payments/checkout
      if (method==='POST' && sub==='checkout') {
        const auth = await authenticate(event)
        if (!auth) return unauth()
        const { challengeTemplateId } = body(event)
        if (!challengeTemplateId) return badReq('challengeTemplateId required')

        const [challenge, user] = await Promise.all([
          prisma.challengeTemplate.findUnique({ where:{ id:challengeTemplateId, isActive:true } }),
          prisma.user.findUnique({ where:{ id:auth.userId } }),
        ])
        if (!challenge) return notFound('Challenge not found')

        const accountNumber = 'NX' + Date.now().toString(36).toUpperCase().slice(-6) + Math.random().toString(36).substring(2,5).toUpperCase()
        const account = await prisma.tradingAccount.create({ data:{ userId:auth.userId, challengeTemplateId, accountNumber, balance:challenge.accountSize, equity:challenge.accountSize, startBalance:challenge.accountSize, peakBalance:challenge.accountSize, dailyStartBalance:challenge.accountSize, paymentStatus:'PENDING', status:'ACTIVE' } })

        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{ price_data: { currency:'usd', product_data:{ name:`Nexus Funding — ${challenge.name}`, description:`$${challenge.accountSize.toLocaleString()} ${challenge.phase}-Phase Challenge` }, unit_amount:Math.round(challenge.price*100) }, quantity:1 }],
          mode: 'payment',
          customer_email: user.email,
          success_url: `${process.env.URL || process.env.FRONTEND_URL}/pages/dashboard.html?success=1&account=${account.id}`,
          cancel_url:  `${process.env.URL || process.env.FRONTEND_URL}/pages/challenges.html?cancelled=1`,
          metadata: { userId:auth.userId, accountId:account.id },
        })

        await prisma.tradingAccount.update({ where:{ id:account.id }, data:{ stripeSessionId:session.id } })
        return ok({ sessionId:session.id, url:session.url })
      }

      // POST /payments/webhook
      if (method==='POST' && sub==='webhook') {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
        const sig = event.headers?.['stripe-signature']
        let evt
        try {
          evt = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET)
        } catch (e) {
          return badReq(`Webhook error: ${e.message}`)
        }

        if (evt.type === 'checkout.session.completed') {
          const session = evt.data.object
          const { userId, accountId } = session.metadata
          await prisma.tradingAccount.update({ where:{ id:accountId }, data:{ paymentStatus:'PAID', stripePaymentId:session.payment_intent, startedAt:new Date() } })
          await prisma.notification.create({ data:{ userId, type:'CHALLENGE', title:'🚀 Challenge Active!', message:'Payment confirmed. Your trading account is now live. Good luck!', metadata:{ accountId } } })
        }
        return ok({ received: true })
      }

      // GET /payments/history
      if (method==='GET' && sub==='history') {
        const auth = await authenticate(event)
        if (!auth) return unauth()
        const accounts = await prisma.tradingAccount.findMany({ where:{ userId:auth.userId, paymentStatus:{ in:['PAID','REFUNDED'] } }, include:{ challenge:{ select:{ name:true, accountSize:true, price:true } } }, orderBy:{ createdAt:'desc' } })
        return ok(accounts.map(a => ({ id:a.id, accountNumber:a.accountNumber, amount:a.challenge.price, challenge:a.challenge.name, accountSize:a.challenge.accountSize, stripePaymentId:a.stripePaymentId, date:a.startedAt||a.createdAt })))
      }
    }

    // ═══════════════════════════════════════════════════════
    //  PAYOUTS
    // ═══════════════════════════════════════════════════════
    if (segments[0] === 'payouts') {
      const auth = await authenticate(event)
      if (!auth) return unauth()

      if (method==='GET') {
        return ok(await prisma.payout.findMany({ where:{ userId:auth.userId }, include:{ account:{ select:{ accountNumber:true } } }, orderBy:{ requestedAt:'desc' } }))
      }
      if (method==='POST') {
        const { accountId, method: payMethod, walletAddress } = body(event)
        if (!accountId || !payMethod) return badReq('accountId and method required')
        const account = await prisma.tradingAccount.findFirst({ where:{ id:accountId, userId:auth.userId, phase:'FUNDED', status:'ACTIVE' }, include:{ challenge:true } })
        if (!account) return notFound('Funded account not found')
        const profit = account.balance - account.startBalance
        if (profit < 100) return badReq('Minimum payout is $100')
        const existing = await prisma.payout.findFirst({ where:{ accountId, status:{ in:['PENDING','APPROVED','PROCESSING'] } } })
        if (existing) return conflict('You already have a pending payout for this account')
        const splitRatio = account.challenge.profitSplit
        const amount = parseFloat(((profit*splitRatio)/100).toFixed(2))
        return created(await prisma.payout.create({ data:{ userId:auth.userId, accountId, amount, grossAmount:profit, firmShare:parseFloat((profit-amount).toFixed(2)), splitRatio, method:payMethod, walletAddress:walletAddress||null, status:'PENDING' } }))
      }
    }

    // ═══════════════════════════════════════════════════════
    //  LEADERBOARD (public)
    // ═══════════════════════════════════════════════════════
    if (segments[0] === 'leaderboard' && method==='GET') {
      const funded = await prisma.tradingAccount.findMany({ where:{ phase:'FUNDED', status:'ACTIVE' }, include:{ user:{ select:{ firstName:true, lastName:true, country:true } }, challenge:{ select:{ accountSize:true } }, orders:{ where:{ status:'CLOSED' }, select:{ profit:true }, take:200 } }, orderBy:{ totalProfit:'desc' }, take:50 })
      const top = funded.map(a => {
        const wins = a.orders.filter(o => (o.profit||0) > 0).length
        return { id:a.id, firstName:a.user.firstName, lastName:a.user.lastName[0]+'.', country:a.user.country, accountSize:a.challenge.accountSize, balance:a.balance, totalProfit:a.totalProfit, profitPct:a.startBalance>0?((a.balance-a.startBalance)/a.startBalance)*100:0, winRate:a.orders.length>0?(wins/a.orders.length)*100:0, tradingDays:a.tradingDays }
      })
      return ok({ top, updatedAt:new Date().toISOString() })
    }

    // ═══════════════════════════════════════════════════════
    //  AFFILIATE
    // ═══════════════════════════════════════════════════════
    if (segments[0] === 'affiliate') {
      const auth = await authenticate(event)
      if (!auth) return unauth()
      if (method==='GET' && segments[1]==='stats') {
        const user = await prisma.user.findUnique({ where:{ id:auth.userId }, select:{ affiliateCode:true } })
        const refs = await prisma.affiliateRef.findMany({ where:{ referrerId:auth.userId }, include:{ referred:{ select:{ firstName:true, lastName:true, createdAt:true, status:true } } }, orderBy:{ createdAt:'desc' } })
        return ok({ affiliateCode:user?.affiliateCode, referralLink:`${process.env.URL||process.env.FRONTEND_URL}/pages/register.html?ref=${user?.affiliateCode}`, totalReferrals:refs.length, totalEarned:refs.reduce((s,r) => s+r.earned,0), commissionPct:refs[0]?.commissionPct??10, refs:refs.map(r => ({ name:`${r.referred.firstName} ${r.referred.lastName}`, status:r.referred.status, earned:r.earned, paid:r.paid, date:r.referred.createdAt })) })
      }
    }

    // ═══════════════════════════════════════════════════════
    //  NOTIFICATIONS
    // ═══════════════════════════════════════════════════════
    if (segments[0] === 'notifications') {
      const auth = await authenticate(event)
      if (!auth) return unauth()
      if (method==='GET' && !segments[1]) {
        return ok(await prisma.notification.findMany({ where:{ userId:auth.userId }, orderBy:{ createdAt:'desc' }, take:50 }))
      }
      if (method==='GET' && segments[1]==='unread-count') {
        const count = await prisma.notification.count({ where:{ userId:auth.userId, read:false } })
        return ok({ count })
      }
      if (method==='POST' && segments[1]==='read-all') {
        await prisma.notification.updateMany({ where:{ userId:auth.userId, read:false }, data:{ read:true } })
        return ok({ ok:true })
      }
      if (method==='POST' && segments[1]==='read' && segments[2]) {
        await prisma.notification.updateMany({ where:{ id:segments[2], userId:auth.userId }, data:{ read:true } })
        return ok({ ok:true })
      }
    }

    // ═══════════════════════════════════════════════════════
    //  ADMIN routes
    // ═══════════════════════════════════════════════════════
    if (segments[0] === 'admin') {
      const auth = await authenticate(event)
      if (!auth) return unauth()
      const user = await prisma.user.findUnique({ where:{ id:auth.userId }, select:{ role:true } })
      if (!user || !['ADMIN','SUPER_ADMIN'].includes(user.role)) return forbidden('Admin access required')
      const sub = segments[1]

      if (method==='GET' && sub==='analytics') {
        const [totalUsers, activeUsers, totalAccounts, activeAccounts, passedAccounts, failedAccounts, fundedAccounts, pendingPayouts, openTrades, totalTrades] = await Promise.all([
          prisma.user.count(), prisma.user.count({ where:{ status:'ACTIVE' } }),
          prisma.tradingAccount.count(), prisma.tradingAccount.count({ where:{ status:'ACTIVE' } }),
          prisma.tradingAccount.count({ where:{ status:'PASSED' } }),
          prisma.tradingAccount.count({ where:{ status:'FAILED' } }),
          prisma.tradingAccount.count({ where:{ phase:'FUNDED' } }),
          prisma.payout.count({ where:{ status:'PENDING' } }),
          prisma.order.count({ where:{ status:'OPEN' } }),
          prisma.order.count(),
        ])
        const revenueData = await prisma.tradingAccount.findMany({ where:{ paymentStatus:'PAID' }, include:{ challenge:{ select:{ price:true } } } })
        const revenue = revenueData.reduce((s,a) => s+a.challenge.price, 0)
        const cutoff30 = new Date(Date.now()-30*24*60*60*1000)
        const last30Revenue = revenueData.filter(a => a.startedAt&&a.startedAt>=cutoff30).reduce((s,a) => s+a.challenge.price, 0)
        return ok({ users:{ total:totalUsers, active:activeUsers }, accounts:{ total:totalAccounts, active:activeAccounts, passed:passedAccounts, failed:failedAccounts, funded:fundedAccounts }, payouts:{ pending:pendingPayouts }, trades:{ total:totalTrades, open:openTrades }, revenue:{ total:revenue, last30Days:last30Revenue } })
      }

      if (method==='GET' && sub==='users') {
        const params = event.queryStringParameters || {}
        const page = Math.max(1, parseInt(params.page||'1')), limit = 25
        const where = {}
        if (params.search) where.OR = [{ email:{ contains:params.search, mode:'insensitive' } }, { firstName:{ contains:params.search, mode:'insensitive' } }, { lastName:{ contains:params.search, mode:'insensitive' } }]
        if (params.status) where.status = params.status
        const [users, total] = await Promise.all([prisma.user.findMany({ where, skip:(page-1)*limit, take:limit, orderBy:{ createdAt:'desc' }, select:{ id:true, email:true, firstName:true, lastName:true, role:true, status:true, emailVerified:true, country:true, createdAt:true, affiliateCode:true, _count:{ select:{ tradingAccounts:true } } } }), prisma.user.count({ where })])
        return ok({ users, total, page, pages:Math.ceil(total/limit) })
      }

      if (method==='PATCH' && sub==='users' && segments[2]) {
        const { status, role, emailVerified } = body(event)
        const u = await prisma.user.update({ where:{ id:segments[2] }, data:{ ...(status&&{ status }), ...(role&&{ role }), ...(emailVerified!==undefined&&{ emailVerified }) } })
        await prisma.auditLog.create({ data:{ adminId:auth.userId, action:'UPDATE_USER', targetType:'user', targetId:segments[2], after:body(event) } })
        return ok(u)
      }

      if (method==='GET' && sub==='accounts') {
        const params = event.queryStringParameters || {}
        const page = Math.max(1, parseInt(params.page||'1')), limit = 50
        const where = {}
        if (params.status) where.status = params.status
        if (params.phase)  where.phase  = params.phase
        const [accounts, total] = await Promise.all([prisma.tradingAccount.findMany({ where, skip:(page-1)*limit, take:limit, orderBy:{ createdAt:'desc' }, include:{ user:{ select:{ id:true, email:true, firstName:true, lastName:true } }, challenge:{ select:{ name:true, accountSize:true } }, _count:{ select:{ orders:true } } } }), prisma.tradingAccount.count({ where })])
        return ok({ accounts, total, page, pages:Math.ceil(total/limit) })
      }

      if (method==='PATCH' && sub==='accounts' && segments[2]) {
        const { status, phase, balance } = body(event)
        const a = await prisma.tradingAccount.update({ where:{ id:segments[2] }, data:{ ...(status&&{ status }), ...(phase&&{ phase }), ...(balance!==undefined&&{ balance }) } })
        await prisma.auditLog.create({ data:{ adminId:auth.userId, action:'UPDATE_ACCOUNT', targetType:'account', targetId:segments[2], after:body(event) } })
        return ok(a)
      }

      if (method==='POST' && sub==='accounts' && segments[2]==='reset' && segments[3]==='reset') {
        const a = await prisma.tradingAccount.findUnique({ where:{ id:segments[2] }, include:{ challenge:true } })
        if (!a) return notFound()
        await prisma.order.updateMany({ where:{ accountId:segments[2], status:'OPEN' }, data:{ status:'CANCELLED', closedAt:new Date(), closeReason:'ADMIN' } })
        const reset = await prisma.tradingAccount.update({ where:{ id:segments[2] }, data:{ balance:a.challenge.accountSize, equity:a.challenge.accountSize, peakBalance:a.challenge.accountSize, dailyStartBalance:a.challenge.accountSize, dailyLoss:0, totalProfit:0, tradingDays:0, status:'ACTIVE', phase:'CHALLENGE_1', failReason:null, startedAt:new Date(), resetCount:{ increment:1 } } })
        await prisma.auditLog.create({ data:{ adminId:auth.userId, action:'RESET_ACCOUNT', targetType:'account', targetId:segments[2] } })
        return ok(reset)
      }

      if (method==='GET' && sub==='payouts') {
        const params = event.queryStringParameters || {}
        const page = Math.max(1, parseInt(params.page||'1')), limit = 50
        const where = {}; if (params.status) where.status = params.status
        const [payouts, total] = await Promise.all([prisma.payout.findMany({ where, skip:(page-1)*limit, take:limit, orderBy:{ requestedAt:'desc' }, include:{ user:{ select:{ id:true, email:true, firstName:true, lastName:true } }, account:{ select:{ accountNumber:true } } } }), prisma.payout.count({ where })])
        return ok({ payouts, total, page, pages:Math.ceil(total/limit) })
      }

      if (method==='PATCH' && sub==='payouts' && segments[2]) {
        const { status, adminNote } = body(event)
        if (!['APPROVED','REJECTED','PROCESSING','COMPLETED'].includes(status)) return badReq('Invalid status')
        const p = await prisma.payout.update({ where:{ id:segments[2] }, data:{ status, adminNote:adminNote||null, processedAt:new Date(), processedBy:auth.userId } })
        await prisma.notification.create({ data:{ userId:p.userId, type:'PAYOUT', title:status==='APPROVED'?'✅ Payout Approved':status==='REJECTED'?'❌ Payout Rejected':'💸 Payout Update', message:adminNote||`Your payout has been ${status.toLowerCase()}.`, metadata:{ payoutId:p.id } } })
        await prisma.auditLog.create({ data:{ adminId:auth.userId, action:`PAYOUT_${status}`, targetType:'payout', targetId:segments[2] } })
        return ok(p)
      }

      if (method==='GET' && sub==='trades') {
        const params = event.queryStringParameters || {}
        const page = Math.max(1, parseInt(params.page||'1')), limit = 100
        const where = {}
        if (params.flagged==='true') where.flagged = true
        if (params.userId)    where.userId    = params.userId
        if (params.accountId) where.accountId = params.accountId
        const [trades, total] = await Promise.all([prisma.order.findMany({ where, skip:(page-1)*limit, take:limit, orderBy:{ openedAt:'desc' }, include:{ user:{ select:{ id:true, email:true, firstName:true, lastName:true } }, account:{ select:{ accountNumber:true } } } }), prisma.order.count({ where })])
        return ok({ trades, total, page, pages:Math.ceil(total/limit) })
      }

      if (method==='GET' && sub==='challenge-templates') {
        return ok(await prisma.challengeTemplate.findMany({ orderBy:[{ sortOrder:'asc' },{ accountSize:'asc' }] }))
      }
      if (method==='POST' && sub==='challenge-templates') {
        return created(await prisma.challengeTemplate.create({ data:body(event) }))
      }
      if (method==='PUT' && sub==='challenge-templates' && segments[2]) {
        return ok(await prisma.challengeTemplate.update({ where:{ id:segments[2] }, data:body(event) }))
      }

      if (method==='GET' && sub==='kyc') {
        const params = event.queryStringParameters || {}
        const docs = await prisma.kycDocument.findMany({ where: params.status ? { status:params.status } : { status:'PENDING' }, include:{ user:{ select:{ id:true, email:true, firstName:true, lastName:true } } }, orderBy:{ submittedAt:'desc' }, take:100 })
        return ok(docs)
      }
      if (method==='PATCH' && sub==='kyc' && segments[2]) {
        const { status, reviewNote } = body(event)
        return ok(await prisma.kycDocument.update({ where:{ id:segments[2] }, data:{ status, reviewNote:reviewNote||null, reviewedAt:new Date(), reviewedBy:auth.userId } }))
      }

      if (method==='GET' && sub==='audit-logs') {
        const params = event.queryStringParameters || {}
        const page = Math.max(1, parseInt(params.page||'1'))
        return ok(await prisma.auditLog.findMany({ skip:(page-1)*50, take:50, orderBy:{ createdAt:'desc' } }))
      }
    }

    return notFound('Route not found')

  } catch (err) {
    console.error('API error:', err)
    return serverErr(process.env.NODE_ENV==='production' ? 'Internal server error' : err.message)
  }
}
