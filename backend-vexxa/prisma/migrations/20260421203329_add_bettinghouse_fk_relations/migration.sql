-- AddForeignKey
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_bettingHouse_fkey" FOREIGN KEY ("bettingHouse") REFERENCES "betting_houses"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_counts" ADD CONSTRAINT "fraud_counts_bettingHouse_fkey" FOREIGN KEY ("bettingHouse") REFERENCES "betting_houses"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_data" ADD CONSTRAINT "affiliate_data_bettingHouse_fkey" FOREIGN KEY ("bettingHouse") REFERENCES "betting_houses"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_bettingHouse_fkey" FOREIGN KEY ("bettingHouse") REFERENCES "betting_houses"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_logs" ADD CONSTRAINT "commission_logs_bettingHouse_fkey" FOREIGN KEY ("bettingHouse") REFERENCES "betting_houses"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_logs" ADD CONSTRAINT "fraud_logs_bettingHouse_fkey" FOREIGN KEY ("bettingHouse") REFERENCES "betting_houses"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_snapshots" ADD CONSTRAINT "notification_snapshots_bettingHouse_fkey" FOREIGN KEY ("bettingHouse") REFERENCES "betting_houses"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;
