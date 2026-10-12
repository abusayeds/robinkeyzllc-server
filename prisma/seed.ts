import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function seedAdmin() {
  const name = process.env.ADMIN_NAME ?? 'Admin';
  const email = process.env.ADMIN_EMAIL ?? 'admin@gmail.com';
  const phone = process.env.ADMIN_PHONE ?? '01700000000';
  const password = process.env.ADMIN_PASSWORD ?? '1qazxsw2';

  const hashedPassword = await bcrypt.hash(password, 10);

  // upsert keeps this safe to run again, and resets the password to the
  // configured one so the admin can always be recovered.
  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      password: hashedPassword,
      role: Role.admin,
      isDeleted: false,
      isEmailVerified: true,
    },
    create: {
      name,
      email,
      phone,
      password: hashedPassword,
      role: Role.admin,
      isEmailVerified: true,
    },
    select: { id: true, name: true, email: true, role: true },
  });

  console.log('Admin seeded:', admin);
}

seedAdmin()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
