-- CreateTable
CREATE TABLE "subscription_payment_methods" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "store_subscription_id" INTEGER NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_token" TEXT NOT NULL,
    "last4" VARCHAR(4),
    "brand" VARCHAR(32),
    "expiry_month" VARCHAR(2),
    "expiry_year" VARCHAR(4),
    "card_holder" VARCHAR(128),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "state" VARCHAR(32) NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscription_payment_methods_store_id_state_idx" ON "subscription_payment_methods"("store_id", "state");

-- CreateIndex
CREATE INDEX "subscription_payment_methods_store_subscription_id_is_defau_idx" ON "subscription_payment_methods"("store_subscription_id", "is_default");

-- AddForeignKey
ALTER TABLE "subscription_payment_methods" ADD CONSTRAINT "subscription_payment_methods_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payment_methods" ADD CONSTRAINT "subscription_payment_methods_store_subscription_id_fkey" FOREIGN KEY ("store_subscription_id") REFERENCES "store_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
