/**
 * Removes the data the browser E2E run leaves behind in the development
 * database, so a rerun starts from a known state.
 *
 *   node scripts/e2e-cleanup.js
 *
 * It only ever touches accounts whose email starts with `e2e-buyer-` and the
 * orders, ledger rows and notifications those accounts own. Reserved kilograms
 * are handed back to the lots they were taken from.
 */
const { prisma } = require('../server/src/config/db');

async function main() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: 'e2e-buyer-' } },
    select: { id: true, email: true },
  });

  for (const user of users) {
    const orders = await prisma.order.findMany({ where: { buyerId: user.id } });
    for (const order of orders) {
      const items = Array.isArray(order.items) ? order.items : [];
      for (const item of items) {
        const kg = Number(item.reservedWeightKg ?? item.weightKg ?? 0);
        if (!item.inventoryLot || !(kg > 0)) continue;
        // Only undo a reservation the order still holds; committed stock stays sold.
        if (order.inventoryCommitted) continue;
        await prisma.inventoryLot.update({
          where: { id: item.inventoryLot },
          data: { reservedQuantityKg: { decrement: kg }, availableQuantityKg: { increment: kg } },
        });
        await prisma.marketplaceListing
          .updateMany({
            where: { inventoryLotId: item.inventoryLot },
            data: { reservedQuantityKg: { decrement: kg }, availableQuantityKg: { increment: kg } },
          })
          .catch(() => {});
      }
      await prisma.inventoryMovement.deleteMany({ where: { orderId: order.id } });
      await prisma.notification.deleteMany({ where: { relatedId: order.id } });
    }
    await prisma.order.deleteMany({ where: { buyerId: user.id } });
    await prisma.wasteSubmission.deleteMany({ where: { sellerId: user.id } });
    await prisma.wasteAuction.deleteMany({ where: { sellerId: user.id } });
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }

  const lots = await prisma.inventoryLot.findMany();
  const inconsistent = lots.filter(
    (l) =>
      l.availableQuantityKg < 0 ||
      Math.abs(
        l.availableQuantityKg + l.reservedQuantityKg + l.soldQuantityKg - l.acceptedQuantityKg
      ) > 0.01
  );
  const report = {
    removedUsers: users.map((u) => u.email),
    ordersRemaining: await prisma.order.count(),
    lotsChecked: lots.length,
    lotsInconsistent: inconsistent.length,
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.lotsInconsistent) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(String(err && err.stack ? err.stack : err).slice(0, 500));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
