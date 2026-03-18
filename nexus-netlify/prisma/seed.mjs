// prisma/seed.mjs
// Runs automatically during Netlify build
import { PrismaClient } from '@prisma/client'
import { createHash, randomBytes } from 'crypto'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const bcrypt  = require('bcryptjs')

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding Nexus Funding database...')

  // ── Admin user ────────────────────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@nexusfunding.com'
  const adminPass  = process.env.ADMIN_PASSWORD || 'Admin@Nexus2024'

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } })
  if (!existing) {
    await prisma.user.create({
      data: {
        email:         adminEmail,
        passwordHash:  await bcrypt.hash(adminPass, 12),
        firstName:     'Platform',
        lastName:      'Admin',
        role:          'SUPER_ADMIN',
        status:        'ACTIVE',
        emailVerified: true,
        affiliateCode: 'NXADMIN',
      },
    })
    console.log(`✅ Admin created: ${adminEmail}`)
  } else {
    console.log(`ℹ️  Admin already exists: ${adminEmail}`)
  }

  // ── Challenge templates ───────────────────────────────────
  const challenges = [
    {
      name: 'Starter 10K', accountSize: 10000, price: 99, phase: 2,
      profitTarget1: 8, profitTarget2: 5, maxDailyLoss: 5, maxTotalDrawdown: 10,
      minTradingDays: 5, maxTradingDays: 30, profitSplit: 80, leverage: 100,
      instruments: ['FOREX','CRYPTO','INDICES','COMMODITIES'], isActive: true, isPopular: false, sortOrder: 1,
    },
    {
      name: 'Standard 25K', accountSize: 25000, price: 199, phase: 2,
      profitTarget1: 8, profitTarget2: 5, maxDailyLoss: 5, maxTotalDrawdown: 10,
      minTradingDays: 5, maxTradingDays: 30, profitSplit: 80, leverage: 100,
      instruments: ['FOREX','CRYPTO','INDICES','COMMODITIES'], isActive: true, isPopular: true, sortOrder: 2,
    },
    {
      name: 'Standard 50K', accountSize: 50000, price: 349, phase: 2,
      profitTarget1: 8, profitTarget2: 5, maxDailyLoss: 5, maxTotalDrawdown: 10,
      minTradingDays: 5, maxTradingDays: 30, profitSplit: 80, leverage: 100,
      instruments: ['FOREX','CRYPTO','INDICES','COMMODITIES'], isActive: true, isPopular: false, sortOrder: 3,
    },
    {
      name: 'Standard 100K', accountSize: 100000, price: 599, phase: 2,
      profitTarget1: 8, profitTarget2: 5, maxDailyLoss: 5, maxTotalDrawdown: 10,
      minTradingDays: 5, maxTradingDays: 30, profitSplit: 80, leverage: 100,
      instruments: ['FOREX','CRYPTO','INDICES','COMMODITIES'], isActive: true, isPopular: false, sortOrder: 4,
    },
    {
      name: 'Standard 200K', accountSize: 200000, price: 1099, phase: 2,
      profitTarget1: 8, profitTarget2: 5, maxDailyLoss: 5, maxTotalDrawdown: 10,
      minTradingDays: 5, maxTradingDays: 30, profitSplit: 85, leverage: 100,
      instruments: ['FOREX','CRYPTO','INDICES','COMMODITIES'], isActive: true, isPopular: false, sortOrder: 5,
    },
    {
      name: 'Express 25K', accountSize: 25000, price: 279, phase: 1,
      profitTarget1: 10, profitTarget2: null, maxDailyLoss: 5, maxTotalDrawdown: 10,
      minTradingDays: 3, maxTradingDays: 14, profitSplit: 75, leverage: 100,
      instruments: ['FOREX','INDICES'], isActive: true, isPopular: false, sortOrder: 10,
    },
    {
      name: 'Express 50K', accountSize: 50000, price: 499, phase: 1,
      profitTarget1: 10, profitTarget2: null, maxDailyLoss: 5, maxTotalDrawdown: 10,
      minTradingDays: 3, maxTradingDays: 14, profitSplit: 75, leverage: 100,
      instruments: ['FOREX','INDICES'], isActive: true, isPopular: false, sortOrder: 11,
    },
  ]

  for (const c of challenges) {
    const exists = await prisma.challengeTemplate.findFirst({ where: { name: c.name } })
    if (!exists) {
      await prisma.challengeTemplate.create({ data: c })
      console.log(`✅ Challenge: ${c.name}`)
    }
  }

  // ── System settings ───────────────────────────────────────
  const settings = [
    { key: 'platform_name',        value: 'Nexus Funding' },
    { key: 'min_payout_usd',       value: '100' },
    { key: 'affiliate_commission', value: '10' },
    { key: 'kyc_required',         value: 'true' },
    { key: 'new_registrations',    value: 'true' },
  ]
  for (const s of settings) {
    await prisma.systemSetting.upsert({ where: { key: s.key }, update: {}, create: s })
  }

  console.log('✅ Seed complete')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
