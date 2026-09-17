-- Per-casa withdrawal frequency: weekly (weekday) + biweekly (2 monthly windows).
ALTER TABLE betting_houses
  ADD COLUMN "withdrawalDay2"    INTEGER,
  ADD COLUMN "withdrawalDay2End" INTEGER,
  ADD COLUMN "withdrawalWeekday" INTEGER;

-- Seed cadence per CEO directive (idempotent at migration time):
--   betnacional -> weekly, every Monday  (weekday = 1)
--   hiperbet    -> biweekly, days 1-2 and 15-16 of each month
UPDATE betting_houses SET "withdrawalWeekday" = 1
  WHERE "slug" = 'betnacional';

UPDATE betting_houses
   SET "withdrawalDay"     = 1,
       "withdrawalDayEnd"  = 2,
       "withdrawalDay2"    = 15,
       "withdrawalDay2End" = 16
 WHERE "slug" = 'hiperbet';
