-- CreateEnum
CREATE TYPE "currency_format_style_enum" AS ENUM ('comma_dot', 'dot_comma', 'space_comma');

-- AlterTable
ALTER TABLE "currencies" ADD COLUMN "format_style" "currency_format_style_enum" NOT NULL DEFAULT 'comma_dot';
