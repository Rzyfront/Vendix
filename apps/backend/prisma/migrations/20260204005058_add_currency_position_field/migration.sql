-- CreateEnum
CREATE TYPE "currency_position_enum" AS ENUM ('before', 'after');

-- AlterTable
ALTER TABLE "currencies" ADD COLUMN     "position" "currency_position_enum" NOT NULL DEFAULT 'after';
