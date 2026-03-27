-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_embeddings" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "metadata" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE UNIQUE INDEX IF NOT EXISTS "ai_embeddings_store_id_entity_type_entity_id_key" ON "ai_embeddings"("store_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "ai_embeddings_store_id_entity_type_idx" ON "ai_embeddings"("store_id", "entity_type");

-- HNSW vector index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS "ai_embeddings_embedding_idx" ON "ai_embeddings" USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
