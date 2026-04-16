-- CreateTable: data_collection_tabs
CREATE TABLE IF NOT EXISTS "data_collection_tabs" (
    "id" SERIAL NOT NULL,
    "template_id" INTEGER NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "icon" VARCHAR(100),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_collection_tabs_pkey" PRIMARY KEY ("id")
);

-- AddColumns: data_collection_sections
ALTER TABLE "data_collection_sections" ADD COLUMN IF NOT EXISTS "tab_id" INTEGER;
ALTER TABLE "data_collection_sections" ADD COLUMN IF NOT EXISTS "parent_section_id" INTEGER;
ALTER TABLE "data_collection_sections" ADD COLUMN IF NOT EXISTS "icon" VARCHAR(100);

-- AddColumn: data_collection_items
ALTER TABLE "data_collection_items" ADD COLUMN IF NOT EXISTS "width" VARCHAR(10);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "data_collection_tabs_template_id_sort_order_idx" ON "data_collection_tabs"("template_id", "sort_order");
CREATE INDEX IF NOT EXISTS "data_collection_sections_tab_id_sort_order_idx" ON "data_collection_sections"("tab_id", "sort_order");
CREATE INDEX IF NOT EXISTS "data_collection_sections_parent_section_id_sort_order_idx" ON "data_collection_sections"("parent_section_id", "sort_order");

-- AddForeignKey
ALTER TABLE "data_collection_tabs" ADD CONSTRAINT "data_collection_tabs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "data_collection_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_collection_sections" ADD CONSTRAINT "data_collection_sections_tab_id_fkey" FOREIGN KEY ("tab_id") REFERENCES "data_collection_tabs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_collection_sections" ADD CONSTRAINT "data_collection_sections_parent_section_id_fkey" FOREIGN KEY ("parent_section_id") REFERENCES "data_collection_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
